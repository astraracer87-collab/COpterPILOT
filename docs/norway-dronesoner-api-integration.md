# Norwegen (NO) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **dronesoner.no**. Stand: 2026-11-15, live verifiziert
(DE-Session). Freigabe liegt laut Product Owner vor.

Vergleich: `docs/denmark-dronezoner-api-integration.md` (DK),
`docs/godrone-api-integration.md` (NL, Rendering).

---

## 1. Kurzfassung

- **Keine Abfrage-API** – die Karte (MapLibre GL 5.17) lädt beim Start **fertige
  statische GeoJSON-Dateien** aus `https://dronesoner.no/data/`, **ohne Auth**.
- **Eine Datei = eine Zonenart.** Die Bedeutung steckt im **Dateinamen / der
  Layer-Konfiguration**, nicht in einem Zonen-Attribut.
- WGS84 `[lon,lat]`, 2D. Höhen stehen als **Text** in `lower_limit`/`upper_limit`
  (`GND`, `1500 FT AMSL`, `643 m AMSL`, `FL95`).
- NOTAM-basierte Dateien werden laufend neu erzeugt; Stand in
  `data/notam_status.json`. `?v=<ts>` an URLs ist nur Cache-Buster.
- Drei Kategorien: **Rot** „Krever tillatelse" (Genehmigung/Verbot, `#cc0000`),
  **Orange** „Vær oppmerksom" (Achtung, `#E67E22`), **Blau** „Luftrom"
  (Luftraum, `#007bff`).

---

## 2. Dateien (Basis `https://dronesoner.no/data/`)

### Rot – Genehmigung nötig / Verbot
| Datei | Inhalt | Feat. | wichtige Felder |
|---|---|---|---|
| `forbud_notam.geojson` | NOTAM-Drohnenverbot (dynamisch) | 0 | wie Gefahrengebiete |
| `forbud_lufthavner_5km.geojson` | 5-km-Zone um Flughäfen | 48 | `ICAO`,`IATA`,`NAVN`,`URL` |
| `forbud_verneomrader.geojson` | Naturschutz **mit** Drohnenverbot | 773 | `offisieltNavn`,`forbudType`,`tidsbegrenset`,`verneforskrift`,`beskrivelse`(HTML) |
| `forbud_restriksjoner.geojson` | Restriktionsgebiete (EN R…) | 33 | `navn`,`info`,`info_en`,`lower_limit`,`upper_limit`,`kilde` |
| `forbud_fengsler.geojson` | Gefängnisse (Grenze ungefähr) | 37 | `navn`,`info` |
| `forbud_nsm_sensor.geojson` | Sensorverbot (NSM) | 197 (**40 ohne Geometrie**) | `navn`,`typeforbud`,`refnr` |
| `forbud_ambassader.geojson` | Botschaften (**OSM** → ODbL-Attribution!) | 85 | OSM-Tags |
| `forbud_sikkerhetssoner.geojson` | Öl/Gas-Plattformen | 63 | `navn`,`icao`,`upper_limit`,`lower_limit`,`helideck_m` |

### Orange – Achtung
`obs_flyplasser.geojson` (162, kleine Flug-/Landeplätze), `obs_fareomrader.geojson`
(24, Gefahrengebiete END…), `obs_sanntid_fareomrader.geojson` (47, echtzeit-aktiv),
`obs_droneflyging.geojson` (33, gemeldete Flüge), `obs_notam_soner.geojson` (24),
`obs_verneomrader.geojson` (**2697, ≈12 MB**, Schutz **ohne** Verbot).

### Blau – Luftraum
`luftrom_ctr_tiz.geojson` (54, CTR/TIZ), `luftrom_rmz_tmz.geojson` (3,
Funk-/Transponderpflicht), `luftrom_vfr_rapporteringspunkt.geojson` (360,
**Point**, ab Zoom 7).

### Status
`notam_status.json`: `oppdatert_iso`, `antall_notam`, `kilder` → zur
Änderungserkennung der NOTAM-Dateien. (`befolkning_2025.pmtiles` = Bevölkerung
für SORA, **nicht** Geozonen.)

---

## 3. Attribute & Parsing

- **Kreise schon als Polygone** ausgerechnet (5 km Flughafen etc.) – kein
  Radius-Sonderfall. MultiPolygon bei Schutzgebieten/NOTAM.
- **Höhen (Text) → Meter** (`parseHeightToMeters`): `GND`/`SFC`→0; `UNL`→unbegrenzt;
  `FL95`→95×100 ft×0,3048; `… FT/FEET/FOT`→×0,3048; `… NM`→×1852; sonst Meter.
  `AMSL`=über Meer, `AGL`=über Grund. Für Drohnen (120 m AGL) treffen `GND`-Zonen
  immer; hohe AMSL-Untergrenzen je nach Gelände.
- **Zeit:** `aktiv_fra_iso`/`aktiv_til_iso` (ISO UTC, maßgeblich), `daglige_vinduer`
  (`[["HHMM","HHMM"],…]` UTC, kann JSON-String sein), `activation_type`
  (`Stadig aktivt` / `Aktivert etter NOTAM`). Seite zeigt Zone **15 min vorher**
  aktiv, dimmt außerhalb.
- **Schutzgebiete:** `forbudType` (`Generelt ferdselsforbud` vs. `Direkte
  drone/modellfly-forbud`), `tidsbegrenset` (nur zeitweise, z. B. Brutzeit),
  `stoyforbud` (Lärm).
- `info`/`info_en` enthalten teils **HTML** → bereinigen. `kilde`/`hjemmel`/
  `sist_endret`.

### ⚠️ Datenqualität beim Import
1. **Uneinheitliche Feldnamen** (`navn`/`Navn`/`NAVN`/`offisieltNavn`/`name`;
   `icao`/`icaoKode`/`ICAO`) → auf eigenes Schema mappen.
2. **40 Features ohne Geometrie** (`forbud_nsm_sensor`) → filtern.
3. `typeforbud` (NSM) ~12 Schreibvarianten → normalisieren.
4. `forbud_notam` kann leer sein → als leere Liste behandeln.
5. `obs_verneomrader` ~12 MB → vereinfachen / PMTiles.
6. Botschaften aus **OSM** → „© OpenStreetMap contributors (ODbL)".

---

## 4. Integration

### Schritte
1. **Server-Sync** (alle Dateien, `shared/norwayGeozones.ts`): auf das
   gemeinsame Schema mappen (`category` = PROHIBITED/CAUTION/AIRSPACE aus der
   Datei-Gruppe; `lower_m`/`upper_m` aus Text; `valid_from`/`valid_to`/
   `daily_windows_utc`; `info` HTML-bereinigt). Vollständiges Referenz-Skript
   (Python, nur Stdlib) liegt im Quellbericht vor.
2. **Abruf-Rhythmus:** `notam_status.json` alle 10–15 min → bei neuem
   `oppdatert_iso` die NOTAM-Dateien (`forbud_notam`, `obs_fareomrader`,
   `obs_sanntid_fareomrader`, `obs_droneflyging`) neu; feste Zonen täglich;
   Schutzgebiete wöchentlich.
3. **Aktiv-Logik** wie die Seite (15 min Vorlauf, tägliche Fenster in UTC).
4. **Performance:** große Schutzgebiets-Layer → PMTiles (tippecanoe).
5. **Label/Attribution:** `NO: "dronesoner.no / AIP Norway"`; zusätzlich OSM-
   Attribution für Botschaften.

---

## 5. Offene Punkte
- Nutzungsfreigabe/Lizenz ablegen; eigener User-Agent mit Kontakt.
- Hinweis übernehmen: verbindlich bleiben NOTAM (ippc.no) / Luftfartstilsynet;
  Gefängnis-Grenzen nur ungefähr.
- Layer-Definitionen/Logik stehen in `dronesoner.no/js/config.js` + `utils.js` –
  bei Änderungen dort nachsehen.

---

## 6. Schnelltest

```bash
UA="Mozilla/5.0 Chrome/120"; B="https://dronesoner.no/data"
curl -s -A "$UA" "$B/notam_status.json" | jq '{oppdatert_iso, antall_notam}'
for f in forbud_restriksjoner forbud_lufthavner_5km luftrom_ctr_tiz obs_fareomrader; do
  n=$(curl -s -A "$UA" "$B/$f.geojson" | jq '.features|length'); echo "$n  $f"
done
```
