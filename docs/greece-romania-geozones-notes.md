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

---

## Anhang RO: Verifizierte Felder & Mapping (DE-IP, 2026-11-15)

**Fixtures:** `docs/fixtures/ro_zones_sample.geojson`, `docs/fixtures/ro_notam_sample.geojson`.

### Quelle 1 – statische Zonen (`zone_restrictionate_uav.json`, 1.272 Features)
| Feld | Beispiel | Mapping |
|---|---|---|
| `zone_id` | `RZ 1001` | ID/Name (Dedupe) |
| `status` | `RESTRICTED` | → Beschränkung (`RESTRICTED`→`REQ_AUTHORISATION`; weitere Werte prüfen) |
| `lower_lim` | `GND` | Untergrenze: `GND`→0 |
| `upper_lim` | `120M AGL` | Obergrenze: `"120M AGL"`→120 m; auch `FL###` möglich → ×100 ft ×0.3048 |
| `contact` | `ROMATSA +40… twr.arad@romatsa.ro` | Freigabestelle |

Geometrie: `Polygon` (WGS84). Höhen-Parser nötig (`GND`/`### M AGL`/`FL###`).

### Quelle 2 – NOTAM-UAV WFS (`restrictii_notam_pt_uav`, 226 Features)
| Feld | Beispiel | Mapping |
|---|---|---|
| `serie` | `R5607/2026` | NOTAM-Kennung |
| `dfrom` / `dto` | `2026-10-31T17:30:00Z` / … | Gültigkeit (zeitlich begrenzte Zone) |
| `tip` | `R` | Typ (R=Restricted …) |
| `mesaj` | voller NOTAM-Text (Q/A/B/C/D/E…-Zeilen) | Popup/Info; Höhen ggf. aus `F)/G)` |

→ `shared/romaniaGeozones.ts`: beide Quellen mergen; statische Zonen als
Dauerzonen, NOTAM als temporäre (über `dfrom`/`dto`). Dedupe statisch über
`zone_id`, NOTAM über `serie`.

---

## Anhang GR: ✅ doch extrahierbar – WMS-KML + GetFeatureInfo (DE-Session, 2026-11-15)

Obwohl WFS abgeschaltet ist, lässt sich GR **zu Vektordaten** bringen – ohne
Login, nur über die öffentlichen WMS-Endpunkte:

1. **`GetMap` mit `FORMAT=kml`** je Ebene → echte **Polygone in WGS84**
   (ohne Attribute). Der WMS kann KML-Vektoren ausgeben, auch wenn WFS aus ist.
2. Pro Polygon einen Punkt **innerhalb** bestimmen (point on surface).
3. **`GetFeatureInfo`** an diesem Punkt:
   - `text/html` → Tabelle mit `REG NO`, Name (Behörde), Gültigkeit, Höhen
     AGL/MSL (ft)
   - `application/vnd.ogc.gml` → Bounding-Box je Treffer (gleiche Reihenfolge)
4. Zuordnung über **Bounding-Box-Match** (Polygon-BBox == GML-Box), da sich
   Zonen überlappen und ein Punkt mehrere Treffer liefert.
5. Ergebnis als GeoJSON-FeatureCollection.

**Werkzeug im Repo:** [`docs/tools/greece/dagr_geozonen.py`](tools/greece/dagr_geozonen.py)
(`pip install requests shapely`; `python dagr_geozonen.py --tage 30 --out dagr_geozonen.geojson`).
- Ebenen: `all_limitation_layer`, `all_warning_layer`, `all_permifrag_layer`,
  `hellas_CTR`. Zeitfenster über `WMS_DATE_FROM/TO`.
- Ausgabe-Properties: `layer`, `reg_no`, `name`, `authority`, `valid_from`,
  `valid_to`, `alt_agl_from_ft`/`alt_agl_to_ft`, `alt_msl_from_ft`/`alt_msl_to_ft`.

### Rechtliches (wichtig)
- Webseite unter **CC BY-NC-ND 4.0** → Nutzung **nur im Rahmen der erteilten
  Datenfreigabe von HASP/HCAA**. Server höflich behandeln (Pause eingebaut).

**Status GR: Daten extrahierbar** (Skript vorhanden) – alternativ weiterhin
ED-269/AIXM bei HASP/HCAA.

---

## Anhang GR (2): Produktions-Worker mit Dauer-Feed ✅ (2026-11-15)

Über das Einmal-Skript hinaus liegt jetzt ein **vollständiger Hintergrund-Worker**
im Repo: [`docs/tools/greece/dagr-worker/`](tools/greece/dagr-worker/). Er macht
GR praktisch einsatzbereit, sofern er auf **EU-IP** läuft.

- **Zugriffsweg:** öffnet DAGR in **echtem Chromium** (Playwright) und stellt
  **alle Anfragen als `fetch()` innerhalb der Seite** (gleicher Ursprung/Cookies/
  Header) — genau der Weg, für den die HASP/HCAA-Freigabe gilt. Nichts umgangen;
  höfliche Pause, bricht bei 403 ab (wartet dann 4× Intervall).
- **7 Phasen mit Checkpoints/Resume:** session → capabilities (Frühwarnung bei
  Umbau) → geometry (GetMap→KML, Innenpunkt je Zone) → attributes (GetFeatureInfo
  GML+HTML, BBox-Match, je Zone fortsetzbar) → assemble (GeoJSON, Höhen
  `9999999`→`null`, IDs = REG-NO) → validate → publish.
- **Qualitätsschranken vor Publish** (sonst bleibt `latest/` unverändert,
  Exit 2): Match-Rate ≥ 98 %, Zonenschwund ≤ 15 %, ≥ 50 Zonen. Diff zum Vorstand
  (neu/entfernt/geändert) im `report.json`.
- **Ablage `/data`:** `status.json` (App pollt hier), `latest/greece.geojson`
  (freigegebener Stand), `runs/<id>/…` (Protokoll/Checkpoints, letzte 20).
- **Betrieb:** `docker compose up -d` (alle 24 h ein Lauf, EU-IP-Host nötig, z. B.
  NAS/Server DE) oder einmalig `python -m dagr_worker run`. `tests/mock_dagr.py`
  simuliert DAGR für Tests ohne echten Server.
- Fremdflug-Ebenen (`*_flight_layer`) werden **bewusst nicht** abgefragt.
  Lizenznotiz im GeoJSON (`metadata.license_note`).

→ Damit ist GR mit stabilem Feed versorgt; der ED-269/AIXM-Export bei HASP/HCAA
bleibt die noch sauberere Alternative, falls angeboten.

---

## Anhang RO: Zonen-Gruppierung & Skript (DE-Session, 2026-11-15)

**Werkzeug im Repo:** [`docs/tools/romania/romatsa_ro_geozones.py`](tools/romania/romatsa_ro_geozones.py)
(requests) → feste Zonen + NOTAM-Zonen, Höhen-Parser, normalisiertes GeoJSON.

### Zonen-Gruppen nach ID-Präfix (aus Kontakt/Höhe abgeleitet, konsistent)
| Präfix | Anz. | Typ | Genehmigung |
|---|---|---|---|
| `RZ 1xxx` | 64 | Flughäfen/CTR (ROMATSA) | Tower (Kontakt im Feld `contact`) |
| `RZ 2xxx` | 656 | Militär – **nur bei NOTAM-Aktivierung** | `fdex@roaf.ro` |
| `RZ 3xxx`/`4xxx` | 378/173 | Verteidigungsobjekte (MApN) | `aerofoto@mapn.ro` |
| `RZ 570` | 1 | Sonderzone Bukarest (GND–FL105) | MApN |

- **Gestapelte Volumina:** Paare wie `RZ 1001` (GND–120 m) + `RZ 1002`
  (120 m–2500 ft AMSL) = eine CTR in Höhenschichten → Zonen **mit Unter-/
  Obergrenze** auswerten, nicht nur 2D.
- NOTAM-Layer `tip`: `R` (Restricted, 61), `D` (Danger, 163), `O` (Other, 70) –
  bei ROMATSA bestätigen lassen. `mesaj` Feld **D)** = Tagesplan, **F)/G)** =
  Höhen. Die RZ-2xxx-Militärzonen werden über diese NOTAMs aktiviert.
- Höhen sind Freitext (`GND`, `120M AGL`, `FL105`, `3000 FT AMSL`, `BY NOTAM`
  15×) → Parser im Skript. `zone_id` mal mit/ohne Leerzeichen → normalisieren.
