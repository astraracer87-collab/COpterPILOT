# Austro Control Dronespace (AT) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **utm.dronespace.at** (Austro Control, UTM-Plattform
„Skyzr“/Frequentis-basiert, Client-Version 1.57.26). Stand: 2026-11-15. Alle
Angaben wurden live geprüft, sofern nicht als „ungetestet“ markiert.

Vergleichsdokument für die Niederlande: `docs/godrone-api-integration.md`.

---

## 1. Kurzfassung

- Die öffentliche Karte unter `https://utm.dronespace.at/avm/` ist eine
  MapLibre-App. Sie lädt die Geozonen als **ED-269-GeoJSON** von
  `utm/uas.geojson`. Dafür braucht es **keine Authentifizierung und keinen
  API-Key**.
- **COpterPILOT nutzt diesen Feed bereits**
  (`AT_GEOZONES_URL` in `client/lib/geozoneDirect/ed269Sources.ts`,
  `fetchAustria()`).
- **Gefundener Fehler:** Ohne Zeitparameter liefert der Server nur die
  **in diesem Moment aktiven** Zonen. Je nach Uhrzeit des täglichen Abrufs
  fehlen zeitgesteuerte Zonen, z. B. militärische Nahkontrollbezirke (MTMA),
  die nur werktags tagsüber aktiv sind. Gemessen: Nachts (02:00 UTC) kamen
  **283** Zonen, mit Zeitfenster **292**. → **Fix siehe §5.1.**
- Zusätzlich gibt es einen Höhenwind-Endpunkt, Terrain-Kacheln
  (Terrarium-DEM) und einen socket.io-Push, der Zonenänderungen meldet.

---

## 2. Zugang

| Punkt | Wert |
|---|---|
| Basis | `https://utm.dronespace.at/avm/` |
| Auth für Geozonen / Wetter / Terrain | keine |
| User-Agent | Browser-UA setzen. Ohne UA kommt teils 403/Redirect, das ist im Repo schon berücksichtigt (`BROWSER_UA`) |
| Kompression | `Accept-Encoding: gzip`. Die Vollantwort ist ca. 3,6 MB unkomprimiert |
| Konfiguration im HTML | `window.ENV = {"HOST":"https://utm.dronespace.at/avm/","BASE_URL":"https://utm.dronespace.at","RELATIVE_PATH":"/avm/","VERSION":"1.57.26","TS":…}` |

Login-Bereiche (`auth/skyzr/*`, Keycloak/OpenID) sind nur für registrierte
Betreiber gedacht und für die Geozonen nicht nötig.

---

## 3. Endpunkt `GET utm/uas.geojson` (Geozonen)

```
GET https://utm.dronespace.at/avm/utm/uas.geojson
    [?start=<ISO>&end=<ISO>&buffer=<min>]
    [&bounds=<w>,<s>,<e>,<n>]
```

### 3.1 Parameter (so baut die Web-App sie in `fetchUAS()` zusammen)

| Parameter | Bedeutung | Getestet |
|---|---|---|
| *(keiner)* | nur die **jetzt** aktiven Zonen | 283 Zonen um 02:00 UTC |
| `start`, `end` (ISO-8601, UTC) | Zonen, die in diesem Zeitraum aktiv sind | `start=jetzt&end=+1 Jahr` → **292 (vollständig)** |
| `buffer` (Minuten) | erweitert das Zeitfenster | `start=end=jetzt&buffer=525600` → 292 |
| `bounds=w,s,e,n` | ganzzahlige Grad (die App rundet mit floor/ceil) | `16,48,17,49` → 35 Zonen |

Ein Zeitpunkt werktags um 07:00 UTC liefert ebenfalls 292, nachts 283. Die
Differenz sind 9 MTMA-Zonen (LOXZ1/4/5, LOXT1 …) mit Wochentags-Schedules.

### 3.2 Antwort

Reine `FeatureCollection` ohne Zusatzfelder. Jedes Feature hat
`geometry.type = "Polygon"` (WGS84). In `properties` steckt **ED-269 (UAS
Geographical Zone)** mit einigen Erweiterungen:

| Feld | Beispiel | Hinweis |
|---|---|---|
| `zoneId` | UUID | stabil, zum Deduplizieren |
| `identifier` | `acg_163` | |
| `country` | `AUT` | |
| `name` | `CTR LOWW`, `LO R 1`, `MTMA LOXZ4` | |
| `type` | `COMMON` | immer |
| `restriction` | `REQ_AUTHORISATION` (≈79 %), `NO_RESTRICTION`, `CONDITIONAL`, `PROHIBITED` | ED-269-Standardwerte |
| `reason` | `Air traffic`, `Nature`, `Noise`, `Sensitive` | |
| `region` | `0`–`9` | interne Region |
| `regulationExemption` | `YES` | |
| `message` | „Hubschrauberlandeplatz Weiz LKH (LOGE)“ | Kurztitel |
| `extendedProperties.localizedMessages[]` | `{language:"de-AT"\|"en", message}` | **HTML** (`<b>`, `<a>`), ausführlicher Rechtstext |
| `extendedProperties.legalBasis` / `legalBasisURL` | „LVR 2014 § 18b Abs. 2“ / RIS-Link | |
| `extendedProperties.authorityRequirementConditions[]` | `{authority, condition:"EXCLUDED/LOS=VLOS/ALTITUDE_AGL_MAX=30/MTOM_G_MAX=249"}` | **Ausnahme**: < 250 g, VLOS, ≤ 30 m AGL ist in CTRs ausgenommen |
| `applicability[]` | `{permanent:"YES"\|"NO", startDateTime, endDateTime, schedule:[{day:["MON",…], startTime:"06:00Z", endTime:"14:30Z"}]}` | mehrere Einträge möglich (Sommer-/Winterzeit) |
| `zoneAuthority[]` | `{name, siteURL, email, purpose:"AUTHORIZATION"\|"NOTIFICATION"}` | |
| `geometry` (in den properties!) | `{uomDimensions:"M"\|"FT", lowerLimit, lowerVerticalReference:"AGL", upperLimit, upperVerticalReference:"AGL", horizontalProjection}` | ED-269-Original, dupliziert die Feature-Geometrie |
| `lower` / `upper` | `"SFC"`, `"UNL"`, `"150 M AGL"` | Anzeige-Strings |
| `lowerMeters` / `upperMeters` | `0` / `10000` | **bereits in Metern**. `10000` bedeutet UNL |
| `airspacetype`, `airspaceclass` | `other` / `CTR`, `LOGE` … | |
| `hidden` | `true` bei 6 „Systemzonen“ | **ausblenden**, das passiert bereits in `client/lib/ed269.ts` |
| `metaData` | `{creationDateTime, updateDateTime, author}` | |

Höhenbezug: Fast alle Zonen haben AGL in Metern, 5 Zonen haben `FT`.

---

## 4. Weitere Endpunkte

| Endpunkt | Status | Inhalt |
|---|---|---|
| `GET weather/wind?alt=<m>&bbox=<w>,<n>,<e>,<s>` | ✅ 200 | Höhenwind-Raster mit 0,5°-Auflösung als GeoJSON-Points `{i, j, windDirection, windSpeed}`. Ohne `bbox` kommt ein globales Grobraster. Die Einheit von `windSpeed` ist nicht dokumentiert (vermutlich m/s, **prüfen**). Die bbox-Reihenfolge laut Client-Code ist links-oben-lng, links-oben-lat, rechts-unten-lng, rechts-unten-lat |
| `GET map/terrain_<TS>/{z}/{x}/{y}` | ✅ 200 | DEM-Kacheln im **Terrarium**-Format, maxzoom 13. `<TS>` steht in `window.ENV.TS` und ändert sich mit dem Deployment |
| `GET utm/operationplans.geojson` | ✅ 200 | öffentlich leer (`features: []`). Echte Flugpläne gibt es nur mit Login |
| `utm/operationplans.json?active` | ❌ 500 | ohne Login |
| `utm/reservations.geojson` | ❌ 504 (Timeout) | |
| `weather/ee/*`, `weather/metars.geojson` | – | Estland-Wetter bzw. 404, für AT irrelevant (die Plattform ist white-label) |
| Basiskarte | – | Vektor-Stil „openmaptiles“ und Wolken-Kacheln `https://flyk.com/cloudtiles/{z}/{x}/{y}.png`, nicht übernehmen |
| socket.io `https://utm.dronespace.at` mit `path:"/avm/socket.io/"` | ungetestet | Events: `uas` (Zonen geändert, löst bei der Web-App einen Neuabruf aus), `alert`, `operationplan`, `telemetry`, `time` |
| `utm/operationplan/*`, `utm/reserve`, `utm/pay`, `auth/skyzr/*` | ungetestet | Fluganmeldung/Bezahlung, nur mit Login, **nicht** anfassen |

---

## 5. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- `client/lib/geozoneDirect/ed269Sources.ts` → `fetchAustria()` holt
  `AT_GEOZONES_URL` **ohne Parameter**. Danach folgen `finalize(…, "at")` und
  `normalizeAustrianEd269Placeholder` (MATZ/MCTR mit Platzhalter-Enddatum 2100).
- `client/lib/ed269.ts` filtert `hidden` und nutzt `localizedMessages`.
- `shared/ed269SourceInfo.ts` nutzt `legalBasisURL` und
  `authorityRequirementConditions`.
- `shared/ed269Restriction.ts`:
  - `ed269ValidityFromProps` (min/max über alle `applicability`)
  - `ed269ScheduleFromProps` (Schedules als Text)
  - `ed269IsNotamEligible`
- Test: `client/lib/__tests__/austriaGeozones.test.ts`.

### 5.1 Pflicht-Fix: vollständigen Zonenbestand laden
`fetchAustria()` auf ein Zeitfenster umstellen:

```ts
const start = new Date();
const end = new Date(start.getTime() + 365 * 24 * 3600 * 1000);
const url = `${AT_GEOZONES_URL}?start=${start.toISOString()}&end=${end.toISOString()}`;
```

- Damit kommen alle 292 Zonen inkl. aller zeitgesteuerten Zonen, unabhängig
  von der Abrufzeit.
- Testfall ergänzen: Die URL enthält `start`/`end`, und der Test in
  `client/lib/__tests__/geozoneCoverage.test.ts` (prüft
  `startsWith("https://utm.dronespace.at/")`) bleibt grün.

### 5.2 Aktivität nach Schedule auswerten (empfohlen)
Mit dem vollständigen Bestand landen auch Zonen auf dem Gerät, die gerade
**nicht** aktiv sind, z. B. MTMA Mo–Do 07:00–15:30Z. Heute kennt die App
dafür nur ein min/max-Fenster und eine Textanzeige.

- Neue Funktion `ed269IsActiveAt(p, date)` in `shared/ed269Restriction.ts`.
  Eine Zone ist aktiv, wenn ein Eintrag in `applicability` passt:
  - `permanent === "YES"`, **oder**
  - `start ≤ date ≤ end` **und** (kein `schedule` **oder** ein
    Schedule-Eintrag passt auf Wochentag und Uhrzeit)
  - `startTime`/`endTime` sind UTC mit Suffix `Z`, `day` ist ein Array aus
    `MON`…`SUN` (optional auch `ANY`).
- In der Karte inaktive Zonen abgeschwächt darstellen und im Popup „aktiv
  Mo–Do 07:00–15:30 UTC“ zeigen. Für die Flugprüfung zählt der
  **geplante Flugzeitpunkt**.
- Tests:
  - LOXZ4 aus einer gekürzten Fixture: Do 10:00Z aktiv, Sa 10:00Z inaktiv,
    Do 16:00Z inaktiv
  - Winter- vs. Sommereintrag

### 5.3 Ausnahme für < 250 g in CTRs (fachlich prüfen)
`authorityRequirementConditions[].condition` hat das Format
`EXCLUDED/LOS=VLOS/ALTITUDE_AGL_MAX=30/MTOM_G_MAX=249`. Die Bedingungen werden
schon angezeigt (`ed269SourceInfo.ts`). Optional könnte die App den String
parsen und bei passendem Drohnenprofil (MTOM < 250 g, VLOS, geplante Höhe
≤ 30 m) „ausgenommen“ statt „Genehmigung nötig“ anzeigen.

### 5.4 Optional
- **Höhenwind** (`weather/wind`): als Wetter-Overlay oder Hinweis bei der
  Flugplanung, nur für AT/Umgebung. Die Einheit vorher klären.
- **Terrain-DEM**: Geländehöhe für die Umrechnung MSL ↔ AGL. Das ist
  relevant für andere Quellen, z. B. NL-`Msl`-Zonen. Die URL enthält den
  Deployment-Timestamp `TS`, also vorher `index.html` lesen oder eine eigene
  DEM-Quelle nutzen.
- **socket.io-Event `uas`**: Damit ließen sich Änderungen sofort statt erst
  täglich laden. Der Aufwand (socket.io-Client in RN, Hintergrundverbindung)
  steht aber kaum im Verhältnis. Ein täglicher Abruf plus Abruf beim
  App-Start reicht.

### Refresh
Unverändert täglich über `ed269Store.ts`. Mit dem Zeitfenster aus §5.1
hängt die Vollständigkeit nicht mehr von der Abrufzeit ab.

---

## 6. Offene Punkte

- **Einheit von `windSpeed`** im Wind-Endpunkt (vermutlich m/s).
- **Dauerhaftigkeit:** Ist `utm/uas.geojson` als öffentliche Schnittstelle
  gedacht? Er wird seit Langem stabil genutzt. Optional bei
  dronespace@austrocontrol.at nachfragen.
- **Darstellung inaktiver Zonen:** Ob zeitgesteuerte, gerade inaktive Zonen
  in der Karte erscheinen sollen (abgeschwächt) oder ausgeblendet werden,
  ist eine Produktentscheidung.

---

## 7. Schnelltest

```bash
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
S=$(date -u +%Y-%m-%dT%H:%M:%S.000Z); E=$(date -u -d '+1 year' +%Y-%m-%dT%H:%M:%S.000Z)
# ohne Zeitfenster (nur jetzt aktiv) vs. mit Zeitfenster (vollständig)
curl -s --compressed -A "$UA" "https://utm.dronespace.at/avm/utm/uas.geojson" | jq '.features|length'
curl -s --compressed -A "$UA" "https://utm.dronespace.at/avm/utm/uas.geojson?start=$S&end=$E" \
  | jq '{n:(.features|length), restr:([.features[].properties.restriction]|group_by(.)|map({(.[0]):length})|add)}'
```
