# Schweden (SE) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **LFV Drönarkartan** (`daim.lfv.se`, Daten von
Transportstyrelsen). Stand: 2026-11-15, live verifiziert (DE-Session).
Freigabe: Nutzung derselben Zugriffe wie die Webseite.

Vergleich: `docs/anac-pt-api-integration.md` (ED-318 `layer`),
`docs/switzerland-bazl-api-integration.md` (CH).

---

## 1. Kurzfassung

- OpenLayers-Karte, **kein Login**. Zwei Quellenarten:
  - **A (Hauptquelle):** UAS-Geozonen als **GeoJSON nach EUROCAE ED-318** →
    `…/dronechart/data/uas_zones_ED318.json` (72 Zonen, ~580 KB).
  - **B:** Luftraum (Flugplätze, R/D, CTR/TIZ/ATZ, 5-km-/1-km-Puffer, SUP,
    NOTAM) über **GeoServer WFS** `https://daim.lfv.se/geoserver/wfs`.
- Alles WGS84 `[lon,lat]`. ED-318 aktualisiert im **AIRAC-Zyklus** (28 Tage),
  `ETag`/`Last-Modified` → `If-None-Match`/`HEAD` nutzen.

**Werkzeug im Repo:** [`docs/tools/sweden/lfv_se_geozones.py`](tools/sweden/lfv_se_geozones.py)
(nur Python-Stdlib) → lädt A + B und schreibt `se_geozones.geojson` im
Einheitsschema; `from_ed318()` allein reicht für die reinen UAS-Zonen.

---

## 2. Quelle A – ED-318-UAS-Zonen ⭐

```
GET https://daim.lfv.se/echarts/dronechart/data/uas_zones_ED318.json
```
Top-Level `metadata.issued`/`validFrom` + `features`.

### Geometrie – zwei Varianten (⚠️ ED-318 erweitert GeoJSON)
- **Polygon** (56): Standard, 1 Ring.
- **Kreis** (16): `type:"Point"` + `extent:{subType:"Circle",radius:<m>}` →
  Standard-Parser zeigen sonst nur einen **Punkt**! → in Polygon wandeln
  (geodätischer Kreis, 64 Punkte; Code im Skript).
- Höhen im **`geometry.layer`**-Objekt (`lower`/`upper`/`lowerReference`/
  `upperReference`/`uom`). Meist `0–x m AGL`; **Sonderfall** ESU209 Säve:
  `0 m AGL – 1500 ft AMSL` → Einheiten **nicht** hart codieren.

### Properties (ED-269/318)
`identifier` (`ESU…`, Schlüssel), `country`=`SWE`, `name[]`/`message[]`
(mehrsprachig `en-GB`+`sv-SE`), `type` (**`REQ_AUTHORIZATION`** 35 → rot/verboten,
**`CONDITIONAL`** 37 → orange/Bedingungen), `restrictionConditions`
(`AUTHORIZED`/`NO_PHOTOGRAPH`), `reason[]`, `regulationExemption`,
`zoneAuthority[]` (`purpose` AUTHORIZATION/NOTIFICATION, `intervalBefore`
ISO-Dauer z. B. `P14D`), `limitedApplicability[]` (Zeitraum → gegen „jetzt" prüfen).

---

## 3. Quelle B – Luftraum (GeoServer WFS, ohne Auth)
```
GET https://daim.lfv.se/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=<LAYER>&outputFormat=json
```
| Layer | Inhalt |
|---|---|
| `mais:RSTA` (170) | Restriktionsgebiete `ES R…` (rot) |
| `mais:DNGA` (21) | Gefahrengebiete `ES D…` (rot) |
| `mais:CTR` (43) / `mais:TIZ` (11) / `mais:ATZ` (2) | Kontroll-/Info-/Verkehrszonen |
| `DAIM_TOPO:RWY5K` (47) / `HKP1K` (38) | 5-km-/1-km-Puffer um Pisten/Heliports |
| `DAIM_TOPO:SUP` (63) | **temporäre** R/D (AIP SUP, zeitabhängig) |
| `dynais:NOTAM` (288) | NOTAM-Gebiete (dynamisch) |

- MAIS-Höhen sind **Freitext** (`GND`, `FL 85`, `1000`=ft AMSL) → parsen.
- SUP-Filter (Webseite): `TO >= <jetzt> AND FROM <= <jetzt+2 Tage>`.
- NOTAM-Filter (Webseite): `(CODE23 ilike 'R%' OR CODE23 ilike 'W%') AND CODE45 <> 'TT'`.
- **AIRAC-Wechsel:** `mais:ARP` Feld `WEF` (aktuell) vs. `mais:ARP_NEXT` (nächster).

---

## 4. Integration
- `shared/swedishGeozones.ts`: ED-318 (A) auf Einheitsschema (`severity` aus
  `type`), **Kreise → Polygone**, Höhen in Meter (uom beachten), Mehrsprach
  (`en-GB`/`sv-SE`), `limitedApplicability`/SUP-`FROM/TO`/NOTAM-`START/ENDVALIDITY`
  gegen „jetzt". `SE: "LFV / Transportstyrelsen"`.
- **Server-Sync** mit `ETag`, nicht pro App-Instanz. ED-318/MAIS täglich bzw.
  per AIRAC; NOTAM/SUP häufig (15–30 min).
- `data/rsta_config.json` liefert Links zum Genehmigungsantrag (übernehmbar).

---

## 5. Offene Punkte
- `data/notam.txt`-Logik (Anzeige-/Ausblendliste) mit LFV klären oder per
  CQL-Filter arbeiten.
- Quellenangabe „LFV / Transportstyrelsen" + Datenstand (`issued`) in der App.

## 6. Schnelltest
```bash
UA="Mozilla/5.0"
curl -s -A "$UA" "https://daim.lfv.se/echarts/dronechart/data/uas_zones_ED318.json" \
  | jq '{issued:.metadata.issued, n:(.features|length),
         types:([.features[].properties.type]|group_by(.)|map({(.[0]):length})|add)}'
```
