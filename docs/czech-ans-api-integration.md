# Tschechien (CZ) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **dronemap.gov.cz** (ANS CR / Řízení letového provozu).
Stand: 2026-11-15. Freigabe liegt vor.

---

## 1. Kurzfassung

- `dronemap.gov.cz` ist eine **eigene OpenLayers-Webapp** (kein ArcGIS/Altitude
  Angel). Basiskarten/Hintergrundlayer kommen vom **ArcGIS-Server
  `aimgis.rlp.cz`** (WMS), die eigentlichen Drohnen-Zonen über **eigene
  PHP-Endpunkte** von `dronemap.gov.cz`.
- **Ohne Login erreichbar** (Seite lädt öffentlich).

## 2. Beobachtete Endpunkte (verifiziert)

| Zweck | Endpoint |
|---|---|
| Vektor-/Zonendaten (GeoJSON) | `https://dronemap.gov.cz/getGJ.php?…` |
| Daten-/Query-API | `https://dronemap.gov.cz/getData.php?cmd=…` |
| Layer-Definitionen (OL) | `https://dronemap.gov.cz/addDynamicLayers.php` (TileWMS → aimgis) |
| Hintergrund-WMS | `https://aimgis.rlp.cz/server/services/<svc>/MapServer/WMSServer` |
| Permanente GeoJSON | `https://dronemap.gov.cz/data/permanent/*.geojson`, `tiles/cz/**/*.geojson` |
| Kontakt | `dronemap@ans.cz` |

Die Zonen werden client-seitig mit `geojson-vt` zu Vektorkacheln gerendert; die
Rohdaten liefert `getGJ.php`/`getData.php`.

## 3. Offener Punkt (nächster Schritt)
Die **genauen Parameter** von `getGJ.php` / `getData.php?cmd=…` für den
Drohnen-Zonen-Datensatz ließen sich statisch nicht sicher ableiten. Zwei Wege:
1. **Aus dem Browser:** `dronemap.gov.cz` öffnen → DevTools → Netzwerk →
   die `getGJ.php`/`getData.php`-Aufrufe mit den Zonendaten kopieren (URL +
   Parameter). Damit baue ich den Abruf.
2. **Bei ANS CR (`dronemap@ans.cz`) erfragen**, ob die Geozonen als **ED-269**
   oder direktes GeoJSON bereitstehen (sauberste Lösung).

## 4. Integration (sobald Endpoint/Parameter vorliegen)
- `fetchCzech()` lädt das GeoJSON; `shared/czechGeozones.ts` mappt die Felder.
  Da OpenLayers-GeoJSON: Struktur nach dem ersten echten Abruf dokumentieren.
- `"cz"` in die Länderliste. Label `CZ: "ANS CR / ŘLP"`. Refresh täglich.

> **Stand:** App-Typ und Endpunkt-Familie verifiziert; es fehlt der exakte
> Zonen-Abruf (Parameter aus Browser oder ED-269 von ANS CR).

---

## 7. Befund (DE-IP, 2026-11-15): Daten sind VERSCHLÜSSELT ⛔

- Endpunkt: `POST https://dronemap.gov.cz/getGJ.php?ct=…&iv=…&s=…`.
- **Anfrage UND Antwort sind AES-verschlüsselt** (CryptoJS mit `ct`/`iv`/`salt`).
  Die Antwort ist ein Base64-Blob, **kein GeoJSON**. Der Schlüssel steckt im
  Client-JS; der Betreiber verschleiert die Übertragung bewusst.
- **Kein sauberer öffentlicher Pull** ohne Reverse-Engineering der
  Verschlüsselung (nicht empfohlen).
- **Nächster Schritt: ED-269 beim Betreiber anfragen → `dronemap@ans.cz`.**
  (Status CZ: datenseitig blockiert, Betreiber-Anfrage nötig.)

---

## 8. ✅ GELÖST: offizieller Download (Betreiber-Antwort 2026-11-15)

ANS CR / ŘLP stellt die UAS-Geozonen **öffentlich zum Download** bereit – kein
Login, keine Verschlüsselung (die AES-`getGJ.php` war nur das Karten-Rendering).

**Seite:** `https://aim.rlp.cz/?lang=cz&p=uas-gz`
**Pfadschema:** `https://aim.rlp.cz/data/uas/<issued>/<validFrom>/…`
(zusätzlich `…/<issued>/actual/…` für den aktuellen Satz).

### Zwei Formate
1. **EU-Standard ED-318** (empfohlen – wie Spanien):
   - `…/ed_318_a1_a2_all.json` – **FeatureCollection** `ed_318` mit
     `metadata.validFrom`/`issued`. ⚠️ **≈ 318 MB** (ganzes Land).
   - `…/ed_318_a1_a2_tiles.zip` – **gekachelt** → für die App **diese** nehmen
     (statt der 318-MB-Datei).
2. **Native Einzel-Dateien** (klein, GeoJSON-FeatureCollections, Polygon):
   - `…/LKR314A.json` … (benannte Beschränkungsgebiete, je wenige kB)
   - `…/GRID_CTR.json` (~12 MB, 19.709 Grid-Zellen), `…/GRID_ATZ.json`
   - Properties: `ident` (z. B. `3LKR314A`), `vertical_limit`
     (z. B. `"GND - 3500 ft AMSL"` / `"GND - 120 m AGL"`), `effective_date`,
     `publication`, `data_source`, `_timestamp`, `_crc`.

### Integration
- **Bevorzugt ED-318** (`tiles.zip`) → `finalize(raw,"cz")` über die vorhandene
  ED-269/ED-318-Pipeline (wie ES). Die 318-MB-`all`-Datei **nicht** roh laden.
- Alternativ die nativen Dateien: `vertical_limit`-String parsen
  (`"GND"`/`"### ft AMSL"`/`"### m AGL"` → Meter), `ident`/`publication` → Name.
  GRID_* sind Tessellierungen (viele Zellen) – nur bei Bedarf.
- **Status CZ: einsatzbereit** (offizieller ED-318-Download).
