# Übergabe an Hauptjob – Geozonen-Datenabruf aus Deutschland (2026-11-15)

**Zweck:** Der ursprüngliche „Godrone API Structure"-Job lief in einer US-Cloud;
mehrere nationale Portale waren dort geo-/WAF-/bot-geblockt. Diese Sitzung lief
auf dem **deutschen Rechner (Vodafone-IP, Mannheim)** im **echten Browser** und
hat die blockierten Länder tatsächlich erreicht und Daten gezogen.

**Rahmen (eingehalten):** Nur echte, **öffentliche** Endpunkte bzw. Daten, die
die öffentliche App selbst anonym lädt. **Kein** Bot-/WAF-Schutz umgangen,
**keine** privaten Logins verwendet. Captcha/Anmeldungen blieben außen vor.

Alle Dateien liegen in `fixtures/` (ES-Layer in `fixtures/es/`).

---

## 1. Erreichbarkeit DE vs. US (Kernbefund)

| Land | US-Cloud | DE (diese Sitzung) | Hinweis |
|---|---|---|---|
| PL | geblockt | ✅ erreichbar | API direkt |
| ES | geblockt | ✅ erreichbar | ArcGIS direkt |
| RO | geblockt | ✅ erreichbar | GeoServer direkt |
| GR | geblockt | ✅ nur im echten Browser | Bot-Schutz gegen simple Clients (curl → 403) |
| CZ/LV/HU/LU | – | ✅ erreichbar | siehe unten |

→ Für den Hauptjob heißt das: Abrufe dieser Länder müssen aus **EU-IP** und für
GR aus einem **Browser-Kontext** (echte Header) laufen, nicht aus der US-Cloud.

---

## 2. Datenstatus je Land

| Land | Status | Features | Quelle / Technik | Datei(en) |
|---|---|---|---|---|
| **ES** | ✅ komplett | ~21.068 | ENAIRE ArcGIS MapServer, GeoJSON | `es/es_*.geojson` (12 Layer) |
| **PL** | ✅ komplett | 1.774 Zonen | PANSA API (KML) | `pansa_kml_filtered.kml`, `pansa_zones_types.json` |
| **RO** | ✅ komplett | 1.498 | ROMATSA GeoServer WFS + statisch | `ro_zone_restrictionate_uav.json`, `ro_wfs_restrictii_notam_pt_uav.geojson` |
| **LU** | ✅ komplett | 34 | geoportail OGC API Features | `lu_uas_zones_1928.geojson` |
| **MT** | ✅ komplett | 195 | iDronect Meteor `getFilteredZones` | `mt_zones.geojson` (+ normalisiert, s. §4) |
| **GR** | ⚠️ kein Vektor | – | HASP MapServer **nur WMS-Raster** | – (ED-269 nötig) |
| **CZ** | ⛔ verschlüsselt | – | ANS CR, AES-verschlüsselt | – (ED-269 nötig) |
| **LV** | 🟡 Referer-Proxy | – | LGS ArcGIS, Referer-gesichert | – (Selbst-curl oder ED-269) |
| **IT** | 🔒 Login | – | d-flight | – (Betreiber-Zugang) |
| **HU** | 🔒 Login | – | MyDroneSpace | – (Betreiber-Zugang) |

---

## 3. Abruf-Rezepte (reproduzierbar)

### ES – ENAIRE  ✅
- Host `servais.enaire.es`, Pfad **`/insignias/rest/services/...`** (öffentlich, kein Auth).
- ⚠️ **Korrektur zum alten Handover:** Der dort genannte
  `SRV_UAS_ZG_data_V2/FeatureServer` ist **veraltet**. Aktuell gilt der obige Pfad.
- Abruf als GeoJSON, paginiert: `query?where=1=1&outFields=*&returnGeometry=true&outSR=4326&f=geojson&resultOffset=N&resultRecordCount=2000`.
- Services/Layer & Feature-Zahlen:
  `Drones_ZG_Aero_V3`: L0 AERODROMOS 563 · L1 ZG_EAC_FIZ 223 · L2 AVISOS 184 ·
  L3 ZG_RVF 119 · L4 AEROMODELISMO 257 · L6 ZG_Aerodromos 1.305 ·
  L10 ZG_Restringidas 370 · `Drones_ZG_Infra_V0/L11` Infra **14.163** ·
  `Drones_ZG_Urbano_V0/L11` Urbano 4 · `NOTAM_UAS_APP_V3/L1` NOTAM 745 ·
  `ENP_APP_Local_V4` L0 ENP0 1.814 · L1 ENP1 1.321.
- Höhenfilter der App: Feld `RESTRICCION_LOWER < 120` (nur Layer mit diesem Feld).
- ⚠️ **Dateigrößen:** `es_Infra_L11` ≈ 182 MB, `es_ENP0_L0` ≈ 226 MB,
  `es_ENP1_L1` ≈ 241 MB (sehr detaillierte Geometrie). Für die App
  vereinfachen (Douglas-Peucker) oder nur benötigte Attribute/Gebiete laden.

### PL – PANSA  ✅
- API `api.dronemap.pansa.pl`, Zugang **wie die öffentliche Karte**:
  fester öffentlicher API-Key → anonymer Login `POST /v1/front/login` →
  Bearer-Token → Datenabruf. (Kein privates Konto.)
- Zonentypen: DRAP (Prohibited), DRAR (Restricted), DRAI (Information), CTR,
  ATZ, RMZ, TMA, P, R, D … `&max=` = Höhengrenze in **Metern** (kein Anzahllimit).

### RO – ROMATSA  ✅
- `flightplan.romatsa.ro` (Leaflet + GeoServer WFS), öffentlich, GeoJSON.
- `ro_zone_restrictionate_uav.json`: 1.272 statische UAV-Zonen
  (Properties `zone_id, lower_lim, upper_lim, contact, status`).
- `ro_wfs_restrictii_notam_pt_uav.geojson`: 226 NOTAM-UAV via WFS
  (`serie, dfrom, dto, mesaj, tip`).

### LU – geoportail  ✅
- OGC API Features (pygeoapi): **`features.geoportail.lu/collections/1928/items`**.
- ⚠️ Ersetzt den **defekten** Alt-Feed `drones.geoportail.lu/zones` (konstant HTTP 422).
- 34 UAS-Zonen 0–120 m. Properties: `nom_zone` (z. B. EL-UAS-S10), `description`,
  `type_restiction` (z. B. 0to120m), `min_height`/`max_height`, `activite`,
  `statut`, `responsabilite`, `start_date`/`end_date`, `conditions`,
  `exceptions`, `nature_protect`.

### MT – iDronect  ✅
- `tmcad.idronect.com/map` (Meteor DDP, React/Redux).
- Öffentliche Methode **`Zones.getFilteredZones({ managedZones: true })`** anonym
  im Browser ausgeführt (kein Login, `Meteor.userId()` = null) — exakt der
  Aufruf, den die Karte selbst macht. Der leere Filter `{}` liefert anonym 0;
  richtiger Parameter ist `managedZones: true`.
- 195 Zonen, alle Polygone. Kontakt-E-Mails **bewusst enthalten** (161/195) —
  der Pilot braucht sie für die Flugfreigabe. Siehe §4 zur Höhen-Einheit.

### GR – HASP/HCAA  ⚠️ kein Vektor
- `dagr.hasp.gov.gr` → MapServer 7 (MS4W), nur **WMS-Raster** (GetMap/PNG),
  **WFS serverseitig deaktiviert**, nur GetFeatureInfo (Punkt). curl → 403.
- **Empfehlung:** WMS-Raster-Overlay anzeigen **oder** ED-269/AIXM bei HASP/HCAA.

### CZ – ANS CR  ⛔ verschlüsselt
- `dronemap.gov.cz`, `POST /getGJ.php?ct=…&iv=…&s=…`; **Anfrage und Antwort
  AES-verschlüsselt** (CryptoJS). Kein sauberer Scrape ohne RE der Verschlüsselung.
- **Empfehlung:** ED-269 beim Betreiber → **`dronemap@ans.cz`**.

### LV – LGS  🟡 Referer-Proxy
- `m.airspace.lv`, ArcGIS (interner Server `LGS-AGS`) über
  `https://m.airspace.lv/mob//proxy/proxy.ashx?<ziel-URL>`.
- Proxy verlangt `Referer`-Header (sonst 403). Selbst abrufbar:
  ```bash
  curl.exe -s -H "Referer: https://m.airspace.lv/mob/map" "https://m.airspace.lv/mob//proxy/proxy.ashx?https://LGS-AGS/rest/services/DRONES/DronesZonesUAS/MapServer/layers?f=json" -o lv_layers.json
  ```
  Dann Layer-Query mit `.../MapServer/<id>/query?where=1=1&outFields=*&returnGeometry=true&f=geojson`.
  Services: `DronesZonesUAS` (AGL), `DronesZonesUASAMSL` (AMSL), `FIR_drones`.
- **Alternative:** ED-269/AIXM 5.1 bei LGS/AIS → **`ais.lgs.lv`**.

---

## 4. MT-Normalizer (Zielschema-Vorlage)

Datei `mt_zones_normalized.geojson` (195 Features) normalisiert die MT-Rohdaten.
Validiert gegen die Rohdatei: **195/195 Features, alle mit Geometrie,
`zoneId`-Mengen identisch, 161 E-Mails erhalten.**

**Wichtige Einheiten-Auflösung:**
- `_raw.maxHeight` (Werte 60/120/400/1200/**8800** …) ist die **Luftraumdecke
  (vermutlich Fuß)** und **KEIN Drohnenlimit**.
- Das echte Auto-Freigabe-Limit steht im **Namenstext** („Auto Authorised
  maximum XX m AGL") und wird als **`auto_limit_m`** (AGL, Meter) geparst —
  betrifft die 9 LUQA-Zonen am Flughafen.
- ⚠️ **Noch gegen die Malta-AIP gegenprüfen**, bevor die Fuß-Annahme fest
  verdrahtet wird.

**Property-Schema je Feature:**
```
name              Originalname (inkl. Kontakt-Text)
label             bereinigter Name (ohne Kontakt/Auflagen)
kontakt_email     erste Freigabe-E-Mail
kontakt_email_alle [..]  (nur wenn mehrere)
auto_limit_m      Auto-Freigabe-Höhe AGL in m (nur wo im Text genannt, 9 Zonen)
forbidden         bool
zoneId            stabile ID
_raw {maxHeight, minHeight, type, radius, cost, maxPilots}
```

Dieses Schema (label + extrahierte Kontakte + aufgelöste Höhe + `_raw`) ist eine
gute **Vorlage für die anderen Länder** Richtung ED-269-ähnlichem Zielmodell.

---

## 5. Datei-Inventar (`fixtures/`)

| Datei | Größe |
|---|---|
| es/es_AERODROMOS_L0.geojson | 0,6 MB |
| es/es_ZG_EAC_FIZ_L1.geojson | 1,4 MB |
| es/es_AVISOS_L2.geojson | 3,2 MB |
| es/es_ZG_RVF_L3.geojson | 1,2 MB |
| es/es_AEROMODELISMO_L4.geojson | 1,0 MB |
| es/es_ZG_Aerodromos_L6.geojson | 10,8 MB |
| es/es_ZG_Restringidas_L10.geojson | 4,7 MB |
| es/es_Infra_L11.geojson | **182 MB** |
| es/es_Urbano_L11.geojson | 0,1 MB |
| es/es_NOTAM_L1.geojson | 2,3 MB |
| es/es_ENP0_L0.geojson | **226 MB** |
| es/es_ENP1_L1.geojson | **241 MB** |
| pansa_kml_filtered.kml | 3,0 MB |
| pansa_zones_types.json | 43 KB |
| ro_zone_restrictionate_uav.json | 2,1 MB |
| ro_wfs_restrictii_notam_pt_uav.geojson | 279 KB |
| lu_uas_zones_1928.geojson | 75 KB |
| mt_zones.geojson | 391 KB |
| mt_zones_normalized.geojson | 915 KB *(aktuell in Downloads)* |
| enaire_aero_layer0_sample.geojson | 6 KB |
| enaire_Drones_ZG_Aero_V3_MapServer.json | 4 KB |

---

## 6. Noch offen (für den Hauptjob zu entscheiden)

- **GR / CZ** – kein öffentlicher Vektor-Pull → **ED-269/AIXM** beim Betreiber
  anfragen (`dronemap@ans.cz`; GR über HASP/HCAA).
- **LV** – entweder Selbst-curl mit Referer (§3) oder ED-269 (`ais.lgs.lv`).
- **IT (d-flight), HU (MyDroneSpace)** – Login/Betreiber-Zugang nötig; Format
  d-flight ggf. ED-269.
- **LU-Code** – Feed-Umstellung auf den OGC-Feed in `client/lib/luGeozones.ts`
  (nur im Projekt-Repo umsetzbar).
- **Höhen-Normalisierung** generell: Einheiten je Land prüfen (PL/LU Meter,
  MT-Decke vermutlich Fuß, ES Feld `RESTRICCION_LOWER`).
- **Lizenzen/Nutzungsrechte** je Portal für die Weiterverwendung klären.
