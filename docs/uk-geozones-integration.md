# UK (GB) – Geozonen-Quelle & Integrationsauftrag

Übergabe-Dokument zur UK-Quelle: der **NATS UAS Restrictions Map** (UK AIP
ENR 5.1), bereitgestellt als Google-My-Maps-Karte. Stand: 2026-11-15, live
geprüft.

> **Korrektur gegenüber einer früheren Fassung dieses Dokuments:** Die Karte
> ist **nicht** eine beliebige Community-Karte und es fehlen **nicht** die
> Flugplatz-FRZ. Die Prüfung der Daten zeigt: Es ist die **autoritative
> UK-AIP-Luftraumstruktur inkl. Flight Restriction Zones**, also die offizielle
> Quelle, auf die NATS/CAA die Drohnenpiloten verweisen.

Vergleich: übrige Länder-Dokumente in `docs/`.

---

## 1. Kurzfassung

- Quelle ist die **NATS UAS Restrictions Map** (NATS = offizieller UK-AIS-
  Provider; Inhalt = **UK AIP ENR 5.1**). Die CAA „Drone Code"-Seite verweist
  Piloten auf genau diese NATS-Karte. Technisch ist sie als **Google My Maps**
  veröffentlicht (`mid=1BktWMPYNuh6N5_IPngyq8jW80nAWXI8d`).
- **KML/KMZ-Export, ohne Auth:**
  `https://www.google.com/maps/d/kml?mid=1BktWMPYNuh6N5_IPngyq8jW80nAWXI8d`
  (KMZ) bzw. `…&forcekml=1` (KML). Live: 240 KB KMZ → `doc.kml` ~2 MB.
- **1069 Placemarks** in 3 Ordnern (= Luftraumkategorie):
  - **Danger (219)** – `EGD###` (z. B. „EGD001 TREVOSE HEAD")
  - **Prohibited (2)** – `EGP###` (z. B. „EGP611 COULPORT / FASLANE")
  - **Restricted (848)** – `EGR###` **und die Flugplatz-FRZ**
    (675 FRZ-Nennungen, 647× „Aerodrome", dazu einige RPZ)
- **Die Flugplatz-FRZ sind enthalten** (im Ordner „Restricted") – das ist für
  die Drohnen-Geo-Awareness in UK zentral.
- Geometrie als `Polygon`/`LineString`/`MultiGeometry` vorhanden; Metadaten
  als **Freitext** in den Beschreibungen (Höhen, Aktivität, Kontakt) → Parsing.

---

## 2. Quelle & Export

| Punkt | Wert |
|---|---|
| Quelle | NATS UAS Restrictions Map (UK AIP ENR 5.1), Google My Maps |
| `mid` | `1BktWMPYNuh6N5_IPngyq8jW80nAWXI8d` |
| KMZ | `https://www.google.com/maps/d/kml?mid=<MID>` |
| KML | `https://www.google.com/maps/d/kml?mid=<MID>&forcekml=1` |
| Auth | **keine** |
| Autoritativ | Inhalt = UK AIP (NATS/CAA). Die **AIP bleibt die rechtlich maßgebliche Quelle**; die Karte ist die offizielle visuelle Aufbereitung. |

> **Caveat (CAA-Hinweis):** Kurzfristige Beschränkungen (v. a. **NOTAMs**) sind
> **nicht** in dieser Karte enthalten. Offizielle NOTAM-Quelle ist separat zu
> berücksichtigen. Die App sollte das im Hinweistext klar sagen.

---

## 3. Schema (KML)

- **Ordner = Luftraum-/Beschränkungstyp:**
  - `Danger` → Gefahrengebiet (ED-R-ähnlich; Vorsicht/bedingt)
  - `Prohibited` → `PROHIBITED`
  - `Restricted` → `REQ_AUTHORISATION`/`RESTRICTED` **inkl. Flugplatz-FRZ**
- **Placemark:** `<name>` (z. B. `EGR156 WINDSOR CASTLE`, FRZ-Einträge mit
  Flugplatzbezug), `<description>` als CDATA-HTML, Geometrie
  `Polygon`/`LineString`/`MultiGeometry`.
- **Beschreibung (Freitext, zu parsen):** DMS-Koordinaten, `Upper limit:
  … FT ALT`, `Lower limit: SFC`, `Activity: …`, `Service: …`, `Contact: …`
  (CAA: `AROps@caa.co.uk`, ACOMS-Portal). FRZ-Einträge nennen den Flugplatz
  und seinen Status.
- Kein `ExtendedData`; 6 Style-URLs (Farben je Ordner/Typ).

---

## 4. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- GB ist in der App **nicht** als Geozonen-Land geführt (ggf. in
  `countryMaps.ts`/`countryDetection.ts` ergänzen).

### Schritte
1. **KML laden** (`…/kml?mid=…&forcekml=1`) und mit `togeojson` (im Projekt
   vorhanden) in GeoJSON wandeln.
2. **Normalisierung** `shared/ukGeozones.ts`:
   - Ordnername → `restriction` (Danger/Prohibited/Restricted-Mapping oben;
     FRZ liegen im „Restricted"-Ordner → als genehmigungspflichtig behandeln).
   - Beschreibung parsen: `Upper limit`/`Lower limit` (FT ALT/SFC → Meter),
     `Activity`, `Service`, `Contact` → interne Felder/Message; FRZ-Bezug
     erkennen (Name/Beschreibung „FRZ"/„Aerodrome").
   - `MultiGeometry`/`LineString` behandeln (für die Flächenprüfung nur
     Polygone; Linien sind teils Arcs/Grenzen).
3. `"gb"` in die Länderliste; eigener KML-Pfad (kein ED-269-Schema).
4. **Label/Attribution:** „UK AIP ENR 5.1 – NATS" (offizielle Quelle). Im
   Hinweistext: **NOTAMs separat prüfen** (nicht in der Karte).
5. **Refresh:** KML täglich neu laden (die NATS-Karte wird im AIRAC-Zyklus
   aktualisiert; die Google-My-Maps trägt keine maschinenlesbare Versionsinfo).

---

## 5. Offene Punkte
1. **Update-Zyklus/Permanenz bestätigen:** Die Daten stammen aus dem UK AIP
   (AIRAC, 28 Tage). Die Google-My-Maps-URL als offiziellen NATS-Kanal
   bestätigen (die CAA-Drone-Code-Seite verlinkt die NATS-Karte).
2. **NOTAM-Lücke:** Kurzfristige Sperren sind nicht enthalten – in der App
   kennzeichnen; ggf. separate NOTAM-Quelle anbinden.
3. **Höhen/Aktivität** liegen nur im Freitext → robustes Parsing nötig
   (`FT ALT`, `SFC`, `FL`, Zeitangaben).

---

## 6. Schnelltest

```bash
UA="Mozilla/5.0 Chrome/120"
curl -s -A "$UA" -L "https://www.google.com/maps/d/kml?mid=1BktWMPYNuh6N5_IPngyq8jW80nAWXI8d" -o uk.kmz
unzip -p uk.kmz doc.kml | grep -c "<Placemark"          # ~1069
unzip -p uk.kmz doc.kml | grep -c "FRZ"                 # FRZ enthalten (>600)
```
