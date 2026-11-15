# Slowakei (SK) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **gis.lps.sk/vfrm** (LPS SR / Letové prevádzkové služby).
Stand: 2026-11-15, **live verifiziert**. Freigabe liegt vor.

> **Korrektur gegenüber einer früheren Fassung:** Die Zonen sind **öffentlich
> und ohne Token abrufbar**. Ich hatte zuerst den falschen Dienst (einen
> token-geschützten `FeatureServer`) erwischt. Der von der App genutzte
> **`VFRM_popup/MapServer`** ist offen abfragbar.

---

## 1. Kurzfassung

- Die VFR-Manual-Karte (`gis.lps.sk/vfrm`, ArcGIS Web AppBuilder) bezieht die
  Luftraum-/Zonendaten vom **öffentlichen ArcGIS-MapServer**
  `gis.lps.sk/server/rest/services/VFRM/VFRM_popup/MapServer` – **ohne Auth**.
- **Hauptlayer (verifiziert):** Layer **5 „Airspace"** – **178 Polygon-Zonen**
  mit vollem AIXM-Schema (Typ, Klasse, **Höhen**, ICAO, Betriebszeiten).
- Zonentypen (`TYPE_CODE`): `RAS` (68), `R` (30), `TMA-P` (20), `TRA` (17),
  `A` (12), `PROTECT` (9), `CTR` (6), `TSA` (5), `P` (3), `D` (2), `D-OTHER`,
  `FIR-P` …
- Der direkte `VFRM/Airspaces/FeatureServer` verlangt zwar einen Token (499),
  wird aber **nicht gebraucht** – die MapServer-Query liefert dieselben Daten.

---

## 2. Zugang

```
GET https://gis.lps.sk/server/rest/services/VFRM/VFRM_popup/MapServer/5/query
    ?where=1=1&outFields=*&outSR=4326&f=geojson
```
- Auth: **keine**. Paging via `resultOffset`/`resultRecordCount` (ArcGIS-Default
  beachten; 178 Features passen in wenige Seiten).
- Nützliche weitere Layer im selben MapServer:
  - `…/MapServer/4` – Airspace_point (Polygon)
  - `VFRM/VFRM_popup_fis/MapServer/0` – Airspace_sectors_FIS (Polygon)
  - (`…/MapServer/7` NONaixm_plochy = Flugplatz-Bodenflächen wie Parking –
    **nicht** drohnenrelevant)

---

## 3. Schema (Layer 5 „Airspace", AIXM-abgeleitet)

| Feld | Beispiel | Bedeutung |
|---|---|---|
| `IDENT_TXT` | `LZSLZPP001` | Kennung (Dedupe) |
| `NAME_TXT` | `MRVA LZPP 001` | Name |
| `TYPE_CODE` | `RAS`, `R`, `P`, `D`, `CTR`, `TMA-P`, `TRA`, `TSA` | Zonentyp |
| `LOCALTYPE_TXT` | `MRVA` | lokaler Typ |
| `CLASS_CODE` | | Luftraumklasse |
| `DISTVERTLOWER_VAL`/`_UOM`/`_CODE` | `3000` / `FT` / `MSL` | **Untergrenze** |
| `DISTVERTUPPER_VAL`/`_UOM`/`_CODE` | | **Obergrenze** |
| `WORKHR_CODE`/`WORKHRRMK_TXT` | | Betriebszeiten |
| `ICAO_TXT`, `MIL_CODE`, `COMNAME_TXT`, `REMARKS_TXT` | | Zusatz |

- Geometrie: Polygon (WGS84). Höhen in FT, Bezug `MSL`/`SFC`/`STD` (FL) → in
  Meter umrechnen.
- `TYPE_CODE` → Beschränkung: `P`/`PROTECT` → `PROHIBITED`; `R`/`TRA`/
  `TSA`/`CTR`/`TMA-P` → `REQ_AUTHORISATION`/`RESTRICTED`; `A` → Info. Mit der
  Fachseite abstimmen.

### ⚠️ Wichtig: `TYPE_CODE="RAS"` ist gemischt – NICHT pauschal behandeln
Die 68 `RAS`-Gebiete unterteilen sich über `LOCALTYPE_TXT`:

| `LOCALTYPE_TXT` | Anzahl | Untergrenze | Drohnenrelevant |
|---|---|---|---|
| `MRVA` | 35 | 2000–11600 ft **MSL** | **nein** – Radar-Mindestvektorhöhen (Lotsen-Konstrukt) |
| `ATZ` | 23 | 0 ft **SFC** | **ja** – Flugplatzverkehrszonen |
| `RMZ` | 5 | 0 ft **SFC** | **ja** – Funkpflichtzonen |
| `NPZ` | 4 | FL95 / FL245 | **nein** – Flugflächen, weit über Drohnenhöhe |

- **Nicht** nach `TYPE_CODE="RAS"` filtern – das würde die 23 ATZ + 5 RMZ
  (boden­basierte, drohnenrelevante Zonen) versehentlich mitlöschen.
- **Empfohlen:** über den vorhandenen **Höhen-/Erreichbarkeitsfilter**
  (`shared/geozoneAltitudeFilter.ts`, 120 m) ausschließen – MRVA (≥ 2000 ft
  MSL) und NPZ (FL95+) fallen automatisch raus, ATZ/RMZ (0 ft SFC) bleiben.
  Robuster als eine Typ-Liste und für alle Länder einheitlich.
- Falls explizit gewünscht: nur `LOCALTYPE_TXT ∈ {MRVA, NPZ}` ausschließen.

---

## 4. Integrationsauftrag

### Schritte
1. **Abruf** `fetchSlovakia()`: Layer 5 (+ optional 4, FIS) als GeoJSON laden.
   Generischer **ArcGIS-FeatureServer/MapServer-Loader** (wie CY/SI)
   wiederverwendbar.
2. **Normalisierung** `shared/slovakiaGeozones.ts`: `TYPE_CODE` → Beschränkung,
   `DISTVERT*` → Höhen (FT/MSL → Meter), `NAME_TXT`/`IDENT_TXT` übernehmen.
3. `"sk"` in die Länderliste. Label `SK: "LPS SR"`, Attribution „© LPS SR".
4. **Tests**: `TYPE_CODE`-Mapping, Höhenumrechnung, Dedupe über `IDENT_TXT`.
5. **Refresh**: täglich.

---

## 5. Offene Punkte
- `TYPE_CODE`-→-Beschränkung-Mapping fachlich bestätigen (RAS/MRVA, TMA-P, FIR-P).
- Höhenbezug (`MSL` vs. `GND`) sauber umrechnen.
- Prüfen, ob drohnenspezifische UAS-Zonen separat existieren oder in `Airspace`
  mit enthalten sind.

---

## 6. Schnelltest
```bash
B="https://gis.lps.sk/server/rest/services/VFRM/VFRM_popup/MapServer/5"
curl -s "$B/query?where=1%3D1&outFields=*&outSR=4326&f=geojson" \
  | jq '{n:(.features|length), types:([.features[].properties.TYPE_CODE]|group_by(.)|map({(.[0]):length})|add)}'
```

---

## Anhang SK: Live-Aktivierungen + Skript (DE-Session, 2026-11-15)

**Werkzeug im Repo:** [`docs/tools/slovakia/lps_sk_geozones.py`](tools/slovakia/lps_sk_geozones.py)
(nur Stdlib) → `sk_zones.geojson` (statisch, Höhen in m) + `sk_activations.geojson`
(live) + Health-Check.

- **Statische Zonen:** `VFRM/VFRM_popup/MapServer/5/query?...&f=geojson` (178,
  davon drohnenrelevant: Untergrenze `SFC`). Filtern über `TYPE_CODE`/`LOCALTYPE`.
- **Live-Aktivierungen** (R/TRA/TSA): `Hosted/Reservation_(Public)2/FeatureServer/0`
  — Join über `airspace` ↔ `IDENT_TXT`, `status`/`startdate`/`enddate`. Webseiten-
  Filter übernehmen: `(lower_fl<>'FL' OR lower_val<=195) AND (localtype_txt IS NULL
  OR localtype_txt<>'NPZ') AND status IN ('ACTIVE','APPROVED','ALLOCATED',
  'REFERENCE_ALLOCATED','PENDING')`. Höhen der Reservierung haben **Vorrang** vor
  den statischen.
- **Health-Check** `Hosted/Status_(Public)/FeatureServer/0`: liefert Treffer, wenn
  der AUP/UUP-Import >3 min alt/fehlgeschlagen → App-Warnung „Aktivierungsdaten
  evtl. nicht aktuell".
- **Ausfiltern** (zu hoch/irrelevant): `MRVA` (35), `NPZ`, `FBZ`, reine FL-Zonen.
  `CTR`/`P`/`D`/`PROTECT`/`ATZ` als permanent behandeln.
- Z-Komponente (`[lon,lat,0]`) beim Import entfernen. Attribution: „VFR Manual,
  LPS SR, š. p.".
