# Zypern (CY) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **drones.gov.cy/gr/geo-zones-map/** (Department of Civil
Aviation / AMC Cyprus). Stand: 2026-11-15, live geprüft. Freigabe liegt vor.

Vergleich: übrige Länder-Dokumente in `docs/`.

---

## 1. Kurzfassung

- Die zyprische Drohnen-Geozonenkarte ist eine **Esri ArcGIS-Online-WebMap**
  (`amc-cy.maps.arcgis.com`), eingebettet als ArcGIS „embeddable map".
- Die Zonen liegen als **öffentlicher ArcGIS-FeatureServer** vor – **ohne
  Authentifizierung** abrufbar:
  ```
  https://services9.arcgis.com/1oNBJ7Sv4IbovWiG/arcgis/rest/services/UAV_areas_WFL1/FeatureServer/12
  ```
- **Live geprüft:** 141 Zonen (`Polygon`). ⚠️ **Schema ist KML-Import-Stil**,
  nicht ED-269: Beschränkungstyp steckt im `FolderPath`, alle Detail-Infos als
  **griechischer HTML-Text** in `PopupInfo` → Parsing nötig.
- Hinweis: Die Portalseite `drones.gov.cy` selbst ist aus dieser Umgebung
  bot-/geo-geblockt (curl 000); die **ArcGIS-Daten** (`*.arcgis.com`) sind
  dagegen frei erreichbar und wurden live abgefragt.

---

## 2. Zugang

| Punkt | Wert |
|---|---|
| WebMap-Item | `amc-cy.maps.arcgis.com/.../items/6796841dbcb84f89bc80b9b4d78f7b86` |
| Zonen-FeatureServer | `https://services9.arcgis.com/1oNBJ7Sv4IbovWiG/arcgis/rest/services/UAV_areas_WFL1/FeatureServer/12` |
| Auth | **keine** (ArcGIS Online, öffentlich) |

Abruf als GeoJSON:
```
GET …/FeatureServer/12/query?where=1=1&outFields=*&outSR=4326&f=geojson
```
Layer-Metadaten/Felder: `…/FeatureServer/12?f=json`. (Es kann weitere
Sublayer geben – `…/FeatureServer?f=json` prüfen.)

---

## 3. Schema (ArcGIS, KML-Import-Stil)

| Feld | Beispiel | Bedeutung |
|---|---|---|
| `OBJECTID` | `1` | ID |
| `Name` | `001 - Αγκυροβόλιο Μονής` | Zonenname (griechisch) |
| `FolderPath` | `CYPRUS GEO ZONES MAP ver09T2/RESTRICTED ZONES` | **Beschränkungskategorie** (nach `/` splitten) |
| `PopupInfo` | HTML (griechisch): „Διαχειριστής Ζώνης … Τηλέφωνο … Όροι Πρόσβασης: ΕΞΟΥΣΙΟΔΟΤΗΣΗ …" | Zonen-Manager, Kontakt, Zugangsbedingungen |
| `Shape__Area`, `Shape__Length` | | Fläche/Umfang |

- Geometrie: `Polygon` (WGS84), **keine Höhenfelder**.
- **Beschränkung** aus `FolderPath` ableiten (z. B. „RESTRICTED ZONES" →
  `REQ_AUTHORISATION`; weitere Kategorien aus der vollen Antwort sammeln).
- `PopupInfo` ist HTML und **griechisch** – „Όροι Πρόσβασης" (Zugangsbedingung)
  z. B. „ΕΞΟΥΣΙΟΔΟΤΗΣΗ" (= Autorisierung erforderlich). Für Anzeige parsen und
  ggf. übersetzen.

---

## 4. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- CY ist nur über Bounding-Box bekannt (`shared/countryDetection.ts`), **keine
  Geodaten**.

### Schritte
1. **Abruf** `client/lib/geozoneDirect/cyprusSource.ts`:
   - `CY_FS = ".../UAV_areas_WFL1/FeatureServer/12"`,
     `fetchCyprus()` → `/query?where=1=1&outFields=*&outSR=4326&f=geojson`
     (ArcGIS-Paging über `resultOffset`/`resultRecordCount` beachten;
     Default-Limit prüfen).
2. **Normalisierung** `shared/cyprusGeozones.ts`:
   - `FolderPath` → Beschränkungskategorie/`restriction`.
   - `PopupInfo` (griechisches HTML) parsen: Manager, Telefon, E-Mail,
     Zugangsbedingung → interne Felder/Message. HTML strippen.
   - keine Höhen → ohne Ceiling behandeln.
3. `"cy"` in die Länderliste; eigener ArcGIS-Pfad (kein ED-269).
4. **Label**: `CY: "DCA Cyprus / AMC"`. Attribution „© Department of Civil
   Aviation, Cyprus".
5. **Tests**: `FolderPath`-Mapping, `PopupInfo`-Parsing, Dedupe über
   `OBJECTID`/`Name`.
6. **Refresh**: täglich.

---

## 5. Offene Punkte
1. **Kategorien vollständig erfassen:** Alle `FolderPath`-Werte aus der
   kompletten Antwort sammeln und auf Beschränkungen mappen (nicht nur
   „RESTRICTED ZONES").
2. **Griechische Texte:** `PopupInfo` ist griechisch – Parsing robust gegen
   HTML/Leerzeichen bauen; für die App ggf. Übersetzung der Standardphrasen.
3. **Keine Höhen** im Datensatz.
4. **Versions-/Update-Info:** Layer heißt „ver09T2" – Aktualisierungszyklus bei
   DCA Cyprus erfragen.

---

## 6. Schnelltest

```bash
B="https://services9.arcgis.com/1oNBJ7Sv4IbovWiG/arcgis/rest/services/UAV_areas_WFL1/FeatureServer"
curl -s "$B/12/query?where=1%3D1&outFields=*&outSR=4326&f=geojson&resultRecordCount=400" \
  | jq '{n:(.features|length),
         folders:([.features[].properties.FolderPath]|group_by(.)|map({(.[0]):length})|add)}'
```

---

## Anhang CY: ED-269-Datei als bessere Primärquelle + Skript (DE-Session, 2026-11-15)

**Werkzeug im Repo:** [`docs/tools/cyprus/cy_geozones_to_geojson.py`](tools/cyprus/cy_geozones_to_geojson.py)
(nur Stdlib) → ED-269 **oder** ArcGIS → sauberes GeoJSON (Kreise→Polygone, Popup-
Parsing, Z-Werte entfernt).

- **Quelle A (empfohlen): ED-269-JSON** (rechtlich verbindlich, mit **Höhen**):
  Link auf `https://drones.gov.cy/geo-zones-file/` dynamisch holen (Dateiname
  ändert sich), aktuell `…/uploads/2025/05/CYP_GeoZones_06_05_25.json`. **141 Zonen**
  (62 Polygone + **79 Kreise** `{type:"Circle",center,radius}`), alle **0–120 m AGL**,
  `permanent:YES`. `restriction` `PROHIBITED` (29)/`REQ_AUTHORISATION` (112),
  `reason` SENSITIVE/PRIVACY/AIR_TRAFFIC. ⚠️ ED-269 ist **kein** GeoJSON
  (`geometry` ist Array, `Circle` existiert nicht) → konvertieren.
- **Quelle B:** ArcGIS `services9.arcgis.com/1oNBJ7Sv4IbovWiG/.../UAV_areas_WFL1/
  FeatureServer/12` (mein Hauptdoc) – Kategorie aus `FolderPath`, Regeln im
  **griechischen** `PopupInfo`-HTML (Zonenverwalter/Telefon/Mail/Antragsformular).
- ⚠️ **Versions-Diskrepanz:** Karte `ver09` (07/2026) vs. ED-269-Datei (05/2025) –
  beide 141 Zonen, aber 52 Namen weichen ab, Verbotszonen 29 vs. 28 → bei der DCA
  klären, welche maßgeblich ist; bis dahin beide abgleichen. KMZ:
  `…/uploads/2026/07/CYPRUS_GEO_ZONES_MAP_ver09.kmz`.
- NOTAM-Layer 204 ist **veraltet** (Snapshot 05/2026) → für temporäre Zonen den
  offiziellen AIS Cyprus/NOTAM nutzen. Nordzypern/SBA nicht abgedeckt (DCA nicht zuständig).
