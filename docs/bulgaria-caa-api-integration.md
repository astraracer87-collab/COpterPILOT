# Bulgarien (BG) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **uas.caa.bg** (Главна дирекция „Гражданска въздухоплавателна
администрация" / Bulgaria CAA). Stand: 2026-11-15, live geprüft. Freigabe liegt vor.

Vergleich: übrige Länder-Dokumente in `docs/`.

---

## 1. Kurzfassung

- Bulgariens UAS-Portal (`uas.caa.bg`, Angular-App) bezieht die Zonen aus einem
  **öffentlichen GeoServer-WFS** – **ohne Authentifizierung**.
- **Endpoint:** `https://uas.caa.bg/geoserver/caa-uas/wfs`
- Reiches, strukturiertes Schema (ED-269-nah): Zonentyp, Beschränkung, Höhen
  (als WKT im `buffer_wkt`), Kontakt, U-Space-Flag, Gültigkeit.
- Öffentliche Layer (`typename`):
  - `caa-uas:VGeoCAAZonesPublic` – **Haupt-Zonendatensatz**
  - `caa-uas:VGeoBULATSAZonesPublic` – BULATSA-Zonen (16)
  - `caa-uas:VGeoAirspaceZonesPublic`, `caa-uas:VGeoFlightZonesPublic`
    (derzeit leer, aber vorhanden)

---

## 2. Zugang

```
GET https://uas.caa.bg/geoserver/caa-uas/wfs
    ?service=WFS&version=2.0.0&request=GetFeature
    &typename=caa-uas:VGeoCAAZonesPublic
    &srsName=EPSG:4326&outputFormat=application/json
```
- Auth: **keine**. Paging via `count`/`startIndex`.
- Capabilities: `…/wfs?service=WFS&request=GetCapabilities` (alle Layer).
- Config der App: `https://uas.caa.bg/assets/config/static_public.json`.

---

## 3. Schema (`VGeoCAAZonesPublic`)

| Feld | Bedeutung |
|---|---|
| `zone_id`, `id` | IDs (Dedupe) |
| `name` | Zonenname |
| `zone_type` | Zonentyp |
| `restriction_code` | Beschränkung (→ ED-269-Mapping) |
| `buffer_wkt` | **Geometrie als WKT** (zusätzlich zur GeoJSON-`geometry`) |
| `region` | Region |
| `purpose` | Zweck |
| `is_uspace` | U-Space-Zone (bool) |
| `is_permanent` | dauerhaft (bool) |
| `contact_name` / `contact_email` / `contact_phone` | Freigabestelle |
| `information`, `message` | Infotexte |
| `restriction_conditions` | Bedingungen |
| `z_order`, `is_deleted` | UI/Status |

Geometrie kommt als GeoJSON (`outputFormat=application/json`); `buffer_wkt` ist
redundant.

---

## 4. Integrationsauftrag

### Ist-Zustand
- BG nur über Bounding-Box bekannt, keine Geodaten.

### Schritte
1. **Abruf** `fetchBulgaria()` in `ed269Sources.ts`: WFS `VGeoCAAZonesPublic`
   (+ `VGeoBULATSAZonesPublic`) als GeoJSON, paginiert.
2. **Normalisierung** `shared/bulgariaGeozones.ts`: `restriction_code`/
   `zone_type` → internes Modell; Höhen aus `restriction_conditions`/
   `message` ableiten (prüfen, ob strukturierte Höhenfelder existieren – in
   der Stichprobe nicht sichtbar); Kontakt/`is_uspace`/`is_permanent`
   übernehmen; `is_deleted=true` filtern.
3. `"bg"` in die Länderliste. Label `BG: "CAA Bulgaria"`, Attribution
   „© ГД ГВА (CAA Bulgaria)".
4. **Tests**: WFS-Paging, `restriction_code`-Mapping, Dedupe über `zone_id`.
5. **Refresh**: täglich.

---

## 5. Offene Punkte
- **Höhen:** In den Properties sind keine klaren `lower`/`upper`-Felder;
  prüfen, ob Höhen in `restriction_conditions`/`message` oder einem anderen
  Layer stecken.
- `restriction_code`-Werte vollständig erfassen und mappen.

---

## 6. Schnelltest
```bash
curl -s "https://uas.caa.bg/geoserver/caa-uas/wfs?service=WFS&version=2.0.0&request=GetFeature&typename=caa-uas:VGeoCAAZonesPublic&srsName=EPSG:4326&outputFormat=application/json" \
  | jq '{n:(.features|length), types:([.features[].properties.zone_type]|group_by(.)|map({(.[0]):length})|add)}'
```
