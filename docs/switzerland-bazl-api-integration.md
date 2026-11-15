# Schweiz (CH) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **map.geo.admin.ch**, Ebene „Einschränkungen für Drohnen"
(Layer `ch.bazl.einschraenkungen-drohnen`). Datenherr **BAZL**, Hosting
swisstopo / geo.admin.ch. Stand: 2026-11-15, live verifiziert (DE-Session).

Vergleich: `docs/anac-pt-api-integration.md` (ED-269 + `layer`),
`docs/dronespace-at-api-integration.md` (AT).

---

## 1. Kurzfassung

- Offizieller, **täglich** erzeugter Datensatz, **ohne Auth**. Aktuell **1.288
  Zonen** (1.279 Polygon, 9 MultiPolygon), alle `country: "CHE"`, ED-269-konform.
- **Drei Wege:** Bulk-Download (STAC) **für die App**, Live-`identify` (Punkt-/
  Mehrsprach-Abfrage), WMTS-Raster (nur Anzeige).
- Bulk gibt es als **GeoJSON** (flache Properties) **und ED-269-JSON**
  („SwissUASGeozones", verschachtelt) – beide WGS84.
- Attribution Pflicht: **„Daten: BAZL, swisstopo"**.
- 🇱🇮 **Liechtenstein ist mit abgedeckt:** CH und LI bilden ein gemeinsames
  Luftfahrt-/Drohnenregime (BAZL zuständig); der Datensatz enthält die
  LI-Zonen mit. → **Kein eigener LI-Abruf nötig**; in der App LI auf diese
  CH-Quelle mappen (Ländererkennung `li` → `ch`-Geozonen).

---

## 2. Bulk-Download (Hauptweg)

### STAC-Katalog
```
GET https://data.geo.admin.ch/api/stac/v0.9/collections/ch.bazl.einschraenkungen-drohnen/items
```
Liefert ein Item mit Assets (Auswahl):
| Asset-Key | Inhalt | ~Größe |
|---|---|---|
| `einschraenkungen-drohnen_4326.geojson` | GeoJSON, **flache Properties** | 13,9 MB |
| `einschraenkungen-drohnen_4326.json` | **ED-269** (verschachtelt) | 18 MB |
| `…_2056.gpkg` / `…_2056.shp.zip` / `…_2056.xtf.zip` | GeoPackage/Shapefile/INTERLIS | LV95 |

> ⚠️ **Asset-URLs nicht hart codieren** – immer über `assets[<key>].href` aus der
> STAC-Antwort lesen. Änderungserkennung über `properties.updated` / `datetime`
> des Items (täglich ~04:05 UTC neu).

**Welche Datei:** `_4326.geojson` = einfachste Wahl (direkt MapLibre/Leaflet/
Turf). **`_4326.json` (ED-269)** = sinnvolles gemeinsames Zielformat, wenn mehrere
Länder in ein Schema kommen (mehrere Zeitfenster/Höhenschichten sauber abbildbar).

---

## 3. Schema (GeoJSON `_4326.geojson`, ED-269 flach)

| Feld | Bedeutung | Werte |
|---|---|---|
| `identifier` | eindeutige ID | `CTR0015`, `LSZH001`, `VD00051`, `BLns…` |
| `country` | `CHE` | |
| `name` | Zonenname | „CTR ZURICH" … |
| `type` | `COMMON` (alle) | |
| `restriction` | `REQ_AUTHORISATION` (alle – auch Sperrungen laufen formal als „Bewilligung nötig") | |
| `restrictionConditions` | **Klartext-Regel (EN)** | „Operation of UA > 250 g prohibited from 120 m AGL" |
| `reason` | `NATURE` (820), `SENSITIVE` (288), `AIR_TRAFFIC` (180) | |
| `message` | Pilotenhinweis (EN) | |
| `permanent` | `YES` (1.251) / `NO` (37) | |
| `startDateTime`/`endDateTime`, `startTime`/`endTime` | Zeitfenster (nur bei `permanent=NO`) | ISO 8601 |
| `authorityName`/`service`/`email`/`siteURL`/`phone`, `purpose`, `intervalBefore` | Bewilligungsstelle + Vorlauf (`P14DT00H`=14 Tage) | |
| `uomDimensions`=`M`, `lowerLimit`/`lowerVerticalReference`, `upperLimit`/`upperVerticalReference` | Höhen (AGL) | siehe unten |
| `fill`/`fill-opacity`/`stroke`/`stroke-opacity`/`stroke-width` | **fertige Darstellung** (simplestyle) | §5 |

### Höhen richtig lesen ⚠️
- `lowerLimit = 0` → Einschränkung **ab Boden**.
- `lowerLimit = 120` (alle 18 **CTR**) → **unterhalb 120 m AGL frei**,
  Einschränkung erst darüber (typischer Kontrollzonen-Fall).
- `upperLimit = 99999` → nach oben unbegrenzt.

### ED-269-Variante (`_4326.json`)
Gleiche Kernfelder, aber verschachtelt: `applicability[]` (mit `permanent`,
`startDateTime`/`endDateTime`, `dailyPeriod[]` = tägliche Fenster),
`zoneAuthority[]`, `geometry[]` (je Volumen `uomDimensions`/`lowerLimit`/
`lowerVerticalReference`/`upperLimit`/`upperVerticalReference`/
`horizontalProjection`). **Für tägliche Zeitfenster + mehrere Höhenschichten
diese Variante nehmen.**

---

## 4. Besonderheiten der Geometrie
- `Polygon`/`MultiPolygon`, `[lon,lat]`, Kreise bereits **auspolygonisiert**
  (kein Radius-Sonderfall).
- Manche Flugplätze = **zwei Zonen**: `LSxx001` (Zone) + `LSxx002`
  („Airport perimeter", ab Boden). Beide auswerten.
- Zonen überlappen → bei Punktabfrage **alle** Treffer auswerten.

---

## 5. Farben/Kategorien (aus `fill`, wie auf map.geo.admin.ch)
| Farbe | Anzahl | reason | Zonen |
|---|---|---|---|
| 🟧 `#ffaa00` | 820 | NATURE | Wild-/Vogelschutz, Jagdbann (`BLns`, `JBG`, `WZV_`, `VD…`) |
| 🟦 `#0041be` | 288 | SENSITIVE | Gefängnisse, Kernanlagen (`ENSI`), Militär (`VBS_`), Spitäler (`OS_`) |
| 🟪 `#900050` | 102 | AIR_TRAFFIC | Flugplätze, Heliports, **CTR** (ab 120 m AGL) |
| 🟥 `#b11313` | 78 | AIR_TRAFFIC | Flugplatz-Perimeter (`LSxx002`, ab Boden) |

Farben stehen in den Properties → **kein eigenes Mapping nötig**
(MapLibre: `fill-color: ["get","fill"]`, `fill-opacity: ["get","fill-opacity"]`).

---

## 6. Integration für COpterPILOT

### Schritte
1. **STAC-Sync (täglich, z. B. 06:00):** Item abfragen → bei neuem `updated` die
   **`_4326.json` (ED-269)** laden → ins gemeinsame Schema (`finalize(…,"ch")`
   bzw. `shared/swissGeozones.ts`). `"ch"` in die Vektor-Länder.
2. **Performance:** 13,9 MB roh ist zu groß fürs Gerät → im Backend **PMTiles**
   (tippecanoe) für die Anzeige; Rohgeometrie + Index (`rbush`/`flatbush`) für die
   Punkt-/Routenprüfung. Für die rechtliche Prüfung **unvereinfachte** Geometrie.
3. **Höhen/Zeit:** `lowerLimit`/`upperLimit` (AGL) + `permanent`/`startDateTime`/
   `endDateTime` (+ `dailyPeriod` aus ED-269) auswerten.
4. **Mehrsprachigkeit:** Bulk nur **EN**. DE/FR/IT über die Live-API (`identify`,
   Felder `zone_*_de`, `auth_*_de`) nachladen und cachen, oder je `reason`
   eigene Standardtexte.
5. **Label/Attribution:** `CH: "BAZL / swisstopo"` → „Daten: BAZL, swisstopo".

---

## 7. Live-API (optional, wie die Webseite)

**Identify (Zonen an Punkt, mit Geometrie + mehrsprachig):**
```
GET https://api3.geo.admin.ch/rest/services/ech/MapServer/identify
   ?layers=all:ch.bazl.einschraenkungen-drohnen
   &geometry=8.5417,47.3769&geometryType=esriGeometryPoint&sr=4326
   &mapExtent=8.4,47.3,8.7,47.45&imageDisplay=1000,600,96&tolerance=10
   &geometryFormat=geojson&returnGeometry=false&lang=de
```
Properties u. a.: `zone_name_de/fr/it/en`, `zone_restriction_id`
(z. B. `REQ_AUTHORISATION.CTR`), `zone_restriction_de`, `zone_message_de`,
`auth_*`, `air_vol_lower_limit`/`_upper_limit`/`_vref`, `time_*`, `period_*`.
Auch `esriGeometryEnvelope` möglich (alle Zonen im Gebiet).
> `featureId` der API ≠ `identifier` der Bulk-Datei → Bulk als führende Quelle.

**HTML-Popup:** `…/ch.bazl.einschraenkungen-drohnen/{featureId}/htmlPopup?lang=de`
**WMTS-Raster (nur Anzeige):**
`https://wmts.geo.admin.ch/1.0.0/ch.bazl.einschraenkungen-drohnen/default/current/3857/{z}/{x}/{y}.png`

---

## 8. Offene Punkte
- Nutzungslizenz formal bestätigen (map.geo.admin.ch: „Daten: BAZL, swisstopo").
- Temporäre Zonen (`permanent=NO`, z. B. Lauberhorn, Baustellen) ändern häufig →
  tägliche Synchronisation ist Pflicht; Datenstand in der App anzeigen.

---

## 9. Schnelltest

```bash
UA="Mozilla/5.0 Chrome/120"
HREF=$(curl -s -A "$UA" "https://data.geo.admin.ch/api/stac/v0.9/collections/ch.bazl.einschraenkungen-drohnen/items" \
  | jq -r '.features[0].assets["einschraenkungen-drohnen_4326.geojson"].href')
curl -s -A "$UA" "$HREF" | jq '{n:(.features|length),
  reason:([.features[].properties.reason]|group_by(.)|map({(.[0]):length})|add),
  perm:([.features[].properties.permanent]|group_by(.)|map({(.[0]):length})|add)}'
```
