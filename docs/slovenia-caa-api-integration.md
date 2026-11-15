# Slowenien (SI) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zur Slowenien-Karte (CAA Slovenia / Slovenia Control,
ArcGIS Web AppBuilder). Stand: 2026-11-15, live geprüft. Freigabe liegt vor.

Quelle: `caa-slovenia.maps.arcgis.com/apps/webappviewer/index.html?id=2d42618566cc4f49a263a676a964ec90`

Vergleich: übrige Länder-Dokumente in `docs/`.

---

## 1. Kurzfassung

- Slowenien nutzt eine **ArcGIS-Online-WebMap** (CAA Slovenia). Die Zonen
  liegen als **öffentliche ArcGIS-FeatureServer** auf
  `services6.arcgis.com/1F2lR3M9nMUYDj5l` – **ohne Authentifizierung**.
- Mehrere Layer bilden zusammen das Luftraumbild. Drohnenrelevant v. a.:
  - `restricted_danger/FeatureServer/0` – Restricted/Danger-Gebiete
  - `CTR_AIRAC_AMDT_108_2021/FeatureServer/0` – Kontrollzonen
  - `TMZ_areas/FeatureServer/0`
  - `Danger_corridor_LJD2/FeatureServer/0`
  - dazu `gat_jan2021_v2_gdb/FeatureServer/*` (VFR-Routen, Flugplätze,
    Paragliding, Reporting Points …)
- ⚠️ **Schema ist dünn** (Name + NOTAM-Link, kaum strukturierte Metadaten) und
  die Layer tragen **Stände von 2021** (AMDT 108) – Aktualität prüfen.

---

## 2. Zugang

Basis: `https://services6.arcgis.com/1F2lR3M9nMUYDj5l/arcgis/rest/services/`

| Layer | URL |
|---|---|
| Restricted/Danger | `restricted_danger/FeatureServer/0` |
| CTR | `CTR_AIRAC_AMDT_108_2021/FeatureServer/0` |
| TMZ | `TMZ_areas/FeatureServer/0` |
| Danger-Korridor | `Danger_corridor_LJD2/FeatureServer/0` |

Abruf als GeoJSON:
```
GET <layer>/query?where=1=1&outFields=*&outSR=4326&f=geojson
```
Auth: keine. Die WebMap-Definition (alle Layer):
`caa-slovenia.maps.arcgis.com/sharing/rest/content/items/b380ca2b24a24e49a07e918396836e59/data?f=json`.

---

## 3. Schema (`restricted_danger`, Beispiel)

| Feld | Beispiel | Bedeutung |
|---|---|---|
| `AREA` | `LJ(R)-6A` | Gebietskennung |
| `Subject` | `LJ(R)-6A restricted` | Beschreibung |
| `NOTAM` | `https://www.sloveniacontrol.si/…/Zapore.aspx` | Link zu Sperren |
| `FID`/`Id` | | ID |
| `Shape__Area`/`Shape__Length` | | Geometrie-Maße |

- Geometrie: Polygon (WGS84). **Keine Höhen, keine strukturierte Restriction**
  → Typ/Beschränkung aus dem Layernamen ableiten (`restricted_danger` →
  `REQ_AUTHORISATION`/Danger; `CTR` → `REQ_AUTHORISATION`; `TMZ` → Info).

---

## 4. Integrationsauftrag

### Schritte
1. **Abruf** `fetchSlovenia()`: die 4 drohnenrelevanten FeatureServer-Layer
   (restricted_danger, CTR, TMZ, Danger_corridor) als GeoJSON laden und mergen;
   Layername → Zonentyp/Beschränkung.
2. **Normalisierung** `shared/sloveniaGeozones.ts`: Felder → internes Modell;
   keine Höhen → ohne Ceiling; `NOTAM`-Link als Info übernehmen.
3. `"si"` in die Länderliste. Label `SI: "CAA Slovenia / Slovenia Control"`,
   Attribution „© Slovenia Control".
4. **Tests**: Merge der Layer, Layername→Typ-Mapping, Dedupe über `AREA`/`FID`.
5. **Refresh**: täglich.

---

## 5. Offene Punkte
1. **Aktualität:** Layer tragen 2021/AMDT-108-Stände. Bei CAA Slovenia/Slovenia
   Control klären, ob es aktuellere Layer oder einen ED-269-Feed gibt.
2. **Dünnes Schema:** keine Höhen/strukturierte Beschränkung – Typ nur über
   Layername. Für die 120-m-Prüfung fehlen Ceilings.
3. Vollständige Layerliste (14 Layer) auf weitere drohnenrelevante Ebenen
   prüfen.

---

## 6. Schnelltest
```bash
B="https://services6.arcgis.com/1F2lR3M9nMUYDj5l/arcgis/rest/services"
curl -s "$B/restricted_danger/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson" \
  | jq '{n:(.features|length), sample:.features[0].properties}'
```

---

## Anhang SI: aktuelle Mai-2026-Karte + dynamische Auflösung + Skript (DE-Session, 2026-11-15)

⚠️ **Korrektur zum „Stand 2021":** Es gibt eine **aktuelle** UAS-Geozonen-Karte
(Mai 2026). Die alte 2021er-/„GAT"-Karte **nicht** verwenden.

- **Aktuelle Web Map:** Item `14c35a6c4d5a472ea2ed5b2a75abc690` („UAS GEO ZONES –
  May 2026"), App `25ba69037c264c5faa5381174f76f861`.
- **Dynamisch auflösen (Pflicht):** Die CAA tauscht bei Updates ganze Feature-
  Services aus (`ELES_2023`→`_2025`, `Luka_KP`→`Luka_Koper_25`). Daher **nie**
  Layer-URLs hart verdrahten, sondern die Web Map lesen
  (`…/sharing/rest/content/items/14c35a6c4d5a472ea2ed5b2a75abc690/data?f=json` →
  `operationalLayers[].url`). Services auf `services6.arcgis.com/1F2lR3M9nMUYDj5l`,
  nur `Query`, `f=geojson` → WGS84, `maxRecordCount` 2000.

**Werkzeug im Repo:** [`docs/tools/slovenia/caa_si_geozones.py`](tools/slovenia/caa_si_geozones.py)
(nur Stdlib) → liest Layerliste aus der Web Map, paginiert, schreibt
`si_uas_geozones.geojson` + `si_manifest.json` (mit `lastEditDate`).

### Relevante Layer (Auszug)
CTR (4), Restricted (5, NOTAM-dynamisch), Danger (1, NOTAM-dynamisch),
Kernkraftwerk Krško (verboten), ELES-Stromnetz (32), Flugfelder/Aerodrome,
Heliports, ModelarskeCone, GO_07/08/09, Triglav-Nationalpark. ⚠️ **`Pozidano_built`
= bebaute Gebiete ~190.000 Polygone (~280 MB!)** → nur gepaged ziehen und als
**PMTiles** (tippecanoe) ausliefern, nie roh.

### Fallen
- **Feldnamen je Layer verschieden** (Mapping-Tabelle in der Quelldoku) → auf
  `restrict*`/`subject`/`except*` (case-insensitive) zurückfallen. Zweisprachig
  SL/EN.
- **Höhen meist Freitext** („allowed up to 50 m AGL"); nur `UAS_URSIKS` hat Zahl
  (`Upper`). `restriction_level`: `forbidden/prohibited`→`PROHIBITED`,
  `allowed up to…`→`CONDITIONAL`.
- **Restricted/Danger sind zeitabhängig** (`Check_NOTAM`-Link) → in der App
  „NOTAM prüfen" kennzeichnen. **FIR ist eine Linie**, keine Zone.
- `objectIdField` ist bei `Pozidano` **`FID`** (nicht `OBJECTID`); `outFields=*`
  nehmen. Attribution/Farben aus `drawingInfo` der Web Map.
