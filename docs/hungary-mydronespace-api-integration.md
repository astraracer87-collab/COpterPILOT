# Ungarn (HU) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **MyDroneSpace** (HungaroControl, App-Paket
`hu.netbriefing.mydronespace`). Stand: 2026-11-15. Freigabe liegt vor; die
App wurde vom Betreiber bereitgestellt.

Grundlage: statische Analyse der Android-App (XAPK, v2.12.72) + Live-Prüfung der
Endpunkte. Keine Dekompilierung nötig – Endpunkte/Modelle aus den DEX-Strings
und live verifiziert.

---

## 1. Kurzfassung

- MyDroneSpace (für HungaroControl) hat **zwei Anbindungen**:
  1. **Daten-API:** `https://hatosag.mydronespace.hu/api/` (Node/Express).
     Die Geozonen liegen unter **`GET /api/zones`** – **erfordert Login**
     (live: `401 Unauthorized`, JSON).
  2. **Kartenkacheln (öffentlich):** WMTS-Raster der AIXM-Lufträume,
     `https://mds.mydronespace.hu/wmts/1.0.0/aixm/{z}/{x}/{y}.png` – **ohne
     Auth** (GoogleMapsCompatible, Zoom 0–17, „R-SYS Tile Server").
- **Login/Auth:** über **GoodID** (ungarische eID, `connect.goodid.net`) und
  **Google** (aus der CSP der API verifiziert). Der Zonen-Abruf braucht einen
  eingeloggten Token.
- Die HungaroControl-AUP-Seite (`ais-en.hungarocontrol.hu/airspace-use-plan/`)
  verweist nur auf `mydronespace.hu` – kein eigener Daten-Feed.

---

## 2. Verifizierte Endpunkte

| Zweck | Endpoint | Auth |
|---|---|---|
| Geozonen (Vektor) | `GET https://hatosag.mydronespace.hu/api/zones` | **ja (401 ohne Token)** |
| Geometrien | `…/api/geometries` | vermutlich ja |
| Drohnen/Operator/Flug | `…/api/drones`, `…/api/operator`, `…/api/flight`, `…/api/area`, `…/api/restriction` | ja |
| AIXM-Kacheln (Raster) | `https://mds.mydronespace.hu/wmts/1.0.0/aixm/{z}/{x}/{y}.png` | **nein (öffentlich)** |
| WMTS-Capabilities | `https://mds.mydronespace.hu/wmts/1.0.0/WMTSCapabilities.xml` | nein |

Weitere in der App/CSP referenzierte Hosts: `nominatim.openstreetmap.org`
(Geocoding), `*.sentry.io` (Telemetrie), `*.google.com`/`*.googleapis.com`
(Maps/Login), `connect.goodid.net` (eID-Login).

## 3. Zonen-Datenmodell (aus den App-Klassen)

Die App rendert die Zonen als **GeoJSON** (Google Maps `GeoJsonLayer`). Die
Zonen-Objekte (`/api/zones`) tragen laut App-Modell u. a.:
- `ZoneFeature` (Geometrie), `ZoneFeatureCenter`, `ZoneFeatureHeight` (Höhen)
- `ZoneType` / `zoneTypeValue` / `zoneTypeLabel`
- `ZoneDescription`, `ZoneMessage`, `ZoneStatus`
- `zoneId`, Konflikt-Flags (`ZoneHasConflict`, `…WithNDZ`)

> Exakte Feldnamen der JSON-Antwort sind erst mit einem eingeloggten Abruf
> endgültig zu bestätigen (siehe §5).

---

## 4. Integrationsauftrag

### Ist-Zustand
- HU ist in der App nur über Bounding-Box bekannt, keine Geodaten.

### Zwei Wege
1. **WMTS-Raster (sofort, ohne Auth):** Die AIXM-Kacheln als Overlay-Layer
   einbinden (`mds.mydronespace.hu/wmts/1.0.0/aixm/{z}/{x}/{y}.png`). Zeigt die
   Lufträume, aber **nur als Bild** – keine Zonengrenzen/Höhen zum Prüfen.
   Nützlich als Anzeige, nicht für die Geo-Awareness-Logik.
2. **Vektor-Zonen (`/api/zones`, mit Auth):** Für die eigentliche
   Geo-Awareness. Braucht einen MyDroneSpace-Login (GoodID/Google) und den
   Bearer-Token. Dann `fetchHungary(token)` → GeoJSON → `shared/hungaryGeozones.ts`
   (Mapping `ZoneType`/`ZoneFeatureHeight`/`ZoneDescription` → internes Modell).

### Schritte
- `"hu"` in die Länderliste; eigener Pfad (kein ED-269-Standard, aber
  GeoJSON-nah).
- Label `HU: "MyDroneSpace / HungaroControl"`, Attribution „© HungaroControl".
- Refresh täglich (mit Token) bzw. WMTS-Kacheln live.

---

## 5. Offene Punkte (vor dem Bau klären)
1. **Zugang zu `/api/zones`:** Mit HungaroControl/MyDroneSpace
   (`info@mydronespace.hu`) klären:
   - Gibt es einen **ED-269-/GeoJSON-Export** oder einen **öffentlichen**
     Zonen-Endpunkt? (bevorzugt – erspart den Login-Flow)
   - Sonst: API-Zugang/Service-Account bzw. den unterstützten Auth-Flow
     (GoodID/Google) für eine Fremd-App.
2. **Antwortschema** von `/api/zones` mit einem eingeloggten Abruf erfassen und
   als Fixture ablegen.
3. **WMTS als Zwischenlösung:** Die AIXM-Kacheln sind sofort nutzbar (Anzeige),
   ersetzen aber die Vektor-Zonen nicht.

---

## 6. Schnelltest

```bash
# öffentliche WMTS-Capabilities (listet AIXM-Layer):
curl -s "https://mds.mydronespace.hu/wmts/1.0.0/WMTSCapabilities.xml" | head -40
# Zonen-Endpoint (erwartet 401 ohne Token):
curl -s -o /dev/null -w "%{http_code}\n" "https://hatosag.mydronespace.hu/api/zones"
# mit Token (nach Login):
# curl -s -H "Authorization: Bearer <TOKEN>" "https://hatosag.mydronespace.hu/api/zones" | jq '.features[0].properties'
```
