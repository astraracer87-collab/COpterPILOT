#!/usr/bin/env python3
"""
PANSA DroneMap (Polen) -> GeoJSON-Export für Drohnen-Geozonen.

Nutzt dieselben Endpunkte wie https://dronemap.pansa.pl (Stand Nov 2026):
  1. POST /v1/front/login           (Header x-api-key)  -> Bearer-Token (1 h gültig)
  2. GET  /v1/zones                 -> alle Geozonen inkl. GeoJSON-Polygon
  3. GET  /v1/zones/types           -> Zonentypen + Beschreibung (DRA-P / DRA-R / DRA-I)
  4. GET  /v1/activ/timeslices      -> Aktivierungszeiträume (AIXM)
  5. GET  /v1/activ/activations     -> Tages-Aktivierungen aus AUP/UUP (EUROCONTROL)
  6. GET  /v1/notams                -> NOTAMs (u. a. Zonen-Aktivierungen)

Ausgabe: GeoJSON FeatureCollection (RFC 7946, WGS84, [lon, lat]).

Aufruf:
    python3 pansa_geozones.py -o pansa_geozones.geojson
    python3 pansa_geozones.py --from-dir dump/ -o pansa.geojson   # offline aus gespeicherten JSONs
    python3 pansa_geozones.py --dump-dir dump/                     # nur Rohdaten sichern
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

BASE_URL = "https://api.dronemap.pansa.pl"
# Öffentlicher API-Key aus dem Frontend-Bundle (main.*.js, Klasse mit apiKeyHeaders()).
# Kann sich bei einem Frontend-Update ändern -> siehe Doku, Abschnitt "Wenn es bricht".
API_KEY = os.environ.get("PANSA_API_KEY", "4b705300-8dfa-11ee-b9d1-0242ac120002")
TIMEOUT = 60
UA = "GeozoneImporter/1.0 (+contact: your-company)"

ENDPOINTS = {
    "zones": "/v1/zones",
    "types": "/v1/zones/types",
    "timeslices": "/v1/activ/timeslices",
    "activations": "/v1/activ/activations",
    "notams": "/v1/notams",
}

# Darstellungs-Vorschlag je Kategorie
CATEGORY_STYLE = {
    "DRA-P": {"fill": "#d32f2f", "label": "Verbot (nur Berechtigte)"},
    "DRA-R": {"fill": "#f9a825", "label": "Beschränkt (Zustimmung/Bedingungen)"},
    "DRA-I": {"fill": "#1976d2", "label": "Information / Vorsicht"},
    None: {"fill": "#9e9e9e", "label": "Unbekannt"},
}


# --------------------------------------------------------------------------- HTTP
def _request(method: str, path: str, headers: dict, params: dict | None = None):
    url = BASE_URL + path
    if params:
        from urllib.parse import urlencode
        url += "?" + urlencode(params)
    req = urllib.request.Request(url, method=method, headers={"User-Agent": UA, **headers})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


def login() -> str:
    data = _request("POST", "/v1/front/login", {
        "x-api-key": API_KEY,
        "Accept": "application/json",
        "Content-Type": "application/json",
    })
    tok = data.get("access_token")
    if not tok:
        raise RuntimeError(f"Login ohne access_token: {list(data)}")
    return tok


def fetch_all() -> dict:
    tok = login()
    h = {
        "x-api-key": API_KEY,
        "Authorization": f"Bearer {tok}",
        "Accept": "application/json",
        "Cache-Control": "no-cache",
    }
    return {k: _request("GET", p, h) for k, p in ENDPOINTS.items()}


def load_dir(d: str) -> dict:
    out = {}
    for k in ENDPOINTS:
        with open(os.path.join(d, f"{k}.json"), encoding="utf-8") as f:
            out[k] = json.load(f)
    return out


# --------------------------------------------------------------------------- Logik
def _props(resp):
    """Die API verpackt alles als {"properties": [...], "status": 200}."""
    if isinstance(resp, dict) and "properties" in resp:
        return resp["properties"] or []
    return resp or []


def category_map(types: list) -> dict:
    """Zonentyp (z. B. 'CTR1KM') -> 'DRA-P' | 'DRA-R' | 'DRA-I' aus der Typbeschreibung."""
    m = {}
    for t in types:
        en = ((t.get("description") or {}).get("en") or "").upper()
        cat = None
        for c in ("DRA-P", "DRA-R", "DRA-I"):
            if en.startswith(c) or en[:20].find(c) >= 0:
                cat = c
                break
        m[t["name"]] = cat
    # Fallbacks für Typen, deren Name die Kategorie schon trägt
    m.setdefault("DRAP", "DRA-P")
    m.setdefault("DRAR", "DRA-R")
    m.setdefault("DRAI", "DRA-I")
    return m


def _parse_dt(s):
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def build_geojson(raw: dict, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    zones = _props(raw["zones"])
    cats = category_map(_props(raw["types"]))

    # Aktivierungen nach Zonenname (= designator) gruppieren
    windows: dict[str, list] = {}
    for ts in _props(raw["timeslices"]):
        windows.setdefault(ts["designator"], []).append(
            {"start": ts["start"], "stop": ts["stop"], "min_ft": ts.get("min"),
             "max_ft": ts.get("max"), "source": "TIMESLICE"})
    for a in _props(raw["activations"]):
        windows.setdefault(a["designator"], []).append(
            {"start": a["start"], "stop": a["stop"], "min_ft": a.get("min"),
             "max_ft": a.get("max"), "source": (a.get("etc") or {}).get("upType", "AUP")})
    for n in _props(raw["notams"]):
        if not n.get("zonename") or not n.get("active"):
            continue
        for na in n.get("notamActivations") or []:
            windows.setdefault(n["zonename"], []).append(
                {"start": na.get("start"), "stop": na.get("stop"), "source": "NOTAM",
                 "notam": n.get("series")})

    feats = []
    for z in zones:
        geom = z.get("geojson")
        if not geom or not geom.get("coordinates"):
            continue
        etc = z.get("etc") or {}
        acts = z.get("acts") or {}
        w = windows.get(z["name"], [])
        h24 = bool(acts.get("H24"))
        active_now = h24 or any(
            (_parse_dt(x["start"]) or now) <= now <= (_parse_dt(x["stop"]) or now) for x in w)
        # Zonen mit eigener Gültigkeit (start/stop) außerhalb des Zeitraums ausblenden lassen
        zs, ze = _parse_dt(z.get("start")), _parse_dt(z.get("stop"))
        valid_now = (zs is None or zs <= now) and (ze is None or now <= ze)

        cat = cats.get(z["type"])
        if cat is None and z["type"].startswith("M"):   # z. B. MTMA (militär. TMA) -> wie TMA
            cat = cats.get(z["type"][1:])
        desc = z.get("description") or {}
        prim = etc.get("primitive") or {}
        feats.append({
            "type": "Feature",
            "id": z["uid"],
            "geometry": geom,  # bereits RFC-7946-Polygon, [lon, lat], Ring geschlossen
            "properties": {
                "uid": z["uid"],
                "name": z["name"],
                "othername": z.get("othername"),
                "country": z.get("country") or "PL",
                "type": z["type"],
                "category": cat,  # DRA-P / DRA-R / DRA-I
                "lower_ft_amsl": z.get("min"),
                "upper_ft_amsl": z.get("max"),
                "source": (z.get("source") or "").strip() or None,
                "contact": z.get("contact"),
                "description_en": desc.get("en"),
                "description_pl": desc.get("pl"),
                "valid_from": z.get("start"),
                "valid_to": z.get("stop"),
                "valid_now": valid_now,
                "h24": h24,
                "activations": w,
                "active_now": active_now,
                "shape": prim.get("type", "POLYGON"),
                "circle_center": prim.get("centre"),
                "circle_radius_m": prim.get("radius"),
                "rpa_status": etc.get("status"),        # RED/YELLOW/BLUE/GREEN bei RPA
                "rpa_color": etc.get("custom_color"),
                "parent": etc.get("master"),            # z. B. 'CTR EPKK'
                "modified": z.get("modified"),
                "fill": etc.get("custom_color") or CATEGORY_STYLE[cat]["fill"],
            },
        })
    return {
        "type": "FeatureCollection",
        "name": "PANSA DroneMap geozones (PL)",
        "generated": now.isoformat(),
        "source": BASE_URL,
        "features": feats,
    }


# --------------------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default="pansa_geozones.geojson")
    ap.add_argument("--from-dir", help="Rohdaten aus Verzeichnis lesen statt API")
    ap.add_argument("--dump-dir", help="Rohdaten zusätzlich hier ablegen")
    a = ap.parse_args()

    raw = load_dir(a.from_dir) if a.from_dir else fetch_all()
    if a.dump_dir:
        os.makedirs(a.dump_dir, exist_ok=True)
        for k, v in raw.items():
            with open(os.path.join(a.dump_dir, f"{k}.json"), "w", encoding="utf-8") as f:
                json.dump(v, f, ensure_ascii=False)
    fc = build_geojson(raw)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)
    print(f"{len(fc['features'])} Zonen -> {a.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
