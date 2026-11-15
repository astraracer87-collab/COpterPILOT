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

- Geometrie: Polygon (WGS84). Höhen in FT, Bezug `MSL`/… → in Meter umrechnen.
- `TYPE_CODE` → Beschränkung: `P`/`PROTECT` → `PROHIBITED`; `R`/`RAS`/`TRA`/
  `TSA`/`CTR`/`TMA-P` → `REQ_AUTHORISATION`/`RESTRICTED`; `A` → Info. Mit der
  Fachseite abstimmen.

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
