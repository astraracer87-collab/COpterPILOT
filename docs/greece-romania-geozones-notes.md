# Rumänien (RO) & Griechenland (GR) – Geozonen-Analyse

Stand: 2026-11-15, **live verifiziert von einer DE-IP** (die Hosts waren nur aus
der US-Cloud blockiert). Freigaben liegen vor. Bot-/WAF-Schutz wurde **nicht
umgangen** – GR nur per echtem Browser gelesen.

---

## Rumänien (RO) – ROMATSA ✅ GELÖST (öffentlich, ohne Auth)

Technik: **Leaflet + GeoServer WFS** (web2py-App `flightplan.romatsa.ro`). Zwei
Daten-Endpunkte, beide direkt als JSON abrufbar, **ohne Login**:

### 1. Statischer Zonensatz (Haupt-Geozonen)
```
GET https://flightplan.romatsa.ro/init/static/zone_restrictionate_uav.json
```
- GeoJSON-`FeatureCollection`, **1.272 Features**.
- Properties: `zone_id`, `lower_lim`, `upper_lim` (Höhen), `contact`, `status`.
- Fixture: `fixtures/ro_zone_restrictionate_uav.json` (2,1 MB).

### 2. GeoServer-WFS – NOTAM-UAV (temporäre Sperren)
```
GET https://flightplan.romatsa.ro/init/geoserver/ows?service=WFS&version=1.0.0
    &request=GetFeature&typeName=carto:restrictii_notam_pt_uav
    &maxFeatures=5000&outputFormat=application/json
```
- GeoJSON-`FeatureCollection`, **226 Features**.
- Properties: `serie`, `dfrom`, `dto` (Gültigkeit), `mesaj`, `tip`.
- Fixture: `fixtures/ro_wfs_restrictii_notam_pt_uav.geojson` (279 KB).
- Der GeoServer kann weitere `carto:*`-Layer haben → `GetCapabilities` am
  selben `…/init/geoserver/ows` prüfen.

### Integration RO
- Beide Quellen (statische Zonen + NOTAM-WFS) laden und mergen.
- `shared/romaniaGeozones.ts`: `zone_id`/`status` → Beschränkung,
  `lower_lim`/`upper_lim` → Höhen, `contact` übernehmen; NOTAM-Layer
  (`dfrom`/`dto`) als zeitlich begrenzte Zonen.
- `"ro"` in die Länderliste. Label `RO: "ROMATSA"`. **Status: einsatzbereit.**

---

## Griechenland (GR) – HASP/HCAA (DAGR) ⚠️ nur WMS-Raster, KEIN öffentliches Vektor-Dataset

**Korrektur zum Handover:** Nicht Esri/ArcGIS, sondern **MapServer 7.0.1
(MS4W 3.1.4)** über `…/cgi-bin/mapserv.exe` (OpenLayers-Frontend).

- Die Karte lädt **nur gerenderte WMS-Rasterkacheln** (`REQUEST=GetMap`,
  `FORMAT=image/png`), zeitgefiltert über `WMS_DATE_FROM`/`WMS_DATE_TO`.
- **WFS ist serverseitig DEAKTIVIERT** → kein GeoJSON/GML-Bulk-Export
  („WFS request not enabled"). Der Server kann WFS, es ist nur abgeschaltet.
- **GetFeatureInfo ist aktiv** (`queryable=1`; HTML/GML/text) → nur
  **Punktabfrage je Klick**, kein Datensatz.
- **Host blockt Nicht-Browser-Clients** (curl → 403); nur ein echter Browser
  kommt an die Endpunkte. Kanonischer Host laut Capabilities: `dagr.hcaa.gr`;
  die App nutzt `dagr.hasp.gov.gr`.

**Relevante WMS-Layer:** `all_limitation_layer`, `all_warning_layer`,
`all_permifrag_layer`, `hellas_CTR` (+ `_ann`-Annotationsvarianten),
`allowed_future_flight_layer`, `rejected_future_flight_layer` u. a.

**Beispiel-GetMap (Raster-Overlay):**
```
…/cgi-bin/mapserv.exe?map=C:/ms4w_3.1.4/MAPFILES/dagr_TILED.map&SERVICE=WMS
  &VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true
  &LAYERS=all_limitation_layer,all_warning_layer,all_permifrag_layer,hellas_CTR
  &CRS=EPSG:3857&WMS_DATE_FROM=<von>&WMS_DATE_TO=<bis>&WIDTH=256&HEIGHT=256&BBOX=<...>
```

### Empfehlung / nächster Schritt GR
Für echte Geozonen-Geometrien führt der öffentliche Weg **nicht** weiter. Optionen:
1. **WMS-Raster-Overlay** einbinden (nur Anzeige, keine Geofencing-Logik).
2. **ED-269/AIXM bei HASP/HCAA anfragen** – der saubere Weg zu Vektordaten
   (wie bei den Login-/Betreiber-Ländern). **Empfohlen.**
3. Nur für Punkt-in-Zone-Checks: **GetFeatureInfo** on-demand (kein Datensatz).

**Status GR: offen** – ohne Vektordaten keine vollwertige Geo-Awareness;
ED-269/AIXM beim Betreiber erfragen.
