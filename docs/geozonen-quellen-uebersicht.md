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
| **GB** | NATS UAS Restrictions Map | keine | KML (Google My Maps) | ✅ einsatzbereit (offiziell, inkl. FRZ) | `uk-geozones-integration.md` |
| **IS** | Samgöngustofa / gis.is | keine | WFS GeoJSON | ✅ einsatzbereit (ohne Höhen) | `iceland-samgongustofa-api-integration.md` |
| **CY** | DCA Cyprus / ArcGIS | keine | ArcGIS FeatureServer (KML-Stil) | ✅ einsatzbereit (gr. Popups parsen) | `cyprus-dca-api-integration.md` |
| **HR** | Croatia Control (AMC) | keine | SignalR-Hub (WKT) | ✅ einsatzbereit (anonym) | `croatia-amc-api-integration.md` |
| **BG** | CAA Bulgaria | keine | GeoServer WFS (ED-269-nah) | ✅ einsatzbereit | `bulgaria-caa-api-integration.md` |
| **SI** | CAA Slovenia / Slovenia Control | keine | ArcGIS FeatureServer (dünn) | ✅ einsatzbereit (Stand 2021 prüfen) | `slovenia-caa-api-integration.md` |
| **LU** | Geoportail Luxembourg | keine (CC0) | ED-269 / OGC Features | 🔑 Modul `luGeozones.ts` gebaut (nicht eingebunden), Feed defekt → auf OGC umstellen | `luxembourg-geozones-integration.md` |
| **IT** | d-flight | Login (Keycloak) + CSRF | ED-269 Download | 🔑 CSRF gelöst, Download-Format erfassen | `dflight-it-api-integration.md` |
| **PL** | PANSA DroneMap | API-Key (`x-api-key`) → Bearer | KML | ✅ live abgerufen (DE-IP): 1.774 Zonen | `pansa-pl-api-integration.md` |
| **ES** | ENAIRE | keine | ED-318 (ArcGIS MapServer) | ✅ live abgerufen (DE-IP), Fixtures | `enaire-es-api-integration.md` |
| **MT** | iDronect / Transport Malta | keine (DDP) | Meteor-DDP (`flightArea`-GeoJSON) | 🔑 Filter-Parameter fehlen (Browser-Capture) | `idronect-mt-api-integration.md` |
| **HU** | MyDroneSpace / HungaroControl | Login (GoodID/Google) | GeoJSON (`/api/zones`) + WMTS-Raster | 🔑 Zonen brauchen Login; WMTS öffentlich | `hungary-mydronespace-api-integration.md` |
| **CZ** | ANS CR / ŘLP | keine | custom (`getGJ.php`) + ArcGIS-WMS | 🔑 Endpoint-Parameter fehlen | `czech-ans-api-integration.md` |
| **SK** | LPS SR | keine | ArcGIS MapServer-Query (GeoJSON) | ✅ einsatzbereit (178 Zonen, AIXM-Schema) | `slovakia-lps-api-integration.md` |
| **LV** | LGS / AIS Latvia | keine | AIXM 5.1 / Mobile-App | 🔑 Daten-Endpoint fehlt | `latvia-lgs-api-integration.md` |
| **GR** | HASP (dagr) | – | vermutl. ArcGIS | 🌐 403 bot-geblockt | `greece-romania-geozones-notes.md` |
| **RO** | ROMATSA | – | unbekannt | 🌐 000 geo-geblockt | `greece-romania-geozones-notes.md` |

**Zusammenfassung:** 13× ✅ einsatzbereit · 8× 🔑 Zugang/Detail offen ·
2× 🌐 nur in dieser Umgebung blockiert.

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
