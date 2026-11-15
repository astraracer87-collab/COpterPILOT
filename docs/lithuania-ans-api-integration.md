# Litauen (LT) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **utm.ans.lt** (Oro navigacija / Lithuanian ANS).
Stand: 2026-11-15, live geprüft. Freigabe liegt laut Product Owner vor.

Vergleich: übrige Länder-Dokumente in `docs/`.

---

## 1. Kurzfassung (gute Nachricht: identisch zu Österreich)

- Litauen nutzt **dieselbe UTM-Plattform wie Austro Control Dronespace** –
  „Skyzr"/Frequentis (Client-Version 1.57.x, Pfad `/avm/`, `auth/skyzr`,
  socket.io, MapLibre). Siehe `docs/dronespace-at-api-integration.md`.
- Der **ED-269-Zonen-Feed ist identisch aufgebaut**, nur mit anderer Basis-URL:
  ```
  GET https://utm.ans.lt/avm/utm/uas.geojson?start=<ISO>&end=<ISO>
  ```
- **Live geprüft:** 200, **359 Zonen**, `country: "LTU"`, **kein Login/Key**.
  Gleiches Property-Schema wie AT (`identifier`, `restriction`, `geometry`,
  `applicability`, `lowerMeters`/`upperMeters`, `hidden`, …).
- `restriction`: `REQ_AUTHORISATION` (209), `PROHIBITED` (143),
  `NO_RESTRICTION` (7).

---

## 2. Zugang

| Punkt | Wert |
|---|---|
| Basis | `https://utm.ans.lt/avm/` |
| Zonen-Feed | `https://utm.ans.lt/avm/utm/uas.geojson?start=<ISO>&end=<ISO>` |
| Auth | **keine** |
| Format | ED-269-GeoJSON (wie AT) |
| Bounds-Filter | optional `&bounds=w,s,e,n` (wie AT) |

**Wichtig – gleicher Abruf-Fix wie Österreich:** **Immer mit Zeitfenster**
(`start`=jetzt, `end`=+1 Jahr) abfragen. Ohne `start`/`end` liefert der Server
nur die **momentan aktiven** Zonen; zeitgesteuerte Zonen fehlen dann je nach
Abrufzeit (siehe AT-Dokument §5.1).

---

## 3. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- LT ist in der App nur verlinkt (`shared/countryMaps.ts`:
  `https://utm.ans.lt/avm/#p=12/{lat}/{lon}`), **keine Geodaten**.
- Die **gesamte AT-Logik ist wiederverwendbar** – Feed, Schema, Normalisierung,
  Höhen-/Zeitlogik sind gleich.

### Schritte
1. **Konstante + Abruf** in `client/lib/geozoneDirect/ed269Sources.ts`:
   - `LT_GEOZONES_URL = "https://utm.ans.lt/avm/utm/uas.geojson"`
   - `fetchLithuania()` analog `fetchAustria()`, **mit Zeitfenster**
     (`?start=…&end=…`), `finalize(raw, "lt")` und
     `normalizeAustrianEd269Placeholder` (die MATZ/MCTR-Platzhalterlogik gilt
     plattformweit; für LT prüfen, ob relevante Zonen existieren – sonst ist
     sie ein harmloser No-op).
   - `"lt"` zu den Vektor-Ländern hinzufügen, in `fetchEd269CountryFeatures`
     verdrahten.
2. **`hidden`-Zonen filtern** (wie AT, in `client/lib/ed269.ts` bereits
   vorhanden).
3. **Label**: `LT: "Oro navigacija (ED-269)"` in `ED269_SOURCE_LABELS`.
   Attribution „© Oro navigacija / Lithuanian ANS".
4. **Tests**: analog AT (Normalisierung, Zeitfenster, Höhen, Dedupe über
   `identifier`). LT kann denselben Testpfad wie AT nutzen.
5. **Refresh**: täglich, mit Zeitfenster.

---

## 4. Offene Punkte
- Prüfen, ob LT (wie AT) zeitgesteuerte Militärzonen mit dem
  2100-Platzhalter-Enddatum hat (`normalizeAustrianEd269Placeholder`). Sonst
  keine Sonderbehandlung nötig.
- Nutzungsbedingungen der Freigabe im Repo ablegen.

---

## 5. Schnelltest

```bash
UA="Mozilla/5.0 Chrome/120"
S=$(date -u +%Y-%m-%dT%H:%M:%S.000Z); E=$(date -u -d '+1 year' +%Y-%m-%dT%H:%M:%S.000Z)
curl -s --compressed -A "$UA" "https://utm.ans.lt/avm/utm/uas.geojson?start=$S&end=$E" \
  | jq '{n:(.features|length), country:(.features[0].properties.country),
         restr:([.features[].properties.restriction]|group_by(.)|map({(.[0]):length})|add)}'
```
