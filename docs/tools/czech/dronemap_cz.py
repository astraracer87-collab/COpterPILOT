#!/usr/bin/env python3
"""
dronemap_cz.py – Geozonen von dronemap.gov.cz (ŘLP ČR) als GeoJSON holen.

Nutzt denselben Endpunkt wie die Webseite (getGJ.php). Request-Parameter und
Antwort sind mit CryptoJS-AES verschlüsselt (Passphrase-Modus, OpenSSL-kompatibel,
Format "cryptojs-aes-php": {ct, iv, s}).

Benötigt: pip install requests cryptography

Schlüssel (siehe README): als Umgebungsvariablen setzen
    DRONEMAP_KEY_REQ  = Wert von ds_gj   (verschlüsselt den Request)
    DRONEMAP_KEY_RESP = Wert von ds_as   (entschlüsselt die Antwort)

Aufruf:
    python3 dronemap_cz.py --from 2026-11-15 --to 2026-11-15 -o cz_geozones.geojson
"""
import argparse, base64, datetime as dt, hashlib, json, math, os, sys, time

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding

BASE = "https://dronemap.gov.cz/"

# --- CryptoJS-kompatibles AES (OpenSSL EVP_BytesToKey, MD5, AES-256-CBC) -------

def _evp_bytes_to_key(passphrase: bytes, salt: bytes, key_len=32, iv_len=16):
    d, prev = b"", b""
    while len(d) < key_len + iv_len:
        prev = hashlib.md5(prev + passphrase + salt).digest()
        d += prev
    return d[:key_len], d[key_len:key_len + iv_len]


def cryptojs_encrypt(plaintext: str, passphrase: str) -> dict:
    salt = os.urandom(8)
    key, iv = _evp_bytes_to_key(passphrase.encode(), salt)
    p = padding.PKCS7(128).padder()
    data = p.update(plaintext.encode()) + p.finalize()
    enc = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    ct = enc.update(data) + enc.finalize()
    return {"ct": base64.b64encode(ct).decode(), "iv": iv.hex(), "s": salt.hex()}


def cryptojs_decrypt(obj: dict, passphrase: str) -> str:
    salt = bytes.fromhex(obj["s"])
    key, iv = _evp_bytes_to_key(passphrase.encode(), salt)
    dec = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    data = dec.update(base64.b64decode(obj["ct"])) + dec.finalize()
    u = padding.PKCS7(128).unpadder()
    return (u.update(data) + u.finalize()).decode("utf-8")

# --- Abruf ---------------------------------------------------------------------

def fetch_raw(key_req: str, key_resp: str, day_from: dt.date, day_to: dt.date,
              module: str = "dron") -> dict:
    import requests
    params = {
        "tm": "a" + day_from.strftime("%Y%m%d") + day_to.strftime("%Y%m%d"),
        "dummy": int(time.time() * 1000),
        "moduleName": module,
    }
    enc = cryptojs_encrypt(json.dumps(params, separators=(",", ":")), key_req)
    r = requests.post(BASE + "getGJ.php", params=enc, timeout=60,
                      headers={"Referer": BASE, "Origin": BASE.rstrip("/"),
                               "User-Agent": "Mozilla/5.0 (GeozonenSync)"})
    r.raise_for_status()
    txt = r.text.strip()
    if not txt.startswith("{"):
        raise RuntimeError(f"Unerwartete Antwort: {txt[:200]!r}")
    plain = cryptojs_decrypt(json.loads(txt), key_resp)
    data = json.loads(plain)
    if isinstance(data, str):          # Server liefert teils doppelt kodiert
        data = json.loads(data)
    return data

# --- Normalisierung --------------------------------------------------------------

DRUH = {  # druh_id -> (Kurzname, Bedeutung)
    "1": ("D", "Gefahrengebiet (Danger Area)"),
    "2": ("P", "Flugbeschränkungsgebiet / Prohibited Area"),
    "3": ("R", "Restricted Area"),
    "4": ("TRA", "Temporary Reserved Area"),
    "5": ("TSA", "Temporary Segregated Area"),
    "6": ("TMA", "Terminal Control Area"),
    "7": ("CTR", "Kontrollzone (UASCondID 7-1 innen / 7-2 außen, M = militärisch)"),
    "23": ("NOTAM-R", "NOTAM-Gebiet (Beschränkung)"),
    "24": ("NOTAM-W", "NOTAM-Gebiet (Warnung)"),
    "76": ("HEL", "Hubschrauberlandeplatz (Punkt)"),
    "77": ("RMZ", "Radio Mandatory Zone"),
    "80": ("SLZ", "Segelflug-/Ultraleicht-Gelände (SLZ)"),
    "86": ("UAS-FLIGHT", "Angemeldeter Drohnenflug (live, zeitlich begrenzt)"),
    "91": ("TRAGA", "TRA für allgemeine Luftfahrt"),
    "99": ("P-UAS", "Für UAS gesperrtes Gebiet"),
    "107": ("HEL-PIS", "Hubschrauberlandeplatz öffentliches Interesse (Krankenhaus u.ä.)"),
    "111": ("MODEL", "Modellflugplatz"),
    "112": ("ATZ", "Aerodrome Traffic Zone (112-1 innen / 112-2 außen)"),
    "113": ("GEO", "UAS-Geozone"),
}


def circle(lon, lat, radius_m, n=64):
    """Kreis als Polygon (geodätisch genähert, für Radien < ~50 km ausreichend)."""
    R = 6378137.0
    pts = []
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        dlat = (radius_m * math.cos(a)) / R
        dlon = (radius_m * math.sin(a)) / (R * math.cos(math.radians(lat)))
        pts.append([round(lon + math.degrees(dlon), 7), round(lat + math.degrees(dlat), 7)])
    return {"type": "Polygon", "coordinates": [pts]}


def _ts(v):
    try:
        return dt.datetime.strptime(v, "%Y%m%d%H%M%S").replace(tzinfo=dt.timezone.utc).isoformat()
    except Exception:
        return None


def _ft(v):
    try:
        return float(v)
    except Exception:
        return None


def normalize(fc: dict, circles=True) -> dict:
    out = []
    for f in fc.get("features", []):
        p, g = dict(f.get("properties") or {}), f.get("geometry")
        d = str(p.get("druh_id", ""))
        short, meaning = DRUH.get(d, (f"druh_{d}", "unbekannt"))
        lo, hi = _ft(p.get("bott")), _ft(p.get("ceil"))
        radius = _ft(p.get("radius"))
        if circles and g and g["type"] == "Point" and radius:
            g = circle(*g["coordinates"][:2], radius)
        out.append({
            "type": "Feature",
            "id": p.get("id") or p.get("ident"),
            "geometry": g,
            "properties": {
                "source": "dronemap.gov.cz",
                "country": "CZ",
                "type": short,
                "type_desc": meaning,
                "druh_id": d,
                "ident": p.get("ident"),
                "name": p.get("fname") or p.get("ident"),
                "uas_condition": p.get("UASCondID"),
                "lower_ft": lo, "upper_ft": hi,
                "lower_m": round(lo * 0.3048) if lo is not None else None,
                "upper_m": round(hi * 0.3048) if hi is not None else None,
                "radius_m": radius,
                "valid_from": _ts(p.get("platnost_od", "")),
                "valid_to": _ts(p.get("platnost_do", "")),
                "schedule": p.get("rozvrh") or None,
                "note": p.get("note") or None,
                "raw": p,
            },
        })
    return {"type": "FeatureCollection", "features": out}


def main():
    ap = argparse.ArgumentParser()
    today = dt.date.today()
    ap.add_argument("--from", dest="dfrom", default=today.isoformat())
    ap.add_argument("--to", dest="dto", default=today.isoformat())
    ap.add_argument("--raw", action="store_true", help="unverändertes GeoJSON ausgeben")
    ap.add_argument("--no-circles", action="store_true", help="Kreise als Punkt+radius lassen")
    ap.add_argument("-o", "--out", default="-")
    a = ap.parse_args()
    kq, kr = os.environ.get("DRONEMAP_KEY_REQ"), os.environ.get("DRONEMAP_KEY_RESP")
    if not kq or not kr:
        sys.exit("DRONEMAP_KEY_REQ / DRONEMAP_KEY_RESP fehlen (siehe README)")
    fc = fetch_raw(kq, kr, dt.date.fromisoformat(a.dfrom), dt.date.fromisoformat(a.dto))
    res = fc if a.raw else normalize(fc, circles=not a.no_circles)
    s = json.dumps(res, ensure_ascii=False)
    if a.out == "-":
        print(s)
    else:
        open(a.out, "w", encoding="utf-8").write(s)
        print(f"{len(res['features'])} Features -> {a.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
