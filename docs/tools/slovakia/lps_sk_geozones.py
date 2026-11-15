#!/usr/bin/env python3
"""LPS SR (Slowakei) Geozonen -> GeoJSON. Quelle: VFR Manual, LPS SR, š. p.

Erzeugt sk_zones.geojson (statisch, normalisierte Höhen in Metern) und
sk_activations.geojson (live). Nur Python-Standardbibliothek.
Quelle verifiziert gegen https://gis.lps.sk/server/rest/services (DE-Session 2026-11-15).
"""
import json, urllib.parse, urllib.request, datetime

BASE = "https://gis.lps.sk/server/rest/services"
ZONES = f"{BASE}/VFRM/VFRM_popup/MapServer/5/query"
RESV  = f"{BASE}/Hosted/Reservation_(Public)2/FeatureServer/0/query"
STAT  = f"{BASE}/Hosted/Status_(Public)/FeatureServer/0/query"
UA = {"User-Agent": "DeineApp-Geozonen/1.0 (Kontakt: deine@mail)"}

def get(url, **params):
    q = urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(f"{url}?{q}", headers=UA), timeout=60) as r:
        data = json.load(r)
    if "error" in data:
        raise RuntimeError(data["error"])
    return data

def fetch_geojson(url, where="1=1", batch=500):
    """Holt robust in Blöcken über die ObjectIDs (unabhängig von maxRecordCount)."""
    ids = sorted(get(url, where=where, returnIdsOnly="true", f="json").get("objectIds") or [])
    feats = []
    for i in range(0, len(ids), batch):
        chunk = ",".join(map(str, ids[i:i+batch]))
        fc = get(url, objectIds=chunk, outFields="*", returnGeometry="true",
                 outSR=4326, geometryPrecision=6, f="geojson")
        feats += fc["features"]
    return feats

def strip_z(geom):
    def s(c):
        return [s(x) for x in c] if isinstance(c[0], list) else c[:2]
    geom["coordinates"] = s(geom["coordinates"])
    return geom

FT = 0.3048
def to_m(val, uom, ref):
    """Gibt (Meter, Bezug) zurück. ref: SFC/AGL, MSL/AMSL, STD (=FL)."""
    if val is None:
        return None, ref
    uom = (uom or "").upper()
    if uom == "FL":
        return round(val * 100 * FT), "STD"
    if uom == "M":
        return round(val), ref
    return round(val * FT), ref  # FT

DRONE_RELEVANT = {"CTR", "P", "R", "D", "D-OTHER", "PROTECT"}
DRONE_LOCAL = {"ATZ", "RMZ"}

def zones():
    out = []
    for f in fetch_geojson(ZONES):
        p = f["properties"]
        lo_m, lo_ref = to_m(p.get("DISTVERTLOWER_VAL"), p.get("DISTVERTLOWER_UOM"), p.get("DISTVERTLOWER_CODE"))
        up_m, up_ref = to_m(p.get("DISTVERTUPPER_VAL"), p.get("DISTVERTUPPER_UOM"), p.get("DISTVERTUPPER_CODE"))
        t, lt = p.get("TYPE_CODE"), p.get("LOCALTYPE_TXT")
        out.append({
            "type": "Feature",
            "id": p.get("GFID") or p.get("OBJECTID"),
            "geometry": strip_z(f["geometry"]),
            "properties": {
                "country": "SK",
                "ident": p.get("IDENT_TXT"),
                "name": p.get("NAME_TXT"),
                "type": t, "localType": lt, "class": p.get("CLASS_CODE"),
                "lower": {"value": p.get("DISTVERTLOWER_VAL"), "uom": p.get("DISTVERTLOWER_UOM"),
                          "ref": p.get("DISTVERTLOWER_CODE"), "m": lo_m},
                "upper": {"value": p.get("DISTVERTUPPER_VAL"), "uom": p.get("DISTVERTUPPER_UOM"),
                          "ref": p.get("DISTVERTUPPER_CODE"), "m": up_m},
                "workHours": p.get("WORKHR_CODE"), "workHoursRemark": p.get("WORKHRRMK_TXT"),
                "remarks": p.get("REMARKS_TXT"),
                "lastModified": p.get("LASTMOD_DATE"),
                "droneRelevant": (t in DRONE_RELEVANT or lt in DRONE_LOCAL)
                                 and (p.get("DISTVERTLOWER_CODE") == "SFC"),
                "source": "VFR Manual, LPS SR, š. p.",
            },
        })
    return out

RESV_WHERE = ("(lower_fl <> 'FL' OR lower_val <= 195) "
              "AND (localtype_txt IS NULL OR localtype_txt <> 'NPZ') "
              "AND status IN ('ACTIVE','APPROVED','ALLOCATED','REFERENCE_ALLOCATED','PENDING')")

def activations():
    feats = fetch_geojson(RESV, RESV_WHERE)
    for f in feats:
        strip_z(f["geometry"])
        p = f["properties"]
        for k in ("startdate", "enddate", "lastupdate"):
            if p.get(k):
                p[k + "_iso"] = datetime.datetime.fromtimestamp(p[k] / 1000, datetime.timezone.utc).isoformat()
    return feats

def feed_stale():
    w = ("(latestupdate NOT BETWEEN CURRENT_TIMESTAMP - INTERVAL '3' MINUTE AND CURRENT_TIMESTAMP) "
         "OR (statussource = 'NAM' AND statusnam <> 'success') "
         "OR (statussource = 'AMA' AND statusama <> 'success')")
    return bool(get(STAT, where=w, returnIdsOnly="true", f="json").get("objectIds"))

if __name__ == "__main__":
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    z = zones()
    json.dump({"type": "FeatureCollection", "generated": now, "features": z},
              open("sk_zones.geojson", "w", encoding="utf-8"), ensure_ascii=False)
    a = activations()
    json.dump({"type": "FeatureCollection", "generated": now, "feedStale": feed_stale(), "features": a},
              open("sk_activations.geojson", "w", encoding="utf-8"), ensure_ascii=False)
    print(f"{len(z)} Zonen ({sum(f['properties']['droneRelevant'] for f in z)} drohnenrelevant), "
          f"{len(a)} Aktivierungen")
