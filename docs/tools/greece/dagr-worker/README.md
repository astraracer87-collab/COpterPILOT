# DAGR-Worker – Griechische UAS-Geozonen (HASP/HCAA) als GeoJSON

Hintergrund-Job, der die Geozonen von **dagr.hasp.gov.gr** in einem festen, nachvollziehbaren
Ablauf abruft und als GeoJSON bereitstellt. Er darf dauern, kann abgebrochen werden und
setzt beim nächsten Start dort fort, wo er war.

## Warum ein Browser?

DAGR stellt kein Vektor-Dataset und kein WFS bereit, blockt einfache HTTP-Clients (403) und
ist nur aus der EU erreichbar. Der Worker öffnet deshalb die DAGR-Seite in einem echten
Chromium und stellt alle Anfragen **innerhalb der Seite** – also genau so, wie es die Webseite
selbst tut. Das ist der Zugriffsweg, für den die HASP/HCAA-Freigabe gilt. Es wird nichts
verschleiert oder umgangen.

**Voraussetzung:** Der Container muss mit einer **EU-IP** ins Internet (z. B. NAS oder Server in DE).
US-Cloud-Hosting funktioniert nicht.

## Ablauf (Phasen)

| # | Phase | Was passiert | Checkpoint |
|---|-------|--------------|-----------|
| 1 | `session` | Chromium öffnet DAGR, WMS-Endpunkt wird automatisch aus der Karte gelesen | – |
| 2 | `capabilities` | GetCapabilities: Sind alle Ebenen noch da? (Frühwarnung bei Umbau) | run.json |
| 3 | `geometry` | GetMap als KML je Ebene → Polygone; Innenpunkt je Zone berechnen | geometry.json |
| 4 | `attributes` | Je Zone GetFeatureInfo (GML = BBox, HTML = Attribute), Zuordnung über exakte BBox | attributes.jsonl (je Zone) |
| 5 | `assemble` | GeoJSON bauen, Höhen 9999999 → `null`, IDs = REG-NO | result.geojson |
| 6 | `validate` | Qualitätsschranken + Vergleich mit letztem Stand (neu/entfernt/geändert) | report.json |
| 7 | `publish` | Nur wenn alles ok: atomar nach `latest/` kopieren | latest/ |

Abgeschlossene Phasen werden beim Fortsetzen übersprungen. In Phase 4 werden bereits
abgefragte Zonen übersprungen.

## Ablage (`/data`)

```
status.json                  ← aktueller Zustand, hier pollt die App
latest/greece.geojson        ← zuletzt FREIGEGEBENER Datenstand (das nutzt die App)
latest/report.json           ← Bericht dazu (Anzahl, Zuordnungsquote, Diff)
runs/<run_id>/run.json       ← Phasen mit Start/Ende/Dauer/Ergebnis
runs/<run_id>/events.jsonl   ← lückenloses Ereignisprotokoll (JSON-Zeilen)
runs/<run_id>/…              ← Checkpoints und Ergebnis dieses Laufs
```

Die letzten 20 Läufe bleiben erhalten (`DAGR_KEEP_RUNS`).

### `status.json` (Beispiel)

```json
{
  "state": "running",            // running | published | rejected | interrupted | failed | blocked
  "phase": "attributes",
  "progress": {"done": 212, "total": 388, "eta_s": 240},
  "window": {"from": "2026-11-15 00:00", "to": "2026-12-15 24:00"},
  "error": null,
  "latest": {"run_id": "20261115-160251", "published": "…", "zones": 388, "airspaces": 215}
}
```

## Qualitätsschranken

Ein Lauf wird **nicht** veröffentlicht (`latest/` bleibt unverändert, Exit-Code 2), wenn

- weniger als `DAGR_MIN_MATCH_RATE` (98 %) der Zonen sauber Attribute zugeordnet bekommen,
- die Zonenanzahl gegenüber dem letzten Stand um mehr als `DAGR_MAX_DROP_RATE` (15 %) fällt,
- weniger als `DAGR_MIN_ZONES` (50) Zonen geliefert werden.

So landet ein halber oder kaputter Abruf nie in der App.

## GeoJSON-Felder

Zonen (`category: "zone"`): `reg_no`, `name`, `valid_from`, `valid_to`, `lower_ft_agl`, `upper_ft_agl`,
`lower_ft_msl`, `upper_ft_msl`, `details`, `layer`, `match`, `geometry_hash`, ggf. `part` (mehrteilige Zone).

Lufträume (`category: "airspace"`): `airspace_type` (CTR, TMA, ATZ, R, P, C, D) – DAGR liefert dafür
**keine** Attribute. Die Flughafen-CTR/ATZ sind mit Namen aber auch als Zonen enthalten.

Die Ebenen mit Fluganmeldungen anderer Nutzer (`*_flight_layer`) werden bewusst nicht abgefragt.

## Start

```bash
docker compose up -d --build              # Dauerbetrieb: alle 24 h ein Lauf
docker compose logs -f                    # Protokoll live
docker compose run --rm dagr-worker run   # einmaliger Lauf (setzt Unterbrochenes fort)
docker compose run --rm dagr-worker run --fresh
docker compose run --rm dagr-worker status
```

Ohne Docker: `pip install playwright && playwright install chromium`, danach `python -m dagr_worker run`.

### Exit-Codes

`0` veröffentlicht · `1` Fehler/abgebrochen (wird fortgesetzt) · `2` Qualitätsprüfung abgelehnt ·
`3` Zugriff gesperrt (403) · `4` läuft bereits

Bei `3` wartet der Dauerbetrieb das Vierfache des Intervalls, damit der Server nicht weiter angefragt wird.

## Konfiguration (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `DAGR_INTERVAL_H` | 24 | Abstand der Läufe im `loop`-Modus |
| `DAGR_DAYS_AHEAD` | 30 | Zeitfenster ab heute (`WMS_DATE_FROM/TO`) |
| `DAGR_DATE_FROM` / `DAGR_DATE_TO` | – | festes Fenster, z. B. `2026-12-01 00:00` |
| `DAGR_PAUSE_S` | 0.3 | Pause nach jeder Anfrage |
| `DAGR_RETRIES` | 4 | Wiederholungen mit wachsender Wartezeit |
| `DAGR_WMS_URL` | auto | WMS-Endpunkt fest vorgeben (sonst aus der Seite gelesen) |
| `DAGR_PAGE_URL` | https://dagr.hasp.gov.gr/ | Startseite (Alternative: `https://dagr.hcaa.gr/`) |
| `DAGR_ZONE_LAYERS` / `DAGR_AIRSPACE_LAYERS` | alle | Ebenen, kommagetrennt (leer = keine Lufträume) |
| `DAGR_HEADLESS` | 0 | 1 = ohne virtuellen Bildschirm |

## Test ohne DAGR

`tests/mock_dagr.py` simuliert den MapServer, inklusive überlappender Zonen, Polygon mit Loch,
mehrteiliger Zone und geändertem Datenstand (`MOCK_VARIANT=2`):

```bash
python tests/mock_dagr.py 8765 &
DAGR_PAGE_URL=http://127.0.0.1:8765/ DAGR_MIN_ZONES=10 DAGR_DATA_DIR=/tmp/dd python -m dagr_worker run
```

## Lizenz

Nutzung nur im Rahmen der HASP/HCAA-Freigabe (Webseite: CC BY-NC-ND 4.0). Das Feld
`metadata.license_note` im GeoJSON hält das fest.
