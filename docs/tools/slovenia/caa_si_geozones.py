#!/usr/bin/env python3
"""Lädt alle UAS-Geozonen der CAA Slovenia als GeoJSON (WGS84).
Liest die Layerliste dynamisch aus der Web Map (May 2026), blättert durch alle
Seiten, hängt pro Feature source_layer/layer_title/country an.
Quelle verifiziert gegen caa-slovenia / services6.arcgis.com/1F2lR3M9nMUYDj5l (DE-Session 2026-11-15).
Nur Python-Standardbibliothek.
"""
import json, time, urllib.parse, urllib.request

WEBMAP_ID = "14c35a6c4d5a472ea2ed5b2a75abc690"   # "UAS GEO ZONES - May 2026"
SHARING = "https://www.arcgis.com/sharing/rest/content/items/"
PAGE = 2000
SKIP_TITLES = {"Skiciraj"}          # Zeichen-Layer ohne Daten
SEPARATE = {"Pozidano_built_May24"}  # sehr groß (~190k) -> eigene Datei

def get(url, params=None):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "geozone-sync/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)

def layer_features(url, title):
    meta = get(url, {"f": "json"})
    oid = meta.get("objectIdField", "OBJECTID")
    offset, out = 0, []
    while True:
        page = get(url + "/query", {
            "where": "1=1", "outFields": "*", "returnGeometry": "true",
            "orderByFields": oid, "resultOffset": offset,
            "resultRecordCount": PAGE, "geometryPrecision": 6, "f": "geojson",
        })
        if "error" in page:
            raise RuntimeError(f"{title}: {page['error']}")
        feats = page.get("features", [])
        service = url.split("/services/")[1].split("/")[0]
        for f in feats:
            f["properties"]["source_layer"] = service
            f["properties"]["layer_title"] = title
            f["properties"]["country"] = "SI"
        out += feats
        if not page.get("properties", {}).get("exceededTransferLimit") or not feats:
            break
        offset += len(feats)
    return out, meta.get("editingInfo", {}).get("lastEditDate")

def main():
    webmap = get(SHARING + WEBMAP_ID + "/data", {"f": "json"})
    main_fc = {"type": "FeatureCollection", "features": []}
    manifest = []
    for lyr in webmap.get("operationalLayers", []):
        title, url = lyr.get("title"), lyr.get("url")
        if not url or title in SKIP_TITLES:
            continue
        feats, edited = layer_features(url, title)
        service = url.split("/services/")[1].split("/")[0]
        manifest.append({"title": title, "url": url, "count": len(feats),
                         "lastEditDate": edited})
        print(f"{title:40s} {len(feats):7d}")
        if service in SEPARATE:
            with open(f"si_{service}.geojson", "w", encoding="utf-8") as fh:
                json.dump({"type": "FeatureCollection", "features": feats},
                          fh, ensure_ascii=False)
        else:
            main_fc["features"] += feats
    with open("si_uas_geozones.geojson", "w", encoding="utf-8") as fh:
        json.dump(main_fc, fh, ensure_ascii=False)
    with open("si_manifest.json", "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
