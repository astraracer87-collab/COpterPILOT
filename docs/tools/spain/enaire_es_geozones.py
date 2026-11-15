#!/usr/bin/env python3
"""ENAIRE-Geozonen (Spanien) als GeoJSON exportieren – eine Datei pro Layer + Gesamtdatei.
Quelle verifiziert gegen https://servais.enaire.es/insignias/rest/services (DE-Session 2026-11-15).
Benötigt: requests.
"""
import json, time, pathlib, requests

BASE = "https://servais.enaire.es/insignias/rest/services/"
LAYERS = {
    "eac_fiz":          ("NSF/Drones_ZG_Aero_V3/MapServer/1", 2000),
    "aerodromos_zg":    ("NSF/Drones_ZG_Aero_V3/MapServer/6", 2000),
    "restringidas":     ("NSF/Drones_ZG_Aero_V3/MapServer/10", 2000),
    "rvf_foto":         ("NSF/Drones_ZG_Aero_V3/MapServer/3", 2000),
    "avisos":           ("NSF/Drones_ZG_Aero_V3/MapServer/2", 2000),
    "infraestructuras": ("NSF/Drones_ZG_Infra_V0/MapServer/11", 4000),
    "urbano":           ("NSF/Drones_ZG_Urbano_V0/MapServer/11", 2000),
    "notam":            ("NOTAM/NOTAM_UAS_APP_V3/MapServer/1", 3000),
    "enp":              ("ENP/ENP_APP_Local_V4/MapServer/0", 2000),
    "zepa":             ("ENP/ENP_APP_Local_V4/MapServer/1", 2000),
    "aerodromos_pt":    ("NSF/Drones_ZG_Aero_V3/MapServer/0", 2000),
    "aeromodelismo":    ("NSF/Drones_ZG_Aero_V3/MapServer/4", 2000),
}

s = requests.Session()
s.headers["User-Agent"] = "GeozonenImport/1.0 (Kontakt eintragen)"

def fetch_layer(path, page):
    feats, offset = [], 0
    while True:
        r = s.get(BASE + path + "/query", params={
            "where": "1=1", "outFields": "*", "returnGeometry": "true",
            "outSR": 4326, "orderByFields": "OBJECTID",
            "resultOffset": offset, "resultRecordCount": page, "f": "geojson",
        }, timeout=120)
        r.raise_for_status()
        fc = r.json()
        if "error" in fc:
            raise RuntimeError(fc["error"])
        batch = fc.get("features", [])
        feats += batch
        more = fc.get("exceededTransferLimit") or fc.get("properties", {}).get("exceededTransferLimit")
        if not batch or not more:
            return feats
        offset += len(batch)
        time.sleep(0.3)  # Server schonen

out = pathlib.Path("enaire_geojson"); out.mkdir(exist_ok=True)
alle = []
for key, (path, page) in LAYERS.items():
    feats = fetch_layer(path, page)
    for f in feats:
        f["properties"]["_layer"] = key
        f["properties"]["_source"] = "ENAIRE " + path
    (out / f"{key}.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "features": feats}, ensure_ascii=False))
    alle += feats
    print(f"{key:18s} {len(feats):6d}")
(out / "enaire_alle.geojson").write_text(json.dumps(
    {"type": "FeatureCollection", "features": alle}, ensure_ascii=False))
