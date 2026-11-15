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
