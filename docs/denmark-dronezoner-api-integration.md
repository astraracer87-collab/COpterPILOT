# Dänemark (DK) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **dronezoner.eu** (Trafikstyrelsen / GisVision).
Stand: 2026-11-15, live verifiziert (DE-Session). Freigabe liegt laut Product
Owner vor.

Vergleich: `docs/cyprus-dca-api-integration.md`, `docs/slovakia-lps-api-integration.md`
(ArcGIS-Muster), `docs/godrone-api-integration.md` (NL).

---

## 1. Kurzfassung

- `dronezoner.eu` ist eine **ArcGIS-JS-App (4.34)** auf einer öffentlichen
  ArcGIS-Online-WebMap. Alle Zonen liegen als **öffentliche ArcGIS Feature
  Services** (Owner `Trafikstyrelse_Ekstern`, Zugriff `public`).
- Jeder Layer liefert direkt **GeoJSON** (`f=geojson`), **kein Token**.
- Zonen sind nach Farbe gegliedert: **RØD** (Flugverbot), **ORANGE**
  (Höhenbegrenzung), **BLÅ** (Sicherheit: Gefängnis/Polizei/Militär/Botschaft),
  **GRØN** (Naturschutz, saisonal), **GUL** (temporär aus NOTAMs) + NOTAM-Layer.
- Ausnahme: die **max. Flughöhe** (`Maxflyvehøjde2026`) gibt es nur als
  **Vector Tiles** (kein Feature Service).

> ⚠️ **Sicherheitshinweis:** In der Seitenkonfiguration (`APP_CONFIG`) liegen ein
> **Dataforsyningen-WMS-Token** und **Datafordeler-Zugangsdaten** (Höhenmodell)
> des Betreibers **im Klartext**. Diese **nicht** übernehmen – für Hintergrund-
> karten/Höhen einen **eigenen** kostenlosen Zugang bei dataforsyningen.dk /
> datafordeler.dk anlegen. (Ggf. GisVision/Trafikstyrelsen darauf hinweisen.)

---

## 2. Einstieg & Service-Basis

| Was | URL |
|---|---|
| WebMap (Layerliste/Styles) | `https://www.arcgis.com/sharing/rest/content/items/4d73b79535104a509575e50cd7b30244/data?f=json` |
| Service-Verzeichnis | `https://services-eu1.arcgis.com/Zvx25KS6sGRl9LIx/arcgis/rest/services?f=json` |

`BASE = https://services-eu1.arcgis.com/Zvx25KS6sGRl9LIx/arcgis/rest/services`

> **Service-Namen tragen das Jahr** (`DroneZoner_2025_ny_bekndg`, `…2026`).
> **Nicht hart verdrahten** – den aktuellen Layer **dynamisch aus der WebMap**
> lesen (Item `4d73b79535104a509575e50cd7b30244/data`). Aktuell gilt
> `DroneZoner_2025_ny_bekndg` (nicht die alten `DroneZoner2024_v7` etc.).

---

## 3. Layer-Übersicht (relevante)

| Farbe / Inhalt | Pfad unter `BASE` | Geom | Anzahl |
|---|---|---|---|
| **RØD** – flugsicherheitskritisch (i. d. R. Verbot) | `DroneZoner_2025_ny_bekndg/FeatureServer/1` | Polygon | 166 |
| **ORANGE** – Höhenbegrenzung | `DroneZoner_2025_ny_bekndg/FeatureServer/2` | Polygon | 98 |
| **BLÅ** – Sicherheit (Gefängnis/Polizei/Militär/Botschaft …) | `DroneZoner_2025_ny_bekndg/FeatureServer/4` | Polygon | 623 |
| **GRØN** – Naturschutz (saisonal) | `NaturOmraader2024v2/FeatureServer/0` | Polygon | 140 |
| **GUL** – temporär (NOTAM) | `disabled_notams/FeatureServer/0` | Polygon | 53 |
| NOTAM aktiv / awareness / inaktiv | `active_notams`/`awareness_notams`/`inactive_notams` `/FeatureServer/0` | Polygon | 0/3/0 |
| An-/Abflugkorridore | `Ind__og_udflyvningsplaner/FeatureServer/188` | Polygon | 186 |
| max. Flughöhe (nur Vector Tiles) | `tiles-eu1…/Maxflyvehøjde2026/VectorTileServer` | MVT | – |

(Die `…/FeatureServer/{0,3,5}`-„Signatur"-Layer sind Symbole/Labels, keine Zonen.
Infrastruktur-Layer Windkraft/Straßen/Bahn sind **keine** Geozonen.)

Native SR der festen Zonen ist **EPSG:32632**, NOTAMs **3857** → immer
`outSR=4326` anfordern.

---

## 4. GeoJSON abrufen

```
{BASE}/{LAYER}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson
```
- `maxRecordCount` = 2000 → bei größeren Layern paginieren
  (`&resultOffset=0&resultRecordCount=2000`, solange `exceededTransferLimit`).
- Nur aktive: `where=Aktiv%3D'JA'`. Anzahl: `&returnCountOnly=true&f=json`.
- **Änderungserkennung:** `{BASE}/{LAYER}?f=json` → `editingInfo.lastEditDate`
  (ms). Nur neu laden, wenn geändert (NOTAM-Layer mehrmals täglich!).
- **Coded Values** (z. B. `Type=3`) kommen als Rohcode → Klartext aus
  `{LAYER}?f=json` unter `fields[].domain.codedValues` auflösen.

### Wichtige Felder (RØD/ORANGE/BLÅ)
`title`, `typeId`, `Farve`, `Type`, `Lovkrav`/`Paragraf` (Rechtsgrundlage),
`Bufferzone`/`Enhed`/`Buffer_Zone`, `MaxFlyveHoejde` (nur Orange),
`Elevation_meter`, `Aktiv` (JA/NEJ), `zoneKategori` (Permanent/temporär),
`datoTidSTART`/`datoTidSLUT`/`deaktiveretDato` (ms), `InfoTekst`/
`undtagelsesText`, `kontaktMail`/`InfoLink`/`AnsoegningsLink`, `NOTAMS_url`.

**Code-Tabellen:**
- `Farve`: 1 Rot · 2 Gelb · 3 Grün · 4 Blau · 5 Orange
- `Type`: 1 Ziv. Flughafen · 2 öff. Flugplatz · 3 HEMS · 4 Helipad ·
  5 Militärflugplatz · 6 Botschaft · 7 Gefängnis · 8 Polizei · 9 Schloss ·
  10 Militär · 11 Störfallbetrieb · 12 Fallschirm · 13 Modellflug · 14 Privat ·
  15 Segelflug · 16 Wasserflug · 17 Naturgebiet · 18 HEMS-Basis · 19 Schlossgarten
  · 20 Gerichtsgeb. · 21 Einsatzgebiet · 22 temp. Militär · 23 temp. Zone ·
  24 Security · 25/26 Gericht
- `Buffer_Zone`: 1=0–1 km · 2=0–2 · 3=2–3 · 4=3–4 · 5=3–5 · 6=3–6 · 7=6–8 ·
  8=3–8 · 10=1–2 · 11=0–4 · 12=Anflug

NOTAM-Layer: `name` (z. B. `D0522/26`), `Status`, `StartDate`/`EndDate`,
`LimitMeter`/`LimitFod`, `NOTAMtxt` (Volltext), `notams` = **JSON-String**
(Roh-NOTAM, mit `JSON.parse` lesen). Grün: `Restriktionsperiode_` (Sperrzeitraum),
`Årsag__` (Grund).

---

## 5. Integrationsauftrag

### Ist-Zustand
- Laut Repo-Notizen ist DK evtl. schon teilweise in `ed269Sources.ts` erwähnt –
  **prüfen**, ob eine alte DK-Quelle existiert und ggf. auf diese Services
  umstellen.

### Schritte
1. **Server-Sync** (ArcGIS-Loader, generisch): die 8 relevanten Layer
   (rot/orange/blau/grün/gelb + NOTAM-aktiv/awareness + Korridore) je als
   GeoJSON ziehen, Coded Values auflösen, zu einem DK-Satz mergen.
   `shared/danishGeozones.ts`: `Farve`/`Type` → Beschränkung
   (Rot→`PROHIBITED`, Orange→Höhenbegrenzung/`CONDITIONAL`, Blau→
   `REQ_AUTHORISATION`, Grün→Info/saisonal), `MaxFlyveHoejde`/`LimitMeter` → Höhe.
2. **Zeitfilter in der App** (`datoTidSTART/SLUT`, `StartDate/EndDate`, `Aktiv`) –
   temporäre Zonen bleiben in den Layern stehen.
3. **Lokal cachen** (NOTAM 15–30 min, feste Zonen täglich; vorher `lastEditDate`).
4. **max. Flughöhe:** `Maxflyvehøjde2026` als Vector-Tile-Layer direkt in die
   Karte (MapLibre/OL) **oder** Tiles → GeoJSON (`vt2geojson`, dann dissolven)
   **oder** bei Trafikstyrelsen als Feature Service/GeoJSON anfragen (sauberste).
5. **Label/Attribution:** `DK: "Trafikstyrelsen / dronezoner.eu"`; Lizenz aus
   Item-Feld `licenseInfo` bestätigen.

---

## 6. Offene Punkte
- Nutzungslizenz der Items bei Trafikstyrelsen schriftlich festhalten
  (`licenseInfo`).
- `Maxflyvehøjde2026` als Vektor beschaffen (s. §5.4).
- Eigene Dataforsyningen-/Datafordeler-Zugänge für Hintergrund/Höhen (nicht die
  Klartext-Tokens der Seite – Sicherheitshinweis §1).

---

## 7. Schnelltest

```bash
UA="Mozilla/5.0 Chrome/120"
BASE="https://services-eu1.arcgis.com/Zvx25KS6sGRl9LIx/arcgis/rest/services"
for L in "DroneZoner_2025_ny_bekndg/FeatureServer/1" "DroneZoner_2025_ny_bekndg/FeatureServer/2" \
         "DroneZoner_2025_ny_bekndg/FeatureServer/4" "NaturOmraader2024v2/FeatureServer/0"; do
  n=$(curl -s -A "$UA" "$BASE/$L/query?where=1%3D1&returnCountOnly=true&f=json" | jq .count)
  echo "$n  $L"
done
```
