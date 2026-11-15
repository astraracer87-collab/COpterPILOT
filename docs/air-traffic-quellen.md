# Luftverkehr (Radar) – Datenquellen & Integrationsdoku

Übersicht über die Live-Luftverkehrsquellen von COpterPILOT: die aktiven
ADS-B-/OGN-Feeds (bereits integriert) und FlightRadar24 (geplante Zusatzquelle,
mit schriftlicher Zustimmung von FR24). Stand: 2026-11-15, Endpunkte live geprüft.

Analog zu den Geozonen-Dokumenten (`docs/geozonen-quellen-uebersicht.md`).

---

## 1. Architektur (Ist-Zustand)

- **Kein eigenes Backend mehr.** Die App aggregiert den Luftverkehr
  **clientseitig direkt** aus öffentlichen Quellen (React Native kennt kein
  CORS). Früher lief das über einen Server (`/api/traffic/v2/nearby`,
  `server/aggregator.ts` + `server/ogn.ts` mit TCP-APRS zu
  `aprs.glidernet.org:10152`).
- **Code:** `client/lib/traffic/`
  - `sources.ts` – Abruf jeder Quelle pro Kachel/Bounding-Box
  - `aggregator.ts` – mehrere Quellen parallel, mit Fallback
  - `merge.ts` – Zusammenführen/Deduplizieren (ein Flugzeug aus mehreren Feeds)
  - `classify.ts` – Kategorie (Flugzeug, Hubschrauber, Segelflugzeug, Ballon,
    Ultraleicht, **Drohne**, Bodenfahrzeug)
  - `geo.ts` – Geometrie/Kacheln · `types.ts` – `RawState`/`SourceResult`/`Tile`
- **Quellen-Gesundheit & Fallback:** `client/lib/trafficStatus.ts` +
  `client/lib/opensky.ts` tracken pro Quelle `ok`/`error`/`timeout`; Anzeige
  über `SourceHealthIndicator`.
- **Darstellung/Logik:** `TrafficMapView(.native).tsx`, `useAircraftTrails.ts`
  (Flugspuren), `ProximityAlarmBanner` + `useProximityAlarm` +
  `proximityAlarm.ts` (Näherungswarnung), Radar-Navigator.

---

## 2. Aktive Quellen (ADS-B / OGN – bereits integriert)

Aus `client/lib/traffic/sources.ts`. Alle **kostenlos, ohne API-Key**,
User-Agent `COpterPilot/1.0 (drone preflight app)`.

| Quelle | Endpoint | Inhalt |
|---|---|---|
| **adsb.fi** | `https://opendata.adsb.fi/api/v2` | ADS-B (Community) |
| **adsb.one** | `https://api.adsb.one/v2` | ADS-B |
| **airplanes.live** | `https://api.airplanes.live/v2` | ADS-B |
| **adsb.lol** | `https://api.adsb.lol/v2` | ADS-B |
| **OGN** (Open Glider Network / FLARM) | `https://live.glidernet.org/lxml.php` | Segelflug/FLARM, pro Bounding-Box; Meldungen > `OGN_MAX_AGE_SEC` (120 s) gelten als nicht mehr live |

Im `DataSource`-Typ (`client/lib/opensky.ts`) existieren zusätzlich `opensky`
und `fr24`; aktiv genutzt werden laut Code-Kommentar **adsb.lol,
airplanes.live, adsb.fi und OGN**. `fr24` steht auf `error` und wird derzeit
**nicht** abgefragt (siehe §3).

---

## 3. FlightRadar24 (geplante Zusatzquelle)

### 3.1 Rechtlicher Rahmen
- COpterPILOT ist **kostenlos**. FR24 wurde kontaktiert; sie sind **einverstanden,
  dass die App denselben Web-Feed nutzt, den auch die Webseite verwendet**,
  solange nichts bezahlt wird. Wer mehr braucht (die bezahlte API), zahlt wie
  alle anderen.
- → Genutzt wird der **inoffizielle `feed.js`-Web-Feed**, **nicht** die bezahlte
  API. Die Zustimmung von FR24 bitte schriftlich im Projekt ablegen.

### 3.2 Der Feed (live verifiziert 2026-11-15)
```
GET https://data-cloud.flightradar24.com/zones/fcgi/feed.js
    ?bounds=<Nord>,<Süd>,<West>,<Ost>
    &faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=1&air=1&vehicles=1
    &estimated=1&gliders=1&maxage=14400&stats=1&limit=5000
```
- **Host ist `data-cloud`** (nicht `data-live`; `data-live` nur für Flugdetails,
  siehe 3.5).
- **`bounds` = Nord,Süd,West,Ost** (kommagetrennt, ohne Leerzeichen).
- **Auth: keine** – kein API-Key, kein Login nötig. (Login fügt nur optional
  `enc=<Cookie _frPl>` hinzu.)
- **Header:** ein normaler Browser-`User-Agent` genügt. Optional wie die Webseite
  `origin`/`referer = https://www.flightradar24.com`.

### 3.3 ✅ Cloudflare-Befund (wichtig)
- Die **Webseite** `www.flightradar24.com` ist Cloudflare-geschützt (403 für
  automatisierte Clients).
- Der **Feed-Endpunkt `data-cloud.../feed.js` ist es NICHT** – er antwortet mit
  einem **einfachen Mobile-User-Agent mit HTTP 200** (live geprüft, 10 Flugzeuge
  im Hamburg-Ausschnitt, globaler `full_count` ~12 800).
- **Kein TLS-Impersonation-Trick nötig.** Damit kann **React Native den Feed
  direkt per `fetch`** abrufen (nur ein `User-Agent` setzen) – wie die ADS-B-
  Quellen. Der frühere Vermerk „FR24 nur mit Browser-UA nutzbar"
  (`aggregator.ts`) ist damit entschärft: Browser-UA reicht.
- ✅ **Inzwischen von DE-IP über mehrere Regionen bestätigt** (siehe §3.6): kein
  Block, keine Pflicht-Header, keine Drossel bis ~5 req/s. Langzeitverhalten
  bleibt offen → defensiv behandeln (Fallback, `sourceStatus`, Backoff).

### 3.4 Antwortformat
JSON-Objekt. Nicht-numerische Schlüssel (`full_count`, `version`, `stats`)
**überspringen**; jeder Schlüssel, der mit einer Ziffer beginnt, ist ein Flug
mit einem **Positions-Array**:

| Index | Feld | Beispiel |
|---|---|---|
| 0 | `icao24` (Hex) | `4D2528` |
| 1 | `latitude` | `53.3164` |
| 2 | `longitude` | `9.4182` |
| 3 | `heading` (Grad) | `79` |
| 4 | `altitude` (**Fuß**) | `36975` |
| 5 | `ground_speed` (**Knoten**) | `467` |
| 6 | `squawk` | `""` |
| 7 | Radar-/Empfänger-Code (Datenquelle) | `F-BDWY1` |
| 8 | `aircraft_code` (ICAO-Typ) | `A21N` |
| 9 | `registration` | `9H-WNB` |
| 10 | `time` (Unix) | `1794731836` |
| 11 | `origin_iata` | `LTN` |
| 12 | `destination_iata` | `VNO` |
| 13 | `flight_number` | `W61902` |
| 14 | `on_ground` (0/1) | `0` |
| 15 | `vertical_speed` (fpm) | `-64` |
| 16 | `callsign` | `WZZ8409` |
| 17 | (Zahl, meist 0) | `0` |
| 18 | `airline_icao` | `WZZ` |

Umrechnung für euer Modell: Fuß → Meter (`× 0.3048`), Knoten → m/s
(`× 0.514444`), fpm → m/s (`× 0.00508`) – die Helfer existieren schon in
`sources.ts` (`feetToMeters`, `knotsToMs`, `fpmToMs`).

### 3.5 Flugdetails (optional, bei Klick)
```
GET https://data-live.flightradar24.com/clickhandler/?flight=<flight_id>
```
(`flight_id` = der JSON-Schlüssel aus dem Feed.) Nicht für die Kartenanzeige
nötig, nur für Detailpanel.

### 3.6 Belegt durch
- **Live-Abruf** (2026-11-15): `data-cloud.../feed.js` → HTTP 200 + echte Flüge.
- **FlightRadarAPI** (`JeanExtreme002/FlightRadarAPI`, Python) – gleicher Feed,
  bestätigt URL/Parameter/Feld-Mapping (nutzt `curl_cffi`-TLS-Impersonation nur
  vorsichtshalber; für den Feed selbst nicht zwingend, siehe 3.3).
- **home-assistant-flightradar24** (`AlexandrErohin`) – nutzt dieselbe Library.
- **FlightRadar** (`j4asper/FlightRadar`, C#) – nutzt dagegen die **bezahlte**
  offizielle API (`https://fr24api.flightradar24.com/api/live/flight-positions/…`,
  Bearer-Key, `Accept-Version: v1`); für COpterPILOT **nicht** vorgesehen
  (kostenpflichtig).

---

## 4. Integrationsauftrag: FR24 als Quelle ergänzen

### Schritte
1. **`client/lib/traffic/sources.ts`:**
   - `export const FR24_FEED_URL = "https://data-cloud.flightradar24.com/zones/fcgi/feed.js";`
   - Neue Fetch-Funktion analog zu den ADS-B-Quellen: Bounding-Box →
     `bounds=Nord,Süd,West,Ost` + Default-Parameter (§3.2), `fetchWithTimeout`
     mit `User-Agent`.
   - Parser: `Object.entries(json)` → nicht-numerische Keys überspringen → pro
     Array ein `RawState` (Feld-Mapping §3.4, Einheiten umrechnen). `icao24`
     als Hex; synthetische Targets ohne Hex ggf. mit `fr24-`-Präfix (passt zur
     bestehenden `merge.ts`-Logik, die `fr24-*` ans Ende sortiert).
2. **`client/lib/traffic/aggregator.ts`:** `fr24` als Quelle aktivieren (ist
   derzeit ausgeschlossen) und in die `sourceStatus`-Fallback-Logik aufnehmen.
3. **`client/lib/classify.ts`:** FR24-`aircraft_code`/Kategorie auf das
   interne Kategorie-Schema mappen (viele Codes sind schon abgedeckt).
4. **Polling:** sinnvolles Intervall (~5–8 s pro Ausschnitt wie die Webseite),
   Bounding-Box nicht zu groß; `maxage` begrenzt alte Positionen.
5. **Tests:** Parser-Test mit einer eingecheckten Beispiel-Antwort (Fixture),
   Einheiten-Umrechnung, Skip der nicht-numerischen Keys.

### 4.1 Fertiger Code (copy-paste in `client/lib/traffic/sources.ts`)

Passt zu den vorhandenen Helfern der Datei (`feetToMeters`, `knotsToMs`,
`fpmToMs`, `fetchWithTimeout`, `str`, `isAbortError`, `tileToBbox`) und dem
`RawState`-Typ. `refineCategoryByType` aus `./classify` importieren
(der Import von `parseAdsbCategory` ist schon da → ergänzen).

```ts
// --- Import oben in sources.ts ergänzen ---
import { parseAdsbCategory, refineCategoryByType } from "./classify";

// --- Endpoint-Konstante zu den anderen URLs ---
export const FR24_FEED_URL = "https://data-cloud.flightradar24.com/zones/fcgi/feed.js";

// --- FR24-Feldindizes (siehe §3.4) ---
const FR24 = {
  HEX: 0, LAT: 1, LON: 2, TRACK: 3, ALT_FT: 4, GSPD_KT: 5, SQUAWK: 6,
  RADAR: 7, TYPE: 8, REG: 9, TIME: 10, ORIG: 11, DEST: 12, FLIGHT: 13,
  ON_GROUND: 14, VSPD_FPM: 15, CALLSIGN: 16, AIRLINE_ICAO: 18,
} as const;

/** Parst eine FR24-feed.js-Antwort in RawState[] (nicht-numerische Keys werden übersprungen). */
export function parseFr24Feed(data: Record<string, unknown>): RawState[] {
  const out: RawState[] = [];
  for (const [id, raw] of Object.entries(data)) {
    if (!/^[0-9]/.test(id)) continue;              // full_count/version/stats überspringen
    const a = raw as unknown[];
    if (!Array.isArray(a) || a.length < 17) continue;
    const lat = a[FR24.LAT] as number, lon = a[FR24.LON] as number;
    if (typeof lat !== "number" || typeof lon !== "number") continue;

    const hex = ((a[FR24.HEX] as string) || "").toLowerCase().trim();
    const icao24 = hex.length >= 3 ? hex : `fr24-${id}`;   // synthetische Targets → fr24-* (merge.ts)
    const type = str(a[FR24.TYPE]);
    const onGround = a[FR24.ON_GROUND] === 1 || a[FR24.ON_GROUND] === "1";

    out.push({
      icao24,
      callsign: ((a[FR24.CALLSIGN] as string) || "").trim(),
      originCountry: "",
      longitude: lon,
      latitude: lat,
      baroAltitude: onGround ? 0 : feetToMeters(typeof a[FR24.ALT_FT] === "number" ? (a[FR24.ALT_FT] as number) : null),
      geoAltitude: null,
      onGround,
      velocity: knotsToMs(typeof a[FR24.GSPD_KT] === "number" ? (a[FR24.GSPD_KT] as number) : null),
      trueTrack: typeof a[FR24.TRACK] === "number" ? (a[FR24.TRACK] as number) : null,
      verticalRate: typeof a[FR24.VSPD_FPM] === "number" ? fpmToMs(a[FR24.VSPD_FPM] as number) : null,
      category: refineCategoryByType("airplane", type, str(a[FR24.REG])),
      sources: ["fr24"],
      registration: str(a[FR24.REG]),
      aircraftType: type,
      operator: str(a[FR24.AIRLINE_ICAO]),
      originIata: str(a[FR24.ORIG]),
      destIata: str(a[FR24.DEST]),
      flightNumber: str(a[FR24.FLIGHT]),
    });
  }
  return out;
}

async function fetchFr24Tile(tile: Tile): Promise<SourceResult> {
  try {
    const b = tileToBbox(tile);
    // FR24-bounds = Nord,Süd,West,Ost
    const bounds = `${b.latMax.toFixed(3)},${b.latMin.toFixed(3)},${b.lonMin.toFixed(3)},${b.lonMax.toFixed(3)}`;
    const params = new URLSearchParams({
      bounds, faa: "1", satellite: "1", mlat: "1", flarm: "1", adsb: "1",
      gnd: "1", air: "1", vehicles: "1", estimated: "1", gliders: "1",
      maxage: "14400", stats: "0", limit: "5000",
    });
    const res = await fetchWithTimeout(`${FR24_FEED_URL}?${params.toString()}`, 8000);
    if (res.status === 429 || res.status === 403) return { states: [], status: "error", rateLimited: true };
    if (!res.ok) return { states: [], status: "error" };
    const data = (await res.json()) as Record<string, unknown>;
    return { states: parseFr24Feed(data), status: "ok" };
  } catch (e) {
    return { states: [], status: isAbortError(e) ? "timeout" : "error" };
  }
}

async function fetchFr24(tiles: Tile[]): Promise<SourceResult> {
  const results = await Promise.all(tiles.map((t) => fetchFr24Tile(t)));
  const anyOk = results.some((r) => r.status === "ok");
  const status: SourceStatus = anyOk ? "ok" : (results[0]?.status ?? "error");
  const rateLimited = results.some((r) => r.rateLimited);
  const dedup = new Map<string, RawState>();
  for (const r of results) {
    for (const s of r.states) {
      if (!s.icao24) continue;
      if (!dedup.has(s.icao24)) dedup.set(s.icao24, s);
    }
  }
  return { states: Array.from(dedup.values()), status, rateLimited };
}
```

**Im Dispatcher `fetchSource` den FR24-Zweig ersetzen** (derzeit liefert
`case "fr24"` leer):
```ts
    case "fr24": return fetchFr24(tiles);
    case "opensky":
      return { states: [], status: "error" };   // OpenSky bleibt clientseitig aus
```

**In `aggregator.ts`** `"fr24"` in die Liste der abzufragenden Quellen
aufnehmen (dort, wo `adsbfi`/`airplaneslive`/`adsblol`/`ogn` stehen) und den
veralteten Kommentar „FR24 entfällt clientseitig" entfernen. Die
`sourceStatus`-/Fallback-Logik greift dann automatisch.

**Parser-Test** (`client/lib/traffic/__tests__/`): eine kleine echte Antwort als
Fixture einchecken und prüfen:
```ts
const data = { full_count: 12798, version: 4,
  "4294b831": ["4D2528",53.3164,9.4182,79,36975,467,"","F-BDWY1","A21N","9H-WNB",1794731836,"LTN","VNO","W61902",0,-64,"WZZ8409",0,"WZZ"] };
const s = parseFr24Feed(data);
// erwartet: 1 State, icao24="4d2528", aircraftType="A21N", registration="9H-WNB",
// callsign="WZZ8409", velocity≈240 m/s, baroAltitude≈11270 m, full_count übersprungen
```

### Einordnung
- FR24 als **Zusatzquelle mit Fallback**, nicht als alleinige – der inoffizielle
  Feed kann sich ändern. Die ADS-B-/OGN-Quellen bleiben die Basis.
- Vorteil FR24: zeigt auch MLAT-/geschätzte/Nicht-ADS-B-Flüge, die die reinen
  ADS-B-Feeds nicht haben.

---

## 5. Offene Punkte
1. **Auf echtem Gerät testen:** Kommt der RN-`fetch` (Android/iOS-HTTP-Stack)
   durch FR24s Cloudflare? Hier (Server-Egress) ja; Geräte-IPs können abweichen.
2. **Rate-Limits:** FR24 nennt keine; defensiv pollen, Bounding-Box klein halten.
3. **Zustimmung** von FR24 schriftlich im Projekt ablegen.
4. Prüfen, ob `feed.js` bei Lastspitzen leere Hüllen (`full_count` > 0, aber
   keine Flüge) liefert – die Python-Library droppt dann die Cookies
   `AWSALB`/`AWSALBCORS` und wiederholt (FEED_EMPTY_RETRIES). Für RN ggf.
   einfacher Retry.

---

## 6. Schnelltest
```bash
UA="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile"
curl -s -A "$UA" "https://data-cloud.flightradar24.com/zones/fcgi/feed.js?bounds=53.9,53.0,9.0,10.5&adsb=1&mlat=1&estimated=1&gliders=1&limit=5000" \
  | jq 'to_entries | map(select(.key|test("^[0-9]"))) | {n: length, sample: .[0].value}'
```

---

## 3.6 ✅ Verifiziert von DE-IP (2026-11-15) – alle Testpunkte bestanden

Gegenprüfung des Testplans (T1–T10) von einer **DE/Vodafone-IP** mit echten
`curl`-Abrufen. **Gesamturteil: der Feed ist ohne jede Hürde nutzbar** – kein
Cloudflare-Block, keine Pflicht-Header, keine spürbare Drosselung. **Freigegeben.**

| Test | Ergebnis |
|---|---|
| T1 Grundabruf | HTTP **200**, valides JSON (`full_count`, `version:4`, echte Flüge) |
| T2 Header | **ohne jeden Header 200** (auch ohne User-Agent); `origin`/`referer` **nicht** nötig → in RN reicht schlichtes `fetch(url)` |
| T3 Rate-Limit | 20 Abrufe in 3,8 s (~5,3 req/s) → **20× 200**, keine 429 |
| T4 Bounds | `full_count` = **globaler** Zähler (~18,5k), **nicht** in-bounds. DE-Bounds 510 Flüge, EU-Bounds 1.442 → weit unter `limit=5000`, keine Kappung |
| T5 Feldschema | **1:1 bestätigt** (Ryanair NRN→AGP); ft/kt/fpm |
| T6 Keys | `stats=1` → `stats`-Block; Nicht-Ziffer-Keys (`full_count`/`version`/`stats`) überspringen |
| T7 ohne Hex | 16/510 (~3 %) ohne `icao24` (MLAT/estimated) → `fr24-<id>` |
| T8 Mehrwert | vs. adsb.lol: 392 Hex überlappen (Dedupe), **102 nur FR24** + 16 Hex-lose → **additiv** |
| T9 Detail | `clickhandler/?flight=<id>` → 200, 23 KB, **ohne Auth** |
| T10 Stabilität | DE/EU/Nordmeer alle 200; **leere Region → nur `full_count`/`version`, 0 Flüge** |

### Konsequenzen für die Umsetzung (bestätigt)
1. **Keine Header nötig** – `fetch(url)` genügt (optional Mobile-UA, schadet nicht).
2. **Poll-Intervall:** kein Limit bis ~5 req/s; konservativ **≥ 4–5 s** je Abruf.
   **Keine Kachelung** für lokale Ausschnitte; erst kacheln, wenn die **gelieferte
   Key-Zahl** `limit` erreicht. ⚠️ `full_count` ist **global**, nicht die
   Ausschnitts-Zahl – für Kappungserkennung die Key-Zahl gegen `limit` prüfen.
3. **Feldschema** bestätigt (§3.4-Tabelle gilt 1:1).
4. **Defensive-Handling (Pflicht):** Antwort kann nur `full_count`/`version` sein
   (→ 0 Targets, kein Fehler); Hex-lose → `fr24-<id>`; Dedupe über `icao24`,
   FR24-Only behalten; bei 403/429/leer → Fallback + `sourceStatus` + Backoff.

### Offen / Einschränkung
- **Langzeit** (Stunden, viele Tageszeiten) nicht dauergetestet – nur
  Momentaufnahmen über mehrere Regionen. FR24 kann die Regeln jederzeit ändern →
  das Defensive-Handling (4.) ist der Schutz, gelegentlich nachmessen.
- **FR24-Zustimmung schriftlich ablegen** (gleiche Nutzung wie die Webseite,
  solange nichts bezahlt wird).
