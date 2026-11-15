# Frankreich (FR) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu den französischen UAS-Geozonen (DGAC / IGN, über die
**Géoplateforme `data.geopf.fr`**). Stand: 2026-11-15, live verifiziert
(DE-Session). Datenfreigabe liegt vor; Lizenz **Licence Ouverte Etalab**.

Vergleich: `docs/greece-romania-geozones-notes.md` (RO-WFS),
`docs/iceland-samgongustofa-api-integration.md` (WFS-Muster).

---

## 1. Kurzfassung

- Die Portalseite **cartes.gouv.fr** zeigt die Zonen **nur als gerenderte
  WMTS-Rasterkacheln** (PNG) – im Browser keine Geometrie. **ABER:** dieselben
  Daten gibt es offiziell als **Vektor über WFS** → **~89.700 MultiPolygone**
  als GeoJSON, WGS84.
  (Also ein „Portal zeigt nur Raster"-Fall, der über den WFS **doch** Vektoren
  liefert – vgl. GR.)
- Jedes Polygon hat nur **zwei Fachattribute**: `limite` (Flugverbot oder
  Höhenbegrenzung) und `remarque` (Freitext).
- Rechtsgrundlage: Erlass vom 3.12.2020. **Lizenz Licence Ouverte Etalab**,
  Aktualisierung **jährlich**. Namensnennung: „Source : DGAC / IGN –
  Géoplateforme".
- Gilt für Kategorie **„Ouverte" + Modellflug**, nicht „Spécifique". **Keine**
  temporären Zonen (NOTAM), keine zeitaktiven Militärgebiete.

---

## 2. Dienste & Endpunkte (alle über `data.geopf.fr`)

| Dienst | Endpunkt | Layer | Inhalt |
|---|---|---|---|
| **WFS (Vektor → für die App)** | `https://data.geopf.fr/wfs/ows` | `TRANSPORTS.DRONES.RESTRICTIONS:carte_restriction_drones_lf` | Polygone + Attribute |
| WMTS (Raster) | `https://data.geopf.fr/wmts` | `TRANSPORTS.DRONES.RESTRICTIONS` | PNG-Kacheln (wie cartes.gouv.fr) |
| WMS (Raster) | `https://data.geopf.fr/wms-r/wms` | `TRANSPORTS.DRONES.RESTRICTIONS` | Rasterbild auf Anfrage |

Verwandte Layer (nicht näher geprüft): WMTS `ENR.AERO.CIVIL`/`ENR.AERO.MILITAIRE`
(Luftraumstruktur), WFS `ORTHOIMAGERY.ORTHOPHOS.RESTRICTEDAREAS:arrete`
(Luftaufnahme-Verbote), WMS `drone2023_deal972` (Martinique).

---

## 3. WFS-Datensatz im Detail

### 3.1 Schema (`DescribeFeatureType`)
| Feld | Typ | Bedeutung |
|---|---|---|
| `limite` | string | Art der Beschränkung (Werte unten) |
| `remarque` | string (nullable) | Freitext / Bezugshöhe |
| `geom` | gml:MultiSurface → GeoJSON `MultiPolygon` | Geometrie |

- **89.737 Objekte**, EPSG:4326 (im GeoJSON `[lon,lat]`), inkl. Überseegebiete.

### 3.2 Werte von `limite` → Höhe ableiten
| Wert (String, inkl. `*`-Fußnote) | `max_m` |
|---|---|
| `Vol interdit *` | **0** (verboten) |
| `Hauteur maximale de vol de 30 m *` | 30 |
| `… de 50 m *` | 50 |
| `… de 60 m *` | 60 |
| `… de 100 m *` | 100 |
| (keine Zone) | 120 (allg. Grenze) |

`remarque`: z. B. `Altitude de référence de l'aérodrome : 137 m`,
`Évolution interdite en espace public en agglomération …` oder `null`.

---

## 4. Daten abrufen

**Anzahl prüfen:**
```
GET https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature
  &TYPENAMES=TRANSPORTS.DRONES.RESTRICTIONS:carte_restriction_drones_lf&RESULTTYPE=hits
```
**Seitenweise als GeoJSON** (Paging über `STARTINDEX`/`COUNT`, `SORTBY=gml_id`
für stabile Reihenfolge):
```
  &OUTPUTFORMAT=application/json&COUNT=1000&STARTINDEX=0
```
**Nur ein Gebiet (BBOX, WFS 2.0 + EPSG:4326 = lat,lon!):**
```
  &BBOX=48.80,2.20,48.92,2.45,urn:ogc:def:crs:EPSG::4326
```

> ⚠️ **Server liefert gelegentlich kein JSON** (eine Monitoring-Antwort
> `# HELP jmx…`) → **Retry mit Backoff + JSON-Prüfung** einbauen (siehe
> Python-Beispiel in der Quelldoku). `SORTBY` weglassen, falls der Server das
> Feld ablehnt.

---

## 5. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- FR ist in der App noch **nicht** als Geozonen-Land geführt.
- ~90.000 Polygone sind **zu viel** für den direkten Download aufs Gerät.

### Schritte
1. **Server-Sync:** WFS seitenweise (COUNT=1000) komplett ziehen (Retry/JSON-
   Prüfung), zu einem GeoJSON zusammenführen.
2. **Normalisieren:** `limite` → `max_m` (0 = verboten, sonst Meterzahl);
   `remarque` → Bezugshöhe (`référence … : NNN m`) / Hinweistext.
   `shared/franceGeozones.ts`.
3. **Ausliefern (wichtig):** nicht roh. **Vektorkacheln/PMTiles** mit
   `tippecanoe` (`-zg --drop-densest-as-needed --include=max_m --include=remarque`),
   per HTTP-Range ladbar. Für Offline-Punktabfrage zusätzlich räumlicher Index
   (R-Tree: SpatiaLite oder Turf + rbush).
4. **Überlappungen:** an jedem Punkt gilt der **strengste** Wert – `0` vor jeder
   Höhe, sonst die **kleinste** Höhe. Darstellung nach `max_m` absteigend zeichnen
   (100 m zuerst, Verbot zuletzt → strengste Zone oben).
5. **Label/Attribution:** `FR: "DGAC / IGN – Géoplateforme"`; Pflicht-Namensnennung
   „Source : DGAC / IGN – Géoplateforme" (Licence Ouverte Etalab).
6. **Refresh:** jährlich aktualisiert → **monatlicher Check** reicht
   (`RESULTTYPE=hits` vergleichen oder Hash). Datenstand in der App anzeigen.

---

## 6. Offene Punkte
- **Höhenbezug** von `limite`/`remarque`: AGL annehmen; Flugplatz-Bezugshöhen aus
  `remarque` nur informativ.
- Prüfen, ob `ENR.AERO.MILITAIRE` / zeitlich aktive Gebiete zusätzlich gewünscht
  sind (nicht im Basisdatensatz).
- Max. `COUNT` des WFS-Servers ermitteln (Download beschleunigen).
- Schraffierte Flächen auf cartes.gouv.fr ggf. mit WFS abgleichen (fehlende
  Zonenart?).
- Fußnote `*` aus der offiziellen Legende übernehmen.

---

## 7. Schnelltest

```bash
UA="Mozilla/5.0 Chrome/120"; B="https://data.geopf.fr/wfs/ows"
L="TRANSPORTS.DRONES.RESTRICTIONS:carte_restriction_drones_lf"
# Anzahl:
curl -s -A "$UA" "$B?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=$L&RESULTTYPE=hits" | grep -o 'numberMatched="[0-9]*"'
# Erste Seite + limite-Verteilung:
curl -s -A "$UA" "$B?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=$L&OUTPUTFORMAT=application/json&COUNT=500&STARTINDEX=0&SORTBY=gml_id" \
  | jq '{n:(.features|length), limits:([.features[].properties.limite]|group_by(.)|map({(.[0]):length})|add)}'
```

---

## 8. Quellen
- WFS-Capabilities: `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities`
- Géoportail: „Restrictions UAS catégorie Ouverte et aéromodélisme"
- INSPIRE-Metadaten `DGAC_RESTRICTIONS-UAS`
