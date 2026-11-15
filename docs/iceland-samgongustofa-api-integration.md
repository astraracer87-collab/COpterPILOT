# Island (IS) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **island.is/en/drone-map** (Samgöngustofa / ISAVIA).
Stand: 2026-11-15, live geprüft. Freigabe liegt laut Product Owner vor.

Vergleich: übrige Länder-Dokumente in `docs/`.

---

## 1. Kurzfassung

- Islands Drohnenkarte (`island.is/en/drone-map`) bettet den
  **gis.is-Kartenviewer** ein (`kort.gis.is/mapview/?app=dronar`, ISAVIA).
- Die Zonen liegen als **GeoServer-Vektorlayer** vor und sind per **WFS als
  GeoJSON** abrufbar – **ohne Authentifizierung**.
- **Layer (live geprüft):** `samgongustofa:dronemap_isl_geom`
  (Samgöngustofa = isländische Verkehrsbehörde) → **271 Zonen**, `MultiPolygon`,
  ED-269-nahe Felder (`country: "ISL"`). Dazu
  `samgongustofa:skyndilokanir_dronar` (temporäre Sperrungen, aktuell 0).
- Einschränkung: Der Layer trägt **nur Basis-Metadaten, keine Höhengrenzen**.

---

## 2. Zugang

| Punkt | Wert |
|---|---|
| GeoServer | `https://gis.is/geoserver/wfs` (auch `https://gis.natt.is/geoserver/wfs`) |
| Zonen-Layer | `samgongustofa:dronemap_isl_geom` |
| Temp. Sperrungen | `samgongustofa:skyndilokanir_dronar` |
| Auth | **keine** |
| WMS (Raster, optional) | `https://gis.is/geoserver/wms` (gleiche Layer) |

Abruf als GeoJSON:
```
GET https://gis.is/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature
    &typeNames=samgongustofa:dronemap_isl_geom
    &srsName=EPSG:4326&outputFormat=application/json
```

---

## 3. Schema (WFS-GeoJSON)

| Feld | Beispiel | Bedeutung |
|---|---|---|
| `identifier` | `NFZ-1` | ID (Dedupe) |
| `country` | `ISL` | |
| `name` | `Lögreglan á höfuðborgarsvæðinu` | Name (isländisch) |
| `type` | `COMMON` | (alle) |
| `restriction` | `CONDITIONAL` | (im Datensatz durchgehend CONDITIONAL) |
| `purpose` | `INFORMATION` | |

- Geometrie: `MultiPolygon` (WGS84).
- **Keine `lower`/`upper`/Höhenfelder** – der 120-m-Höhenfilter greift mangels
  Ceiling nicht; alle IS-Zonen immer anzeigen (wie bei IE).
- Dedupe über `identifier`.

---

## 4. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- IS ist nur über Bounding-Box bekannt (`shared/countryDetection.ts`), **keine
  Geodaten**, kein Karten-Link in `countryMaps.ts`.

### Schritte
1. **Abruf** `client/lib/geozoneDirect/islandSource.ts` (oder in
   `ed269Sources.ts`):
   - `IS_WFS = "https://gis.is/geoserver/wfs"`,
     Layer `samgongustofa:dronemap_isl_geom`.
   - `fetchIceland()` lädt GeoJSON (ggf. paginiert über `count`/`startIndex`),
     plus optional `skyndilokanir_dronar` (temporäre Sperrungen) mergen.
2. **Normalisierung** `shared/icelandGeozones.ts`: Felder → internes Modell;
   `restriction` ist ED-269-Standard (`CONDITIONAL`), direkt nutzbar. Keine
   Höhen → ohne Ceiling behandeln.
3. `"is"` in die Länderliste; eigener WFS-Pfad (nicht reines ED-269-GeoJSON,
   aber nah dran).
4. **Label**: `IS: "Samgöngustofa / ISAVIA"`. Attribution
   „© Samgöngustofa / ISAVIA / gis.is".
5. **Tests**: Normalisierung, fehlende Höhen, Dedupe über `identifier`,
   WFS-Paging.
6. **Refresh**: täglich.

---

## 5. Offene Punkte
- **Fehlende Höhen:** Klären, ob ein ergänzender Layer Höhengrenzen führt
  (`dronemap_isl_geom` hat keine). Für die reine Zonen-Anzeige ausreichend.
- `gis.is` vs. `gis.natt.is` liefern denselben WFS – einen als Primär-, den
  anderen als Fallback nutzen.
- Namen/Infos sind isländisch (ggf. `purpose`/`restriction` für die
  Anzeige übersetzen).

---

## 6. Schnelltest

```bash
UA="Mozilla/5.0 Chrome/120"
curl -s --compressed -A "$UA" "https://gis.is/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=samgongustofa:dronemap_isl_geom&srsName=EPSG:4326&outputFormat=application/json" \
  | jq '{n:(.features|length), country:(.features[0].properties.country), keys:(.features[0].properties|keys)}'
```
