#!/usr/bin/env python3
"""Normalisiert den Roh-Export von tmcad.idronect.com in ein einheitliches Format.

Aufruf:
    python normalisieren.py malta_geozonen_roh_2026-11-15.geojson

Erzeugt im selben Ordner:
    malta_geozonen.geojson   – bereinigte Zonen mit einheitlichen Attributen
    malta_geozonen.csv       – Übersichtstabelle (ohne Geometrie)
    malta_geozonen_diff.txt  – Änderungen gegenüber dem letzten Lauf (falls vorhanden)

Nur Python-Standardbibliothek, keine Pakete nötig.
"""
import csv
import json
import sys
from datetime import date
from pathlib import Path

LAND = "MT"
QUELLE = "Transport Malta / Idronect (tmcad.idronect.com)"


def to_bool(v):
    if v in (None, ""):
        return None
    return bool(v) if not isinstance(v, str) else v.strip().lower() in ("1", "true", "yes")


def normalisiere(feature):
    p = feature.get("properties") or {}
    center = p.get("center")
    lon = lat = None
    if isinstance(center, str) and "," in center:
        lon, lat = (float(x) for x in center.split(",")[:2])
    return {
        "type": "Feature",
        "geometry": feature["geometry"],
        "properties": {
            "land": LAND,
            "zone_id": p.get("zoneId"),
            "name": (p.get("name") or "").strip(),
            "typ_code": p.get("type"),
            "verboten": to_bool(p.get("forbidden")),
            "min_hoehe": p.get("minHeight"),
            "max_hoehe": p.get("maxHeight"),  # Einheit laut Quelle nicht angegeben – prüfen!
            "max_piloten": p.get("maxPilots"),
            "kosten": p.get("cost"),
            "kreis_mitte_lon": lon,
            "kreis_mitte_lat": lat,
            "kreis_radius_m": p.get("radius"),
            "archiviert": p.get("archived"),
            "quelle": QUELLE,
            "stand": date.today().isoformat(),
        },
    }


def main(roh_pfad):
    roh = Path(roh_pfad)
    daten = json.loads(roh.read_text(encoding="utf-8"))
    features = [normalisiere(f) for f in daten["features"] if f.get("geometry")]
    # Archivierte Zonen ausblenden, Reihenfolge stabil halten
    features = [f for f in features if not f["properties"]["archiviert"]]
    features.sort(key=lambda f: f["properties"]["zone_id"] or "")

    ziel = roh.parent / "malta_geozonen.geojson"
    alt = {}
    if ziel.exists():
        for f in json.loads(ziel.read_text(encoding="utf-8"))["features"]:
            alt[f["properties"]["zone_id"]] = f

    ziel.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                               ensure_ascii=False), encoding="utf-8")

    spalten = [k for k in features[0]["properties"].keys()] if features else []
    with open(roh.parent / "malta_geozonen.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=spalten, delimiter=";")
        w.writeheader()
        for f in features:
            w.writerow(f["properties"])

    if alt:
        neu = {f["properties"]["zone_id"]: f for f in features}
        hinzu = sorted(set(neu) - set(alt))
        weg = sorted(set(alt) - set(neu))
        geaendert = sorted(
            z for z in set(neu) & set(alt)
            if neu[z]["geometry"] != alt[z]["geometry"]
            or {k: v for k, v in neu[z]["properties"].items() if k != "stand"}
            != {k: v for k, v in alt[z]["properties"].items() if k != "stand"}
        )
        zeilen = [f"Neu: {len(hinzu)}", *[f"  + {z} {neu[z]['properties']['name'][:80]}" for z in hinzu],
                  f"Entfernt: {len(weg)}", *[f"  - {z} {alt[z]['properties']['name'][:80]}" for z in weg],
                  f"Geändert: {len(geaendert)}", *[f"  ~ {z} {neu[z]['properties']['name'][:80]}" for z in geaendert]]
        (roh.parent / "malta_geozonen_diff.txt").write_text("\n".join(zeilen), encoding="utf-8")
        print(f"Seit letztem Lauf: {len(hinzu)} neu, {len(weg)} entfernt, {len(geaendert)} geändert")

    verboten = sum(1 for f in features if f["properties"]["verboten"])
    print(f"{len(features)} Zonen geschrieben ({verboten} mit Flugverbot) → {ziel.name}, malta_geozonen.csv")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Aufruf: python normalisieren.py <roh-export.geojson>")
    main(sys.argv[1])
