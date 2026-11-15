# Offline-Karten: amtliche Quellen je Land

Diese Übersicht dokumentiert, welche Grundkarten und Luftbilder die App für
**Offline-Länder** (Einstellungen → Offline-Karten & Hindernisse) auf dem Gerät
speichern darf. Code: `COUNTRY_MAP_PROVIDERS` in `client/lib/mapSources.ts`,
Downloader `client/lib/offlineMaps.ts`, Oberfläche
`client/screens/RcOfflineMapsScreen.tsx`.

## Grundsätze

- Offline gespeichert werden **nur amtliche Dienste mit offener Lizenz**, die
  Speicherung, Weitergabe und auch kommerzielle Nutzung erlauben (CC BY 4.0 o. ä.).
- **Nie** massenhaft geladen werden `tile.openstreetmap.org` (OSM-Tile-Usage-Policy),
  CARTO und Esri – sie bleiben reine Online-Ersatzkarten (`FALLBACK_MAP`,
  `FALLBACK_SATELLITE`). Google nur online mit eigenem Schlüssel.
- Nur Kachelraster **EPSG:3857 / GoogleMapsCompatible** (XYZ/WMTS) oder WMS mit
  `CRS=EPSG:3857` – andere Kachelraster (z. B. EPSG:2180, EPSG:3057, PTTM06) werden
  nicht unterstützt.
- Die Kachel-Adresse wird 1:1 für Anzeige und Offline-Speicher benutzt (Hash der
  Vorlage = Ordnername). Teilen sich zwei Länder eine Vorlage (LI/CH), wird der
  Ordner erst gelöscht, wenn kein Land ihn mehr nutzt.
- **Jedes Land der App ist wählbar** (`OFFLINE_APP_COUNTRIES` = `LICENSE_COUNTRIES`).
  Ohne frei speicherbare Grundkarte zeigt die App den Hinweis „Für <Land> gibt es
  keine frei speicherbare Grundkarte – offline werden Geozonen und Hindernisse
  gespeichert; die Karte wird online angezeigt.“ Geozonen werden dann als Kacheln
  (WMS/XYZ, z. B. HU) oder als Vektordatei (ED-269-Gerätecache, z. B. DK/NO/ES)
  gespeichert, Hindernisse überall.

## Länder-Tabelle

Geprüft = Kachel live mit `curl` abgerufen (HTTP 200, Bild), Stichprobe Hauptstadt
in mehreren Zoomstufen, Bild sichtgeprüft.

| Land | Quelle | Vorlage (Kurzform) | Zoom | Lizenz | Offline erlaubt | Geprüft |
| ---- | ------ | ------------------ | ---- | ------ | --------------- | ------- |
| DE | basemap.de (BKG) + DOP HE/RP/NW/BY | bestehend | ≤18/19 | dl-de/by-2.0 bzw. Landeslizenzen | ja | bestehend |
| AT | basemap.at + Orthofoto | bestehend | ≤19 | CC BY 4.0 | ja | bestehend |
| CH | swisstopo Landeskarte + SWISSIMAGE | bestehend | ≤18/19 | swisstopo OGD | ja | bestehend |
| NL | PDOK BRT-Achtergrondkaart + Luchtfoto | bestehend | ≤19 | CC BY 4.0 / PDOK | ja | bestehend |
| FR | IGN Plan IGN v2 + Orthophotos (Géoplateforme) | bestehend | ≤19 | Licence Ouverte 2.0 | ja | bestehend |
| LI | swisstopo (deckt FL ab), gleiche Vorlagen wie CH | `wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/…/3857/{z}/{x}/{y}.jpeg`, `…swissimage…` | 0–18 / 0–19 | swisstopo OGD | ja | 2026-11-15 |
| NO | Kartverket Topografisk Norgeskart (Cache) | `cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png` | 0–18 | CC BY 4.0 | ja (Karte) / Luftbild „Norge i bilder“ nicht frei | 2026-11-15 |
| ES | IGN España Mapa base (IGNBaseTodo) | `www.ign.es/wmts/ign-base?…LAYER=IGNBaseTodo&TILEMATRIXSET=GoogleMapsCompatible…` | 0–19 | CC BY 4.0 (scne.es) | ja | 2026-11-15 |
| ES | PNOA Orthofoto (IGN) | `www.ign.es/wmts/pnoa-ma?…LAYER=OI.OrthoimageCoverage&TILEMATRIXSET=GoogleMapsCompatible…` | 0–19 (20 vorhanden) | CC BY 4.0 | ja | 2026-11-15 |
| EE | Maa- ja Ruumiamet Grundkarte (`kaart`, Raster GMC) | `tiles.maaamet.ee/tm/wmts/1.0.0/kaart/default/GMC/{z}/{y}/{x}.png` | 0–18 | Maa- ja Ruumiameti avaandmete litsents (frei, kommerziell, Quellenangabe) | ja | 2026-11-15 |
| EE | Maa- ja Ruumiamet Orthofoto (`foto`, GMC) | `tiles.maaamet.ee/tm/wmts/1.0.0/foto/default/GMC/{z}/{y}/{x}.jpg` | 0–18 | wie oben | ja | 2026-11-15 |
| CZ | ČÚZK Základní topografické mapy (ZTM_WM) | `ags.cuzk.gov.cz/arcgis1/rest/services/ZTM_WM/MapServer/tile/{z}/{y}/{x}` | 6–18 | CC BY 4.0 (alle Raumdaten ČÚZK außer Messbilder/Archivalien, seit 07/2023) | ja | 2026-11-15 |
| CZ | ČÚZK Ortofoto ČR (ORTOFOTO_WM) | `ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}` | 6–19 (20 vorhanden) | CC BY 4.0 | ja | 2026-11-15 |
| PL | GUGiK Ortofotomapa (Geoportal-WMTS, Matrix `EPSG:3857:{z}`) | `mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?…TILEMATRIXSET=EPSG:3857…` | 0–19 | kostenfrei, „dowolne wykorzystanie“ (geoportal.gov.pl) | ja (nur Luftbild) | 2026-11-15 |
| PL | Topografische Karte | WMTS nur EPSG:2180/4326, BDOT-WMS mit 401 | – | – | nein (nicht 3857) | 2026-11-15 |
| IS | LMÍ / Náttúrufræðistofnun Grundkarte (`nytt_grunnkort_samsett_naer_fjaer`, GeoServer-WMS) | `gis.lmi.is/geoserver/wms?…CRS=EPSG:3857&BBOX={bbox-epsg-3857}` | 0–18 | CC BY 4.0 | ja (WMTS nur EPSG:3057 → WMS) | 2026-11-15 |
| LU | geoportail.lu | – | – | – | nein (keine frei speicherbare Kachelkarte) | bestehend |
| BE | NGI/IGN CartoWeb (`topo`, 3857, z7–17) | `cartoweb.wmts.ngi.be/1.0.0/topo/default/3857/{z}/{y}/{x}.png` | 7–17 | **CC BY-NC**, Kopieren/Robots untersagt, kommerziell kostenpflichtig | **nein** | 2026-11-15 (Kachel 200, Lizenz verbietet) |
| HR | DGU TK25 (WMS) / DOF (WMS) | `geoportal.dgu.hr/services/tk/ows`, `…/dof/ows` | – | keine klare offene Lizenz, TK25 laut Verordnung entgeltpflichtig; DOF mit „GEOPORTAL“-Wasserzeichen | nein | 2026-11-15 |
| PT | DGT Ortos2021 | WMTS nur PTTM_06 (EPSG:3763); WMS liefert in EPSG:3857 nur leere Kacheln | – | DGT offen | nein (technisch nicht möglich) | 2026-11-15 |
| CY | DLS Orthoimagery 2019 WebMercator | `eservices.dls.moi.gov.cy/…/Orthoimagery_2019_WebMercator/MapServer/tile/{z}/{y}/{x}` | ≥12 (z8 404) | Orthofotos werden verkauft, keine offene Lizenz | nein | 2026-11-15 (Kachel 200, Lizenz fehlt) |
| SK | ÚGKK ZBGIS | `zbgis.skgeodesy.sk` | – | – | nein (vom Prüfrechner nicht erreichbar, TLS-Abbruch → nicht verifiziert) | 2026-11-15 |
| SI | GURS (e-prostor) | `ipi.eprostor.gov.si` | – | – | nein (nicht erreichbar → nicht verifiziert) | 2026-11-15 |
| LV | LĢIA / LVM | `services.lgia.gov.lv`, `lvmgeoserver.lvm.lv` | – | – | nein (nicht erreichbar → nicht verifiziert) | 2026-11-15 |
| LT | geoportal.lt | mapproxy WMTS | – | – | nein (Zugang nur mit Anmeldung, 401) | 2026-11-15 |
| IE | Tailte Éireann (OSi) | – | – | keine offene Lizenz für Grundkarten | nein | 2026-11-15 |
| DK | Dataforsyningen (SDFI) | – | – | frei, aber nur mit Token/Konto | nein (Schlüssel nötig) | – |
| SE | Lantmäteriet Topowebb | – | – | frei (CC0/CC BY), aber nur mit Konto/Schlüssel | nein (Schlüssel nötig) | – |
| FI | MML (Maanmittauslaitos) | – | – | CC BY 4.0, aber API-Schlüssel nötig | nein (Schlüssel nötig) | – |
| GB | Ordnance Survey | – | – | OS Maps API mit Schlüssel | nein (Schlüssel nötig) | – |
| IT | Geoportale Nazionale / IGM | – | – | Lizenz für Massen-/Offline-Nutzung unklar | nein | – |
| HU, BG, GR, RO, MT | – | – | – | keine offene amtliche Kachelkarte gefunden | nein | – |

Länder mit „nein“ sind trotzdem offline wählbar: **Geozonen + Hindernisse**, die
Karte wird online (CARTO/Esri) angezeigt. Polen speichert zusätzlich das amtliche
Luftbild.

## Geozonen offline

| Art | Länder | Wie |
| --- | ------ | --- |
| Kacheln (WMS/XYZ) | DE, CH, LU, NL, FR, HU | `geozoneTemplates()` → Kacheln ab Zoom 11 bis gewählte Detailstufe |
| Vektor (ED-269-Gerätecache) | AT, BE, DK, EE, FI, NO, IE, SE, PT, ES, PL, LT, IT\*, GB, IS, CY, HR, SI, BG, LV | `refreshEd269Dataset(iso)` (ed269Store.ts) lädt die ganze Landesdatei; Fortschritt `<ISO>:geo:vector` |
| keine | CZ, SK, GR, RO, MT, LI\*\* | nur Hindernisse (+ Karte, wo vorhanden) |

\* Italien nur mit eingetragenem d-flight-Zugang.
\*\* Liechtenstein steckt im Schweizer BAZL-Datensatz (Geozonen über CH).

## Wartung

- Neue Quelle: Kachel live prüfen (mehrere Zoomstufen, Bild ansehen), Lizenz
  belegen, Eintrag in `COUNTRY_MAP_PROVIDERS` mit `attribution`, `maxzoom`,
  ggf. `minzoom`, `kbPerTile` (≈ mittlere Kachelgröße) und hier eine Zeile ergänzen.
- Länderliste: `OFFLINE_APP_COUNTRIES` muss `LICENSE_COUNTRIES` (storage.ts)
  enthalten – wird von `client/lib/__tests__/offlineMapSources.test.ts` geprüft.
- Bekannte Grenze: Die Länder-Erkennung arbeitet für viele Länder mit
  Rechteck-Boxen (`COUNTRY_BOUNDING_BOXES`). In Überlappungen gewinnt das kleinere
  Land (z. B. Huelva → PT, Nordnorwegen um Narvik → SE). Dort zeigt die App die
  Ersatzkarte, und der Downloader lädt diese Zellen nicht für das „falsche“ Land.
