# Geozonen-Daten – Gesamtübersicht (Stand 2026-11-15)

Beschreibung aller von Deutschland aus abgerufenen Drohnen-Geozonen-Daten.
Alle Dateien liegen in `fixtures/` (ES-Layer in `fixtures/es/`).
Abruf über die echten, öffentlichen Endpunkte der nationalen Portale; kein
Bot-/WAF-Schutz umgangen, keine privaten Logins verwendet.

---

## Schnellüberblick

| Land | Status | Features gesamt | Quelle / Technik |
|---|---|---|---|
| **ES** Spanien | ✅ komplett | ~21.347 | ENAIRE ArcGIS (MapServer, GeoJSON) |
| **PL** Polen | ✅ komplett | 1.774 Zonen | PANSA API (KML) + Zonentypen |
| **RO** Rumänien | ✅ komplett | 1.498 | ROMATSA (GeoServer WFS + statisch) |
| **LU** Luxemburg | ✅ komplett | 34 | geoportail OGC API Features |
| **GR** Griechenland | ⚠️ kein Vektor | – | HASP MapServer WMS (nur Raster) |

---

## ES – Spanien (ENAIRE)  ✅ komplett

Host `servais.enaire.es`, Pfad `/insignias/rest/services/...`. Öffentlich, ohne
Auth, als GeoJSON (`outputFormat=geojson`, `outSR=4326`). Hinweis: Der im alten
Handover genannte `SRV_UAS_ZG_data_V2/FeatureServer` ist veraltet.

**Service `NSF/Drones_ZG_Aero_V3/MapServer` (Luftfahrt-Zonen):**

| Layer | Name | Features | Datei (`fixtures/es/`) |
|---|---|---|---|
| 0 | AERODROMOS | 563 | es_AERODROMOS_L0.geojson (0,6 MB) |
| 1 | ZG_EAC_FIZ | 223 | es_ZG_EAC_FIZ_L1.geojson (1,4 MB) |
| 2 | AVISOS | 184 | es_AVISOS_L2.geojson (3,2 MB) |
| 3 | ZG_RVF (Restringido Vuelo Fotográfico) | 119 | es_ZG_RVF_L3.geojson (1,2 MB) |
| 4 | AEROMODELISMO | 257 | es_AEROMODELISMO_L4.geojson (1,0 MB) |
| 6 | ZG_Aeródromos | 1.305 | es_ZG_Aerodromos_L6.geojson (10,6 MB) |
| 10 | ZG_Restringidas | 370 | es_ZG_Restringidas_L10.geojson (4,6 MB) |

**Weitere Services:**

| Service / Layer | Inhalt | Features | Datei |
|---|---|---|---|
| Drones_ZG_Infra_V0/11 | Infrastruktur-Zonen | 14.163 | es_Infra_L11.geojson (**177 MB**) |
| Drones_ZG_Urbano_V0/11 | urbane Zonen | 4 | es_Urbano_L11.geojson (0,1 MB) |
| NOTAM_UAS_APP_V3/1 | NOTAM | 745 | es_NOTAM_L1.geojson (2,2 MB) |
| ENP_APP_Local_V4/0 | Naturschutz (ENP) | 1.814 | es_ENP0_L0.geojson (**221 MB**) |
| ENP_APP_Local_V4/1 | Naturschutz (ENP) | 1.321 | es_ENP1_L1.geojson |

- Geometrie: Polygone, EPSG:4326. Höhenfilter der App: Feld
  `RESTRICCION_LOWER < 120` (nur auf Layern mit diesem Feld).
- **Achtung Größe:** `Infra` (177 MB) und `ENP0` (221 MB) sind durch sehr
  detaillierte Geometrie riesig. Für die App ggf. vereinfachen (Douglas-Peucker)
  oder nur benötigte Attribute/Gebiete laden.

## PL – Polen (PANSA)  ✅ komplett

API `api.dronemap.pansa.pl`, Zugang wie die öffentliche Karte: fester
öffentlicher API-Key → anonymer Login (`/v1/front/login`) → Bearer-Token →
Datenabruf.

| Datei | Inhalt | Umfang |
|---|---|---|
| pansa_kml_filtered.kml | Drohnen-Zonen DRAP/DRAR/DRAI (KML-Placemarks) | **1.774 Zonen** (3 MB) |
| pansa_zones_types.json | Zonentyp-Definitionen (mehrsprachig, Flugbedingungen) | komplett |

- Zonentypen u. a.: DRAP (Prohibited), DRAR (Restricted), DRAI (Information),
  CTR, ATZ, RMZ, TMA, P, R, D … (`&max=` = Höhengrenze in m, kein Anzahllimit).

## RO – Rumänien (ROMATSA)  ✅ komplett

`flightplan.romatsa.ro` (Leaflet + GeoServer WFS), öffentlich, GeoJSON.

| Datei | Inhalt | Features | Properties |
|---|---|---|---|
| ro_zone_restrictionate_uav.json | statische UAV-Zonen | 1.272 | zone_id, lower_lim, upper_lim, contact, status |
| ro_wfs_restrictii_notam_pt_uav.geojson | NOTAM-UAV (WFS) | 226 | serie, dfrom, dto, mesaj, tip |

## LU – Luxemburg (geoportail)  ✅ komplett

OGC API Features (pygeoapi), `features.geoportail.lu/collections/1928/items`.
Ersetzt den defekten Alt-Feed `drones.geoportail.lu/zones` (konstant HTTP 422).

| Datei | Inhalt | Features |
|---|---|---|
| lu_uas_zones_1928.geojson | UAS-Zonen 0–120 m | **34** (komplett) |

- Properties: `nom_zone` (z. B. EL-UAS-S10), `description`, `type_restiction`
  (z. B. 0to120m), `min_height`/`max_height`, `activite`, `statut`,
  `responsabilite`, `start_date`/`end_date`, `conditions`, `exceptions`,
  `nature_protect`.

## GR – Griechenland (HASP/HCAA, DAGR)  ⚠️ kein öffentliches Vektor-Dataset

`dagr.hasp.gov.gr` → **MapServer 7.0.1 (MS4W)** via `/cgi-bin/mapserv.exe`.
(Nicht ArcGIS, anders als im Handover vermutet.)

- Karte lädt **nur gerenderte WMS-Rasterkacheln** (GetMap, PNG), Datumsfilter
  `WMS_DATE_FROM`/`WMS_DATE_TO`.
- **WFS serverseitig deaktiviert** → kein GeoJSON/GML-Bulk-Export.
- Nur **GetFeatureInfo** (Punktabfrage) aktiv; Host blockt Nicht-Browser-Clients
  (curl → 403).
- WMS-Layer: `all_limitation_layer`, `all_warning_layer`, `all_permifrag_layer`,
  `hellas_CTR` (+ `_ann`), `allowed/rejected_future_flight_layer`.
- **Empfehlung:** als WMS-Raster-Overlay anzeigen **oder** ED-269/AIXM bei
  HASP/HCAA anfragen (einziger sauberer Weg zu Geometrien).

---

## Erreichbarkeit DE vs. US (warum das hier ging)

Die ursprüngliche Analyse lief in einer US-Cloud; PL, ES, RO, GR waren dort
geo-/WAF-/bot-geblockt. Von **Deutschland** (Vodafone-IP) sind alle erreichbar:
PL/ES/RO direkt, GR nur im echten Browser (Bot-Schutz gegen simple Clients).

## Noch offen (nicht abgerufen)

- **CZ** (dronemap.gov.cz), **LV** (m.airspace.lv), **MT** (iDronect) – per
  Browser-Capture holbar.
- **IT, HU** – Login/Betreiber-Zugang nötig.
- **LU-Code** – Feed-Umstellung + Einbindung in `client/lib/luGeozones.ts`
  (nur im Projekt-Repo umsetzbar).
