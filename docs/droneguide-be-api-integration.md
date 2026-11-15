# Droneguide / skeyes (BE) – API-Analyse & Bestandsdokumentation

Übergabe-Dokument zu **map.droneguide.be** (skeyes / BCAA, Belgien).
Stand: 2026-11-15, Live-Endpunkte geprüft. Freigabe liegt laut Product Owner
schriftlich vor.

**Besonderheit: Belgien ist in COpterPILOT bereits vollständig integriert.**
Dieses Dokument hält die Quellen, das Schema und den vorhandenen Code fest –
als Referenz und zur Bestätigung, nicht als neuer Bauauftrag.

Vergleich: `docs/godrone-api-integration.md` (NL),
`docs/dronespace-at-api-integration.md` (AT),
`docs/dflight-it-api-integration.md` (IT),
`docs/luxembourg-geozones-integration.md` (LU),
`docs/ireland-geozones-integration.md` (IE),
`docs/pansa-pl-api-integration.md` (PL).

---

## 1. Kurzfassung

- Belgien wird aus **zwei öffentlichen Quellen** gespeist, beide ohne Auth,
  beide live geprüft (HTTP 200):
  1. **Droneguide-WFS** (GeoServer): `https://map.droneguide.be/ows` –
     Vektorzonen als GeoJSON.
  2. **skeyes-Live-API** (ED-269): `https://api-cis.skeyes.be/public/uas-zones`
     – aktuelle UAS-Zonen inkl. Aktivierungen.
- Dazu ein **gebündeltes Archiv** im App-Paket als Offline-Rückfall.
- Alles ist bereits implementiert: `client/lib/geozoneDirect/ed269Sources.ts`
  (`fetchBelgium`) + `shared/belgianGeozones.ts` (Normalisierung).
- Quellen-Label: **„skeyes / Droneguide (ED-269)"**.

---

## 2. Quelle A – Droneguide-WFS (GeoServer)

```
GET https://map.droneguide.be/ows
  ?service=WFS&version=2.0.0&request=GetFeature
  &typeNames=geo_zone_fast&srsName=EPSG:4326
  &outputFormat=application/json
  &cql_filter=type_code<>'TIME_ZONE'
  &count=300&startIndex=<0,300,600,…>
```
- Paging über `count`/`startIndex` (App: 300er-Seiten).
- `cql_filter=type_code<>'TIME_ZONE'` blendet reine Zeitzonen aus.
- **Properties** (live bestätigt): `unique_identifier`, `external_reference`,
  `name`, `code`, `description`, `lower_limit_altitude`,
  `lower_limit_reference`, `lower_limit_unit`, `upper_limit_altitude`,
  `upper_limit_reference`, `upper_limit_unit`,
  `lower_limit_altitude_meter_agl`, `upper_limit_altitude_meter_agl`,
  `type_code`, `restriction`, `original_geometry`.
- Praktisch: `*_meter_agl` liefert die Höhen bereits in Meter AGL.

## 3. Quelle B – skeyes-Live-API (ED-269)

```
GET https://api-cis.skeyes.be/public/uas-zones
```
- 200, GeoJSON/ED-269 (~1,9 MB gzip), `items[]`.
- ED-269-Schema mit `lowerAltitude`/`upperAltitude` als Objekt
  `{ value, reference: "GND"|"MSL"|"STD", unit: "F"|"FL" }` und
  `restriction.type` (`PROHIBITED`/`REQ_AUTHORISATION`). Details siehe
  Kommentare in `shared/belgianGeozones.ts`.
- Liefert gegenüber dem WFS zusätzlich die **tagesaktuelle Aktivierung**
  (`validStartTs`/`validEndTs`, `_live`).

---

## 4. Vorhandene Implementierung (Ist-Zustand)

| Baustein | Ort |
|---|---|
| Endpunkt-Konstanten | `client/lib/geozoneDirect/ed269Sources.ts`: `BE_DRONEGUIDE_WFS_URL`, `BE_SKEYES_UAS_ZONES_URL` |
| Abruf + Merge | `fetchBelgium()` – WFS + Live + Bundle, zusammengeführt über `mergeBelgianGeozones`; wirft, wenn keine Online-Quelle erreichbar ist (schützt den Gerätebestand) |
| Normalisierung | `shared/belgianGeozones.ts`: `normalizeDroneguideWfsFeatures`, `normalizeSkeyesApiZones`, `normalizeBelgianFeature`, `belgianAltitudeMeters`, `belgianRestriction`, `translateBelgianType`, `dedupeBelgianFeatures` |
| Höhen/Einheiten | `belgianAltitudeMeters` (F=Fuß, FL=Flugfläche), `belgianAltitudeReference` (GND/MSL/STD, AGL/AMSL) |
| Gültigkeit | `skeyesValidityTs`, ED-269-Logik in `shared/ed269Restriction.ts` |
| Label/Attribution | `BELGIAN_GEOZONE_SOURCE_LABEL` + `ED269_SOURCE_LABELS` (`client/lib/ed269.ts`) |
| Offline-Rückfall | gebündeltes Archiv (`loadBelgianBundle` / `getBelgianBundledFeatures`) |
| Tests | `client/lib/__tests__/` (BE-bezogen), Migrationstests |

Dedupe über `unique_identifier`. Refresh täglich über `ed269Store.ts`.

---

## 5. Was jetzt noch zu tun ist

Da die Integration steht, geht es nur um Pflege/Bestätigung:
1. **Freigabe ablegen:** Die schriftliche skeyes/BCAA-Zustimmung im Repo
   hinterlegen oder verlinken (bisher als öffentliche Quelle genutzt).
2. **Attribution prüfen:** Sicherstellen, dass „© skeyes / Droneguide" korrekt
   angezeigt wird (ist über `ED269_SOURCE_LABELS` vorhanden).
3. **Regressionscheck:** Beide Endpunkte sind am 2026-11-15 live. Einmal
   durchlaufen lassen und bestätigen, dass WFS-Paging und Live-API weiterhin
   die erwarteten Felder liefern (die Property-Namen oben gegenprüfen).

Kein neuer Bauauftrag nötig.

---

## 5a. Alternativer Pfad `uaszone` + OAuth (DE-Session) – nützliche Extras

Eine zweite Analyse fand den **Unifly-Pfad** der Web-App (Layer **`uaszone`**,
nicht `geo_zone_fast`). Unsere Integration nutzt den **auth-freien**
`geo_zone_fast`-WFS + skeyes-Live-API (§2/§3) – **das bleibt primär**. Aus dem
Unifly-Pfad lohnen sich aber diese Ergänzungen:

- **Aktiv/geplant-Flags:** Per `viewParams` (GeoServer-SQL-View) liefert der
  Server `active_at_window_start` (`"1"`=jetzt aktiv) und `active_within_window`
  (`"1"`=im Fenster geplant). So lassen sich Zonen als **aktiv / geplant /
  inaktiv** darstellen (volle Farbe / schraffiert / blass). viewParams-Format:
  `window_start:<ISO>;window_end:<ISO>;show_planned:true` – ⚠️ **Doppelpunkte in
  den Zeitstempeln mit `\:` escapen** (`:`/`;` sind Trennzeichen).
- **`name`/`description` sind JSON-Strings** mit Sprachschlüsseln
  (`{"en":…,"de":…,"fr":…,"nl":…}`) → doppelt parsen, Fallback `de→en→fr→nl`.
- **Detail-Endpunkte** (für Popup, mit Bearer-Token des Unifly-Pfads):
  `GET /api/uaszones/{uuid}` (Kontakt `drones@skeyes.be`, `accessConditions`
  mehrsprachig), `…/{uuid}/validity?start=&end=` (Aktivierungszeiträume),
  `…/{uuid}/notams?start=&end=` (NOTAMs; `start`/`end` **Pflicht**, sonst 400).
- **GeometryCollection** kommt vor (1 CTA = Polygon + MultiLineString) → Parser
  muss das können; für Flächenprüfung nur die Polygon-Teile.
- Auth (falls dieser Pfad doch gebraucht wird): OAuth2 `client_credentials`
  (HTTP Basic `client_id:client_secret`) an
  `/auth/realms/OperatorPortal/protocol/openid-connect/token` → Bearer (48 h).
  **Eigene Credentials bei skeyes anfragen**, nicht die des Web-Clients nutzen.

→ Da `geo_zone_fast` ohne Auth dieselben Zonen gibt, brauchen wir den
OAuth-Pfad nur, falls die `active_*`-Flags/Detail-Endpunkte gewünscht sind.

---

## 6. Schnelltest

```bash
UA="Mozilla/5.0 Chrome/120"
# WFS (eine Seite):
curl -s -A "$UA" "https://map.droneguide.be/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=geo_zone_fast&srsName=EPSG:4326&outputFormat=application/json&count=1&cql_filter=type_code%3C%3E%27TIME_ZONE%27" \
  | jq '.features[0].properties | {name, type_code, restriction, upper_limit_altitude_meter_agl}'
# skeyes Live:
curl -s --compressed -A "$UA" "https://api-cis.skeyes.be/public/uas-zones" | jq '.items | length'
```
