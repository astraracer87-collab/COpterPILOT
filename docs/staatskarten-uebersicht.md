# Staatskarten-Übersicht (Flugplanung)

Diese Übersicht dokumentiert, welche Karte die App in der Flugplanung pro Land
anzeigt. Die Entscheidung ist auf Web und iOS identisch und leitet sich aus einer
gemeinsamen Quelle ab:

- **Eigene-Daten-Entscheidung**: `OWN_MAP_DATA_COUNTRIES` / `hasOwnMap()` in
  `shared/countryDetection.ts`.
- **Karten-Registry**: `client/lib/countryMaps.ts` (Mobile) und
  `web/src/lib/planning/countryMaps.ts` (Web) – inhaltlich identisch gespiegelt.
- **Fallback**: `getMapConfigOrFallback()` liefert für nicht gelistete Länder das
  zentrale EASA-Drohnenportal.

## Anzeige-Logik

1. **Eigene Karte mit Geozonen-Overlay** – nur für die 8 Länder mit echten
   Geozonen-Daten (DE, FR, CH, LU, NL, AT, BE, DK). Es wird unsere eigene Karte
   mit dem Geozonen-Overlay gezeigt.
2. **Offizielle Staatskarte** – für alle übrigen gelisteten Länder. Wenn das
   Portal das Einbetten erlaubt (`iframeable: true`), wird es als iframe (Web) bzw.
   WebView (iOS) eingebettet; sonst erscheint der klar beschriftete Button
   „Offizielle Karte öffnen“. Wo das Portal Koordinaten unterstützt
   (`supportsCoordinates: true`), wird die Karte auf die geplanten Koordinaten
   zentriert – mit korrekter Projektion und Koordinaten-Reihenfolge.
3. **EASA-Fallback** – für nicht gelistete Länder wird das EASA-Portal mit der
   Liste der nationalen Luftfahrtbehörden geöffnet (keine Koordinaten, kein iframe).

## Projektionen / Koordinaten-Reihenfolge

Die Zentrierung erfolgt in `buildMapUrl()` je nach `coordinateType`:

| coordinateType | Projektion              | Platzhalter im URL-Template      |
| -------------- | ----------------------- | -------------------------------- |
| `wgs84`        | WGS84 Lat/Lon           | `{lat}`, `{lon}` / `{lng}`       |
| `lv95`         | CH LV95 (EPSG:2056)     | `{easting}`, `{northing}`        |
| `epsg2169`     | LU (EPSG:2169)          | `{x}`, `{y}`                     |
| `epsg3857`     | Web-Mercator (EPSG:3857)| `{x}`, `{y}`                     |

## Länder-Tabelle

Legende: **Eigene Karte** = unsere Karte mit Geozonen-Overlay · **Deep-Link
m. Koord.** = offizielle Karte, auf Standort zentriert · **Deep-Link o. Koord.** =
offizielle Karte ohne Zentrierung · **iframe/WebView** = einbettbar.

| Land            | ISO | Anzeige               | Deep-Link Koord. | iframe/WebView | Projektion | Portal-URL |
| --------------- | --- | --------------------- | ---------------- | -------------- | ---------- | ---------- |
| Deutschland     | DE  | Eigene Karte          | –                | ja             | wgs84      | https://maptool-dipul.dfs.de/ |
| Frankreich      | FR  | Eigene Karte          | –                | –              | –          | https://www.geoportail.gouv.fr/donnees/restrictions-uas-categorie-ouverte-et-aeromodelisme |
| Schweiz         | CH  | Eigene Karte          | –                | ja             | lv95       | https://map.geo.admin.ch/ |
| Luxemburg       | LU  | Eigene Karte          | –                | ja             | epsg2169   | https://map.geoportail.lu/ |
| Niederlande     | NL  | Eigene Karte          | –                | ja             | wgs84      | https://map.godrone.nl/ |
| Österreich      | AT  | Eigene Karte          | –                | ja             | wgs84      | https://utm.dronespace.at/ |
| Belgien         | BE  | Eigene Karte          | –                | –              | –          | https://map.droneguide.be/ |
| Dänemark        | DK  | Eigene Karte          | –                | –              | –          | https://www.en.droneregler.dk/ |
| Estland         | EE  | Offizielle Staatskarte| ja               | ja             | wgs84      | https://utm.eans.ee/ |
| Finnland        | FI  | Offizielle Staatskarte| nein             | nein           | –          | https://aviationmap.fintraffic.fi/ |
| Spanien         | ES  | Offizielle Staatskarte| nein             | nein           | –          | https://drones.enaire.es/ |
| Griechenland    | GR  | Offizielle Staatskarte| nein             | nein           | –          | https://dagr.hasp.gov.gr/ |
| Kroatien        | HR  | Offizielle Staatskarte| nein             | nein           | –          | https://amc-en.crocontrol.hr/ |
| Irland          | IE  | Offizielle Staatskarte| nein             | nein           | –          | https://www.iaa.ie/general-aviation/drones |
| Italien         | IT  | Offizielle Staatskarte| nein             | nein           | –          | https://www.d-flight.it/ |
| Liechtenstein   | LI  | Offizielle Staatskarte| ja               | ja             | lv95       | https://map.geo.admin.ch/ |
| Litauen         | LT  | Offizielle Staatskarte| ja               | nein           | wgs84      | https://utm.ans.lt/avm/ |
| Lettland        | LV  | Offizielle Staatskarte| nein             | nein           | –          | https://www.airspace.lv/ |
| Norwegen        | NO  | Offizielle Staatskarte| ja               | ja             | wgs84      | https://utm.avinor.no/avm/ |
| Polen           | PL  | Offizielle Staatskarte| nein             | nein           | –          | https://dronemap.pansa.pl/ |
| Portugal        | PT  | Offizielle Staatskarte| nein             | nein           | –          | https://dnt.anac.pt/mapa.html |
| Rumänien        | RO  | Offizielle Staatskarte| nein             | nein           | –          | https://flightplan.romatsa.ro/init/drones |
| Schweden        | SE  | Offizielle Staatskarte| ja               | ja             | epsg3857   | https://daim.lfv.se/echarts/dronechart/ |
| Slowenien       | SI  | Offizielle Staatskarte| nein             | nein           | –          | https://caa-slovenia.maps.arcgis.com/ |
| *Andere Länder* | –   | EASA-Fallback         | nein             | nein           | –          | https://www.easa.europa.eu/en/domains/civil-drones/naa |

## Wartung

- Neues Land mit eigenen Geozonen-Daten: ISO in `OWN_MAP_DATA_COUNTRIES`
  (`shared/countryDetection.ts`) ergänzen und sicherstellen, dass die Geozonen-
  Quelle vorhanden ist.
- Neue/aktualisierte offizielle Staatskarte: Eintrag in **beiden** Registries
  (`client/lib/countryMaps.ts` und `web/src/lib/planning/countryMaps.ts`) ergänzen
  bzw. anpassen – beide müssen identisch bleiben.
- Deep-Link mit Koordinaten nur aktivieren, wenn das Portal-Format verifiziert
  wurde (korrekte Projektion + Koordinaten-Reihenfolge in `buildMapUrl()`).

## AVM-Plattform (Frequentis/Flyk „NinoxDrone")

Mehrere nationale ANSP betreiben denselben Frequentis/Flyk-AVM-Viewer unter
`https://utm.<ansp>/avm/`. Dieser nutzt einen einheitlichen Hash-Deep-Link
`#p=<zoom>/<lat>/<lon>` in WGS84 (Reihenfolge **Lat vor Lon**). Damit ist das
Koordinaten-Format für alle Länder dieser Plattform identisch verifiziert:

- AT `utm.dronespace.at/avm/`, EE `utm.eans.ee/avm/`, NO `utm.avinor.no/avm/`
  liefern **kein** `X-Frame-Options` → einbettbar (`iframeable: true`).
- LT `utm.ans.lt/avm/` liegt hinter Cloudflare mit `X-Frame-Options: SAMEORIGIN`
  → **nicht** einbettbar (`iframeable: false`); der Deep-Link öffnet die Karte
  aber korrekt zentriert im Browser.

## Empirische Prüfung der Einbettbarkeit (Stand Juni 2026)

Die `iframeable`-Flags wurden per HTTP-Header-Prüfung (X-Frame-Options /
Content-Security-Policy `frame-ancestors`) bzw. Render-Test verifiziert. Als
**nicht einbettbar** bestätigt (Framing blockiert): ES `drones.enaire.es`,
IT `d-flight.it`, PT `dnt.anac.pt`, GR (403), HR `amc-en.crocontrol.hr`,
SI `caa-slovenia.maps.arcgis.com` (ArcGIS-Login erforderlich), LT (Cloudflare,
s. o.). LV `airspace.lv` ist zwar einbettbar (kein XFO), nutzt aber einen
Esri-4.x-Viewer mit opaken „Bookmarks" statt eines sauberen Lat/Lon-Deep-Links
und bleibt daher ohne Koordinaten-Zentrierung.
