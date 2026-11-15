# UK (GB) – Geozonen-Quelle & Integrationsauftrag

Übergabe-Dokument zur vom Product Owner bereitgestellten UK-Quelle: einer
**Google-My-Maps-Karte „UK AIP"**. Stand: 2026-11-15, live geprüft.

Vergleich: übrige Länder-Dokumente in `docs/`.

---

## 1. Kurzfassung & wichtige Einordnung

- Die gelieferte Quelle ist eine **Google My Maps** (benutzererstellte Karte,
  `mid=1BktWMPYNuh6N5_IPngyq8jW80nAWXI8d`, Titel „UK AIP"), **kein offizieller
  maschinenlesbarer Behörden-Feed**.
- Sie lässt sich als **KML/KMZ exportieren** (ohne Auth):
  `https://www.google.com/maps/d/kml?mid=1BktWMPYNuh6N5_IPngyq8jW80nAWXI8d`
  (KMZ) bzw. `…/kml?mid=…&forcekml=1`. Live: 240 KB KMZ → `doc.kml` ~2 MB.
- Inhalt: **1069 Placemarks** in 3 Ordnern (= Beschränkungstyp):
  **Danger (219)**, **Prohibited (2)**, **Restricted (848)**. Geometrie als
  `Polygon`/`LineString`/`MultiGeometry` ist vorhanden.
- ⚠️ **Zwei inhaltliche Einschränkungen:**
  1. Es sind nur **AIP Danger/Prohibited/Restricted Areas**. Die eigentlichen
     **drohnenspezifischen Flight Restriction Zones (FRZ)** um Flugplätze
     (ANO 2016) sind **nicht** enthalten – für die Drohnen-Geo-Awareness ist
     das also unvollständig.
  2. Alle Metadaten (Höhen, Aktivität, Kontakt) stehen als **Freitext** in den
     Beschreibungen (CDATA), **keine strukturierten Felder** (`ExtendedData`
     ist leer) → Parsing nötig.
- **Empfehlung:** Für UK zusätzlich/stattdessen die **offizielle Quelle**
  prüfen – Altitude Angel **Drone Safety Map** (CAA/NATS, gleiche Technik wie
  NL GoDrone, siehe `docs/godrone-api-integration.md`: `/v2/mapdata/geojson`
  mit API-Key). Diese liefert FRZ + strukturierte ED-269-ähnliche Daten. Die
  Google-My-Maps-Karte eignet sich als Ergänzung für D/P/R-Gebiete, nicht als
  alleinige Drohnenquelle (siehe §5).

---

## 2. Quelle & Export

| Punkt | Wert |
|---|---|
| Karte | Google My Maps, `mid=1BktWMPYNuh6N5_IPngyq8jW80nAWXI8d` |
| KMZ | `https://www.google.com/maps/d/kml?mid=<MID>` |
| KML (unkomprimiert) | `https://www.google.com/maps/d/kml?mid=<MID>&forcekml=1` |
| Auth | keine |
| Lizenz | **unklar** – benutzererstellte Karte; Urheber/Aktualität/Nutzungsrecht nicht aus der Karte ersichtlich. **Vor Nutzung klären.** |

> Hinweis: Eine Google-My-Maps kann jederzeit vom Ersteller geändert oder
> gelöscht werden; es gibt keine Versionierung und keine Update-Garantie.

---

## 3. Schema (KML)

- **Ordner = Beschränkungstyp:** `Danger` → `CONDITIONAL`/Info,
  `Prohibited` → `PROHIBITED`, `Restricted` → `REQ_AUTHORISATION`/`RESTRICTED`.
- **Placemark:** `<name>` (z. B. `EGD001 TREVOSE HEAD`, `EGP611 COULPORT /
  FASLANE`), `<description>` als CDATA-HTML, `<Polygon>`/`<LineString>`/
  `<MultiGeometry>`.
- **Beschreibung (Freitext, zu parsen):** Koordinaten in DMS, dann
  `Upper limit: 1000 FT ALT`, `Lower limit: SFC`, `Activity: …`, `Service: …`,
  `Contact: …`. Beispiel:
  > „A circle, 2 NM radius, centred at 560331N 0045159W. Upper limit: 2200 FT
  > ALT. Lower limit: SFC. SI 1003/2016. Contact: CAA Airspace Regulation
  > Operations, AROps@caa.co.uk."
- Kein `ExtendedData`. 6 Style-URLs (Farben je Ordner/Typ).

---

## 4. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- GB ist in der App **nicht** als Geozonen-Land geführt (kein Eintrag in
  `countryMaps.ts`/`countryDetection.ts` – ggf. ergänzen).

### Schritte (falls die Google-My-Maps genutzt wird)
1. **KML laden** (`…/kml?mid=…&forcekml=1`) und mit `togeojson` (im Projekt
   für andere Zwecke vorhanden) in GeoJSON wandeln.
2. **Normalisierung** `shared/ukGeozones.ts`:
   - Ordnername → `restriction` (Danger/Prohibited/Restricted-Mapping oben).
   - Beschreibung parsen: `Upper limit`/`Lower limit` (FT ALT/SFC → Meter),
     `Activity`, `Service`, `Contact` → interne Felder/Message.
   - `MultiGeometry`/`LineString` behandeln (viele „Danger"-Einträge haben
     Linien – prüfen, ob das Grenzen/Arcs sind; für Flächenprüfung nur
     Polygone verwenden).
3. `"gb"` in die Länderliste; eigener KML-Pfad (kein ED-269).
4. **Label/Attribution:** „UK AIP (Google My Maps)" **plus deutlicher
   Hinweis**, dass FRZ um Flugplätze fehlen und die Quelle inoffiziell ist.
5. **Refresh:** KML täglich neu laden (keine Versionsinfo verfügbar).

### Bevorzugt: offizielle UK-Quelle
- Altitude Angel **Drone Safety Map** (CAA) klären – gleiche Technik wie NL
  GoDrone. Mit eigenem/öffentlichem API-Key `/v2/mapdata/geojson` (BBox) →
  strukturierte Daten inkl. FRZ. Das wäre die robustere Lösung; die
  Google-My-Maps dann höchstens als Zusatz-Layer.

---

## 5. Offene Punkte
1. **Quelle bestätigen:** Ist die Google-My-Maps die beabsichtigte UK-Quelle,
   oder gibt es Zugang zur offiziellen Altitude-Angel-/CAA-Schnittstelle?
   (Letztere liefert auch die drohnenrelevanten FRZ.)
2. **Lizenz/Urheber** der Google-My-Maps klären (benutzererstellt, keine
   Nutzungs-/Update-Garantie).
3. **FRZ-Lücke:** Diese Karte enthält keine Flugplatz-FRZ – für eine
   vollständige Drohnen-Geo-Awareness in UK nicht ausreichend.

---

## 6. Schnelltest

```bash
UA="Mozilla/5.0 Chrome/120"
curl -s -A "$UA" -L "https://www.google.com/maps/d/kml?mid=1BktWMPYNuh6N5_IPngyq8jW80nAWXI8d" -o uk.kmz
unzip -p uk.kmz doc.kml | grep -c "<Placemark"
unzip -p uk.kmz doc.kml | grep -oE "<name>[^<]+</name>" | head
```
