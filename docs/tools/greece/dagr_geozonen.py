#!/usr/bin/env python3
"""
DAGR Griechenland (dagr.hasp.gov.gr) -> GeoJSON-Export der Drohnen-Geozonen.

Ablauf (ohne Login, nur öffentliche WMS-Endpunkte des MapServers):
  1. GetMap mit FORMAT=kml je Ebene  -> echte Polygone in WGS84 (ohne Attribute)
  2. Pro Polygon einen Punkt *innerhalb* bestimmen (point on surface)
  3. GetFeatureInfo an diesem Punkt:
       - text/html  -> Tabelle mit REG NO, Name (Behörde), Gültigkeit, Höhen AGL/MSL
       - GML        -> Bounding-Box je Treffer (gleiche Reihenfolge wie HTML)
  4. Zuordnung: Bounding-Box des Polygons == GML-Box  -> richtige Tabellenzeile
     (nötig, weil sich Zonen überlappen und ein Punkt mehrere Treffer liefert)
  5. Ergebnis als GeoJSON FeatureCollection speichern.

Abhängigkeiten: requests, shapely   (pip install requests shapely)
Aufruf:         python dagr_geozonen.py [--tage 30] [--out dagr_geozonen.geojson]

Hinweise:
  - WFS ist auf dem Server abgeschaltet; KML-Ausgabe des WMS ist der Weg zu Vektoren.
  - Zeitfenster (WMS_DATE_FROM/TO) steuert, welche temporären Zonen erscheinen
    (Warn-/Permit-Ebenen sind oft leer, wenn im Fenster nichts aktiv ist).
  - Webseite steht unter CC BY-NC-ND 4.0 -> Nutzung nur im Rahmen der erteilten
    Datenfreigabe von HASP/HCAA.
  - Server höflich behandeln: kleine Pause zwischen den Abfragen ist eingebaut.
"""
import argparse
import datetime as dt
import json
import re
import time
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

import requests
from shapely.geometry import shape

BASE = "https://dagr.hasp.gov.gr/cgi-bin/mapserv.exe"
MAPFILE = "C:/ms4w_3.1.4/MAPFILES/dagr_TILED.map"
LAYERS = ["all_limitation_layer", "all_warning_layer", "all_permifrag_layer", "hellas_CTR"]
GR_BBOX_LATLON = "33.5,18.5,42.5,30.5"  # WMS 1.3.0 + EPSG:4326 = lat,lon-Reihenfolge
KML_NS = "{http://www.opengis.net/kml/2.2}"


def wms_params(date_from, date_to, **extra):
    p = {
        "map": MAPFILE, "SERVICE": "WMS", "VERSION": "1.3.0", "STYLES": "",
        "PRN": "", "CRS": "EPSG:4326",
        "WMS_DATE_FROM": date_from, "WMS_DATE_TO": date_to,
    }
    p.update(extra)
    return p


def coords(txt):
    return [[float(v) for v in c.split(",")[:2]] for c in txt.split()]


def parse_kml(text):
    root = ET.fromstring(text.encode())
    geoms = []
    for pm in root.iter(KML_NS + "Placemark"):
        polys = []
        for poly in pm.iter(KML_NS + "Polygon"):
            polys.append([coords(c.text) for c in poly.iter(KML_NS + "coordinates")])
        lines = [coords(ls.find(KML_NS + "coordinates").text) for ls in pm.iter(KML_NS + "LineString")]
        if polys:
            geoms.append({"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1
                         else {"type": "MultiPolygon", "coordinates": polys})
        elif lines:
            geoms.append({"type": "LineString", "coordinates": lines[0]} if len(lines) == 1
                         else {"type": "MultiLineString", "coordinates": lines})
    return geoms


class RowParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self._row, self._cell, self._in = [], None, "", False

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._row = []
        elif tag == "td":
            self._in, self._cell = True, ""

    def handle_endtag(self, tag):
        if tag == "td" and self._row is not None:
            self._row.append(re.sub(r"\s+", " ", self._cell).strip())
            self._in = False
        elif tag == "tr" and self._row:
            if re.match(r"^r\d+", self._row[0]):
                self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._in:
            self._cell += data


def gml_boxes(text, layer):
    boxes = []
    for m in re.finditer(rf"<{layer}_feature>(.*?)</{layer}_feature>", text, re.S):
        c = re.search(r"<gml:coordinates>([^<]+)</gml:coordinates>", m.group(1))
        boxes.append([[float(v) for v in p.split(",")] for p in c.group(1).split()] if c else None)
    return boxes


def match_row(bbox, rows, boxes):
    best, err = -1, 1e9
    for k, b in enumerate(boxes):
        if not b:
            continue
        for a, c in ((0, 1), (1, 0)):  # Achsreihenfolge robust behandeln
            e = (abs(b[0][a] - bbox[0]) + abs(b[0][c] - bbox[1])
                 + abs(b[1][a] - bbox[2]) + abs(b[1][c] - bbox[3]))
            if e < err:
                best, err = k, e
    if best >= 0 and err < 0.01 and len(rows) == len(boxes):
        return rows[best], err
    return (rows[0], err) if len(rows) == 1 else (None, err)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tage", type=int, default=30, help="Zeitfenster ab heute (Tage)")
    ap.add_argument("--out", default="dagr_geozonen.geojson")
    ap.add_argument("--pause", type=float, default=0.15)
    a = ap.parse_args()

    today = dt.date.today()
    d_from = f"{today} 00:00"
    d_to = f"{today + dt.timedelta(days=a.tage)} 24:00"
    s = requests.Session()
    s.headers["User-Agent"] = "geozonen-export (Datenfreigabe HASP)"

    features, stats = [], {}
    for layer in LAYERS:
        r = s.get(BASE, params=wms_params(d_from, d_to, REQUEST="GetMap", LAYERS=layer,
                                          BBOX=GR_BBOX_LATLON, WIDTH=4000, HEIGHT=3000,
                                          FORMAT="kml"), timeout=60)
        geoms = parse_kml(r.text)
        stats[layer] = {"geoms": len(geoms), "matched": 0, "unmatched": 0}
        for g in geoms:
            shp = shape(g)
            minx, miny, maxx, maxy = shp.bounds
            pt = shp.representative_point()
            d = 0.0005
            bb = f"{pt.y - d},{pt.x - d},{pt.y + d},{pt.x + d}"
            q = wms_params(d_from, d_to, REQUEST="GetFeatureInfo", LAYERS=layer,
                           QUERY_LAYERS=layer, BBOX=bb, WIDTH=11, HEIGHT=11, I=5, J=5,
                           FEATURE_COUNT=50)
            html = s.get(BASE, params={**q, "INFO_FORMAT": "text/html"}, timeout=30).text
            gml = s.get(BASE, params={**q, "INFO_FORMAT": "application/vnd.ogc.gml"}, timeout=30).text
            p = RowParser(); p.feed(html)
            row, err = match_row((minx, miny, maxx, maxy), p.rows, gml_boxes(gml, layer))
            props = {"layer": layer}
            if row:
                stats[layer]["matched"] += 1
                m = re.match(r"^(.*)\s\(([^)]+)\)$", row[1])
                props.update(reg_no=row[0], name=m.group(1) if m else row[1],
                             authority=m.group(2) if m else None,
                             valid_from=row[2], valid_to=row[3],
                             alt_agl_from_ft=row[4], alt_agl_to_ft=row[5],
                             alt_msl_from_ft=row[6], alt_msl_to_ft=row[7])
            else:
                stats[layer]["unmatched"] += 1
                props["candidates"] = [f"{x[0]} {x[1]}" for x in p.rows]
            features.append({"type": "Feature", "properties": props, "geometry": g})
            time.sleep(a.pause)
        print(layer, stats[layer])

    fc = {"type": "FeatureCollection",
          "meta": {"source": "https://dagr.hasp.gov.gr (HASP/HCAA)",
                   "window": [d_from, d_to], "extracted": dt.datetime.now().isoformat()},
          "features": features}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)
    print(f"{len(features)} Zonen -> {a.out}")


if __name__ == "__main__":
    main()
