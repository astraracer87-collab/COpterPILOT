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

---

## 6. Anhang: verifiziertes Feldschema & Fallen (DE-Session, 2026-11-15)

Eine zweite Live-Analyse ab DE-IP hat den Feed vollständig durchgemessen. Ergänzt
die obigen Punkte; **der Zeitfenster-Abruf aus §2 bleibt maßgeblich**.

> **Zahl-Abgleich:** Ohne `start`/`end` liefert der Server **333 Zonen**
> (PROHIBITED 117, REQ_AUTHORISATION 209, NO_RESTRICTION 7). **Mit** Zeitfenster
> sind es 359 (PROHIBITED 143) – die Differenz sind die **18 zeitgesteuerten
> Zonen** (`permanent: "NO"`). Das bestätigt den Zeitfenster-Fix: ohne
> `start`/`end` fehlen zeitgesteuerte Zonen. → **immer mit Zeitfenster abrufen.**

### ⚠️ Zwei Fallen (unbedingt behandeln)
1. **Zone „Outside Lithuania":** ein **weltumspannendes** `PROHIBITED`-Polygon
   (Litauen vermutlich als Aussparung). In der App **ausfiltern**
   (`name === "Outside Lithuania"`), sonst färbt sie die ganze Karte rot.
2. **18 zeitlich begrenzte Zonen** (`applicability[0].permanent === "NO"`): nur
   im Fenster `startDateTime`…`endDateTime` (ISO 8601 UTC) als aktiv zeigen.

### Verifizierte `properties`-Felder (ED-269-nah)
| Feld | Bedeutung |
|---|---|
| `identifier` | eindeutige ID → **Primärschlüssel / Dedupe** |
| `zoneId` | weitere interne ID |
| `name` | Kurzname (z. B. `URVI01`); **nicht eindeutig** (Mehrfachvorkommen) |
| `country` | `LTU` |
| `type` | aktuell immer `COMMON` |
| `restriction` | `PROHIBITED` / `REQ_AUTHORISATION` / `NO_RESTRICTION` |
| `reason` / `otherReasonInfo` | Grund (`Air traffic`, `Foreign territory`, …); fehlt bei 11 Zonen |
| `message` | Pilotenhinweis |
| `lower`/`upper` (Text) · `lowerMeters`/`upperMeters` (Zahl, **AGL**) | Höhen – **für Logik die Meter-Felder nehmen** |
| `applicability[]` | `permanent` YES/NO; bei NO `startDateTime`/`endDateTime`; `schedule` derzeit leer |
| `zoneAuthority[]` | `name`, `service`, `contactName`, `siteURL`, `email`, `purpose` |
| `extendedProperties` | `localizedMessages`, `authorityRequirementConditions`, `color` |
| `metaData` | `creationDateTime`, `updateDateTime` (**→ Änderungserkennung**), `author` |
| `geometry` (in properties) | ED-269-Höhen: `uomDimensions`, `lowerLimit`/`lowerVerticalReference`, `upperLimit`/`upperVerticalReference`, `horizontalProjection` |
| `airspacetype`/`airspaceclass`, `uSpaceClass`, `hidden`, `fillColor`/`strokeColor` | Klassifikation/Darstellung; `hidden: true` ausblenden |

### Offene Punkte (ergänzend)
- **Lizenz/Freigabe:** Datei technisch offen, **Lizenz nicht angegeben** → vor
  Produktiveinsatz bei ANS / Oro navigacija schriftlich bestätigen lassen
  (wie GR/SK). Im Repo ablegen.
- **socket.io-Live-Kanal** `/avm/socket.io/`: ungeklärt, ob darüber kurzfristige
  Zonen/Updates kommen, die in der `uas.geojson` fehlen → beobachten.
- **Endpoint-Stabilität:** `uas.geojson` ist nicht als offizielle API
  dokumentiert → Abruf überwachen, Fehler alarmieren, letzte gute Version cachen.
