"""CLI:
  python -m dagr_worker run [--fresh]   Abruf starten (setzt unterbrochenen Lauf automatisch fort)
  python -m dagr_worker status          aktuellen Status als JSON ausgeben
  python -m dagr_worker loop            Dauerbetrieb: alle DAGR_INTERVAL_H Stunden ein Lauf

Exit-Codes: 0 veröffentlicht | 1 Fehler | 2 Qualitätsprüfung abgelehnt | 3 Zugriff gesperrt | 4 läuft bereits
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

from .config import Config
from .job import Job, EXIT_BLOCKED


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="dagr_worker")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--fresh", action="store_true", help="unterbrochenen Lauf NICHT fortsetzen")
    sub.add_parser("status")
    sub.add_parser("loop")
    a = ap.parse_args(argv)
    cfg = Config()

    if a.cmd == "status":
        p = cfg.data_dir / "status.json"
        print(p.read_text() if p.exists() else json.dumps({"state": "never_run"}))
        return 0
    if a.cmd == "run":
        return Job(cfg, fresh=a.fresh).execute()

    interval = float(os.environ.get("DAGR_INTERVAL_H", "24")) * 3600
    while True:
        code = Job(cfg).execute()
        # bei Sperre nicht hämmern: deutlich länger warten
        wait = interval * (4 if code == EXIT_BLOCKED else 1)
        print(json.dumps({"event": "sleep", "seconds": int(wait), "last_exit": code}), flush=True)
        time.sleep(wait)


if __name__ == "__main__":
    sys.exit(main())
