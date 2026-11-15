"""Konfiguration – alles per Umgebungsvariable überschreibbar (Docker-freundlich)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field, asdict
from datetime import date, timedelta
from pathlib import Path


def _env(name, default):
    return os.environ.get(name, default)


ZONE_LAYERS = ["all_limitation_layer", "all_warning_layer", "all_permifrag_layer"]
AIRSPACE_LAYERS = ["hellas_CTR", "hellas_TMA", "hellas_ATZ", "hellas_r", "hellas_p", "hellas_c", "hellas_d"]


@dataclass
class Config:
    # Seite, die im Browser geöffnet wird (Session/Cookies wie ein echter Besucher)
    page_url: str = field(default_factory=lambda: _env("DAGR_PAGE_URL", "https://dagr.hasp.gov.gr/"))
    # MapServer-Endpunkt. Leer = automatisch aus der Karte der Seite lesen.
    wms_url: str = field(default_factory=lambda: _env(
        "DAGR_WMS_URL", ""))
    wms_url_fallback: str = field(default_factory=lambda: _env(
        "DAGR_WMS_URL_FALLBACK",
        "https://dagr.hasp.gov.gr/cgi-bin/mapserv.exe?map=C:/ms4w_3.1.4/MAPFILES/dagr_TILED.map"))
    zone_layers: list = field(default_factory=lambda: _env("DAGR_ZONE_LAYERS", ",".join(ZONE_LAYERS)).split(","))
    airspace_layers: list = field(default_factory=lambda: [l for l in _env(
        "DAGR_AIRSPACE_LAYERS", ",".join(AIRSPACE_LAYERS)).split(",") if l])
    # Zeitfenster für temporäre Zonen
    date_from: str = field(default_factory=lambda: _env("DAGR_DATE_FROM", ""))
    date_to: str = field(default_factory=lambda: _env("DAGR_DATE_TO", ""))
    days_ahead: int = field(default_factory=lambda: int(_env("DAGR_DAYS_AHEAD", "30")))
    # Abdeckung Griechenland in EPSG:3857 (großzügig)
    extent_3857: str = field(default_factory=lambda: _env("DAGR_EXTENT", "2000000,3800000,3400000,5300000"))
    # Höflichkeit / Robustheit
    pause_s: float = field(default_factory=lambda: float(_env("DAGR_PAUSE_S", "0.3")))
    retries: int = field(default_factory=lambda: int(_env("DAGR_RETRIES", "4")))
    request_timeout_s: float = field(default_factory=lambda: float(_env("DAGR_TIMEOUT_S", "60")))
    headless: bool = field(default_factory=lambda: _env("DAGR_HEADLESS", "0") == "1")
    # Qualitäts-Schranken: bei Verletzung wird NICHT als latest veröffentlicht
    min_match_rate: float = field(default_factory=lambda: float(_env("DAGR_MIN_MATCH_RATE", "0.98")))
    max_drop_rate: float = field(default_factory=lambda: float(_env("DAGR_MAX_DROP_RATE", "0.15")))
    min_zone_count: int = field(default_factory=lambda: int(_env("DAGR_MIN_ZONES", "50")))
    # Ablage
    data_dir: Path = field(default_factory=lambda: Path(_env("DAGR_DATA_DIR", "./data")))
    keep_runs: int = field(default_factory=lambda: int(_env("DAGR_KEEP_RUNS", "20")))

    def window(self) -> tuple[str, str]:
        if self.date_from and self.date_to:
            return self.date_from, self.date_to
        today = date.today()
        return (f"{today:%Y-%m-%d} 00:00",
                f"{today + timedelta(days=self.days_ahead):%Y-%m-%d} 24:00")

    def public(self) -> dict:
        d = asdict(self)
        d["data_dir"] = str(self.data_dir)
        return d
