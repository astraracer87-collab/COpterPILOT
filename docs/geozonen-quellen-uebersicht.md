# Geozonen-Quellen – Länderübersicht (Stand 2026-11-15)

Zentrale Übersicht über alle analysierten UAS-Geozonen-Quellen für COpterPILOT.
Pro Land gibt es ein eigenes Detaildokument (`docs/<land>-…-integration.md`).

**Legende Status:**
`✅ einsatzbereit` = öffentlich live abrufbar, Schema erfasst ·
`🔑 Zugang/Detail offen` = Quelle verifiziert, aber Login/Token/Parameter fehlt ·
`🌐 nur hier blockiert` = aus dieser Analyse-Umgebung geo-/bot-geblockt, aus der App (EU-IP) erreichbar.

---

## Gesamttabelle

| Land | Betreiber / Quelle | Auth | Format | Status | Detaildokument |
|---|---|---|---|---|---|
| **NL** | GoDrone / Altitude Angel | öffentl. API-Key (`X-AA-ApiKey`) | GeoJSON (ED-269-nah) | ✅ einsatzbereit, live getestet | `godrone-api-integration.md` |
| **AT** | Austro Control Dronespace (Skyzr) | keine | ED-269 GeoJSON | ✅ einsatzbereit (+ Zeitfenster-Fix) | `dronespace-at-api-integration.md` |
| **BE** | skeyes / Droneguide | keine | ED-269 (WFS + Live) | ✅ **bereits integriert** | `droneguide-be-api-integration.md` |
| **IE** | Irish Aviation Authority | keine | ED-269 GeoJSON | ✅ einsatzbereit (Link dynamisch) | `ireland-geozones-integration.md` |
| **PT** | ANAC | keine | ED-269 Download | ✅ einsatzbereit (vollständigstes ED-269) | `anac-pt-api-integration.md` |
| **LT** | Oro navigacija (Skyzr) | keine | ED-269 (wie AT) | ✅ einsatzbereit | `lithuania-ans-api-integration.md` |
| **GB** | NATS (UK AIP ENR 5.1) | keine | **AIXM 5.1** (+ KML-Rückfall) | ✅ einsatzbereit (offizieller Digital-Datensatz, 1.069 Zonen) | `uk-geozones-integration.md` |
| **EE** | EANS (Skyzr) | keine | ED-269 (wie AT/LT) | ✅ einsatzbereit (live: ~230 Zonen) | `estonia-eans-api-integration.md` |
| **FR** | DGAC / IGN (Géoplateforme) | keine (Etalab) | WFS GeoJSON (~89.700) | ✅ einsatzbereit (Portal nur Raster, WFS liefert Vektor) | `france-geoportail-api-integration.md` |
| **IS** | Samgöngustofa / gis.is | keine | WFS GeoJSON | ✅ einsatzbereit (ohne Höhen) | `iceland-samgongustofa-api-integration.md` |
| **CY** | DCA Cyprus / ArcGIS | keine | ArcGIS FeatureServer (KML-Stil) | ✅ einsatzbereit (gr. Popups parsen) | `cyprus-dca-api-integration.md` |
| **HR** | Croatia Control (AMC) | keine | SignalR-Hub (WKT) | ✅ einsatzbereit (anonym) | `croatia-amc-api-integration.md` |
| **BG** | CAA Bulgaria | keine | GeoServer WFS (ED-269-nah) | ✅ einsatzbereit | `bulgaria-caa-api-integration.md` |
| **SI** | CAA Slovenia / Slovenia Control | keine | ArcGIS FeatureServer (Web Map dyn.) | ✅ einsatzbereit (aktuelle Mai-2026-Karte, Skript) | `slovenia-caa-api-integration.md` |
| **LU** | Geoportail Luxembourg | keine (CC0) | ED-269 / OGC Features | 🔑 Modul `luGeozones.ts` gebaut (nicht eingebunden), Feed defekt → auf OGC umstellen | `luxembourg-geozones-integration.md` |
| **IT** | d-flight | **Nutzer-Login (Einstellungen)** | GeoServer-WFS (GeoJSON) | 🔑→🛠 Modell steht: Nutzer hinterlegt d-flight-Login → WFS (ATM09_INFO 3.876); Login-Flow verifizieren | `dflight-it-api-integration.md` |
| **PL** | PANSA DroneMap | API-Key (`x-api-key`) → Bearer | KML | ✅ live abgerufen (DE-IP): 1.774 Zonen | `pansa-pl-api-integration.md` |
| **ES** | ENAIRE | keine | ED-318 (ArcGIS MapServer) | ✅ KOMPLETT abgerufen (DE-IP, ~21k Feat.) | `enaire-es-api-integration.md` |
| **MT** | iDronect / Transport Malta | keine (DDP) | Meteor-DDP (GeoJSON) | ✅ direkt abrufbar (`{managedZones:true}`, 195 Zonen) | `idronect-mt-api-integration.md` |
| **HU** | MyDroneSpace / HungaroControl | Login (GoodID/Google) | GeoJSON (`/api/zones`) + WMTS-Raster | 🔑 Zonen brauchen Login; WMTS öffentlich | `hungary-mydronespace-api-integration.md` |
| **CZ** | ANS CR / ŘLP | keine | ED-318 Download (offiziell) | ✅ einsatzbereit (aim.rlp.cz, ED-318) | `czech-ans-api-integration.md` |
| **SK** | LPS SR | keine | ArcGIS MapServer-Query (GeoJSON) | ✅ einsatzbereit (178 Zonen, AIXM-Schema) | `slovakia-lps-api-integration.md` |
| **LV** | LGS / airspace.lv | keine (Referer) | ArcGIS GeoJSON + SOE-Aktivfilter | ✅ einsatzbereit (DE-IP verifiziert: 816 Zonen) | `latvia-lgs-api-integration.md` |
| **DK** | Trafikstyrelsen / dronezoner.eu | keine | ArcGIS FeatureServer (GeoJSON) | ✅ einsatzbereit (Rot/Orange/Blau/Grün + NOTAM) | `denmark-dronezoner-api-integration.md` |
| **CH** | BAZL / swisstopo | keine | ED-269 + GeoJSON (STAC-Download) | ✅ einsatzbereit (1.288 Zonen, tägl.) | `switzerland-bazl-api-integration.md` |
| **LI** | BAZL (über CH) | keine | — (im CH-Datensatz enthalten) | ✅ via CH-Quelle (kein eigener Abruf) | `switzerland-bazl-api-integration.md` |
| **NO** | dronesoner.no / AIP Norway | keine | statische GeoJSON-Dateien | ✅ einsatzbereit (Rot/Orange/Blau, NOTAM) | `norway-dronesoner-api-integration.md` |
| **SE** | LFV / Transportstyrelsen | keine | ED-318 + GeoServer WFS | ✅ einsatzbereit (72 UAS-Zonen + Luftraum, Skript) | `sweden-lfv-api-integration.md` |
| **GR** | HASP/HCAA (DAGR) | keine (Freigabe) | WMS-KML + GetFeatureInfo | ✅ einsatzbereit (Produktions-Worker, EU-IP-Host, CC BY-NC-ND) | `greece-romania-geozones-notes.md` |
| **RO** | ROMATSA | keine | GeoServer WFS + JSON | ✅ live abgerufen (DE-IP): 1.272 + 226 Zonen | `greece-romania-geozones-notes.md` |

**Zusammenfassung (31 Länder):** 29× ✅ einsatzbereit · 2× 🔑 Zugang offen.
MT direkt per DDP (`{managedZones:true}`); GR über Produktions-Worker (EU-IP).
**Nur noch IT und HU offen:**
- **IT** – gelöst über **Nutzer-Login in den Einstellungen**: jeder Pilot
  hinterlegt seine d-flight-Zugangsdaten, die App zieht die Zonen per WFS mit
  seinem Token (rechtlich = persönlicher Gebrauch, kein Service-Account/Weitergabe
  nötig). Umsetzbar, Login-Flow (Password-Grant vs. Auth-Code) einmal verifizieren.
- **HU** – öffentlich nur Raster; Vektor nur per Login/Betreiber-Export. Neu verifiziert (DE-Session): EE, FR, DK, CH (+LI), NO, SE, LV;
RO/PL/ES live abgerufen; GB offizieller AIXM-Datensatz. Fertige Export-Skripte
unter `docs/tools/<land>/` für PL, SE, SK, ES, RO, CY, CZ, SI, GR, MT.

---

## Gruppierung nach Technik (für die Implementierung)

- **Echtes ED-269 / ED-318 (vorhandene Pipeline nutzbar):** AT, LT, IE, PT, BE,
  LU (Rückfall OGC), ES (ED-318), IT (nach Login). → `ed269Sources.ts` +
  `shared/ed269Restriction.ts` weiterverwenden.
- **GeoServer-WFS → GeoJSON:** BE, IS, BG. → einheitlicher WFS-Loader möglich.
- **ArcGIS FeatureServer/MapServer → GeoJSON:** CY, SI, SK, (GR vermutlich).
  → einheitlicher ArcGIS-`/query?f=geojson`-Loader möglich.
- **KML → GeoJSON (togeojson):** GB (Google My Maps), PL (`/v1/kml/filtered`).
- **Echtzeit-/Spezialprotokolle:** HR (SignalR-Hub), MT (Meteor-DDP).
- **Login-gebunden:** IT (Keycloak+CSRF), HU (GoodID/Google),
  MT (nur für `managedZones`).

## Wiederverwendbare Bausteine
- **KML→GeoJSON** (GB, PL): ein Parser (`togeojson`) deckt beide ab.
- **WKT→GeoJSON** (HR, teils BG): ein WKT-Parser.
- **ArcGIS-Loader** (CY, SI, SK, evtl. GR): ein generischer FeatureServer/MapServer-Query.
- **WFS-Loader** (BE, IS, BG): ein generischer WFS-GetFeature-Query.
- **Kreis→Polygon** (PT, NL): gemeinsame Hilfsfunktion.
- **Höheneinheiten** (FL, ft AMSL, M AGL): zentrale Umrechnung.

---

## Offene Punkte / Aufgaben an den Product Owner

| Land | Was wird gebraucht |
|---|---|
| IT | Download-Format einmal einloggen & als Fixture erfassen (CSRF-Weg steht) |
| PL | Login+KML von EU-/PL-IP gegenprüfen |
| ES | FeatureServer/WFS von EU-/ES-IP gegenprüfen (WAF) |
| MT | `Zones.getFilteredZones`-**Parameter** aus Browser-Netzwerk-Tab kopieren |
| HU | ED-269/öffentlichen Zonen-Endpoint bei MyDroneSpace erfragen (`info@mydronespace.hu`) |
| CZ | `getGJ.php`-Parameter aus Browser **oder** ED-269 bei ANS CR |
| LV | Daten-Endpoint aus `m.airspace.lv` **oder** ED-269/AIXM bei LGS |
| GR | Datenanfrage aus Browser (Seite bot-geblockt); HASP ist vermutl. ArcGIS |
| RO | Von EU-/RO-IP prüfen **oder** ED-269 bei ROMATSA |
| SI | Aktualität der 2021-Layer bei Slovenia Control prüfen |
| alle | Schriftliche Freigaben/Lizenzen je Land im Repo ablegen |

---

## Hinweise
- **Diese Analyse-Umgebung** (US-Egress-Proxy) blockt einige nationale Portale
  (PL, ES, GR, RO) per Geo-/WAF-Filter. **Die App läuft auf Geräten mit
  EU-IPs** und erreicht diese Quellen voraussichtlich normal; betroffene Quellen
  sind entsprechend markiert.
- Sicherheits-/Schutzmechanismen (WAFs, Bot-Schutz) wurden **nicht umgangen**.
- Für login-gebundene Quellen (IT/HU/SK/MT) ist der sauberste Weg jeweils, beim
  Betreiber einen **ED-269-/öffentlichen Export** anzufragen.
