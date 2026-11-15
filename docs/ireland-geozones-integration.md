# Irland (IE) – Geozonen-Quelle & Integrationsauftrag

Übergabe-Dokument für die Drohnen-Geozonen Irlands. Stand: 2026-11-15,
live geprüft. Betreiber: Irish Aviation Authority (IAA) / AirNav Ireland.

Vergleich: `docs/godrone-api-integration.md` (NL),
`docs/dronespace-at-api-integration.md` (AT),
`docs/dflight-it-api-integration.md` (IT),
`docs/luxembourg-geozones-integration.md` (LU).

---

## 1. Kurzfassung

- Die IAA veröffentlicht die UAS-Geozonen als **GeoJSON im ED-269-Schema**,
  frei abrufbar, **ohne Authentifizierung**.
- Die Datei ist ein sauberes ED-269-GeoJSON: 82 Zonen (`MultiPolygon`) mit
  `identifier`, `country:"IRL"`, `type`, `restrictionConditions`, `reason`,
  `zoneAuthority[]` usw., plus `datasetMetadata` auf oberster Ebene.
- **Wichtige Einschränkung:** Die Datei enthält **keine Höhengrenzen**
  (kein `lowerLimit`/`upperLimit`). Jede Zone gilt ohne vertikale Angabe.
- Nutzungshinweis der IAA: „reference only, not for navigation“. Vor jedem
  Flug zusätzlich NOTAMs/TRAs prüfen. Das gehört in den App-Hinweistext.

---

## 2. Quelle

| Punkt | Wert |
|---|---|
| Einstieg (stabil) | `https://www.iaa.ie/geozones` → leitet auf die HTML-Seite `…/general-aviation/drones/uas-geographic-zones` |
| GeoJSON (Stand 2026-11-06) | `https://www.iaa.ie/docs/default-source/default-document-library/uas/20261106_uas_zones_ireland_v1.geojson?download=true` |
| Auth | keine |
| Größe | ~766 KB, `Content-Type: application/octet-stream` |
| Lizenz | IAA-Daten, „reference only“. Genaue Lizenz/Nutzungsbedingungen bei der IAA bestätigen |
| Anleitung | IAA UAM-010 „Guidance on UAS Geographical Zones JSON file“ |

> ⚠️ **Die Datei-URL enthält ein Datum (`20261106`) und ändert sich bei jedem
> Update.** Nicht hart verdrahten. Stattdessen die HTML-Seite
> `…/uas-geographic-zones` laden und den `*.geojson`-Link extrahieren
> (Regex auf `href="[^"]*\.geojson[^"]*"`). Die so gefundene relative URL mit
> `https://www.iaa.ie` zusammensetzen.

---

## 3. Schema (ED-269-GeoJSON)

Top-Level:
```json
{
  "type": "FeatureCollection",
  "name": "20261106_UAS_Zones_Ireland_V1",
  "datasetMetadata": {
    "provider": "Irish Aviation Authority",
    "issued": "2026-11-06T16:00:00+00:00",
    "validFrom": "2026-11-06T16:00:00+00:00",
    "technicalLimitation": null
  },
  "features": [ … ]
}
```

Feature-`properties`:

| Feld | Beispiel | Bedeutung |
|---|---|---|
| `identifier` | `U74` | stabile ID (Dedupe) |
| `country` | `IRL` | |
| `name` | `Cork Model Aero Club 2` | |
| `type` | `REQ_AUTHORIZATION` (74), `CONDITIONAL` (7), `NO_RESTRICTION` (1) | ED-269-Beschränkung |
| `variant` | `CUSTOMIZED` / `COMMON` | |
| `restrictionConditions` | `PERMITTED/MODEL AIRCRAFT=YES` | maschinenlesbare Bedingung |
| `reason` | `AIR_TRAFFIC` (46), `SENSITIVE` (29), `OTHER` (7) | |
| `otherReasonInfo` | `Exemption Zone` | |
| `regulationExemption` | `null`/`YES` | |
| `message` | Klartext (EN) | für Popup |
| `region` | meist null | |
| `zoneAuthority[]` | `{purpose, name:"AirNav Ireland", service:"Cork ATC", email:"suaairspace@airnav.ie", …}` | Freigabestelle |
| `limitedApplicability[]` | `[{startDateTime, endDateTime}, …]` | zeitlich begrenzte Aktivität |

Geometrie: `MultiPolygon`; das `geometry`-Objekt trägt zusätzlich ein Feld
`layer`. **Keine Höhenfelder** irgendwo in der Datei.

---

## 4. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- Für IE gibt es **keine Geozonen** in der App.
- Die ED-269-Logik (`client/lib/geozoneDirect/ed269Sources.ts`,
  `shared/ed269Restriction.ts`, `client/lib/ed269.ts`) passt direkt, weil das
  Format echtes ED-269 ist. `type` nutzt dieselben Werte wie AT
  (`REQ_AUTHORIZATION`, `CONDITIONAL`, `NO_RESTRICTION`), die
  `normalizeEd269Restriction` bereits kennt (ggf. `REQ_AUTHORIZATION` als
  Alias prüfen – AT liefert `REQ_AUTHORISATION` mit „S“).

### Schritte
1. **Link-Resolver** `resolveIrishGeojsonUrl()`: HTML-Seite laden, aktuellen
   `*.geojson`-Link extrahieren (§2). Fallback auf die zuletzt bekannte URL.
2. **Abruf** in `ed269Sources.ts`: `fetchIreland()` lädt das GeoJSON, mappt
   es minimal. Da echtes ED-269: vermutlich reicht `finalize(raw, "ie")`.
   Nur sicherstellen:
   - `restrictionConditions` und `limitedApplicability[]` übernehmen
     (letzteres ist das ED-269-Gültigkeitsfenster → `ed269ValidityFromProps`
     ggf. um `limitedApplicability` erweitern; AT nutzt `applicability`).
   - **Keine Höhen** → `isZoneReachable` (120-m-Filter) greift mangels
     Ceiling nicht; alle IE-Zonen als „reicht bis Boden/unbegrenzt“ behandeln,
     also immer anzeigen.
3. `"ie"` zu `ED269_DIRECT_COUNTRIES` hinzufügen und in
   `fetchEd269CountryFeatures` verdrahten.
4. **Normalisierung** prüfen: In `normalizeEd269Restriction` sicherstellen,
   dass `REQ_AUTHORIZATION` (mit Z) auf denselben Schlüssel wie
   `REQ_AUTHORISATION` abbildet.
5. **Label**: `IE: "Irish Aviation Authority (ED-269)"` in
   `ED269_SOURCE_LABELS`. Hinweistext „reference only, not for navigation –
   NOTAMs/TRAs zusätzlich prüfen“ ins Popup/Disclaimer.
6. **Tests**: Normalisierung je `type`, `limitedApplicability`-Zeitfenster,
   fehlende Höhen (kein Ceiling), Dedupe über `identifier`,
   Link-Resolver-Fallback.
7. **Refresh**: täglich; die Datei trägt `datasetMetadata.issued`/`validFrom`
   zur Versionskontrolle.

---

## 5. Offene Punkte
- **Lizenz/Nutzungsbedingungen** der IAA-GeoJSON formal bestätigen (die Seite
  sagt „reference only“; die genaue Weiterverwendungslizenz ist zu klären).
- **Fehlende Höhen**: Mit der IAA bzw. UAM-010 klären, ob ein ergänzender
  Höhendatensatz existiert oder ob `geometry.layer` ein Höhenband kodiert.
- `restrictionConditions`-Format (`PERMITTED/MODEL AIRCRAFT=YES`) ggf. parsen,
  um Modellflug-Ausnahmen korrekt anzuzeigen.

---

## 6. Schnelltest

```bash
UA="Mozilla/5.0 Chrome/120"
# aktuellen GeoJSON-Link von der Seite holen:
URL=$(curl -s -A "$UA" https://www.iaa.ie/general-aviation/drones/uas-geographic-zones \
  | grep -oiE 'href="[^"]*\.geojson[^"]*"' | head -1 | sed -E 's/.*href="([^"]+)".*/\1/' | sed 's/&amp;/\&/g')
curl -s -A "$UA" "https://www.iaa.ie${URL}" \
  | jq '{meta:.datasetMetadata.issued, n:(.features|length),
         types:([.features[].properties.type]|group_by(.)|map({(.[0]):length})|add)}'
```
