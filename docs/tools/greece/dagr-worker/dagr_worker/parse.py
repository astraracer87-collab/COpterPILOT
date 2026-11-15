"""Reine Parser- und Geometriefunktionen (ohne Netzwerk) – gut testbar."""
from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

R = 6378137.0
NULL_HEIGHT = 9999999  # DAGR-Platzhalter für "nicht gesetzt"


# ---------------------------------------------------------------- Projektion
def to_3857(lon: float, lat: float) -> tuple[float, float]:
    x = math.radians(lon) * R
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R
    return x, y


def bbox_3857(rings: list[list[list[float]]]) -> list[float]:
    pts = [to_3857(c[0], c[1]) for r in rings for c in r]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


def bbox_distance(a: list[float], b: list[float]) -> float:
    return sum(abs(x - y) for x, y in zip(a, b))


# ---------------------------------------------------------------- KML
def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _coords(text: str) -> list[list[float]]:
    out = []
    for tok in (text or "").split():
        parts = tok.split(",")
        try:
            out.append([round(float(parts[0]), 8), round(float(parts[1]), 8)])
        except (ValueError, IndexError):
            continue
    return out


def _closed(r: list[list[float]]) -> bool:
    return len(r) > 3 and abs(r[0][0] - r[-1][0]) < 1e-7 and abs(r[0][1] - r[-1][1]) < 1e-7


def parse_kml(text: str) -> list[dict]:
    """Liefert je Placemark: {'kml_name', 'geometry' (GeoJSON), 'outer_rings'}.

    MapServer gibt Flächen-Ebenen als <Polygon>, Luftraum-Ebenen als
    geschlossene <LineString> aus – beides wird zu (Multi)Polygon.
    """
    if not text or "<kml" not in text[:500].lower() and "<Placemark" not in text:
        raise ValueError("Antwort ist kein KML")
    root = ET.fromstring(text.encode("utf-8") if isinstance(text, str) else text)
    result = []
    for pm in root.iter():
        if _local(pm.tag) != "Placemark":
            continue
        name = next((e.text for e in pm.iter() if _local(e.tag) == "name"), None)
        polygons: list[list[list[list[float]]]] = []
        lines: list[list[list[float]]] = []
        for el in pm.iter():
            t = _local(el.tag)
            if t == "Polygon":
                outer, inner = [], []
                for b in el.iter():
                    bt = _local(b.tag)
                    if bt in ("outerBoundaryIs", "innerBoundaryIs"):
                        c = next((x.text for x in b.iter() if _local(x.tag) == "coordinates"), "")
                        ring = _coords(c)
                        if len(ring) > 3:
                            (outer if bt == "outerBoundaryIs" else inner).append(ring)
                if outer:
                    polygons.append(outer[:1] + inner)
            elif t == "LineString":
                c = next((x.text for x in el.iter() if _local(x.tag) == "coordinates"), "")
                ring = _coords(c)
                if len(ring) > 1:
                    lines.append(ring)
        closed_lines = [l for l in lines if _closed(l)]
        open_lines = [l for l in lines if not _closed(l)]
        polygons += [[l] for l in closed_lines]
        if polygons:
            geom = ({"type": "Polygon", "coordinates": polygons[0]} if len(polygons) == 1
                    else {"type": "MultiPolygon", "coordinates": polygons})
            outer_rings = [p[0] for p in polygons]
            probe = polygons[0]
        elif open_lines:
            geom = ({"type": "LineString", "coordinates": open_lines[0]} if len(open_lines) == 1
                    else {"type": "MultiLineString", "coordinates": open_lines})
            outer_rings = open_lines
            probe = None
        else:
            continue
        result.append({"kml_name": name, "geometry": geom, "outer_rings": outer_rings, "probe_polygon": probe,
                       "open_lines": open_lines})
    return result


# ---------------------------------------------------------------- Innenpunkt
def interior_point(polygon: list[list[list[float]]]) -> list[float]:
    """Punkt garantiert im Polygon (Scanline, berücksichtigt Löcher).

    Nimmt das breiteste Innen-Intervall auf mehreren horizontalen Linien.
    """
    outer = polygon[0]
    ys = [c[1] for c in outer]
    y0, y1 = min(ys), max(ys)
    best = None
    for f in (0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9):
        y = y0 + (y1 - y0) * f + 1e-11
        xs = []
        for ring in polygon:
            for a, b in zip(ring, ring[1:]):
                if (a[1] > y) != (b[1] > y):
                    xs.append(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]))
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            w = xs[i + 1] - xs[i]
            if best is None or w > best[0]:
                best = (w, [(xs[i] + xs[i + 1]) / 2, y])
        if best and best[0] > 0:
            break
    return best[1] if best else outer[0]


# ---------------------------------------------------------------- GetFeatureInfo
def parse_gfi_gml(text: str) -> list[list[float]]:
    """BBoxen (EPSG:3857) aller Treffer in Ausgabereihenfolge."""
    if "ServiceException" in text:
        raise ValueError("ServiceException: " + re.sub(r"<[^>]+>", " ", text).strip()[:200])
    boxes = []
    for m in re.finditer(r"<gml:coordinates>([^<]*)</gml:coordinates>", text):
        v = [float(x) for x in re.split(r"[\s,]+", m.group(1).strip()) if x]
        if len(v) == 4:
            boxes.append(v)
    return boxes


class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows: list[list[str]] = []
        self._row = None
        self._cell = None

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        if t == "tr":
            self._row = []
        elif t in ("td", "th") and self._row is not None:
            self._cell = []
        elif t == "br" and self._cell is not None:
            self._cell.append("\n")

    def handle_endtag(self, tag):
        t = tag.lower()
        if t in ("td", "th") and self._row is not None and self._cell is not None:
            self._row.append("".join(self._cell).strip())
            self._cell = None
        elif t == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def parse_gfi_html(text: str) -> list[dict]:
    """Datensätze aus dem DAGR-HTML-Template.

    Datenzeile: REG NO | DETAILS | DTG FR | DTG TO | AGL FR | AGL TO | MSL FR | MSL TO
    Danach optional eine Zeile 'Details: …'.
    """
    if "ServiceException" in text:
        raise ValueError("ServiceException: " + re.sub(r"<[^>]+>", " ", text).strip()[:200])
    p = _TableParser()
    p.feed(text)
    records: list[dict] = []
    for row in p.rows:
        first = row[0] if row else ""
        if len(row) >= 8 and first.upper() not in ("REG NO", "INFO"):
            records.append({"cells": row[:8]})
        elif records and first.lower().startswith("details:"):
            txt = " ".join(row)
            txt = re.sub(r"^details:\s*", "", txt, flags=re.I).strip()
            if txt:
                records[-1]["details"] = txt
    return records


def _num(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n >= NULL_HEIGHT:
        return None
    return int(n) if n.is_integer() else n


def record_to_properties(rec: dict) -> dict:
    c = rec["cells"]
    return {
        "reg_no": c[0] or None,
        "name": c[1] or None,
        "valid_from": c[2] or None,
        "valid_to": c[3] or None,
        "lower_ft_agl": _num(c[4]),
        "upper_ft_agl": _num(c[5]),
        "lower_ft_msl": _num(c[6]),
        "upper_ft_msl": _num(c[7]),
        "details": rec.get("details"),
    }


def capabilities_layers(text: str) -> list[str]:
    return re.findall(r"<Name>([^<]+)</Name>", text)
