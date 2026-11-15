# PANSA DroneMap (PL) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **dronemap.pansa.pl** (Polska Agencja Żeglugi Powietrznej,
PAŻP / PANSA). Stand: 2026-11-15. Freigabe von PANSA liegt laut Product Owner
schriftlich vor.

Vergleich: `docs/godrone-api-integration.md` (NL),
`docs/dronespace-at-api-integration.md` (AT),
`docs/dflight-it-api-integration.md` (IT),
`docs/luxembourg-geozones-integration.md` (LU),
`docs/ireland-geozones-integration.md` (IE).

---

## 1. Kurzfassung

- PANSA liefert die Drohnen-Zonen (DRA – Drone Restricted Areas) und
  Luftraumstrukturen über eine API unter **`api.dronemap.pansa.pl`**.
- **Format ist KML**, nicht ED-269/GeoJSON. (`application/vnd.google-earth.kml+xml`)
- **Zwei-Schritt-Auth:** API-Key als Header `x-api-key` → Login holt einen
  Bearer-Token → Datenabruf mit `Authorization: Bearer`.
- Es gibt einen **öffentlichen Standard-API-Key**, den das offizielle
  QGIS-Plugin „PANSA DroneMap Downloader" mitliefert
  (`4b705300-8dfa-11ee-b9d1-0242ac120002`). Mit der schriftlichen PANSA-Freigabe
  sollte zusätzlich geklärt werden, ob ihr einen **eigenen Key** bekommt
  (Rate-Limits, Haftung).
- ⚠️ **Nicht aus dieser Umgebung testbar:** `api.dronemap.pansa.pl` und
  `dronemap.pansa.pl` sind vom US-Egress dieses Proxys **nicht erreichbar**
  (vermutlich Geo-Filter auf EU/PL-IPs; Verbindung bricht ab). Die unten
  dokumentierte Schnittstelle stammt **verifiziert aus dem Quellcode des
  offiziellen QGIS-Plugins** (plugins.qgis.org/plugins/pansa_dronemap_downloader,
  Autor KELM Solutions), nicht aus einem eigenen Live-Abruf. Vor dem Bau von
  einer PL-/EU-IP aus gegenprüfen.

---

## 2. Auth & Endpunkte (aus dem QGIS-Plugin, v1.1)

> ✅ **Live verifiziert von DE-IP (2026-11-15):** Abruf erfolgreich, **1.774 Zonen**
> (DRAP/DRAR/DRAI) als KML. Host `api.dronemap.pansa.pl` ist von einer EU-IP
> erreichbar (aus der US-Cloud geblockt). Fixtures lokal: `fixtures/pansa_kml_filtered.kml`,
> `fixtures/pansa_zones_types.json`. OpenAPI-Spec öffentlich: `GET /v3/api-docs`.

### Schritt 1 – Login (Bearer-Token holen)
```
POST https://api.dronemap.pansa.pl/v1/front/login
x-api-key: <API-Key>
Origin: https://dronemap.pansa.pl
(Body leer)

→ 200 { "access_token": "<bearer>", ... }      # Feld heißt access_token (nicht token)
```

### Schritt 2 – Daten (mit **beiden** Headern: `x-api-key` + `Authorization: Bearer`)
```
GET https://api.dronemap.pansa.pl/v1/kml/filtered?extrude=false&types=<CSV>&max=<alt_m>
x-api-key: <API-Key>
Authorization: Bearer <access_token>
Accept: application/vnd.google-earth.kml+xml
→ 200 KML
```
- `max` = **Höhengrenze in Metern** (NICHT die Zonenanzahl). `≥ 500` deaktiviert
  den Höhenfilter praktisch.
- `types` = kommagetrennte Liste der Klassen (siehe §3).

**Weitere öffentliche Endpunkte** (gleiche Header):
- `GET /v1/zones/filtered?lon=&lat=&range=&max_height=120` – Zonen als JSON (Punkt+Radius)
- `GET /v1/zones` · `GET /v1/zones/types` · `GET /v1/notams` · `GET /v1/activ/*`
- `GET /v3/api-docs` – **öffentliche OpenAPI-Spec** (beste Referenz für alle Felder/Endpunkte)

> Hinweis: Das Plugin nutzt `verify=False` (TLS-Prüfung aus). **Nicht
> übernehmen** – mit korrekter Zertifikatsprüfung arbeiten.

---

## 3. Zonentypen (`types`)

**Drohnen-Geozonen (Kern):**

| Code (`types`) | Expandiert zu (Plugin) | Bedeutung |
|---|---|---|
| `DRAP` | `DRAP, DRA-P, ATZ1KM, ATZ6KM, CTR1KM, CTR6KM, MCTR2KM` | DRA **Prohibited** – Flugverbot (inkl. Ringe um Flugplätze) |
| `DRAR` | `DRAR, DRA-R` | DRA **Restricted** – Genehmigung nötig |
| `DRAI` | `DRAI, DRA-I` | DRA **Information** – Hinweiszone |

**Luftraumstrukturen (optional als Kontext):**
`CTR, TMA, ATZ, MCTR, MTMA, MATZ, RMZ, ADIZ, TRA, TSA, MRT, TFR, RPA, P, R, D`.

Geozonen-Kategorien im KML: `G1`–`G4` (Risiko-/Höhenkategorien; genaue
Bedeutung aus der KML-Antwort ableiten).

Für die reine Geo-Awareness genügt `types=DRAP,DRAR,DRAI`. Für eine
vollständige Karte zusätzlich die Luftraumstrukturen.

---

## 4. Ergänzende reichbare Quelle: `airspace.pansa.pl` (AUP/UUP)

Erreichbar (HTTP 200) ist das **AUP/UUP-System** (Airspace Use Plan,
Luftraum-Aktivierungen):
- `https://airspace.pansa.pl/aup/current`, `.../aup/next` (HTML mit
  eingebetteten Daten)
- Live-Updates über SockJS/WebSocket (`/meta/configuration`,
  `/topic/new-use-plans`, `/filters`)

Das sind **temporäre Luftraum-Aktivierungen** (NOTAM-ähnlich), nicht die
statischen Drohnen-Geozonen. Als zusätzlicher „heute aktiv"-Layer interessant,
ersetzt aber nicht die DRA-Zonen aus §2.

---

## 5. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- PL ist in der App nur verlinkt (`shared/countryMaps.ts`), keine Geodaten.
- Die vorhandene Vektor-Pipeline (`ed269Sources.ts`) ist auf **ED-269/GeoJSON**
  ausgelegt. PANSA liefert **KML** → braucht einen eigenen Pfad.

### Schritte
1. **KML-Unterstützung:** PL kann **nicht** einfach wie die ED-269-Länder
   behandelt werden. Nötig ist ein KML-Parser (z. B. `@tmcw/togeojson` /
   `@mapbox/togeojson`) → GeoJSON, dann Mapping auf das interne Zonenmodell.
   Ein neues `shared/polishGeozones.ts`:
   - KML-Placemarks → Features
   - Zonentyp aus Name/Folder/Styling ableiten (`DRA-P`→`PROHIBITED`,
     `DRA-R`→`REQ_AUTHORISATION`, `DRA-I`→`NO_RESTRICTION`/Info)
   - Höhen aus dem KML (`max`-Parameter bzw. Placemark-Höhen) übernehmen
2. **Abruf** `client/lib/geozoneDirect/pansaSource.ts` (eigener Pfad, nicht
   `ED269_DIRECT_COUNTRIES`):
   - Konstanten `PANSA_LOGIN_URL`, `PANSA_KML_URL`, `PANSA_API_KEY`
     (konfigurierbar, nicht fest im Binary; Default = öffentlicher Key, bis ein
     eigener Key vorliegt)
   - `fetchPoland()`: Login (x-api-key) → Token → KML
     (`types=DRAP,DRAR,DRAI`, `max=500`) → parsen → normalisieren →
     `finalize(..., "pl")`
   - Fehlerbehandlung: 401/403 → „Quelle nicht verfügbar / Key prüfen"
3. **Label**: `PL: "PAŻP / PANSA DroneMap"` in den Quellen-Labels; Attribution
   „© Polska Agencja Żeglugi Powietrznej (PAŻP)".
4. **Tests**: KML→Zonen-Parsing (Fixture aus einer echten Antwort, sobald von
   PL-/EU-IP abrufbar), Typ-Mapping, Höhen, Dedupe.
5. **Refresh**: täglich. Optional AUP (§4) als „heute aktiv"-Zusatz.

---

## 6. Offene Punkte
1. **Eigener API-Key?** Mit PANSA klären, ob der öffentliche Plugin-Key
   dauerhaft nutzbar ist oder ihr einen eigenen Key bekommt (Rate-Limits,
   Bedingungen). Key konfigurierbar halten.
2. **Live-Verifikation von PL-/EU-IP:** Aus dieser Umgebung nicht möglich
   (Geo-Block). Login-Flow, KML-Struktur, Höhen- und Typfelder dort einmal
   gegenprüfen und eine Fixture einchecken.
3. **KML-Schema:** Genaues Mapping von KML-Name/Style/ExtendedData auf
   Beschränkung und Höhe aus einer echten Antwort ableiten.
4. **Nutzungsbedingungen** der schriftlichen PANSA-Freigabe im Repo ablegen.

---

## 7. Schnelltest (von einer PL-/EU-IP ausführen)

```bash
UA="Mozilla/5.0"; KEY="<API-Key>"
TOKEN=$(curl -s -X POST "https://api.dronemap.pansa.pl/v1/front/login" \
  -H "x-api-key: $KEY" -H "Origin: https://dronemap.pansa.pl" \
  -H "Referer: https://dronemap.pansa.pl/" | jq -r .token)

curl -s "https://api.dronemap.pansa.pl/v1/kml/filtered?extrude=false&types=DRAP,DRAR,DRAI&max=500" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.google-earth.kml+xml" -o pl_zones.kml
head -c 400 pl_zones.kml
```

---

## 8. Verifizierte Daten & Mapping (DE-IP, 2026-11-15)

**Fixtures:** `docs/fixtures/pansa_kml_sample.kml` (2 Placemarks),
Zonentypen vollständig in `pansa_zones_types.json` (34 Typen).

### KML-Struktur (aus `kml/filtered`)
Jedes `<Placemark>` trägt Typ **und Höhen in der `<description>`**:
```
<name>DRA-P 2550</name>
<description>Restriction: N/A, Type: DRAP, Min: 0 ft, Max: 600 ft</description>
<Polygon>…<coordinates>lon,lat,0 …</coordinates>…</Polygon>
```
Parser: Beschreibung mit
`/Type:\s*(\w+),\s*Min:\s*(-?\d+)\s*ft,\s*Max:\s*(-?\d+)\s*ft/` auslesen →
`Type`→Beschränkung (Tabelle unten), Höhen **ft→m** (`×0.3048`), Geometrie aus
`<Polygon>`/`<MultiGeometry>`. (KML→GeoJSON via `togeojson` + Description-Regex,
da die Höhen/Typen **nicht** in ExtendedData, sondern im Freitext stehen.)

### `Type` → Beschränkung (aus allen 34 Typen abgeleitet, Präfix DRA-P/R/I)
| Beschränkung | Typen |
|---|---|
| **PROHIBITED** (7) | `DRAP`, `MRT`, `TF`, `TFR`, `TMA`, `TS`, `TSA` |
| **REQ_AUTHORISATION** (18) | `ATZ`, `ATZ1KM`, `ATZ6KM`, `CTR`, `CTR1KM`, `CTR6KM`, `D`, `DRAR`, `EPD`, `EPP`, `EPR`, `MCTR`, `MCTR2KM`, `P`, `R`, `RPA`, `TR`, `TRA` |
| **NO_RESTRICTION / Info** (9) | `AAA`, `ADIZ`, `AREA`, `DRAI`, `EA`, `FIS`, `NW`, `RMZ`, `ROL` |

Die Beschreibungstexte je Typ (EN/PL, Flugbedingungen, Kontakt) stehen im
`zones/types`-Endpoint und können als Popup-Text genutzt werden.
