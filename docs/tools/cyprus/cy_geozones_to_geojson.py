#!/usr/bin/env python3
"""
Zypern UAS-Geozonen -> GeoJSON (EPSG:4326)

Quellen (beide öffentlich, ohne Token):
  ed269  : offizielle ED-269-JSON-Datei der Zivilluftfahrtbehörde (DCA Cyprus)
           Link wird automatisch von https://drones.gov.cy/geo-zones-file/ ermittelt
  arcgis : ArcGIS-Feature-Layer, den die Webkarte https://drones.gov.cy/geo-zones-map/ nutzt

Nur Python-Standardbibliothek.

Beispiele:
  python3 cy_geozones_to_geojson.py --source ed269  -o cy_geozones.geojson
  python3 cy_geozones_to_geojson.py --source arcgis -o cy_geozones_arcgis.geojson
  python3 cy_geozones_to_geojson.py --source ed269 --input CYP_GeoZones.json -o out.geojson   # offline
"""
import argparse
import html
import json
import math
import re
import sys
import urllib.request

UA = {"User-Agent": "geozones-sync/1.0"}
FILE_PAGE = "https://drones.gov.cy/geo-zones-file/"
FALLBACK_ED269 = "https://drones.gov.cy/wp-content/uploads/2025/05/CYP_GeoZones_06_05_25.json"
ARCGIS_LAYER = ("https://services9.arcgis.com/1oNBJ7Sv4IbovWiG/arcgis/rest/services/"
                "UAV_areas_WFL1/FeatureServer/12")

# Mapping der griechischen "Όροι Πρόσβασης" (ArcGIS-Popup) auf ED-269-Enums
ACCESS_MAP = [
    (re.compile(r"ΑΠΑΓΟΡΕΥΜΕΝΗ"), "PROHIBITED"),
    (re.compile(r"ΕΞΟΥΣΙΟΔΟΤ"), "REQ_AUTHORISATION"),
]


def http_get(url, as_json=True):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return json.loads(data.decode("utf-8-sig")) if as_json else data.decode("utf-8", "replace")


def find_latest_ed269_url():
    """Liest die Download-Seite und nimmt den ersten Link auf eine .json-Datei."""
    try:
        page = http_get(FILE_PAGE, as_json=False)
        m = re.findall(r'href="(https?://drones\.gov\.cy/wp-content/uploads/[^"]+\.json)"', page)
        if m:
            return m[0]
    except Exception as e:  # noqa: BLE001
        print(f"Warnung: Download-Seite nicht lesbar ({e}), nutze Fallback-URL", file=sys.stderr)
    return FALLBACK_ED269


def circle_to_ring(lon, lat, radius_m, segments=64):
    """Kreis (Mittelpunkt lon/lat, Radius in m) als geschlossener Polygonring (sphärisch)."""
    R = 6371008.8
    d = radius_m / R
    lat1, lon1 = math.radians(lat), math.radians(lon)
    ring = []
    for i in range(segments):
        brg = 2 * math.pi * i / segments
        lat2 = math.asin(math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(brg))
        lon2 = lon1 + math.atan2(math.sin(brg) * math.sin(d) * math.cos(lat1),
                                 math.cos(d) - math.sin(lat1) * math.sin(lat2))
        ring.append([round(math.degrees(lon2), 7), round(math.degrees(lat2), 7)])
    ring.append(ring[0])
    return ring


# ---------------------------------------------------------------- ED-269
def convert_ed269(doc, segments):
    feats = []
    for z in doc.get("features", []):
        base = {k: v for k, v in z.items() if k != "geometry"}
        auth = (z.get("zoneAuthority") or [{}])[0]
        for gi, g in enumerate(z.get("geometry", [])):
            hp = g["horizontalProjection"]
            props = dict(base)
            props.update({
                "source": "ED-269",
                "authorityName": auth.get("name"),
                "authorityEmail": auth.get("email"),
                "authorityPhone": auth.get("phone"),
                "lowerLimit": g.get("lowerLimit"),
                "upperLimit": g.get("upperLimit"),
                "lowerVerticalReference": g.get("lowerVerticalReference"),
                "upperVerticalReference": g.get("upperVerticalReference"),
                "uomDimensions": g.get("uomDimensions"),
                "geometryIndex": gi,
            })
            if hp["type"] == "Polygon":
                geom = {"type": "Polygon", "coordinates": hp["coordinates"]}
            elif hp["type"] == "Circle":
                lon, lat = hp["center"]  # ED-269: [lon, lat]
                props.update({"circleCenter": [lon, lat], "circleRadius": hp["radius"]})
                geom = {"type": "Polygon", "coordinates": [circle_to_ring(lon, lat, hp["radius"], segments)]}
            else:
                print(f"Unbekannter Geometrietyp {hp['type']} bei {z.get('identifier')}", file=sys.stderr)
                continue
            feats.append({"type": "Feature", "id": f"{z.get('identifier')}-{gi}",
                          "properties": props, "geometry": geom})
    return {"type": "FeatureCollection", "name": doc.get("title"), "features": feats}


# ---------------------------------------------------------------- ArcGIS
def parse_popup(h):
    """PopupInfo (HTML aus KML-Beschreibung) -> Dict."""
    out, rest = {}, []
    for part in re.split(r"<br\s*/?>", h or "", flags=re.I):
        links = re.findall(r'href="([^"]+)"', part)
        txt = html.unescape(re.sub(r"<[^>]+>", "", part)).strip()
        if not txt and not links:
            continue
        m = re.match(r"^([^:]{3,40}):\s*(.*)$", txt)
        if m and not m.group(1).lower().startswith("http"):
            out[m.group(1).strip()] = m.group(2).strip() or (links[0] if links else "")
        else:
            rest.append(txt)
    out["_text"] = " ".join(rest).strip()
    return out


def arcgis_props(a):
    p = parse_popup(a.get("PopupInfo"))
    access = (p.get("Όροι Πρόσβασης") or "").strip()
    folder = (a.get("FolderPath") or "").split("/")
    restriction = None
    for rx, val in ACCESS_MAP:
        if rx.search(access):
            restriction = val
            break
    if restriction is None and len(folder) > 1:
        restriction = "PROHIBITED" if "PROHIBITED" in folder[1] else "REQ_AUTHORISATION"
    form = p.get("'Eντυπο Αίτησης") or p.get("Έντυπο Αίτησης")
    m = re.search(r"https?://\S+?\.pdf", access + " " + (form or ""))
    name = a.get("Name") or ""
    num = re.match(r"^(\d+)\s*-\s*(.*)$", name)
    return {
        "source": "ArcGIS",
        "objectId": a.get("OBJECTID"),
        "zoneNo": num.group(1) if num else None,
        "name": num.group(2) if num else name,
        "category": folder[1] if len(folder) > 1 else None,   # RESTRICTED ZONES / PROHIBITED ZONES
        "restriction": restriction,
        "accessTermsRaw": re.sub(r"\s{2,}.*$", "", access),
        "message": p.get("_text"),
        "authorityName": p.get("Διαχειριστής Ζώνης"),
        "authorityPhone": p.get("Τηλέφωνο Επικοινωνίας"),
        "authorityEmail": p.get("Ηλεκτρονική Διεύθυνση"),
        "applicationForm": m.group(0) if m else None,
        "styleId": a.get("SymbolID"),
    }


def convert_arcgis(pages):
    feats = []
    for fc in pages:
        for f in fc.get("features", []):
            a = f.get("properties") or {}
            geom = f.get("geometry")
            if geom:  # z-Werte (immer 0) entfernen
                geom = json.loads(json.dumps(geom), parse_float=float)
                def strip(c):
                    return [strip(x) for x in c] if isinstance(c[0], list) else c[:2]
                geom["coordinates"] = strip(geom["coordinates"])
            feats.append({"type": "Feature", "id": a.get("OBJECTID"),
                          "properties": arcgis_props(a), "geometry": geom})
    return {"type": "FeatureCollection", "name": "CY UAS Geo Zones (ArcGIS)", "features": feats}


def fetch_arcgis_pages(page_size=1000):
    pages, offset = [], 0
    while True:
        url = (f"{ARCGIS_LAYER}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson"
               f"&orderByFields=OBJECTID&resultOffset={offset}&resultRecordCount={page_size}")
        fc = http_get(url)
        pages.append(fc)
        n = len(fc.get("features", []))
        exceeded = (fc.get("properties") or {}).get("exceededTransferLimit") or fc.get("exceededTransferLimit")
        if not exceeded or n == 0:
            break
        offset += n
    return pages


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["ed269", "arcgis"], default="ed269")
    ap.add_argument("--input", help="lokale Datei statt Download (ED-269-JSON bzw. ArcGIS-GeoJSON)")
    ap.add_argument("-o", "--output", default="cy_geozones.geojson")
    ap.add_argument("--segments", type=int, default=64, help="Stützpunkte pro Kreis (ED-269)")
    args = ap.parse_args()

    if args.source == "ed269":
        if args.input:
            doc = json.load(open(args.input, encoding="utf-8-sig"))
        else:
            url = find_latest_ed269_url()
            print(f"ED-269-Quelle: {url}", file=sys.stderr)
            doc = http_get(url)
        out = convert_ed269(doc, args.segments)
    else:
        pages = [json.load(open(args.input, encoding="utf-8"))] if args.input else fetch_arcgis_pages()
        out = convert_arcgis(pages)

    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False)
    print(f"{len(out['features'])} Features -> {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
