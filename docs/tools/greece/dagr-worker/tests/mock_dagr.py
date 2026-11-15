"""Mock eines DAGR-MapServers für Offline-Tests.

Ahmt nach: Startseite mit OpenLayers-Karte (window.map), GetCapabilities,
GetMap als KML (Zonen = Polygon, Lufträume = LineString, keine Attribute),
GetFeatureInfo als GML (nur BBox) und HTML (DAGR-Tabelle), Überlappungen.

Umgebungsvariablen: MOCK_VARIANT=1|2 (2 = geänderter Datenstand),
MOCK_BLOCK_UA=1 (403 für Clients ohne Browser-Header)
"""
import json
import math
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

R = 6378137.0
VARIANT = os.environ.get("MOCK_VARIANT", "1")


def m(lon, lat):
    return math.radians(lon) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R


def circle(lon, lat, r_deg, n=48):
    pts = [[round(lon + r_deg * math.cos(2 * math.pi * i / n), 8),
            round(lat + r_deg * 0.8 * math.sin(2 * math.pi * i / n), 8)] for i in range(n)]
    return pts + [pts[0]]


def square(lon, lat, h):
    r = [[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h]]
    return [[round(x, 8), round(y, 8)] for x, y in r]


ZONES = []  # (reg, name, polygons[list of rings-lists], attrs)
for i in range(30):
    lon, lat = 20.5 + (i % 6) * 1.2, 35.5 + (i // 6) * 1.1
    ZONES.append([f"r{10000000 + i}", f"ZONE {i} (HCAA)", [[circle(lon, lat, 0.12)]],
                  ["1970-01-01 00:00", "2030-01-01 00:00", "9999999", "9999999", "0", str(2000 + i)], None])
    # verschachtelte, überlappende Innenzone (gleicher Mittelpunkt!)
    if i % 3 == 0:
        ZONES.append([f"r{20000000 + i}", f"INNER {i} (HCAA)", [[circle(lon, lat, 0.05)]],
                      ["2026-11-20 06:00", "2026-11-21 18:00", "0", "400", "9999999", "9999999"],
                      "Temporary.\nAuthorised by APP."])
# Polygon mit Loch – Mittelpunkt liegt im Loch
ZONES.append(["r30000001", "DONUT (HCAA)", [[square(27.5, 41.0, 0.3), square(27.5, 41.0, 0.15)]],
              ["1970-01-01 00:00", "2030-01-01 00:00", "9999999", "9999999", "0", "1500"], None])
# mehrteilige Zone (zwei Placemarks mit gleicher REG NO)
ZONES.append(["r30000002", "TWIN (HCAA)", [[square(19.8, 39.0, 0.05)]],
              ["1970-01-01 00:00", "2030-01-01 00:00", "9999999", "9999999", "0", "1000"], None])
ZONES.append(["r30000002", "TWIN (HCAA)", [[square(19.95, 39.0, 0.05)]],
              ["1970-01-01 00:00", "2030-01-01 00:00", "9999999", "9999999", "0", "1000"], None])

if VARIANT == "2":
    ZONES = [z for z in ZONES if z[0] != "r10000005"]           # entfernt
    for z in ZONES:
        if z[0] == "r10000007":
            z[3] = z[3][:5] + ["2500"]                           # Attribut geändert
    ZONES.append(["r40000000", "NEW ZONE (HCAA)", [[circle(26.0, 38.0, 0.1)]],
                  ["2026-11-15 00:00", "2026-12-01 00:00", "9999999", "9999999", "0", "800"], None])

AIRSPACE = {"hellas_CTR": [circle(23.9, 37.9, 0.3)], "hellas_TMA": [circle(23.9, 37.9, 0.9)],
            "hellas_ATZ": [], "hellas_r": [square(24.5, 36.5, 0.2)], "hellas_p": [], "hellas_c": [], "hellas_d": []}


def pip(pt, ring):
    x, y = pt
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def in_poly(pt, poly):
    return pip(pt, poly[0]) and not any(pip(pt, h) for h in poly[1:])


def bbox_m(polys):
    pts = [m(*c) for p in polys for c in p[0]]
    return min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)


def kml(placemarks):
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
            + "".join(placemarks) + "</Document></kml>")


def coords(r):
    return "\n".join(f"\t{x:.8f},{y:.8f}" for x, y in r)


PAGE = """<!doctype html><html><head><title>Drone Aware - GR</title></head><body><div id=m></div>
<script>
const src = {getParams: () => ({LAYERS:'all_limitation_layer,all_warning_layer'}),
             getUrls: () => [location.origin + '/cgi-bin/mapserv.exe?map=C:/ms4w_3.1.4/MAPFILES/dagr_TILED.map']};
const lyr = {getSource: () => src};
window.map = {getLayers: () => ({forEach: (f) => [lyr].forEach(f)})};
</script></body></html>"""


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="text/plain"):
        b = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path)
        if os.environ.get("MOCK_BLOCK_UA") == "1" and "Mozilla" not in self.headers.get("User-Agent", ""):
            return self.send(403, "Forbidden")
        if u.path == "/blocked":
            return self.send(403, "Forbidden")
        if u.path == "/":
            return self.send(200, PAGE, "text/html")
        if not u.path.startswith("/cgi-bin/mapserv"):
            return self.send(404, "nf")
        q = {k.upper(): v[0] for k, v in parse_qs(u.query).items()}
        req = q.get("REQUEST")
        if req == "GetCapabilities":
            names = ["all_limitation_layer", "all_warning_layer", "all_permifrag_layer", *AIRSPACE]
            return self.send(200, "<WMS_Capabilities>" + "".join(f"<Layer><Name>{n}</Name></Layer>" for n in names)
                             + "</WMS_Capabilities>", "text/xml")
        layer = q.get("LAYERS")
        if req == "GetMap":
            pms = []
            if layer == "all_limitation_layer":
                for z in ZONES:
                    for poly in z[2]:
                        inner = "".join(f"<innerBoundaryIs><LinearRing><coordinates>{coords(h)}</coordinates>"
                                        f"</LinearRing></innerBoundaryIs>" for h in poly[1:])
                        pms.append(f"<Placemark><name>{layer}.0</name><Polygon><outerBoundaryIs><LinearRing>"
                                   f"<coordinates>{coords(poly[0])}</coordinates></LinearRing></outerBoundaryIs>"
                                   f"{inner}</Polygon></Placemark>")
            for r in AIRSPACE.get(layer, []):
                pms.append(f"<Placemark><name>{layer}.0</name><LineString><coordinates>{coords(r)}"
                           f"</coordinates></LineString></Placemark>")
            return self.send(200, kml(pms), "application/vnd.google-earth.kml+xml")
        if req == "GetFeatureInfo":
            if layer != "all_limitation_layer":
                return self.send(200, "<msGMLOutput></msGMLOutput>", "text/xml")
            x0, y0, x1, y1 = map(float, q["BBOX"].split(","))
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            lon = math.degrees(cx / R)
            lat = math.degrees(2 * math.atan(math.exp(cy / R)) - math.pi / 2)
            hits = [z for z in ZONES if any(in_poly((lon, lat), p) for p in z[2])]
            if q.get("INFO_FORMAT") == "application/vnd.ogc.gml":
                feats = "".join(
                    "<all_limitation_layer_feature><gml:boundedBy><gml:Box srsName=\"EPSG:3857\"><gml:coordinates>"
                    "%f,%f %f,%f</gml:coordinates></gml:Box></gml:boundedBy></all_limitation_layer_feature>"
                    % bbox_m(z[2]) for z in hits)
                return self.send(200, f"<?xml version=\"1.0\"?><msGMLOutput><all_limitation_layer_layer>{feats}"
                                      f"</all_limitation_layer_layer></msGMLOutput>", "text/xml")
            rows = "".join(
                f"<TR class=\"lim\"><td>{z[0]}</td><td>{z[1]}</td>" + "".join(f"<td>{v}</td>" for v in z[3]) + "</TR>"
                + (f"<TR><td colspan=8>Details: {z[4].replace(chr(10), '<br/>')}</td></TR>" if z[4] else "")
                for z in hits)
            html = ("<html><body><TABLE class=\"ms_query\"><TH colspan=8>All active/future limitations</TH>"
                    "<TR><td colspan=2><b>INFO</b></td><td colspan=2><b>DTG</b></td><td colspan=2><b>ALT<br/>(FT AGL)"
                    "</td><td colspan=2><b>ALT<br/>(FT MSL)</td></TR><TR><td><b>REG NO</b></td><td><b>DETAILS</b></td>"
                    "<td><b>FR</b></td><td><b>TO</b></td><td><b>FR</b></td><td><b>TO</b></td><td><b>FR</b></td>"
                    f"<td><b>TO</b></td></TR>{rows}</TABLE></body></html>")
            return self.send(200, html, "text/html")
        return self.send(400, "bad request")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
