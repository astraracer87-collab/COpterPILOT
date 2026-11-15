#!/usr/bin/env python3
"""ROMATSA (Rumänien) UAS-Zonen + NOTAM-Zonen -> normalisiertes GeoJSON.
Quelle verifiziert gegen https://flightplan.romatsa.ro (DE-Session 2026-11-15).
Benötigt: requests.
"""
import json, hashlib, re, datetime as dt
import requests

BASE = "https://flightplan.romatsa.ro/init/geoserver/ows"
COMMON = {"service": "WFS", "version": "1.0.0", "request": "GetFeature",
          "outputFormat": "application/json"}
HEADERS = {"User-Agent": "DeineApp-GeozoneSync/1.0 (kontakt@deine-domain.de)"}

FT = 0.3048

def parse_limit(s: str):
    """-> (wert_in_m | None, bezug) mit bezug in AGL, AMSL, STD(FL), GND, NOTAM, UNKNOWN"""
    t = (s or "").upper().replace(" ", "")
    if t in ("GND", "SFC", "0MAGL"):
        return 0.0, "AGL"
    if t.startswith("BYNOTAM"):
        return None, "NOTAM"
    m = re.match(r"FL(\d+)", t)
    if m:
        return int(m.group(1)) * 100 * FT, "STD"
    m = re.match(r"(\d+(?:\.\d+)?)(M|FT)(AGL|AMSL|MSL|STD|QNH)?", t)
    if m:
        v = float(m.group(1)) * (FT if m.group(2) == "FT" else 1)
        ref = m.group(3) or "AMSL"            # z. B. "6500ft" ohne Bezug -> AMSL annehmen
        ref = {"MSL": "AMSL", "QNH": "AMSL"}.get(ref, ref)
        return round(v, 1), ref
    return None, "UNKNOWN"

def wfs(type_name, **extra):
    r = requests.get(BASE, params={**COMMON, "typeName": type_name, **extra},
                     headers=HEADERS, timeout=60)
    r.raise_for_status()
    return r.json()

def main():
    now = dt.datetime.now(dt.timezone.utc)
    out = []

    static = wfs("carto:zone_restrictionate_uav")
    for f in static["features"]:
        p = f["properties"]
        lo, lo_ref = parse_limit(p["lower_lim"])
        up, up_ref = parse_limit(p["upper_lim"])
        out.append({"type": "Feature", "geometry": f["geometry"], "properties": {
            "country": "RO", "source": "ROMATSA", "kind": "static",
            "id": p["zone_id"].replace(" ", ""),
            "lower_m": lo, "lower_ref": lo_ref, "upper_m": up, "upper_ref": up_ref,
            "raw_lower": p["lower_lim"], "raw_upper": p["upper_lim"],
            "restriction": p["status"],
            "contact": p["contact"],
        }})

    notam = wfs("carto:restrictii_notam_pt_uav", maxFeatures=5000)
    for f in notam["features"]:
        p = f["properties"]
        if dt.datetime.fromisoformat(p["dto"].replace("Z", "+00:00")) < now:
            continue
        out.append({"type": "Feature", "geometry": f["geometry"], "properties": {
            "country": "RO", "source": "ROMATSA", "kind": "notam",
            "id": p["serie"], "notam_type": p["tip"],
            "valid_from": p["dfrom"], "valid_to": p["dto"],
            "message": p["mesaj"].replace("\r", "\n").strip(),
        }})

    fc = {"type": "FeatureCollection", "generated": now.isoformat(), "features": out}
    data = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    with open("geozones_RO.geojson", "w", encoding="utf-8") as fh:
        fh.write(data)
    print(len(out), "Features, sha256", hashlib.sha256(data.encode()).hexdigest()[:12])

if __name__ == "__main__":
    main()
