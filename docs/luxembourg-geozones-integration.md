# Luxemburg (LU) – Geozonen-Quellen & Integrationsauftrag

Übergabe-Dokument für die Drohnen-Geozonen Luxemburgs. Stand: 2026-11-15,
live geprüft. Betreiber: Direction de l'Aviation Civile (DAC) /
Administration de la navigation aérienne (ANA), über das Geoportail Luxembourg.

Vergleich: `docs/godrone-api-integration.md` (NL),
`docs/dronespace-at-api-integration.md` (AT), `docs/dflight-it-api-integration.md` (IT).

---

## 1. Kurzfassung

- Luxemburg veröffentlicht die UAS-Geozonen offiziell als **ED-269-JSON unter
  CC0** (Public Domain) über **data.public.lu**. Keine Authentifizierung.
- **Primärquelle (ED-269, CC0):** `https://drones.geoportail.lu/zones`
  – ⚠️ **liefert aktuell einen Server-Fehler** (`422`, FME-Streaming-Dienst,
  „GeometryExtractor output a Rejected feature“). Mehrfach über den Tag
  reproduziert. Die Datei ist laut Metadaten ~128 KB. Muss überwacht und mit
  Retry abgefragt werden; evtl. bei der DAC melden.
- **Zuverlässiger Rückfall (funktioniert):** die **OGC API Features** des
  Geoportails liefert dieselben Zonen als GeoJSON, allerdings im **nativen
  Geoportail-Schema** (nicht ED-269):
  `https://features.geoportail.lu/collections/1928/items?f=json&limit=2000`
  → 34 Features, HTTP 200.
- Die App nutzt für LU heute bereits die geoportail-WMS-Layer `1927`/`1928`
  (`shared/geozoneLayerCatalog.ts`, `NL`→ nein, LU in `GEOZONE_LAYERS` als
  `lu_uas_0_50`/`lu_uas_50_120`). Die OGC-Features-Collection **1928**
  enthält **alle** UAS-Zonen (sowohl `0to120m` als auch `50to120m`).

---

## 2. Quelle A – ED-269 / CC0 (bevorzugt)

| Punkt | Wert |
|---|---|
| Dataset | data.public.lu, „UAS Geographical Zones - Grand Duchy of Luxembourg“ |
| Dataset-API | `https://data.public.lu/api/1/datasets/6241d06243c4a33e2d86b5c3/` |
| Lizenz | **cc-zero** (CC0, Public Domain) |
| Ressource | Format `.json`, „UAS Geographical zones - ED269 format“ |
| Download-URL | `https://drones.geoportail.lu/zones` |
| Auth | keine |
| Hinweis | Daten „zu Zwecken der Geovigilanz“, konform zu ED-269 Kap. VIII + Appendix 2. Werden alle 5 Minuten aus dem Geoportal aktualisiert |

**Status:** Der Endpunkt antwortet derzeit mit `422` und einer FME-Fehlerseite
(keine JSON-Daten). Das ist ein serverseitiges Problem der DAC, kein
Auth-/Parameterfehler (mit `?lang=en` etc. kommt `401`). Vor dem produktiven
Einsatz muss die Datei einmal erfolgreich abgerufen und ihr ED-269-Schema
verifiziert werden. Die Dataset-API (data.public.lu) ist stabil und kann
genutzt werden, um die aktuelle Ressourcen-URL programmatisch zu lesen, falls
sie sich ändert.

---

## 3. Quelle B – OGC API Features (funktionierender Rückfall)

```
GET https://features.geoportail.lu/collections/1928/items?f=json&limit=2000
```

- HTTP 200, GeoJSON-`FeatureCollection`, 34 Features (33 Polygon + 1 ohne
  Geometrie), ~77 KB. Standard-OGC-Paging über `links`/`numberMatched`.
- Collection-Liste: `https://features.geoportail.lu/collections?f=json`
  (sehr viele Collections; `1928` ist die UAS-Zonen-Collection).
- **Natives Schema (nicht ED-269)** – Properties:

| Feld | Beispiel | Bedeutung |
|---|---|---|
| `nom_zone` | `EL-UAS-S10` | Zonen-Kennung |
| `description` | `Port de Mertert` | Klartext |
| `type_restiction` (sic) | `0to120m`, `50to120m` | Höhenband |
| `min_height` / `max_height` | `0.0` / `120.0` | Meter (AGL) |
| `responsabilite` | `Autorisation vol DAC` | wer freigibt → Beschränkungsart |
| `statut` | `PROD` | Status |
| `activite` | `Actif` | aktiv/inaktiv |
| `start_date` / `end_date` | ISO | Gültigkeit |
| `conditions`, `exceptions` | `Police / CGDIS` | Bedingungen/Ausnahmen |
| `nature_protect` | `TERR` | Schutzkategorie |
| `remarques` | | Bemerkungen |
| `objectid`, `pygeoapi_id` | | IDs zum Deduplizieren |

> Zum Mapping auf das interne ED-269-Modell: `type_restiction`/`min_height`/
> `max_height` → Höhen; `responsabilite`/`conditions` → Beschränkung
> (`REQ_AUTHORISATION` bei „Autorisation vol DAC“, sonst `CONDITIONAL`/
> `NO_RESTRICTION`); `start_date`/`end_date` → Gültigkeit. Höhen sind AGL.

---

## 4. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- LU hängt heute an den Geoportail-**WMS-Rasterlayern** `1927`/`1928`
  (`shared/geozoneLayerCatalog.ts`).
- Vektor-Länder (AT/BE/DK) laufen über
  `client/lib/geozoneDirect/ed269Sources.ts` + Normalisierer in `shared/`.

### Schritte
1. **Primär ED-269 (CC0):** Konstante `LU_ED269_URL =
   "https://drones.geoportail.lu/zones"`, `fetchLuxembourg()` in
   `ed269Sources.ts`. Da echtes ED-269: wahrscheinlich reicht
   `finalize(raw, "lu")` wie bei AT. **Sobald der Endpunkt wieder Daten
   liefert**, Schema verifizieren und eine Fixture einchecken.
2. **Rückfall OGC Features:** `fetchLuxembourgOgc()` auf
   `features.geoportail.lu/collections/1928/items`. Neues
   `shared/luxembourgGeozones.ts` (Muster `belgianGeozones.ts`):
   `normalizeLuxembourgFeature` mappt das native Schema (siehe §3) auf das
   ED-269-Modell. In `fetchLuxembourg()` zuerst die ED-269-Quelle versuchen,
   bei Fehler auf die OGC-Quelle zurückfallen – analog zum BE-Muster
   (`mergeBelgianGeozones`, „ohne Online-Quelle werfen“).
3. `"lu"` zu `ED269_DIRECT_COUNTRIES` hinzufügen und in
   `fetchEd269CountryFeatures` verdrahten.
4. **Label**: `LU: "DAC / Geoportail Luxembourg (ED-269, CC0)"` in
   `ED269_SOURCE_LABELS`. Attribution „© Direction de l'Aviation Civile /
   Geoportail Luxembourg – CC0“.
5. **WMS beibehalten** als zusätzlichen/alternativen Layer, bis die Vektoren
   stabil laufen. Ggf. `lu_*`-WMS-Default ausschalten, wenn Vektor aktiv.
6. **Tests**: Normalisierung des nativen Schemas, Höhen (`0to120m`/`50to120m`),
   Gültigkeit (`start_date`/`end_date`), Dedupe über `objectid`.
7. **Refresh**: täglich. Upstream aktualisiert alle 5 Minuten, ein Tagesabzug
   genügt.

---

## 5. Offene Punkte
- **ED-269-Endpunkt `drones.geoportail.lu/zones` ist derzeit defekt (422).**
  Erfolgreichen Abruf abwarten, Schema prüfen, ggf. DAC kontaktieren
  (`https://dac.gouvernement.lu/en/drones/geozones.html`).
- Deckt die Collection `1928` wirklich alle UAS-Zonen ab, oder gibt es weitere
  Collections (z. B. Flughafen Findel CTR separat)? Prüfen.

---

## 6. Schnelltest

```bash
UA="Mozilla/5.0 Chrome/120"
# ED-269 (CC0) – derzeit evtl. 422:
curl -s --compressed -A "$UA" "https://drones.geoportail.lu/zones" | head -c 200
# OGC-Features-Rückfall (funktioniert):
curl -s --compressed -A "$UA" \
  "https://features.geoportail.lu/collections/1928/items?f=json&limit=2000" \
  | jq '{n:(.features|length), bands:([.features[].properties.type_restiction]|group_by(.)|map({(.[0]):length})|add)}'
```
