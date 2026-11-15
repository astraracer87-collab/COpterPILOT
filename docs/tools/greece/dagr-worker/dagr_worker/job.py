"""Der eigentliche Abruf-Job: feste Phasen, Checkpoints, Protokoll, Qualitätsprüfung.

Ablage (DAGR_DATA_DIR):
  status.json                 aktueller Zustand (für die App zum Pollen)
  latest/greece.geojson       zuletzt freigegebener Datenstand
  latest/report.json          Bericht dazu
  runs/<run_id>/run.json      Phasen, Zeiten, Ergebnis eines Laufs
  runs/<run_id>/events.jsonl  lückenloses Ereignisprotokoll
  runs/<run_id>/geometry.json Checkpoint nach Phase "geometry"
  runs/<run_id>/attributes.jsonl  Checkpoint je Zone (Fortsetzen nach Abbruch)
  runs/<run_id>/result.geojson / report.json
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import signal
import socket
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from . import parse
from .session import DagrSession, BlockedError

PHASES = ["session", "capabilities", "geometry", "attributes", "assemble", "validate", "publish"]

EXIT_OK, EXIT_ERROR, EXIT_REJECTED, EXIT_BLOCKED, EXIT_LOCKED = 0, 1, 2, 3, 4


class Interrupted(Exception):
    """Sauberer Abbruch per SIGTERM/SIGINT (z. B. docker stop)."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _write_json(path: Path, obj):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def _hash(obj) -> str:
    return hashlib.sha1(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


# ====================================================================== Lock
class Lock:
    def __init__(self, path: Path):
        self.path = path

    def acquire(self) -> bool:
        if self.path.exists():
            try:
                info = json.loads(self.path.read_text())
                if info.get("host") == socket.gethostname():
                    os.kill(int(info["pid"]), 0)  # lebt der Prozess noch?
                    return False
                elif time.time() - info.get("ts", 0) < 6 * 3600:
                    return False
            except (ProcessLookupError, ValueError, KeyError, json.JSONDecodeError):
                pass  # verwaister Lock
            except PermissionError:
                return False
        self.path.write_text(json.dumps({"pid": os.getpid(), "host": socket.gethostname(), "ts": time.time()}))
        return True

    def release(self):
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass


# ====================================================================== Job
class Job:
    def __init__(self, cfg, fresh: bool = False):
        self.cfg = cfg
        self.data = cfg.data_dir
        self.runs = self.data / "runs"
        self.runs.mkdir(parents=True, exist_ok=True)
        (self.data / "latest").mkdir(exist_ok=True)
        self.fresh = fresh
        self.run_dir: Path | None = None
        self.run: dict = {}
        self.session: DagrSession | None = None
        self._progress = {}
        self._stop = False

    def _on_signal(self, signum, _frame):
        self._stop = True
        print(json.dumps({"event": "stop_requested", "signal": signum}), flush=True)

    def check_stop(self):
        if self._stop:
            raise Interrupted()

    # -------------------------------------------------------------- Protokoll
    def log(self, phase, event, **kw):
        rec = {"ts": now_iso(), "phase": phase, "event": event, **kw}
        line = json.dumps(rec, ensure_ascii=False)
        print(line, flush=True)
        if self.run_dir:
            with open(self.run_dir / "events.jsonl", "a", encoding="utf-8") as f:
                f.write(line + "\n")

    def _save_run(self):
        _write_json(self.run_dir / "run.json", self.run)
        self._write_status()

    def _write_status(self, **extra):
        st = {
            "updated": now_iso(),
            "run_id": self.run.get("run_id"),
            "state": self.run.get("state"),
            "phase": self.run.get("current_phase"),
            "progress": self._progress,
            "window": self.run.get("window"),
            "error": self.run.get("error"),
            "failed_phase": self.run.get("failed_phase") if self.run.get("error") else None,
            "latest": self._latest_info(),
            **extra,
        }
        _write_json(self.data / "status.json", st)

    def _latest_info(self):
        p = self.data / "latest" / "report.json"
        if p.exists():
            try:
                r = json.loads(p.read_text())
                return {"run_id": r.get("run_id"), "published": r.get("published"),
                        "zones": r.get("counts", {}).get("zones"), "airspaces": r.get("counts", {}).get("airspaces")}
            except json.JSONDecodeError:
                return None
        return None

    # -------------------------------------------------------------- Lauf finden/anlegen
    def _open_run(self):
        if not self.fresh:
            for d in sorted(self.runs.iterdir(), reverse=True):
                rj = d / "run.json"
                if rj.exists():
                    r = json.loads(rj.read_text())
                    if r.get("state") in ("running", "failed", "interrupted", "blocked"):
                        self.run_dir, self.run = d, r
                        self.run["resumed"] = self.run.get("resumed", 0) + 1
                        self.run["state"] = "running"
                        self.run.pop("error", None)
                        self.run.pop("failed_phase", None)
                        self.log("job", "resume", run_id=r["run_id"], done_phases=[
                            p for p, v in r["phases"].items() if v.get("status") == "done"])
                        return
                    break  # nur den jüngsten Lauf fortsetzen
        run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
        self.run_dir = self.runs / run_id
        self.run_dir.mkdir()
        wf, wt = self.cfg.window()
        self.run = {"run_id": run_id, "started": now_iso(), "state": "running", "resumed": 0,
                    "window": {"from": wf, "to": wt}, "config": self.cfg.public(),
                    "phases": {p: {"status": "pending"} for p in PHASES}}
        self.log("job", "start", run_id=run_id, window=self.run["window"])

    # -------------------------------------------------------------- Hauptablauf
    def execute(self) -> int:
        lock = Lock(self.data / "job.lock")
        if not lock.acquire():
            print(json.dumps({"event": "locked", "msg": "Es läuft bereits ein Abruf."}), flush=True)
            return EXIT_LOCKED
        code = EXIT_ERROR
        old_handlers = {s: signal.signal(s, self._on_signal) for s in (signal.SIGTERM, signal.SIGINT)}
        try:
            self._open_run()
            self._save_run()
            for phase in PHASES:
                ph = self.run["phases"][phase]
                if ph.get("status") == "done":
                    continue
                self.check_stop()
                self.run["current_phase"] = phase
                ph.update(status="running", started=now_iso())
                self._save_run()
                t0 = time.time()
                info = getattr(self, f"phase_{phase}")() or {}
                ph.update(status="done", ended=now_iso(), seconds=round(time.time() - t0, 1), **info)
                self.log(phase, "done", **info)
                self._save_run()
            verdict = self.run["phases"]["validate"].get("verdict")
            self.run["state"] = "published" if verdict == "ok" else "rejected"
            code = EXIT_OK if verdict == "ok" else EXIT_REJECTED
        except BlockedError as e:
            self._fail("blocked", str(e))
            code = EXIT_BLOCKED
        except (Interrupted, KeyboardInterrupt):
            self._fail("interrupted", "abgebrochen – wird beim nächsten Start fortgesetzt")
            code = EXIT_ERROR
        except Exception as e:  # noqa: BLE001
            self._fail("failed", f"{type(e).__name__}: {e}", tb=traceback.format_exc())
            code = EXIT_ERROR
        finally:
            if self.session:
                self.session.close()
            if self.run_dir:
                self.run["ended"] = now_iso()
                self.run["current_phase"] = None
                self._save_run()
                self.log("job", "end", state=self.run.get("state"), exit_code=code)
            self._cleanup_old_runs()
            lock.release()
            for s, h in old_handlers.items():
                signal.signal(s, h)
        return code

    def _fail(self, state, msg, tb=None):
        self.run["state"] = state
        self.run["error"] = msg
        ph = self.run.get("current_phase")
        self.run["failed_phase"] = ph
        if ph:
            self.run["phases"][ph]["status"] = "failed"
        self.log(ph or "job", "error", state=state, error=msg, **({"traceback": tb} if tb else {}))

    def _ensure_session(self):
        if self.session is None:
            self.session = DagrSession(self.cfg, self.log)
            self.session.open()
        return self.session

    def _wms_base(self, **kw):
        wf, wt = self.run["window"]["from"], self.run["window"]["to"]
        return {"SERVICE": "WMS", "VERSION": "1.3.0", "STYLES": "", "CRS": "EPSG:3857",
                "WMS_DATE_FROM": wf, "WMS_DATE_TO": wt, **kw}

    # ================================================================ Phasen
    def phase_session(self):
        s = self._ensure_session()
        return {"wms_url": s.wms_url}

    def phase_capabilities(self):
        s = self._ensure_session()
        text = s.wms({"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetCapabilities"})
        layers = set(parse.capabilities_layers(text))
        wanted = self.cfg.zone_layers + self.cfg.airspace_layers
        missing = [l for l in wanted if l not in layers]
        if "all_limitation_layer" not in layers:
            raise RuntimeError("GetCapabilities enthält all_limitation_layer nicht – Dienst geändert?")
        if missing:
            self.log("capabilities", "warning", missing_layers=missing)
        return {"layers_available": len(layers), "missing_layers": missing}

    def phase_geometry(self):
        s = self._ensure_session()
        feats, per_layer = [], {}
        missing = set(self.run["phases"]["capabilities"].get("missing_layers", []))
        for kind, layers in (("zone", self.cfg.zone_layers), ("airspace", self.cfg.airspace_layers)):
            for layer in layers:
                if layer in missing:
                    continue
                kml = s.wms(self._wms_base(REQUEST="GetMap", LAYERS=layer, BBOX=self.cfg.extent_3857,
                                           WIDTH="2000", HEIGHT="2000",
                                           FORMAT="application/vnd.google-earth.kml+xml"))
                items = parse.parse_kml(kml)
                per_layer[layer] = len(items)
                self.log("geometry", "layer", layer=layer, features=len(items))
                for it in items:
                    probe = it.pop("probe_polygon")
                    it.pop("open_lines", None)
                    f = {"idx": len(feats), "kind": kind, "layer": layer, **it,
                         "bbox_3857": parse.bbox_3857(it["outer_rings"])}
                    if kind == "zone" and probe:
                        f["probe"] = parse.interior_point(probe)
                    f.pop("outer_rings")
                    feats.append(f)
        _write_json(self.run_dir / "geometry.json", feats)
        return {"per_layer": per_layer, "features": len(feats)}

    def phase_attributes(self):
        feats = json.loads((self.run_dir / "geometry.json").read_text())
        todo = [f for f in feats if f["kind"] == "zone"]
        ckpt = self.run_dir / "attributes.jsonl"
        done = {}
        if ckpt.exists():
            for line in ckpt.read_text().splitlines():
                if line.strip():
                    r = json.loads(line)
                    done[r["idx"]] = r
        if done:
            self.log("attributes", "checkpoint_loaded", done=len(done), total=len(todo))
        cache: dict[str, tuple] = {}
        t0, n_new = time.time(), 0
        with open(ckpt, "a", encoding="utf-8") as out:
            for i, f in enumerate(todo, 1):
                if f["idx"] in done:
                    continue
                self.check_stop()
                s = self._ensure_session()
                x, y = parse.to_3857(*f["probe"])
                key = f"{f['layer']}|{x:.1f}|{y:.1f}"
                if key not in cache:
                    d = 10
                    q = self._wms_base(REQUEST="GetFeatureInfo", LAYERS=f["layer"], QUERY_LAYERS=f["layer"],
                                       FORMAT="image/png", BBOX=f"{x-d},{y-d},{x+d},{y+d}", WIDTH="21",
                                       HEIGHT="21", I="10", J="10", FEATURE_COUNT="100")
                    boxes = parse.parse_gfi_gml(s.wms({**q, "INFO_FORMAT": "application/vnd.ogc.gml"}))
                    recs = parse.parse_gfi_html(s.wms({**q, "INFO_FORMAT": "text/html"}))
                    cache[key] = (boxes, recs)
                boxes, recs = cache[key]
                res = {"idx": f["idx"], "hits": len(boxes)}
                if boxes and len(boxes) == len(recs):
                    dists = [parse.bbox_distance(b, f["bbox_3857"]) for b in boxes]
                    j = min(range(len(dists)), key=dists.__getitem__)
                    res.update(record=recs[j], bbox_diff_m=round(dists[j], 1),
                               match="bbox" if dists[j] < 50 else "bbox_approx")
                elif len(recs) == 1:
                    res.update(record=recs[0], match="single")
                else:
                    res.update(match="unmatched", candidates=[r["cells"][:2] for r in recs])
                out.write(json.dumps(res, ensure_ascii=False) + "\n")
                out.flush()
                done[f["idx"]] = res
                n_new += 1
                rate = n_new / max(1e-6, time.time() - t0)
                left = len(todo) - len(done)
                self._progress = {"done": len(done), "total": len(todo),
                                  "eta_s": round(left / rate) if rate else None}
                if n_new % 5 == 0 or i == len(todo):
                    self._write_status()
                if n_new % 50 == 0:
                    self.log("attributes", "progress", **self._progress)
        stats = {}
        for r in done.values():
            stats[r["match"]] = stats.get(r["match"], 0) + 1
        self._progress = {"done": len(done), "total": len(todo)}
        return {"match_stats": stats, "requests": self.session.requests if self.session else 0}

    def phase_assemble(self):
        feats = json.loads((self.run_dir / "geometry.json").read_text())
        attrs = {}
        p = self.run_dir / "attributes.jsonl"
        if p.exists():
            for line in p.read_text().splitlines():
                if line.strip():
                    r = json.loads(line)
                    attrs[r["idx"]] = r
        out, seen = [], {}
        for f in feats:
            props = {"source": "DAGR (HASP/HCAA)", "layer": f["layer"], "category": f["kind"]}
            if f["kind"] == "zone":
                a = attrs.get(f["idx"], {"match": "missing"})
                if "record" in a:
                    props.update(parse.record_to_properties(a["record"]))
                props["match"] = a["match"]
                base_id = props.get("reg_no") or f"{f['layer']}_{f['idx']}"
            else:
                t = f["layer"].replace("hellas_", "").upper()
                props["airspace_type"] = t
                base_id = f"airspace_{t}_{_hash(f['geometry'])[:8]}"
            seen[base_id] = seen.get(base_id, 0) + 1
            fid = base_id if seen[base_id] == 1 else f"{base_id}_{seen[base_id]}"
            if seen[base_id] > 1:
                props["part"] = seen[base_id]
            props["geometry_hash"] = _hash(f["geometry"])
            out.append({"type": "Feature", "id": fid, "properties": props, "geometry": f["geometry"]})
        fc = {"type": "FeatureCollection", "name": "GR_DAGR_UAS_Geozones",
              "metadata": {"run_id": self.run["run_id"], "generated": now_iso(),
                           "source_page": self.cfg.page_url, "wms_window": self.run["window"],
                           "crs": "EPSG:4326",
                           "license_note": "Nutzung im Rahmen der HASP/HCAA-Freigabe; Webseite CC BY-NC-ND 4.0"},
              "features": out}
        _write_json(self.run_dir / "result.geojson", fc)
        zones = sum(1 for f in out if f["properties"]["category"] == "zone")
        return {"features": len(out), "zones": zones, "airspaces": len(out) - zones}

    def phase_validate(self):
        fc = json.loads((self.run_dir / "result.geojson").read_text())
        zones = [f for f in fc["features"] if f["properties"]["category"] == "zone"]
        airs = [f for f in fc["features"] if f["properties"]["category"] == "airspace"]
        good = sum(1 for f in zones if f["properties"].get("match") in ("bbox", "single"))
        match_rate = good / len(zones) if zones else 0.0

        prev_path = self.data / "latest" / "greece.geojson"
        diff = None
        problems = []
        if prev_path.exists():
            prev = json.loads(prev_path.read_text())
            diff = self._diff(prev, fc)
            prev_zones = sum(1 for f in prev["features"] if f["properties"]["category"] == "zone")
            if prev_zones and (prev_zones - len(zones)) / prev_zones > self.cfg.max_drop_rate:
                problems.append(f"Zonenanzahl fällt von {prev_zones} auf {len(zones)} "
                                f"(> {self.cfg.max_drop_rate:.0%})")
        if len(zones) < self.cfg.min_zone_count:
            problems.append(f"nur {len(zones)} Zonen (< {self.cfg.min_zone_count})")
        if match_rate < self.cfg.min_match_rate:
            problems.append(f"Attribut-Zuordnung {match_rate:.1%} (< {self.cfg.min_match_rate:.0%})")

        report = {"run_id": self.run["run_id"], "window": self.run["window"],
                  "counts": {"zones": len(zones), "airspaces": len(airs),
                             "per_layer": self.run["phases"]["geometry"].get("per_layer")},
                  "match_rate": round(match_rate, 4),
                  "match_stats": self.run["phases"]["attributes"].get("match_stats"),
                  "unmatched": [f["id"] for f in zones if f["properties"].get("match") not in ("bbox", "single")],
                  "diff_to_latest": diff, "problems": problems,
                  "verdict": "ok" if not problems else "rejected", "published": None}
        _write_json(self.run_dir / "report.json", report)
        if problems:
            self.log("validate", "rejected", problems=problems)
        return {"verdict": report["verdict"], "match_rate": report["match_rate"], "problems": problems,
                "diff": {k: len(v) for k, v in (diff or {}).items()} if diff else None}

    def phase_publish(self):
        if self.run["phases"]["validate"].get("verdict") != "ok":
            return {"published": False, "reason": "Qualitätsprüfung nicht bestanden – latest unverändert"}
        latest = self.data / "latest"
        rep = json.loads((self.run_dir / "report.json").read_text())
        rep["published"] = now_iso()
        _write_json(self.run_dir / "report.json", rep)
        tmp = latest / "greece.geojson.tmp"
        shutil.copyfile(self.run_dir / "result.geojson", tmp)
        os.replace(tmp, latest / "greece.geojson")
        _write_json(latest / "report.json", rep)
        return {"published": True, "path": str(latest / "greece.geojson")}

    # -------------------------------------------------------------- Hilfen
    @staticmethod
    def _diff(prev, cur):
        def index(fc):
            return {f["id"]: f for f in fc["features"] if f["properties"]["category"] == "zone"}
        a, b = index(prev), index(cur)
        changed = []
        skip = {"match", "geometry_hash"}
        for k in a.keys() & b.keys():
            pa = {x: y for x, y in a[k]["properties"].items() if x not in skip}
            pb = {x: y for x, y in b[k]["properties"].items() if x not in skip}
            what = []
            if pa != pb:
                what.append("attribute")
            if a[k]["properties"].get("geometry_hash") != b[k]["properties"].get("geometry_hash"):
                what.append("geometrie")
            if what:
                changed.append({"id": k, "changed": what})
        return {"added": sorted(b.keys() - a.keys()), "removed": sorted(a.keys() - b.keys()),
                "changed": sorted(changed, key=lambda x: x["id"])}

    def _cleanup_old_runs(self):
        runs = sorted([d for d in self.runs.iterdir() if d.is_dir()])
        for d in runs[:-self.cfg.keep_runs] if len(runs) > self.cfg.keep_runs else []:
            shutil.rmtree(d, ignore_errors=True)
