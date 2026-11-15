# GoDrone (NL) – API-Analyse & Integrationsauftrag

Übergabe-Dokument für die Einbindung der niederländischen Geozonen aus
**map.godrone.nl** (LVNL / Altitude Angel) in COpterPILOT als Vektor-Quelle.
Stand der Analyse: 2026-11-14, alle Angaben live gegen die API verifiziert,
sofern nicht als „ungetestet“ markiert.

---

## 1. Kurzfassung

- map.godrone.nl ist keine eigene App, sondern das **Altitude-Angel-Karten-Widget**
  in einer LVNL-Instanz (`instanceId: "lvnl-test"`).
- Die Daten kommen als **GeoJSON** von `https://api.godrone.nl/v2/mapdata/geojson`
  und werden per **Bounding-Box** abgefragt.
- **Authentifizierung** erfolgt über den öffentlichen API-Key per Header
  `Authorization: X-AA-ApiKey <key>`. Laut Rücksprache des Product Owners mit dem
  Betreiber ist der Key der offizielle öffentliche Key und darf genutzt werden.
  Die schriftliche Bestätigung sollte abgelegt werden.
- Geliefert werden UAS-Geozonen (verboten/bedingt), CTR/TMA/TSA/RAS-Lufträume,
  Heliports mit Radius, Hindernis-Warnungen (Kräne) sowie, nur bei kleiner Box,
  Bodengefahren aus OSM (Türme, Bahnlinien, Gewässer, Schulen …).

---

## 2. Zugang

| Punkt | Wert |
|---|---|
| Basis-URL | `https://api.godrone.nl` |
| Header | `Authorization: X-AA-ApiKey hOrnXF_XuIOko8taj9VCi9MUNP4pXVkR_dN-3B8V0` |
| `Bearer <key>` | ❌ führt zu 401 `Authorization has been denied for this request.` |
| Scope (laut Widget-Konfiguration) | `query_mapdata query_mapairdata` |
| CORS | irrelevant (React Native). Im Web nicht getestet |

Der Key **nicht fest im Code verteilen**, sondern als Konstante bzw.
Konfiguration ablegen (z. B. `GODRONE_API_KEY` in `app.json`/`extra` oder einer
Konstante in `client/lib/geozoneDirect/ed269Sources.ts`), damit er
austauschbar bleibt.

Weitere Hosts aus `https://map.godrone.nl/consts.json` (für die
Geozonen-Integration nicht nötig):

```json
{
  "apiUrl": "https://api.godrone.nl",
  "flightServiceApiUrl": "https://flight.godrone.nl",
  "authUrl": "https://auth.godrone.nl",
  "zoneManagerApiUrl": "https://zonemanager-api-lvnl.altitudeangel.com",
  "operatorPortalUrl": "https://www.godrone.nl",
  "tilesets": { "LVNL": "https://lvnl-neu-pro-webs-cdn-ept-data-maps.azureedge.net/tiles/LVNLGroundLevel/{z}/{x}/{y}.png" }
}
```

---

## 3. Endpunkt `GET /v2/mapdata/geojson`

```
GET https://api.godrone.nl/v2/mapdata/geojson?n=<latN>&e=<lonE>&s=<latS>&w=<lonW>[&include=political_boundaries]
Authorization: X-AA-ApiKey <key>
Accept-Encoding: gzip
```

### 3.1 Parameter

| Parameter | Bedeutung |
|---|---|
| `n`, `e`, `s`, `w` | Bounding-Box in WGS84-Dezimalgrad (Pflicht) |
| `include=political_boundaries` | liefert zusätzlich Features der Kategorie `boundary` |
| `exclude=groundHazards`, `include=notams` | im Test **ohne Wirkung** |

### 3.2 Flächenlimits (wichtig!)

Der Server liefert pro Datenebene nur bis zu einer maximalen Box-Fläche. Ist die
Box größer, lässt er die Ebene **still** weg. Die Antwort kommt trotzdem mit
HTTP 200, aber mit `isCompleteData: false` und einem Eintrag in `excludedData`.

| Ebene (`excludedData[].detail.name`) | Limit | Praktisch |
|---|---|---|
| `Airspace` | < 10 000 km² (10 000 000 000 m²) | 1° × 1° in NL (~7 500 km²) geht |
| `Ground Hazards` | < 20 km² (20 000 000 m²) | nur für einen Standort-Check sinnvoll |

Beispiel für eine zu große Box (ganze NL in einem Request):

```json
{"isCompleteData":false,
 "excludedData":[
  {"message":"Request must include a bounding rectangle under 10,000,000,000 square meters.",
   "detail":{"name":"Airspace","displayName":"Airspace"},"errorReason":"QueryAreaTooLarge"},
  {"message":"Request must include a bounding rectangle under 20,000,000 square meters.",
   "detail":{"name":"Ground Hazards","displayName":"Ground Hazards"},"errorReason":"QueryAreaTooLarge"}],
 "features":[], "type":"FeatureCollection", "bbox":[3.3,50.7,7.3,53.6]}
```

Gemessene Größen:

| Box | Features | Größe | Dauer |
|---|---|---|---|
| 0,5° × 0,5° (Utrecht) | 152 | 0,7 MB | 1,9 s |
| 1° × 1° (Utrecht–Arnhem) | 401 | 3,4 MB | 3,8 s |
| 0,1° × 0,06° (Amsterdam) | 33 | 0,26 MB | <1 s |
| ~1 km² (Amsterdam-Zentrum) inkl. Ground Hazards | ~200 | 0,49 MB | <1 s |

### 3.3 Antwort – oberste Ebene

```json
{
  "type": "FeatureCollection",
  "bbox": [w, s, e, n],
  "features": [ ... ],
  "isCompleteData": true,
  "excludedData": [],
  "countriesInViewport": [],
  "nationalFlightRestrictions": [],
  "timeRange": { "from": "2026-11-14T23:56:09Z", "to": "2026-11-21T23:56:09Z" }
}
```

`timeRange` umfasst 7 Tage ab jetzt. Die gelieferten Zonen sind also für dieses
Fenster gültig bzw. aktiv.

### 3.4 Feature

`feature.id` ist ein stabiler Hash (z. B. `84C4C00E307E…`) und eignet sich zum
Deduplizieren über Kacheln hinweg.

Geometrien:
- `Polygon` für Zonen und Lufträume
- `Point` + `properties.radius` (Meter) für Heliports und Kreiszonen
- `LineString` nur bei Ground Hazards, z. B. Bahnlinien

`properties`:

| Feld | Typ / Beispiel | Bedeutung |
|---|---|---|
| `category` | `airspace` · `airport` · `groundHazard` · `boundary` | Grobkategorie |
| `detailedCategory` | siehe 3.5 | Feinkategorie, **wichtigstes Mapping-Feld** |
| `name` | `"SCHIPHOL CTR"` | Name |
| `designator` | `"EHAM"`, `"7.2"`, `"3.q"` | ICAO-Kennung bzw. LVNL-UAS-Zonen-Nummer |
| `airspaceType` | `CTR` `TMA` `CTA` `UTA` `TSA` `RAS` `NAS` \| null | |
| `airspaceClass` | `A` `C` … \| null | |
| `altitudeFloor` / `altitudeCeiling` | `{datum, meters, feet}` \| null | `null` = unbekannt/unbegrenzt |
| `hazardFactor` / `hazardFactorName` | `"60"`/`Danger`, `"40"`/`Warning` | Schwere (String!) |
| `airac` | `{from:"2026-10-29", to:"2026-11-26"}` | AIRAC-Gültigkeit |
| `activity` | `PROCEDURE`, `NO_NOISE` … \| null | |
| `utmStatus` | Objekt \| null | z. B. Schiphol CTR: Freigabe via „GoDrone Guardian UTM“ inkl. `externalUrl` |
| `radius` | `"1000"` (String, Meter) | nur bei Punkt-Features |
| `operationalTo`, `notamId`, `isEst`, `contact`, `externalFacilityId`, `airspaceId` | meist null | |
| `fillColor`, `strokeColor`, `fillOpacity`, `borderWidth`, … | fertige Darstellungsfarben (Strings) | 1:1-Look wie godrone.nl |
| `iconUrl` | `https://api.godrone.nl/v1/map/icon?icon=…` | PNG, **ohne** Auth abrufbar |
| `display` | `{category, detailedCategory, title, sections:[{title,text,iconUrl}], actions}` | fertige englische Infotexte für ein Popup |
| `filters`, `listOrderHint`, `shouldCache` | UI-Metadaten | |

Höhenbezug `datum`:

| datum | Bedeutung | Umrechnung |
|---|---|---|
| `Agl` | über Grund | direkt |
| `Msl` | über Meeresspiegel | MSL (NL ≈ Gelände, für die 120-m-Prüfung zur Not als AGL behandeln, besser Geländehöhe abziehen) |
| `Sps` | Flugfläche / Standarddruck | praktisch immer weit über 120 m, `meters` ist bereits umgerechnet |
| `Sfc` | Oberfläche | = 0 |
| `Unlimited` | unbegrenzt | `meters` ist dann 1e8, als „unbegrenzt“ behandeln |

### 3.5 Beobachtete `detailedCategory`-Werte

| detailedCategory | Beispiel | Vorschlag Mapping (`normalizeEd269Restriction`) |
|---|---|---|
| `uas:zone:prohibited` | „VERBODEN GEBIED TIJDENS DODENHERDENKING“ | `PROHIBITED` |
| `uas:zone:conditional` | „NABIJHEID VAN VLIEGVELD … SCHIPHOL CTR 1“, Industriegebiete, Trauma-Heliports | `REQ_AUTHORISATION` bzw. `CONDITIONAL` (mit Fachseite klären, siehe §6) |
| `type:ctr` | SCHIPHOL CTR (`utmStatus` gesetzt) | `REQ_AUTHORISATION` |
| `type:tsa` | AMSTERDAM/DAM SQUARE, BIJLMERMEER | `RESTRICTED` (zeitlich aktiv) |
| `type:ras`, `type:nas` | IFR AREA RWY 24, TMZ, FAVA | `RESTRICTED` / Info. Oft Floor über 120 m, über den Höhenfilter abfangen |
| `class:a`, `class:c` | SCHIPHOL TMA 1, AMSTERDAM UTA | Info. Floor meist ≫ 120 m |
| `other:ifr_areas` | „LAAGVLIEGROUTEN … (VERBODEN VOOR OPEN CATEGORIE)“ | `PROHIBITED` (für die Open Category) |
| `class:nav_warning` | „CRANE ERECTED AT PSN …“ | Info/Warnung (Hindernis) |
| `risk:increasedAerialActivity:airport` (category `airport`, Point+radius) | Heliport VU Medisch Centrum, 1000 m | Warnung (`CONDITIONAL`) |
| `groundHazard` + `man_made:tower`, `railway:tram`, `railway:station`, `watercourse:watercourse`, `amenity:school`/`university`/`college`/`charging_station`, `navigation:hazard` | OSM-Objekte | **nicht** als Geozone. Optional als Hinweis-Layer beim Standort-Check |

Die Liste ist aus Amsterdam und Utrecht abgeleitet. Beim Einbau sollten
unbekannte `detailedCategory`-Werte geloggt und konservativ als Warnung
behandelt werden.

### 3.6 Beispiel-Feature (gekürzt)

```json
{
  "type": "Feature",
  "id": "…",
  "geometry": { "type": "Polygon", "coordinates": [[[4.7, 52.3], …]] },
  "properties": {
    "category": "airspace",
    "detailedCategory": "uas:zone:conditional",
    "name": "NABIJHEID VAN VLIEGVELD VOOR BEMAND LUCHTVERKEER EHAM SCHIPHOL CTR 1",
    "designator": "7.2",
    "hazardFactor": "60", "hazardFactorName": "Danger",
    "altitudeFloor":   { "datum": "Agl", "meters": 0.0,   "feet": 0.0 },
    "altitudeCeiling": { "datum": "Agl", "meters": 914.0, "feet": 2998.69 },
    "airac": { "from": "2026-10-29", "to": "2026-11-26" },
    "fillColor": "…", "strokeColor": "…",
    "display": { "title": "…", "sections": [ { "title": "Summary", "text": "…" } ] }
  }
}
```

---

## 4. Weitere Endpunkte (aus dem App-Bundle, **ungetestet**)

| Pfad | Zweck |
|---|---|
| `GET /v1/map/icon?icon=<name>` | Icons (PNG). **Getestet**, ohne Auth |
| `GET /v1/search/autocomplete?q=<text>&session=<id>` | Ortssuche |
| `GET /v1/search/place/<id>?session=<id>` | Ortsdetails |
| `GET /v1/postcode?q=<plz>` | Postleitzahlensuche |
| `/v1/altitude/convert` | Höhenbezug umrechnen (Methode/Parameter unbekannt) |
| `/v1/dcz/…` | Drone Control Zones |

---

## 5. Integrationsauftrag für COpterPILOT

### Ist-Zustand im Repo
- NL läuft heute über **PDOK-WMS** (`NL_GEOZONE_LAYERS` in
  `shared/geozoneLayerCatalog.ts`: `luchtvaartgebieden`, `landingsite`,
  Natura 2000, NNN in Godrone-Gelb).
- Vektor-Länder (AT/BE/DK) laufen über `client/lib/geozoneDirect/ed269Sources.ts`
  (`ED269_DIRECT_COUNTRIES`, `fetchEd269CountryFeatures`) mit Normalisierern
  in `shared/` (Muster: `shared/belgianGeozones.ts` → `normalizeBelgianFeature`).
- Gemeinsame Bausteine: `shared/ed269Restriction.ts`
  (`normalizeEd269Restriction`, Farben), `shared/geozoneAltitudeFilter.ts`
  (120-m-Erreichbarkeit), `client/lib/ed269.ts` (`ED269_SOURCE_LABELS`).

### Umsetzungsschritte

1. **`shared/dutchGeozones.ts`** (React-Native-frei, analog zu `belgianGeozones.ts`):
   - `GODRONE_GEOZONE_SOURCE_LABEL = "LVNL / GoDrone (Altitude Angel)"`
   - `godroneAltitudeMeters(alt)`: `null` oder `datum === "Unlimited"` ergibt
     `undefined`, `Sfc` ergibt 0, sonst `alt.meters`
   - `godroneAltitudeReference(alt)`: `Agl` wird „über Grund (AGL)“, `Msl` wird
     „über MSL (AMSL)“, `Sps` wird „Flugfläche (STD)“
   - `godroneRestriction(props)`: Mapping nach §3.5
   - `normalizeGodroneFeature(f)`:
     - `groundHazard` und `boundary` verwerfen
     - `Point` mit `radius` in ein Kreis-Polygon umwandeln (z. B. 48 Segmente)
     - `restriction`, `name` (`designator` als Code), `lowerMeters`,
       `upperMeters`, `typeLabel` und `message` setzen. `message` wird aus
       `display.sections[].text` gebaut, dazu `utmStatus.title` und
       `utmStatus.utm.externalUrl`, falls vorhanden
     - `airac.to` als Gültigkeitsende übernehmen
   - `dedupeGodroneFeatures` über `feature.id`
2. **Abruf in `ed269Sources.ts`**:
   - Konstanten `NL_GODRONE_MAPDATA_URL` und `GODRONE_API_KEY`
   - `fetchNetherlands()`: das NL-Gebiet (ca. `w=3.3 s=50.7 e=7.3 n=53.6`) in
     **1°×1°-Kacheln** (12 Requests) abfragen, sequenziell oder mit maximal
     2–3 parallel
     - Kacheln, die komplett außerhalb des Landes liegen, auslassen. Optional
       das `interactionRegion`-Polygon aus `map.godrone.nl/index.html`
       verwenden
     - je Kachel prüfen, dass `excludedData` **keinen** Eintrag `Airspace` hat,
       sonst die Kachel halbieren und erneut abfragen
     - Ergebnis normalisieren, über `id` deduplizieren und mit `finalize(…, "nl")`
       abschließen
   - `"nl"` zu `ED269_DIRECT_COUNTRIES` hinzufügen und in
     `fetchEd269CountryFeatures` verdrahten
   - Fehlerverhalten wie bei BE: Wenn keine Online-Quelle erreichbar ist,
     werfen, damit der Gerätebestand erhalten bleibt
3. **`client/lib/ed269.ts`**: `NL: GODRONE_GEOZONE_SOURCE_LABEL` in
   `ED269_SOURCE_LABELS` eintragen. Die Quellenangabe übernimmt
   `client/lib/sourceAttribution.ts`. Zusätzlich die Attribution
   „© LVNL / Altitude Angel“ ergänzen.
4. **WMS-Layer**: PDOK-WMS (`nl_no_fly_zones` …) **parallel behalten**, nicht
   ersetzen. Natura 2000 und NNN kommen in GoDrone nicht als Airspace-Feature
   vor. Eventuell den Default von `nl_no_fly_zones` ausschalten, wenn die Vektoren
   aktiv sind, um doppelte Darstellung zu vermeiden. Das ist eine fachliche
   Entscheidung.
5. **Optional – Standort-Check mit Ground Hazards**: Für einen Startpunkt eine
   Box von ca. 2 km × 2 km (< 20 km²) abfragen und `groundHazard` als
   Hinweisliste anzeigen (Türme, Bahnlinien, Schulen in der Nähe).
6. **Tests** (`shared/__tests__/` bzw. `client/lib/__tests__/`, tsx-Runner wie
   bei BE/DK):
   - Normalisierung je `detailedCategory`
   - Umrechnung von Point+radius in ein Polygon
   - Höhen-Datums inkl. `Unlimited` und `null`
   - Erkennung von `excludedData` mit `Airspace` (Kachel-Split)
   - Dedupe über `id`
   - Fixture: eine gekürzte echte Antwort einchecken. Mit dem Key in der
     curl-Zeile unten lässt sich eine neue erzeugen.

### Refresh / Caching
- AIRAC-Zyklus 28 Tage. `timeRange` umfasst 7 Tage, und TSA-, NOTAM- sowie
  Kran-Daten ändern sich täglich. Den Vektorbestand daher **täglich**
  aktualisieren, wie bei den anderen Ländern über `ed269Store.ts`.
- Vollabzug NL: ca. 12 Requests, grob 10–30 MB unkomprimiert. Mit
  `Accept-Encoding: gzip` und `roundFeatureCoords` (5 Nachkommastellen)
  deutlich kleiner.

---

## 6. Offene Punkte / Risiken

- **Nutzungserlaubnis schriftlich festhalten**: E-Mail des Betreibers zum
  öffentlichen Key ablegen. Der Key kann rotiert werden, deshalb muss er
  konfigurierbar sein und ein 401 sauber als „Quelle nicht verfügbar“ behandelt
  werden.
- **Mapping `uas:zone:conditional`**: In LVNL-Daten ist das die große Masse
  (CTR-Umgebung, Industriegebiete, Heliports). Mit der Fachseite klären, ob das
  als „Genehmigung nötig“ (orange) oder „bedingt“ (gelb) angezeigt wird.
- **`Msl`-Höhen** sind für die 120-m-Prüfung nur näherungsweise AGL (NL ist
  flach, Limburg aber nicht).
- **Rate-Limits** sind unbekannt. Sparsam abfragen, kein Polling.
- Die Datenabdeckung ist NL-fokussiert, Grenzgebiete können lückenhaft sein.

---

## 7. Schnelltest

```bash
curl -s --compressed \
  -H "Authorization: X-AA-ApiKey hOrnXF_XuIOko8taj9VCi9MUNP4pXVkR_dN-3B8V0" \
  "https://api.godrone.nl/v2/mapdata/geojson?n=52.40&e=4.95&s=52.34&w=4.85" \
  | jq '{complete: .isCompleteData, excluded: [.excludedData[].detail.name],
         n: (.features|length),
         cats: ([.features[].properties.detailedCategory] | group_by(.) | map({(.[0]): length}) | add)}'
```

---

## 8. Anhang: Rendering & Beobachtungen (DE-Session, 2026-11-15)

Eine zweite Browser-Analyse (Canvas-Mitschnitt, Netzwerk) hat das **Zeichnen**
im Detail bestätigt. Der Stil steckt vollständig in den Feature-Properties – die
App muss keine eigene Farbtabelle führen.

### 8.1 Zeichenregeln (verifiziert)
1. **Füllung** = `fillColor` mit `fillOpacity` als Alpha.
2. **Rand** = `borderColor` mit `borderOpacity`/`borderWidth`. **Fehlt
   `borderColor`, nimmt der Client `fillColor`.**
3. `strokeColor`/`strokeWidth`/`strokeOpacity` werden im Normalzustand **nicht**
   gezeichnet – vermutlich Hover/Auswahl (nicht abschließend verifiziert).
4. Durchgehende Linien (kein Dash, keine Schraffur). Löcher = weitere Ringe des
   Polygons (OL/Canvas-Standard).

> ⚠️ **Zahlen kommen als Strings** (`fillOpacity:"0.18"`, `borderWidth:"2"`,
> `hazardFactor:"60"`) → beim Styling **`parseFloat`/`to-number`**.

### 8.2 Sichtbarkeit über `filters[]`
Ein Feature erscheint **nur, wenn alle Filter seiner Kette `active:true`** sind
(z. B. `Upper Airspace > Airspace > Class A`). Die Voreinstellung kommt vom
Server; einige Ebenen sind default **aus** (z. B. `type:ras`, `type:tsa`,
`other:atc_area`, Teile von „Upper Airspace"). → Beim Übernehmen die
`active:false`-Features ausblenden statt hart zu filtern.

### 8.3 Fertiges data-driven Styling
**MapLibre/Mapbox GL** (GeoJSON direkt als Source, Look identisch zu GoDrone):
```
fill-color:   ["get","fillColor"]
fill-opacity: ["to-number", ["get","fillOpacity"]]
line-color:   ["coalesce", ["get","borderColor"], ["get","fillColor"]]
line-width:   ["to-number", ["get","borderWidth"]]
```
**OpenLayers:**
```js
const rgba = (hex,a)=>{const [r,g,b]=asArray(hex);return [r,g,b,parseFloat(a)];};
function zoneStyle(f){
  const p=f.getProperties();
  if (p.filters?.some(x=>x.active===false)) return null;        // ausgeblendet
  return new Style({
    fill:   new Fill({ color: rgba(p.fillColor, p.fillOpacity ?? 0) }),
    stroke: new Stroke({ color: rgba(p.borderColor || p.fillColor, p.borderOpacity ?? 1),
                         width: parseFloat(p.borderWidth ?? 1) }),
    zIndex: parseInt(p.hazardFactor ?? 0, 10),                    // Gefährlicheres oben
  });
}
```

### 8.4 Kreise – Beobachtung
In diesem Durchlauf (hereingezoomt) kamen **alle** Geometrien als `Polygon`,
Kreiszonen bereits als **geschlossenes ~41-Punkt-Polygon** (plus `radius` in den
Properties). Das deckt sich mit §3.4 (Punkt+`radius`) so: **wenn** schon ein
Polygon geliefert wird, direkt nutzen; **nur** bei reinem `Point`+`radius` selbst
auffächern. → Normalisierer: erst Geometrietyp prüfen, Kreisberechnung nur als
Fallback. Für feinere Darstellung kann man aus Mittelpunkt+`radius` jederzeit
einen glatteren Kreis erzeugen.

### 8.5 `hazardFactor`-Stufen
`20` = Information · `40` = Warning · `60` = Danger → eignet sich als `zIndex`
(Gefährlicheres oben) und für die Sortierung im Info-Panel (`listOrderHint`).
