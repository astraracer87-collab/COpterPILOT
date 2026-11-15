# Slowenien (SI) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zur Slowenien-Karte (CAA Slovenia / Slovenia Control,
ArcGIS Web AppBuilder). Stand: 2026-11-15, live geprüft. Freigabe liegt vor.

Quelle: `caa-slovenia.maps.arcgis.com/apps/webappviewer/index.html?id=2d42618566cc4f49a263a676a964ec90`

Vergleich: übrige Länder-Dokumente in `docs/`.


> **Korrektur (2026-11-15, nach Integration):** Die oben genannte App
> `2d42618…` ist die GAT-Karte (allgemeine Luftfahrt, Stand 2021). Die aktuelle
> offizielle Drohnenkarte ist **„UAS GEO ZONES – May 2026“** (App
> `25ba69037c264c5faa5381174f76f861`, WebMap `14c35a6c4d5a472ea2ed5b2a75abc690`,
> Besitzer `CAA_SLO`). Die App nutzt deren 18 Zonen-Ebenen, siehe
> `shared/slovenianGeozones.ts` (`SI_LAYERS`).


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
