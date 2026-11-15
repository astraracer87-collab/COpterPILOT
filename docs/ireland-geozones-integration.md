# Irland (IE) – Geozonen-Quelle & Integrationsauftrag

Übergabe-Dokument für die Drohnen-Geozonen Irlands. Stand: 2026-11-15,
live geprüft. Betreiber: Irish Aviation Authority (IAA) / AirNav Ireland.

Vergleich: `docs/godrone-api-integration.md` (NL),
`docs/dronespace-at-api-integration.md` (AT),
`docs/dflight-it-api-integration.md` (IT),
`docs/luxembourg-geozones-integration.md` (LU).

---

## 1. Kurzfassung

- Die IAA veröffentlicht die UAS-Geozonen als **GeoJSON im ED-269-Schema**,
  frei abrufbar, **ohne Authentifizierung**.
- Die Datei ist ein sauberes ED-269-GeoJSON: 82 Zonen (`MultiPolygon`) mit
  `identifier`, `country:"IRL"`, `type`, `restrictionConditions`, `reason`,
  `zoneAuthority[]` usw., plus `datasetMetadata` auf oberster Ebene.
- ⚠️ **Korrektur (DE-Session verifiziert): Höhen SIND vorhanden** – nicht in
  `properties`, sondern im **`geometry.layer`-Objekt** (`upper`/`upperReference`/
  `lower`/`lowerReference`/`uom`), genau wie bei PT nativ. Standard-GeoJSON-Parser
  (Leaflet/Mapbox/Turf/GeoPandas) **ignorieren** unbekannte Geometrie-Member →
  beim Import selbst in die Properties kopieren. (Die frühere Aussage „keine
  Höhen" war ein Parser-Artefakt.)
- **Zweiter offizieller Weg:** ein öffentlicher **ArcGIS-FeatureServer** (die
  Datenquelle der eingebetteten Karte) liefert dieselben Zonen live als GeoJSON,
  mit Höhen als **flache** Properties (kein `layer`-Objekt) – gut für Bbox-/
  Änderungsabfragen (siehe §7).
- Nutzungshinweis der IAA: „reference only, not for navigation“. Vor jedem
  Flug zusätzlich NOTAMs/TRAs prüfen. Das gehört in den App-Hinweistext.

---

## 2. Quelle

| Punkt | Wert |
|---|---|
| Einstieg (stabil) | `https://www.iaa.ie/geozones` → leitet auf die HTML-Seite `…/general-aviation/drones/uas-geographic-zones` |
| GeoJSON (Stand 2026-11-06) | `https://www.iaa.ie/docs/default-source/default-document-library/uas/20261106_uas_zones_ireland_v1.geojson?download=true` |
| Auth | keine |
| Größe | ~766 KB, `Content-Type: application/octet-stream` |
| Lizenz | IAA-Daten, „reference only“. Genaue Lizenz/Nutzungsbedingungen bei der IAA bestätigen |
| Anleitung | IAA UAM-010 „Guidance on UAS Geographical Zones JSON file“ |

> ⚠️ **Die Datei-URL enthält ein Datum (`20261106`) und ändert sich bei jedem
> Update.** Nicht hart verdrahten. Stattdessen die HTML-Seite
> `…/uas-geographic-zones` laden und den `*.geojson`-Link extrahieren
> (Regex auf `href="[^"]*\.geojson[^"]*"`). Die so gefundene relative URL mit
> `https://www.iaa.ie` zusammensetzen.

---

## 3. Schema (ED-269-GeoJSON)

Top-Level:
```json
{
  "type": "FeatureCollection",
  "name": "20261106_UAS_Zones_Ireland_V1",
  "datasetMetadata": {
    "provider": "Irish Aviation Authority",
    "issued": "2026-11-06T16:00:00+00:00",
    "validFrom": "2026-11-06T16:00:00+00:00",
    "technicalLimitation": null
  },
  "features": [ … ]
}
```

Feature-`properties`:

| Feld | Beispiel | Bedeutung |
|---|---|---|
| `identifier` | `U74` | stabile ID (Dedupe) |
| `country` | `IRL` | |
| `name` | `Cork Model Aero Club 2` | |
| `type` | `REQ_AUTHORIZATION` (74), `CONDITIONAL` (7), `NO_RESTRICTION` (1) | ED-269-Beschränkung |
| `variant` | `CUSTOMIZED` / `COMMON` | |
| `restrictionConditions` | `PERMITTED/MODEL AIRCRAFT=YES` | maschinenlesbare Bedingung |
| `reason` | `AIR_TRAFFIC` (46), `SENSITIVE` (29), `OTHER` (7) | |
| `otherReasonInfo` | `Exemption Zone` | |
| `regulationExemption` | `null`/`YES` | |
| `message` | Klartext (EN) | für Popup |
| `region` | meist null | |
| `zoneAuthority[]` | `{purpose, name:"AirNav Ireland", service:"Cork ATC", email:"suaairspace@airnav.ie", …}` | Freigabestelle |
| `limitedApplicability[]` | `[{startDateTime, endDateTime}, …]` | zeitlich begrenzte Aktivität |

Geometrie: `MultiPolygon` (alle 82, Kreise bereits polygonisiert). Das
`geometry`-Objekt trägt zusätzlich ein **`layer`-Objekt mit den Höhen**:
```json
"geometry": {
  "type": "MultiPolygon", "coordinates": [[[[-8.4938,52.0910], …]]],
  "layer": { "upper":5000, "upperReference":"AMSL", "lower":0, "lowerReference":"AGL", "uom":"ft" }
}
```
→ `uom` ist `ft` (×0,3048 → m), Referenzen gemischt `AGL`/`AMSL` → mitführen.

> **`CONDITIONAL`-Zonen sind Ausnahmezonen** (Modellflugplätze), die *innerhalb*
> anderer Zonen liegen und deren Beschränkung für Modellflug aufheben → in der
> Darstellung **über** der umgebenden Zone zeichnen, in der Logik als Ausnahme
> behandeln. `limitedApplicability` fehlt bei permanenten Zonen **ganz** (Feld
> nicht vorhanden, nicht `null`).

---

## 4. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- Für IE gibt es **keine Geozonen** in der App.
- Die ED-269-Logik (`client/lib/geozoneDirect/ed269Sources.ts`,
  `shared/ed269Restriction.ts`, `client/lib/ed269.ts`) passt direkt, weil das
  Format echtes ED-269 ist. `type` nutzt dieselben Werte wie AT
  (`REQ_AUTHORIZATION`, `CONDITIONAL`, `NO_RESTRICTION`), die
  `normalizeEd269Restriction` bereits kennt (ggf. `REQ_AUTHORIZATION` als
  Alias prüfen – AT liefert `REQ_AUTHORISATION` mit „S“).

### Schritte
1. **Link-Resolver** `resolveIrishGeojsonUrl()`: HTML-Seite laden, aktuellen
   `*.geojson`-Link extrahieren (§2). Fallback auf die zuletzt bekannte URL.
2. **Abruf** in `ed269Sources.ts`: `fetchIreland()` lädt das GeoJSON, mappt
   es minimal. Da echtes ED-269: vermutlich reicht `finalize(raw, "ie")`.
   Nur sicherstellen:
   - `restrictionConditions` und `limitedApplicability[]` übernehmen
     (letzteres ist das ED-269-Gültigkeitsfenster → `ed269ValidityFromProps`
     ggf. um `limitedApplicability` erweitern; AT nutzt `applicability`).
   - **Höhen aus `geometry.layer`** (nicht `properties`!) auslesen und in die
     Zone übernehmen: `upper`/`lower` × (`uom==="ft"`?0.3048:1) → Meter,
     `upperReference`/`lowerReference` (AGL/AMSL) mitführen. Damit greift der
     120-m-Filter korrekt (anders als früher angenommen).
3. `"ie"` zu `ED269_DIRECT_COUNTRIES` hinzufügen und in
   `fetchEd269CountryFeatures` verdrahten.
4. **Normalisierung** prüfen: In `normalizeEd269Restriction` sicherstellen,
   dass `REQ_AUTHORIZATION` (mit Z) auf denselben Schlüssel wie
   `REQ_AUTHORISATION` abbildet.
5. **Label**: `IE: "Irish Aviation Authority (ED-269)"` in
   `ED269_SOURCE_LABELS`. Hinweistext „reference only, not for navigation –
   NOTAMs/TRAs zusätzlich prüfen“ ins Popup/Disclaimer.
6. **Tests**: Normalisierung je `type`, `limitedApplicability`-Zeitfenster,
   fehlende Höhen (kein Ceiling), Dedupe über `identifier`,
   Link-Resolver-Fallback.
7. **Refresh**: täglich; die Datei trägt `datasetMetadata.issued`/`validFrom`
   zur Versionskontrolle.

---

## 5. Offene Punkte
- **Lizenz/Nutzungsbedingungen** der IAA-GeoJSON formal bestätigen (die Seite
  sagt „reference only“; die genaue Weiterverwendungslizenz ist zu klären).
  Hinweis: Die frühere Freigabe bezog sich evtl. auf den alten Weg – kurz
  bestätigen lassen, dass sie auch für die Art.-15-Datei bzw. den FeatureServer
  gilt.
- ~~Fehlende Höhen~~ **erledigt:** Höhen liegen in `geometry.layer` (§3).
- `restrictionConditions`-Format (`PERMITTED/MODEL AIRCRAFT=YES`) ggf. parsen,
  um Modellflug-Ausnahmen korrekt anzuzeigen.
- **Umweltauflagen** (National Parks & Wildlife Service, separate ArcGIS-Karte
  `dahg.maps.arcgis.com/…id=8f7060450de3485fa1c1085536d477ba`) sind **nicht**
  Teil der Geozonen – nur mit eigener Freigabe/Lizenz einbinden.

---

## 7. Weg B: ArcGIS-FeatureServer (Live-API, Alternative/Ergänzung)

Die eingebettete IAA-Karte ist eine ArcGIS-Instant-App. Öffentlicher
Feature-Layer, **kein Token, CORS erlaubt**, `maxRecordCount` 2000
(82 Features → ein Request):
```
https://services6.arcgis.com/BkChpeOzfjSW2tpl/arcgis/rest/services/Geozones_Ireland/FeatureServer/0
```
- **Alle Zonen (GeoJSON, WGS84):**
  `…/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`
- **Bbox:** `…/0/query?geometry=-9.0,51.8,-8.0,52.2&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=identifier,name,type,reason,message,upper,upperReference,lower,lowerReference,uom&outSR=4326&f=geojson`
- **Änderungsstand:** `…/0?f=json` → `editingInfo.lastEditDate`.

Unterschiede zur Datei: Höhen als **flache** Properties (`upper`/`upperReference`
/…, kein `layer`-Objekt); Behörde „hineingejoint" (`name_1`/`service`/`email`/…
statt Array); Geometrie als `Polygon`; interne Felder (`OBJECTID`/`GlobalID`/…)
ignorieren. **Zeitfenster (`limitedApplicability`) fehlen hier** → für temporäre
Zonen die GeoJSON-Datei (§2) nehmen.

→ Empfehlung: **Datei = Primärquelle** (enthält `limitedApplicability`),
FeatureServer optional für `lastEditDate`-Änderungserkennung/Bbox.

---

## 6. Schnelltest

```bash
UA="Mozilla/5.0 Chrome/120"
# aktuellen GeoJSON-Link von der Seite holen:
URL=$(curl -s -A "$UA" https://www.iaa.ie/general-aviation/drones/uas-geographic-zones \
  | grep -oiE 'href="[^"]*\.geojson[^"]*"' | head -1 | sed -E 's/.*href="([^"]+)".*/\1/' | sed 's/&amp;/\&/g')
curl -s -A "$UA" "https://www.iaa.ie${URL}" \
  | jq '{meta:.datasetMetadata.issued, n:(.features|length),
         types:([.features[].properties.type]|group_by(.)|map({(.[0]):length})|add)}'
```
