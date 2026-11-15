# Estland (EE) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **utm.eans.ee** (EANS – Estonian Air Navigation Services).
Stand: 2026-11-15, live verifiziert (DE-Session). Nutzungsfreigabe **mündlich**
von EANS erteilt – schriftliche Bestätigung noch einholen (siehe §5).

Vergleich: `docs/dronespace-at-api-integration.md` (AT),
`docs/lithuania-ans-api-integration.md` (LT) – **gleiche Plattform**.

---

## 1. Kurzfassung (identisch zu AT/LT – Skyzr-Plattform)

- EANS nutzt **dieselbe UTM-Plattform wie Austro Control (AT) und Oro
  navigacija (LT)** – Skyzr/Frequentis (`/avm/`, socket.io, ED-269-GeoJSON).
- **Ein GET liefert alle Zonen als GeoJSON, ohne Login:**
  ```
  GET https://utm.eans.ee/avm/utm/uas.geojson
  ```
- **Live geprüft:** HTTP 200, ~5 MB, **~230 Zonen**, `country: "EST"`, keine
  Auth, keine Cookies. Nur `Polygon` (Kreiszonen schon zu Polygonen gerechnet),
  WGS84 lon/lat.
- Schema **ED-269-nah** – gleiche Properties wie AT/LT (`identifier`,
  `restriction`, `applicability`, `lowerMeters`/`upperMeters`, `zoneAuthority`,
  `hidden`, `fillColor`/`strokeColor`).

---

## 2. Zugang

| Punkt | Wert |
|---|---|
| Basis | `https://utm.eans.ee/avm/` |
| Zonen-Feed | `https://utm.eans.ee/avm/utm/uas.geojson` |
| Auth | **keine** |
| Format | ED-269-GeoJSON (wie AT/LT) |
| Zeitfenster | optional `?start=<ISO>&end=<ISO>` (+ `buffer`, von der Seite mitgeschickt) |

**Zeitfenster-Empfehlung (wie AT/LT):** Für Flugplanung **immer** `start`/`end`
mitgeben, damit saisonale Zonen (`…FAUNA`, April–November) und NOTAM-Zonen
richtig berücksichtigt werden. Ohne Parameter kommen nur die aktuell gültigen.

Gemessene Zonenzahl (schwankt v. a. durch saisonale Naturschutzzonen):
| Zeitpunkt | Zonen |
|---|---|
| Nov 2026 | 230 |
| Juni 2026 | 233 |
| Januar 2027 | 178 |

---

## 3. Datenstruktur (ED-269-nah)

| Feld | Inhalt / Beispiel |
|---|---|
| `identifier` | `EER56F` (Primärschlüssel) |
| `country` | `EST` |
| `name` | `EER56FAUNA`, `EEGZ24`, `A3333/26` (NOTAM-basiert); **nicht eindeutig** |
| `type` | `COMMON` |
| `restriction` | `NO_RESTRICTION`, `REQ_AUTHORISATION`, `PROHIBITED` |
| `reason` / `otherReasonInfo` | `Air traffic`, `Nature`, `Sensitive`, `Other` |
| `message` | Hinweistext (EN) |
| `extendedProperties.localizedMessages` | Texte `en-GB` + `et-EE` (kein DE → selbst übersetzen) |
| `extendedProperties.expirationTime` | Ablaufdatum |
| `extendedProperties.authorityRequirementConditions` | Behörden-Auflagen |
| `applicability` | `permanent` (YES/NO, ~177× YES), `startDateTime`/`endDateTime`, `schedule` |
| `zoneAuthority` | `name`, `contactName`, `siteURL`, … |
| `lower`/`upper` (Text) · `lowerMeters`/`upperMeters` (Zahl) | Höhen – **für Logik die Meter-Felder** |
| `geometry` (in properties) | ED-269-Höhen (`lowerLimit`/`upperLimit`/`*VerticalReference`/`uomDimensions`/`horizontalProjection`) |
| `airspacetype`/`airspaceclass` | aktuell überall `other` |
| `region`, `regulationExemption`, `metaData` | Region / Ausnahmen / Metadaten |
| `hidden` | `true` ausblenden (aktuell 1 Zone) |
| `fillColor`/`strokeColor` | Darstellungsfarben wie EANS-Karte |

> ⚠️ **Gleicher Name, verschiedene Höhenbänder = getrennte Features.** Beispiel
> `EEGZ24`: einmal SFC–50 m AGL, einmal 51–120 m AGL → zwei Features. Dedupe
> **nicht** nur über `name`, sondern über `identifier` + Höhenband.

---

## 4. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- EE ist in der App noch **nicht** als Geozonen-Land geführt.
- Die **gesamte AT/LT-Logik ist wiederverwendbar** (Feed, Schema, Höhen-/
  Zeitlogik, `hidden`-Filter).

### Schritte
1. **Abruf** in `client/lib/geozoneDirect/ed269Sources.ts`:
   `EE_GEOZONES_URL = "https://utm.eans.ee/avm/utm/uas.geojson"`,
   `fetchEstonia()` analog `fetchAustria()`, **mit Zeitfenster** (`?start=&end=`),
   `finalize(raw, "ee")`. `"ee"` in die Vektor-Länder + `fetchEd269CountryFeatures`.
2. **`hidden`-Zonen filtern** (wie AT/LT).
3. **Label**: `EE: "EANS (ED-269)"`; Attribution „© EANS – Estonian Air
   Navigation Services".
4. **Caching:** Server setzt `Cache-Control: private, max-age=1` → **serverseitig**
   abholen (kein CORS-Header!) und alle 15–60 min cachen, bei Fehler letzten
   guten Stand behalten.
5. **Tests**: analog AT/LT (Höhen, Zeitfenster, Dedupe über `identifier`+Höhe).
6. **Refresh**: täglich (mit Zeitfenster).

---

## 5. Offene Punkte
- **Schriftliche EANS-Freigabe** einholen (Nutzungsbedingungen, Quellenangabe,
  erlaubte Abruffrequenz) – bisher nur mündlich. Im Repo ablegen.
- Bei EANS nach **offizieller, stabiler Schnittstelle** fragen (ED-269-Export /
  versionierte API). `/avm/utm/uas.geojson` ist ein internes Endpoint der Seite
  und kann sich ohne Ankündigung ändern → Abruf überwachen.
- Bedeutung des Parameters `buffer` klären.
- **socket.io** (`/avm/socket.io/`): prüfen, ob kurzfristige Zonen/Updates
  darüber kommen, die im GeoJSON fehlen.

---

## 6. Weitere (ungeprüfte) Endpunkte der Seite
Für Geozonen **nicht** nötig: `/avm/utm/operationplans.geojson` (gemeldete
Flüge), `/avm/utm/reservations.geojson` (Reservierungen),
`/avm/weather/metars.geojson`, `/avm/weather/ee/observations.geojson`.

---

## 7. Schnelltest

```bash
UA="Mozilla/5.0 Chrome/120"
S=$(date -u +%Y-%m-%dT%H:%M:%S.000Z); E=$(date -u -d '+1 year' +%Y-%m-%dT%H:%M:%S.000Z)
curl -s --compressed -A "$UA" "https://utm.eans.ee/avm/utm/uas.geojson?start=$S&end=$E" \
  | jq '{n:(.features|length), country:(.features[0].properties.country),
         restr:([.features[].properties.restriction]|group_by(.)|map({(.[0]):length})|add)}'
```
