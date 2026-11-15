# ANAC DNT (PT) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **dnt.anac.pt** (Autoridade Nacional da Aviação Civil,
Portugal). Stand: 2026-11-15, live geprüft. Freigabe liegt laut Product Owner
schriftlich vor.

Vergleich: `docs/godrone-api-integration.md` (NL),
`docs/dronespace-at-api-integration.md` (AT),
`docs/dflight-it-api-integration.md` (IT),
`docs/luxembourg-geozones-integration.md` (LU),
`docs/ireland-geozones-integration.md` (IE),
`docs/pansa-pl-api-integration.md` (PL),
`docs/droneguide-be-api-integration.md` (BE).

---

## 1. Kurzfassung

- ANAC liefert die portugiesischen Drohnen-Geozonen als **direkten
  ED-269-Download**, **ohne Authentifizierung**, ohne API-Key.
- **Primärquelle (EUROCAE ED-269):**
  `https://dnt.anac.pt/index.php?action=download-json-ed269`
  → 360 Zonen, ~146 KB, `Content-Disposition: UASZoneVersion ED-269 ….json`.
- Alternativ ein **natives JSON** (reichhaltiger, aber nicht ED-269):
  `https://dnt.anac.pt/index.php?action=download-json` (~366 KB).
- Das ist das **sauberste und vollständigste ED-269** aller bisher geprüften
  Länder: inkl. Kreis-Geometrien (Center/Radius), Höhen, bilingualer Texte und
  vollständiger Behördenkontakte.

---

## 2. Quelle

| Punkt | Wert |
|---|---|
| Karte | `https://dnt.anac.pt/mapa.html` (MapLibre) |
| ED-269-Download | `https://dnt.anac.pt/index.php?action=download-json-ed269` |
| Natives JSON | `https://dnt.anac.pt/index.php?action=download-json` |
| Katalog (HTML) | `https://dnt.anac.pt/index.php?action=catalog` |
| Auth | **keine** |
| Lizenz | ANAC, „Regulation nº 1093/2016". Genaue Nutzungslizenz bei ANAC bestätigen (Freigabe liegt vor) |

---

## 3. Schema (EUROCAE ED-269)

Top-Level:
```json
{
  "title": "Portuguese geozones as per Regulation nº 1093/2016 of 14th of december",
  "description": "Version: 28092026133825",
  "features": [ … ]   // 360
}
```

Feature (**echtes ED-269**, `geometry` ist ein **Array** von Luftraumvolumen):

| Feld | Beispiel | Bedeutung |
|---|---|---|
| `identifier` | `1001UA` | stabile ID (Dedupe) |
| `country` | `PRT` | |
| `name` | `Heliporto hospitalar de Abrantes` | |
| `type` | `COMMON` | |
| `restriction` | `REQ_AUTHORISATION` (207), `PROHIBITED` (76), `NO_RESTRICTION` (54), `CONDITIONAL` (23) | |
| `reason` | Array: `NATURE` (185), `AIR_TRAFFIC` (105), `EMERGENCY` (38), `SENSITIVE` (32) | |
| `otherReasonInfo` | `Hospital Helipad` | |
| `applicability[]` | `{startDateTime, endDateTime, permanent:"YES"}` | Gültigkeit |
| `message` | `PT-… EN-…` (bilingual) | für Popup |
| `zoneAuthority[]` | `{name, service, contactName, siteURL, email, phone, purpose}` | Freigabestelle |
| `geometry[]` | Array von Volumen (siehe unten) | |
| `extendedProperties` | `{color:"FF0000", arc:"ARC-c"}` | Farbe + SORA-Air-Risk-Class |

`geometry[]` – jedes Volumen:
```json
{
  "lowerLimit": 0, "upperLimit": 120,
  "uomDimensions": "M",
  "lowerVerticalReference": "AGL", "upperVerticalReference": "AGL",
  "horizontalProjection": { "type": "Circle", "center": [lon,lat], "radius": 1000 }
}
```
- `horizontalProjection.type` ist **`Circle`** (mit `center`+`radius` in Metern)
  **oder** `Polygon`. Kreise müssen zum Rendern in ein Polygon umgerechnet
  werden (z. B. 48–64 Segmente) – wie bei den Punkt-Radien von GoDrone (NL).
- Höhen liegen direkt in Metern AGL vor.

---

## 4. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- PT ist in der App nur verlinkt (`shared/countryMaps.ts`), keine Geodaten.
- Die ED-269-Logik (`ed269Sources.ts`, `shared/ed269Restriction.ts`,
  `client/lib/ed269.ts`) passt direkt – `type`/`restriction`/`reason`/
  `applicability`/`zoneAuthority` sind ED-269-Standard wie bei AT.

### Schritte
1. **Abruf** in `ed269Sources.ts`: `IT`→ nein, `PT_ED269_URL =
   "https://dnt.anac.pt/index.php?action=download-json-ed269"`,
   `fetchPortugal()`. Da echtes ED-269: `finalize(raw, "pt")` genügt
   voraussichtlich.
2. **Kreis-Geometrien:** `horizontalProjection.type === "Circle"` in ein
   Polygon expandieren (gemeinsame Hilfsfunktion mit NL/GoDrone-Punktradien).
   Das `geometry`-**Array** (mehrere Volumen je Zone) beim Mapping
   berücksichtigen – pro Volumen Höhen übernehmen.
3. `"pt"` zu `ED269_DIRECT_COUNTRIES` hinzufügen und in
   `fetchEd269CountryFeatures` verdrahten.
4. **Label**: `PT: "ANAC – DNT (ED-269)"` in `ED269_SOURCE_LABELS`.
   Attribution „© ANAC – Autoridade Nacional da Aviação Civil". Die
   bilinguale `message` je nach App-Sprache (PT/EN) splitten.
5. **Höhenfilter** (120 m) funktioniert, da `upperLimit`/`lowerLimit` in Metern
   AGL vorhanden sind.
6. **Tests**: Kreis→Polygon, mehrere `geometry`-Volumen je Zone, Höhen,
   `applicability`, Dedupe über `identifier`.
7. **Refresh**: täglich. `description`/`version` zur Versionskontrolle nutzen.

---

## 5. Offene Punkte
- **Lizenz** der ED-269-Datei formal mit ANAC bestätigen (Freigabe liegt vor).
- Prüfen, ob das **native JSON** (`download-json`) zusätzliche, für die App
  nützliche Felder hat (es ist ~2,5× größer). Für ED-269-Konformität reicht
  die `-ed269`-Variante.
- Festland + Madeira + Azoren: prüfen, ob alle Regionen in der einen Datei
  enthalten sind (die ANAC-Karte verweist auf separate Azoren-/Madeira-Stellen).

---

## 6. Schnelltest

```bash
UA="Mozilla/5.0 Chrome/120"
curl -s -A "$UA" "https://dnt.anac.pt/index.php?action=download-json-ed269" \
  | jq '{title, version:.description, n:(.features|length),
         restr:([.features[].restriction]|group_by(.)|map({(.[0]):length})|add),
         geom:([.features[].geometry[0].horizontalProjection.type]|group_by(.)|map({(.[0]):length})|add)}'
```

---

## 7. Anhang: native ED-318-Variante & Render-Details (DE-Session, 2026-11-15)

Zusätzlich zur ED-269-Datei (§3) wurde die **native Variante**
`?action=download-json` (ED-318, `sourceType: "anac_ed318"`) vollständig
analysiert. **357 Features:** 248 `Polygon`, 20 `MultiPolygon`, **89 `Point`
(allesamt Kreise**, Radius 1.000–9.260 m). Der Server liefert nur **aktive**
Zonen (`isActive: true`); kein clientseitiger Zeitfilter.

### 7.1 Höhen-`layer` + Einheiten-Fallen ⚠️
Die native Geometrie trägt die Höhen in einem **`layer`-Objekt** (nicht im
ED-269-`geometry[]`-Array):
```json
"layer": { "upper":120, "upperReference":"AGL", "lower":0, "lowerReference":"AGL", "uom":"m" }
```
Verteilung der Einheiten – **unbedingt robust normalisieren:**
| upperReference / uom | Anzahl |
|---|---|
| AGL / `m` | 351 |
| AGL / `M` (Großbuchstabe!) | 1 |
| AMSL / `ft` | 3 |
| AMSL / `m` | 2 |
→ `uom` **case-insensitive** behandeln, `ft→m` (×0.3048), AGL/AMSL beibehalten.

### 7.2 Kreis→Polygon (fertiger Code aus `app.js`)
Kreis = `Point` + `extent:{subType:"Circle", radius:<m>}`. Umrechnung
(Großkreis, 64 Segmente, Ring geschlossen) – deckt auch NL/GoDrone-Punktradien ab:
```js
function circleToPolygon(center, radiusMeters, steps = 64) {
  const [lng, lat] = center.map(Number);
  const R = 6378137, ad = radiusMeters / R, out = [];
  for (let i = 0; i <= steps; i++) {
    const brg = (i / steps) * 2 * Math.PI;
    const la = lat * Math.PI/180, lo = lng * Math.PI/180;
    const tLat = Math.asin(Math.sin(la)*Math.cos(ad) + Math.cos(la)*Math.sin(ad)*Math.cos(brg));
    const tLng = lo + Math.atan2(Math.sin(brg)*Math.sin(ad)*Math.cos(la),
                                 Math.cos(ad) - Math.sin(la)*Math.sin(tLat));
    out.push([tLng*180/Math.PI, tLat*180/Math.PI]);
  }
  return { type: 'Polygon', coordinates: [out] };
}
```
`GeometryCollection` → zu `MultiPolygon` zusammenführen. Bei großen Radien 128
Segmente nehmen.

### 7.3 `applicabilitySchedule` mit BMCT/EECT ⚠️
Zeitfenster können statt Uhrzeiten `BMCT`/`EECT` tragen
(`[{"day":"ANY","startTime":"BMCT","endTime":"EECT"}]`) = *Begin Morning / End
Evening Civil Twilight*. Für „jetzt aktiv?" muss die App die **bürgerliche
Dämmerung** am Ort berechnen (z. B. SunCalc). Reine `startDateTime`/`endDateTime`
(§3) bleiben davon unberührt.

### 7.4 Farben & sonstiges
- **`mapColor`** (Hex) ist von ANAC pro Zone gesetzt → direkt fürs Rendering
  nehmen (Fallback = Kategorie-Farbe). Füllung ~0,14–0,2, Rand 3 px.
- `zoneType` (native) = `PROHIBITED`/`REQ_AUTHORIZATION`/`CONDITIONAL`/
  `NO_RESTRICTION` (Schreibweise mit **Z**, anders als ED-269 `REQ_AUTHORISATION`).
- Kategorien (Flughäfen/CTR/ATZ/Militär/Helipads/Naturparks …) werden client-
  seitig aus `otherReasonInfo`/`name`/`primaryReason` abgeleitet – nur nötig,
  wenn wir dieselben Filter wollen; für Geo-Awareness genügen `zoneType`+Höhen.

### 7.5 ProCiv-Zusatzlayer (nicht Teil der ANAC-Geozonen)
Die Karte zeigt zusätzlich **Zivilschutz-Einsätze** (Waldbrände etc.) aus einem
ArcGIS-FeatureServer (`prociv-agserver.geomai.mai.gov.pt/.../Ocorrencias_Base/
FeatureServer/0`). Rechtsgrundlage UAS.OPEN.060/UAS.SPEC.060. **Separate
Freigabe** nötig, falls gewünscht.

### 7.6 Welche Variante nehmen?
- **ED-318 (`download-json`)** = reichhaltiger (`mapColor`, `layer`, Kategorien-
  Rohfelder). Lokale Empfehlung.
- **ED-269 (`download-json-ed269`)** = EU-Standard, passt direkt auf die
  vorhandene Pipeline (§4).
→ Beide sind dieselben Zonen; der Einheiten-/Kreis-Normalisierer (7.1/7.2) gilt
für beide. Da unser Stack schon ED-269 verarbeitet, bleibt **ED-269 die
Primärquelle**; die ED-318-Felder nur bei Bedarf (Farben/Kategorien) ergänzen.
