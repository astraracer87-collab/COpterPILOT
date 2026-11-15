# UK (GB) – Geozonen-Quelle & Integrationsauftrag

Übergabe-Dokument zur UK-Quelle: der **NATS UAS Restrictions Map** (UK AIP
ENR 5.1), bereitgestellt als Google-My-Maps-Karte. Stand: 2026-11-15, live
geprüft.

> **Korrektur gegenüber einer früheren Fassung dieses Dokuments:** Die Karte
> ist **nicht** eine beliebige Community-Karte und es fehlen **nicht** die
> Flugplatz-FRZ. Die Prüfung der Daten zeigt: Es ist die **autoritative
> UK-AIP-Luftraumstruktur inkl. Flight Restriction Zones**, also die offizielle
> Quelle, auf die NATS/CAA die Drohnenpiloten verweisen.

> **Update 2026-11-15 (DE-Session): Es gibt einen besseren, offiziellen
> Primärweg.** NATS veröffentlicht dieselben Zonen als **digitalen Datensatz
> „UAS Flight Restrictions" (AIXM 5.1 / KMZ)** auf der Digital-Datasets-Seite –
> mit **strukturierten Attributen und exakter Geometrie** (Kreise/Bögen). Die
> Google-My-Maps ist nur die **Visualisierung**. → **Für den Import AIXM nehmen**
> (siehe §7); die My-Maps-KML bleibt Schnellvorschau-Rückfall (§2–§6).

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

---

## 7. ✅ PRIMÄRQUELLE: offizieller NATS-Digitaldatensatz (AIXM 5.1) – empfohlen

NATS veröffentlicht die UAS-Beschränkungen als amtlichen **Digital Dataset**
(dieselben **1.069** Features wie die My-Maps, aber strukturiert):

| Format | Inhalt | Für die App |
|---|---|---|
| **AIXM 5.1 (XML)** | exakte Geometrie (Kreise/Bögen), Höhen, Aktivierungszeiten, Hinweise | ✅ **empfohlen** |
| KML/KMZ | gleiche Zonen, Bögen zu Linien vereinfacht, Attribute nur als HTML | Vorschau/Rückfall |

- **Download-Basis (ohne Login):**
  `https://nats-uk.ead-it.com/cms-nats/export/sites/default/en/Publications/digital-datasets/UAS_AREA_1/`
- **Dateischema:** `EG_UAS_FR_DS_AREA1_FULL_<YYYYMMDD>_<XML|KML>.zip`
  (`<YYYYMMDD>` = AIRAC-Effective-Date; aktueller **und** nächster Zyklus liegen
  online). XML-ZIP ~0,5 MB (entpackt ~11,9 MB); **im ZIP** liegen `<name>.xml`,
  `<name>.sha256` („<hex> *<name>.xml“) und `export-filter.xml` (eine `.sha256`
  neben dem ZIP gibt es nicht – 404). Server: `Last-Modified` + If-Modified-Since
  (304), kein ETag.
- **Zyklus:** alle **28 Tage** (AIRAC). **Keine** temporären Zonen (NOTAM/AIP SUP).

### 7.1 Umfang (AIRAC 26.11.2026): 1.069 Features
| `type` | `localType` | Anzahl | Bedeutung |
|---|---|---|---|
| R | FRZ | 308 | Flight Restriction Zone (um geschützte Flugplätze) |
| R | RPZ | 504 | Runway Protection Zone (~5×1 km je Pistenrichtung) |
| R | – | 36 | sonstige Restricted Areas |
| D | – | 219 | Danger Areas |
| P | – | 2 | Prohibited Areas |

> **FRZ + RPZ eines Flugplatzes = rechtlich eine Zone.** Gemeinsamer Designator-
> Stamm + Buchstaben-Suffix (z. B. `EGR1U010A` FRZ + `EGR1U010B…E` RPZ). In der
> App über den Stamm (`EGR1U010`) **gruppieren/verschmelzen** (Kartentools zeigen
> sonst Lücken).

### 7.2 AIXM-Mapping (unter `AirspaceTimeSlice`, `interpretation=SNAPSHOT`)
| App-Feld | AIXM-Pfad | Hinweis |
|---|---|---|
| ID (stabil) | `../gml:identifier` (UUID) | **Primärschlüssel**, zyklusstabil |
| Kennung | `aixm:designator` | z. B. `EGR1U010A` |
| Name | `aixm:name` | |
| Typ / Untertyp | `aixm:type` / `aixm:localType` | R/D/P · FRZ/RPZ/leer |
| Snapshot-Datum | `gml:validTime/…/gml:timePosition` | = AIRAC-Datum |
| Ober-/Untergrenze | `…/aixm:AirspaceVolume/aixm:upperLimit`(+`@uom`)/`…Reference`, `aixm:lowerLimit`(+`@uom`)/`…Reference` | uom **FT** oder **FL**; Ref **SFC/MSL/STD** – mitführen, **nicht** pauschal zu AGL! |
| Geometrie | `…/aixm:horizontalProjection/aixm:Surface/gml:patches/gml:PolygonPatch` | siehe 7.3 |
| Aktivierung | `aixm:activation/aixm:AirspaceActivation` | `status` ACTIVE/AVBL_FOR_ACTIVATION/OTHER; Zeiten als `Timesheet` oder Freitext-Remark |
| Hinweistext | `aixm:annotation/…/aixm:LinguisticNote/aixm:note` | Genehmigungspflicht, Kontakte |

Höhen: FRZ/RPZ immer 0–2.000 ft SFC; Danger/Restricted teils MSL oder FL (STD).

### 7.3 Geometrie korrekt bauen ⚠️
- **EPSG:4326, aber `gml:pos` = „lat lon"** → für GeoJSON **tauschen** (lon/lat).
- Äußerer Ring = Folge von Segmenten, **nacheinander verketten**:
  | Segment | Anzahl | Umsetzung |
  |---|---|---|
  | `GeodesicString` | 1.449 | Punktliste, Geodäten zwischen Punkten |
  | `LineStringSegment` | 93 | Punktliste direkt |
  | `ArcByCenterPoint` | 564 | Mittelpunkt + `gml:radius` (uom `[nmi_i]`=1.852 m) + `startAngle`/`endAngle` → in Stützpunkte (2–5°) zerlegen |
  | `CircleByCenterPoint` | 200 | Vollkreis → densifizieren |
- ~~Winkel nach GML: von Ost gegen den Uhrzeigersinn (mathematisch)~~ –
  **korrigiert (Prüfung an den echten Daten, 2026-11-15):** `startAngle`/
  `endAngle` sind **Peilungen ab Nord im Uhrzeigersinn**; Richtung = Vorzeichen
  von end − start (größer → im Uhrzeigersinn; negative Winkel kommen vor). Belegt:
  Bogenenden treffen die Nachbarpunkte des Rings auf < 15 m, Flächen aller 1.069
  Gebiete = NATS-KML ±1,2 % (mit „mathematischen“ Winkeln ≈ 600 Ausreißer).
- Radius-Einheit prüfen: im Datensatz `[nmi_i]` (757), `m` (5), `[ft_i]` (2).
  Radien als WGS84-Distanz (Kugel: Kreisflächen ≈ 0,6 % zu groß). Ring schließen.
- Punkte stehen als `gml:pointProperty/aixm:Point/gml:pos` (kein `posList`).
- 6 Gebiete (EGD012/031/138D/401/710/802) verweisen mit `curveMember
  xlink:href="urn:uuid:…"` auf eine **GeoBorder** (Küste/Fluss, am Dateiende) –
  Abschnitt zwischen dem Punkt davor und danach übernehmen.
- Alternative ohne Bogenlogik: KML nehmen (Bögen schon in Linien) – dafür kleine
  Lücken zwischen Nachbarzonen und Attribute nur als HTML.

### 7.4 Import-Ablauf
1. Neueste `…_XML.zip` mit Datum ≤ heute ermitteln; nächsten Zyklus vorab laden,
   ab Effective Date aktivieren. 2. Entpacken + **SHA-256** gegen `.sha256`
   prüfen. 3. AIXM parsen (Mapping 7.2). 4. Segmente verketten, Bögen/Kreise
   densifizieren, lat/lon tauschen → GeoJSON. 5. FRZ+RPZ über Stamm gruppieren.
   6. Diff gegen Vorzyklus über `gml:identifier`. 7. Datenstand (AIRAC) +
   NOTAM-Hinweis in der App.

→ `shared/ukGeozones.ts`: statt KML-Freitext (§4) den AIXM-Parser nutzen (umgesetzt, §8); R→
`REQ_AUTHORISATION`/`RESTRICTED`, P→`PROHIBITED`, D→Gefahrengebiet. **Status GB:
einsatzbereit (offizieller AIXM-Datensatz).**

### 7.5 Offen (AIXM)
- Lizenz/Nutzungsbedingungen (NATS-AGB) gegen die bestehende UK-Vereinbarung
  abgleichen (kommerziell/Weitergabe). Spez-PDF `SPC_AIM006 V2.0` auf
  Aktivierungs-Codes/Note-Purposes durchsehen. Push/Feed für neue Zyklen bei NATS
  erfragen (aktuell nur Datei-Download).

---

## 8. Stand der Umsetzung (2026-11-15)

**Status GB: AIXM-Primärquelle umgesetzt, KML bleibt Rückfall.**

- **Abruf** `client/lib/geozoneDirect/ukSource.ts`: Datei des laufenden AIRAC-
  Zyklus (Effective Date ≤ heute; der schon veröffentlichte nächste Zyklus
  wird erst ab seinem Datum genutzt), bei 404 der Vorgänger. Gleicher AIRAC-
  Stand auf dem Gerät → If-Modified-Since → 304 → kein Download. SHA-256 der
  XML gegen die `.sha256` im ZIP ist Pflicht. Jeder AIXM-Fehler → Google-My-
  Maps-KML (§2–§6), beide scheitern → gespeicherter Bestand bleibt.
- **Parser** `shared/geozoneKit/aixm.ts` (ohne DOMParser, streamend, Pausen
  für den JS-Thread), **SHA-256** `shared/sha256.ts`, **Normalisierung**
  `normalizeUkAixmWithStats` in `shared/ukGeozones.ts` (Mapping §7.2; P →
  PROHIBITED, R/FRZ/RPZ → REQ_AUTHORISATION, D → CONDITIONAL; Höhen mit
  Einheit/Bezug, nie pauschal AGL; FRZ+RPZ über den Stamm gruppiert,
  Geometrien getrennt; Aktivierung als Text, SS–SR-Timesheets als Zeitplan).
- **Zahlen Zyklus 29.10.2026:** 1.069 Airspaces (+ 7 GeoBorder), SHA-256 ok;
  nach Höhenfilter 1.047 Zonen (22 Danger Areas ab ≥ FL125 verworfen), 138
  FRZ/RPZ-Gruppen; Flächen = NATS-KML ±1,2 %. Node: ≈ 0,6–0,75 s für Entpacken,
  Prüfsumme und Parsen.
- **Registry:** `temporary: "none"` (keine NOTAM/SUP im Datensatz), Lizenztext
  aus den Datensatz-Metadaten („For aviation use only“, „Not for resale“).
- **Fixture:** `client/lib/__tests__/fixtures/gb-nats-aixm-sample.xml`
  (11 echte Gebiete + 1 GeoBorder). Tests: `client/lib/__tests__/ukAixm.test.ts`.
- **Offen:** Hermes-Laufzeit/Speicher auf dem Gerät messen; §7.5 (Lizenz/AGB,
  Spez-PDF, Push/Feed) unverändert offen; Freitext-Zeiten wie „In the period
  0001 hours on 16th May …“ bleiben englisch (Zone gilt dann als aktiv).
