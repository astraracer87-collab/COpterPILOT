#!/usr/bin/env python3
"""LFV Schweden -> einheitliches GeoJSON. Nutzung: python lfv_se_geozones.py [out.geojson]"""
import json, math, re, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://daim.lfv.se"
ED318 = BASE + "/echarts/dronechart/data/uas_zones_ED318.json"
WFS = BASE + "/geoserver/wfs"
UA = {"User-Agent": "DeineApp-Geozonen/1.0 (kontakt@deine-domain.de)"}

FT = 0.3048

def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)

def wfs(type_name, cql=None):
    q = {"service": "WFS", "version": "1.1.0", "request": "GetFeature",
         "typeName": type_name, "outputFormat": "json"}
    if cql:
        q["CQL_FILTER"] = cql
    return get_json(WFS + "?" + urllib.parse.urlencode(q))["features"]

def txt(arr, lang="en-GB"):
    """ED-318 Mehrsprachfeld -> String (bevorzugte Sprache, sonst erster)."""
    if not arr:
        return None
    for t in arr:
        if t.get("lang") == lang:
            return t.get("text")
    return arr[0].get("text")

def circle(lon, lat, radius_m, n=64):
    """Geodätischer Kreis als Polygon (ausreichend genau für < 50 km)."""
    R = 6371008.8
    d = radius_m / R
    la1, lo1 = math.radians(lat), math.radians(lon)
    ring = []
    for i in range(n):
        b = 2 * math.pi * i / n
        la2 = math.asin(math.sin(la1)*math.cos(d) + math.cos(la1)*math.sin(d)*math.cos(b))
        lo2 = lo1 + math.atan2(math.sin(b)*math.sin(d)*math.cos(la1),
                               math.cos(d) - math.sin(la1)*math.sin(la2))
        ring.append([round(math.degrees(lo2), 6), round(math.degrees(la2), 6)])
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}

def to_m(v, uom):
    return None if v is None else round(v * FT if uom == "ft" else v, 1)

def parse_alt(s):
    """MAIS-Freitext ('GND', 'FL 85', '1000') -> (meter, ref)."""
    if s is None:
        return None, None
    s = str(s).strip().upper()
    if s in ("GND", "SFC", "0"):
        return 0, "AGL"
    if s in ("UNL", "UNLTD"):
        return None, "UNL"
    m = re.match(r"FL\s*(\d+)", s)
    if m:
        return round(int(m.group(1)) * 100 * FT), "FL"
    m = re.match(r"(\d+)\s*(FT|M)?\s*(AGL|AMSL|MSL)?", s)
    if m:
        v = int(m.group(1)); unit = m.group(2) or "FT"
        return round(v * FT if unit == "FT" else v), (m.group(3) or "AMSL").replace("MSL", "AMSL").replace("AAMSL", "AMSL")
    return None, s

SEV_ED318 = {"PROHIBITED": "red", "REQ_AUTHORIZATION": "red",
             "REQ_RESTRICTION": "red", "CONDITIONAL": "orange"}

def from_ed318():
    data = get_json(ED318)
    out = []
    for f in data["features"]:
        g, p = f["geometry"], f["properties"]
        lay = g.get("layer", {})
        if g["type"] == "Point" and g.get("extent", {}).get("subType") == "Circle":
            geom = circle(*g["coordinates"], g["extent"]["radius"])
        else:
            geom = {"type": g["type"], "coordinates": g["coordinates"]}
        la = (p.get("limitedApplicability") or [{}])[0]
        out.append({"type": "Feature", "geometry": geom, "properties": {
            "id": "SE-" + p["identifier"], "country": "SE", "source": "LFV_ED318",
            "category": "UAS_ZONE", "severity": SEV_ED318.get(p["type"], "orange"),
            "zone_type": p["type"], "name": txt(p.get("name")),
            "name_local": txt(p.get("name"), "sv-SE"),
            "lower_m": to_m(lay.get("lower"), lay.get("uom")), "lower_ref": lay.get("lowerReference"),
            "upper_m": to_m(lay.get("upper"), lay.get("uom")), "upper_ref": lay.get("upperReference"),
            "valid_from": la.get("startDateTime"), "valid_to": la.get("endDateTime"),
            "message": txt(p.get("message")), "message_local": txt(p.get("message"), "sv-SE"),
            "reasons": p.get("reason", []), "restriction": p.get("restrictionConditions"),
            "exemption": p.get("regulationExemption"),
            "extra": (p.get("extendedProperties") or {}).get("text"),
            "authorities": [{
                "name": txt(a.get("name")), "purpose": a.get("purpose"),
                "lead_time": a.get("intervalBefore"), "email": txt(a.get("email")),
                "phone": txt(a.get("phone")), "url": txt(a.get("siteURL"))}
                for a in p.get("zoneAuthority", [])],
            "issued": data.get("metadata", {}).get("issued")}})
    return out

WFS_LAYERS = [
    # typeName, category, severity, CQL
    ("mais:RSTA", "RESTRICTED", "red", None),
    ("mais:DNGA", "DANGER", "red", None),
    ("mais:CTR", "CTR", "orange", "POSITIONINDICATOR not like 'ESGP'"),
    ("mais:TIZ", "TIZ", "orange", None),
    ("mais:ATZ", "ATZ", "orange", None),
    ("DAIM_TOPO:RWY5K", "AIRPORT_5KM", "orange", None),
    ("DAIM_TOPO:HKP1K", "HELIPORT_1KM", "orange", None),
]

def from_wfs():
    out = []
    for tn, cat, sev, cql in WFS_LAYERS:
        for f in wfs(tn, cql):
            p = f["properties"]
            lo, lo_ref = parse_alt(p.get("LOWER"))
            up, up_ref = parse_alt(p.get("UPPER"))
            name = p.get("NAMEOFAREA") or p.get("LOCATION")
            out.append({"type": "Feature", "geometry": f["geometry"], "properties": {
                "id": f"SE-{tn.split(':')[1]}-{f.get('id', name)}", "country": "SE",
                "source": "LFV_WFS:" + tn, "category": cat, "severity": sev,
                "name": name, "name_local": p.get("LOCATION"),
                "lower_m": lo, "lower_ref": lo_ref, "upper_m": up, "upper_ref": up_ref,
                "valid_from": p.get("WEF"), "valid_to": None,
                "message": p.get("COM_EN") or p.get("COMMENT_2") or p.get("COMMENT_1"),
                "icao": p.get("POSITIONINDICATOR") or p.get("POSITIONIN")}})
    # Temporäre Gebiete (SUP): aktiv jetzt bis +2 Tage
    now = datetime.now(timezone.utc)
    cql = f"TO >= '{now:%Y-%m-%dT%H:%M:%SZ}' AND FROM <= '{now + timedelta(days=2):%Y-%m-%dT%H:%M:%SZ}'"
    for f in wfs("DAIM_TOPO:SUP", cql):
        p = f["properties"]
        out.append({"type": "Feature", "geometry": f["geometry"], "properties": {
            "id": f"SE-SUP-{p.get('ID') or p.get('DESIG')}", "country": "SE",
            "source": "LFV_WFS:DAIM_TOPO:SUP", "category": "TEMP_RESTRICTED", "severity": "red",
            "name": p.get("DESIG") or p.get("NAME"), "name_local": p.get("NAME"),
            "lower_raw": f"{p.get('LOWER')} {p.get('LOW_UOM') or ''}".strip(),
            "upper_raw": f"{p.get('UPPER')} {p.get('UP_UOM') or ''}".strip(),
            "valid_from": p.get("FROM"), "valid_to": p.get("TO"), "schedule": p.get("SCHEDULE"),
            "message": p.get("COM_EN") or p.get("COM_SE"), "url": p.get("URL")}})
    # NOTAM: nur Beschränkungen/Warnungen, ohne Trigger
    for f in wfs("dynais:NOTAM", "(CODE23 ilike 'R%' OR CODE23 ilike 'W%') AND CODE45 <> 'TT'"):
        p = f["properties"]
        nid = f"{p.get('SERIES')}{p.get('NO')}/{str(p.get('YEAR'))[-2:]}"
        out.append({"type": "Feature", "geometry": f["geometry"], "properties": {
            "id": "SE-NOTAM-" + nid, "country": "SE", "source": "LFV_WFS:dynais:NOTAM",
            "category": "NOTAM", "severity": "yellow", "name": "NOTAM " + nid,
            "q_code": f"Q{p.get('CODE23')}{p.get('CODE45')}",
            "lower_fl": p.get("LOWER"), "upper_fl": p.get("UPPER"),
            "valid_from": p.get("STARTVALIDITY"), "valid_to": p.get("ENDVALIDITY"),
            "schedule": p.get("ITEM_D"), "message": p.get("ITEM_E")}})
    return out

if __name__ == "__main__":
    out_path = sys.argv[1] if len(sys.argv) > 1 else "se_geozones.geojson"
    feats = from_ed318() + from_wfs()
    fc = {"type": "FeatureCollection",
          "metadata": {"country": "SE", "provider": "LFV / Transportstyrelsen",
                       "generated": datetime.now(timezone.utc).isoformat()},
          "features": feats}
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, ensure_ascii=False)
    print(f"{len(feats)} Features -> {out_path}")
