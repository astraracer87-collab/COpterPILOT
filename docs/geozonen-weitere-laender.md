# Geozonen weiterer Länder (SE, NO, CH, FI, EE, DK) – Quellenanalyse & Integrationsauftrag

Übergabe-Dokument zu den offiziellen Vektorquellen für UAS-Geozonen in
Schweden, Norwegen, der Schweiz (inkl. Liechtenstein), Finnland, Estland und
Dänemark. Stand: 2026-11-15 (Messungen zwischen 00:10 und 00:35 UTC). Alle
Angaben wurden live mit `curl` geprüft, sofern nicht als „ungetestet“ oder
„nicht belegt“ markiert.

Vergleichsdokumente: `docs/dronespace-at-api-integration.md` (AT),
`docs/godrone-api-integration.md` (NL). Bestehende Muster:
`client/lib/geozoneDirect/ed269Sources.ts`, `shared/danishGeozones.ts`,
`shared/belgianGeozones.ts`, `shared/dutchGeozones.ts`,
`shared/ed269Restriction.ts`.

---

## 1. Kurzfassung

| Land | Beste Quelle | Format | Zonen | Größe (roh / gzip) | Auth | Lizenz |
|---|---|---|---|---|---|---|
| **SE** | `dronechart.lfv.se/data/uas_zones_ED318.json` **+** LFV-WFS `daim.lfv.se/geoserver/wfs` | ED-318 (UAS-Zonen) + WFS-GeoJSON (Luftraum, NOTAM) | 72 UAS-Zonen + ~690 WFS-Objekte | 0,58 MB + ~2,5 MB / Server ohne gzip beim ED-318, WFS mit gzip | keine | CC BY 4.0 |
| **NO** | `dronesoner.no/Downloads/NOR_ED269_compliant_geozones_<YYYY-MM-DD>.json` | ED-269 (nacktes Array) | 1391 | 2,9 MB / 0,66 MB | keine | NLOD 2.0 |
| **CH (+FL)** | `data.geo.admin.ch/ch.bazl.einschraenkungen-drohnen/einschraenkungen-drohnen/einschraenkungen-drohnen_4326.json` | ED-269 (`{title, description, features}`) | 1288 (davon 3 LIE) | 18,1 MB / **kein gzip** | keine | opendata.swiss „Opendata BY“ |
| **FI** | `eservices.traficom.fi/Ilmatilasovellus/api/uas-reservations/json` | ED-269 („Finnish UASZoneVersion“) | **739** (nicht 731) | 1,7 MB / kein gzip | keine | nicht auf der Seite genannt; Traficom-Daten allgemein CC BY 4.0 |
| **EE** | `utm.eans.ee/avm/utm/uas.geojson` | GeoJSON mit ED-269-Properties (Frequentis, **identisch zu AT**) | 233 (199 fest + 34 NOTAM) | 5,1 MB / kein gzip | keine | auf der Seite nicht genannt |
| **DK** | `trafikstyrelsen.maps.arcgis.com/…/980697acd04d4a9bb1fd34bbefab924a/data` (+ Natur `ff657943…`) | GeoJSON (eigenes Schema) | 1793 + 140 Natur | 10,9 MB / 3,1 MB | keine | „Data kan frit anvendes med kildeangivelse“ (siehe §7.6, Widerspruch) |

Wichtigste Befunde:

- **DK:** Unsere `DK_GEOZONES_URL` (`980697ac…`) **ist** die aktuelle offizielle
  URL. Sie steht so auf der neuen API-Seite `https://dronezoner.eu/API/`
  („Alle URLs er faste og ændres ikke“). Die englische Download-Seite von
  droneregler.dk verlinkt dagegen noch die `_old`-Items (u. a. unsere
  `DK_LEGACY_GEOZONES_URL` `f049a65a…`). Für Natur gibt es jetzt eine feste
  offizielle GeoJSON-URL (`ff657943…`), die unseren FeatureServer-Query
  ersetzen sollte. → §7.
- **EE** läuft auf derselben Frequentis-Plattform wie Dronespace AT. Der
  vorhandene `fetchAustria()`-Pfad ist fast 1:1 nutzbar. **Aber:** EANS setzt
  `restriction` bei 202 von 233 Zonen auf `NO_RESTRICTION`, auch bei
  Genehmigungszonen und NOTAM-Sperrgebieten. Die Einstufung muss über
  Kennung und Text laufen. → §6.
- **FI** ist die einfachste neue Quelle: ein Request, reines ED-269, 1,7 MB,
  ohne Registrierung. Höhenangaben fehlen aber oft (`lowerLimit`/`upperLimit`
  = `null`). → §5.
- **CH:** Der BAZL-ED-269-Datensatz ist derselbe Layer
  (`ch.bazl.einschraenkungen-drohnen`), den die App heute per WMS/REST
  abfragt, liegt aber als Vektordatei vor und ermöglicht so den
  Offline-Betrieb. Nachteil: 18 MB ohne Server-Kompression. → §4.
- **NO:** Der Dateiname enthält das Build-Datum, und alte Dateien werden
  gelöscht (404). Den aktuellen Namen muss man aus `index.html` lesen. → §3.
- **SE:** Die geografischen UAS-Zonen von Transportstyrelsen gibt es **nicht**
  im WFS, sondern nur als ED-318-Datei. Der WFS liefert dafür CTR/TIZ/ATZ,
  R-/D-Gebiete, die 5-km- und 1-km-Flugplatzzonen, AIP SUP und NOTAM. Für ein
  vollständiges Bild braucht man beide Quellen. → §2.

---

## 2. Schweden (LFV / Transportstyrelsen)

### 2.1 Zugang

| Punkt | Wert |
|---|---|
| UAS-Zonen (ED-318) | `GET https://dronechart.lfv.se/data/uas_zones_ED318.json` |
| WFS (Luftraum, NOTAM) | `GET https://daim.lfv.se/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typename=<layer>&outputFormat=application/json&srsname=EPSG:4326` |
| WMS | `https://daim.lfv.se/geoserver/wms` (für die App nicht nötig) |
| Doku | `https://daim.lfv.se/echarts/dronechart/API/` (Produktspezifikation „Drönarkartan“) |
| Auth | keine |
| User-Agent | nicht nötig (curl-Standard-UA funktioniert) |
| Kompression | WFS liefert gzip. Das ED-318-File kommt unkomprimiert (583 039 B) |
| CRS | WFS: `srsname=EPSG:4326` angeben, die Antwort enthält `crs: urn:ogc:def:crs:EPSG::4326` mit Lon/Lat-Reihenfolge im GeoJSON. Unterstützt werden auch 3006, 3857 u. a. |
| Paging | nicht nötig. Alle Layer kommen vollständig (`totalFeatures` = Anzahl) |

Laut Doku ist der Layer „Geografiska UAS-zoner“ ausdrücklich **nicht** per WFS
verfügbar: „Detta kartlager tillhandahålls ej som WMS/WFS utan finns att ladda
ner från Drönarkartan som JSON (ED318).“ Die Web-App
(`dronechart.lfv.se/assets/index-*.js`) lädt die Datei als
`./data/uas_zones_ED318.json` und hängt nur `?nocache=<ts>` an.

### 2.2 ED-318-Datei (`uas_zones_ED318.json`)

`FeatureCollection` mit `metadata`
(`provider: Transportstyrelsen`, `issued`/`validFrom: 2026-10-29T00:00:00Z`).
Gemessen: **72 Features**, `Last-Modified: Thu, 29 Oct 2026 08:00:30 GMT`
(AIRAC-Datum).

| Feld | Beispiel / Verteilung | Hinweis |
|---|---|---|
| `geometry.type` | `Polygon` (56), `Point` (16) | **Punkte sind Kreise:** `geometry.extent = {subType:"Circle", radius:500}` (Meter). Beim Import zu Polygonen umrechnen |
| `geometry.layer` | `{upper:150, upperReference:"AGL", lower:0, lowerReference:"AGL", uom:"m"}` | Höhe steckt in der Geometrie (ED-318). Meist 150 m AGL, einmal 1500 ft AMSL |
| `properties.identifier` | `ESU200` | stabil |
| `properties.name[]` | `[{text, lang:"en-GB"}, {text, lang:"sv-SE"}]` | mehrsprachig (ED-318) |
| `properties.type` | `REQ_AUTHORIZATION` (35), `CONDITIONAL` (37) | **ED-318-Schreibweise mit „Z“**. `normalizeEd269Restriction` kann das schon |
| `properties.variant` | `COMMON` | |
| `properties.restrictionConditions` | `AUTHORIZED` (71), `NO_PHOTOGRAPH` (1) | |
| `properties.reason[]` | `SENSITIVE` 27, `OTHER` 27, `AIR_TRAFFIC` 17, `PRIVACY` 1 | |
| `properties.otherReasonInfo[]` | `Security` / `Säkerhet` | mehrsprachig |
| `properties.message[]` | ausführlicher Text en/sv | Popup |
| `properties.limitedApplicability[]` | `{startDateTime:"2025-10-27T00:00:00Z"}` | ED-318-Name statt `applicability` |
| `properties.zoneAuthority[]` | `{name[], purpose:"AUTHORIZATION"\|"NOTIFICATION", intervalBefore:"P14DT00H00M", email[], phone[], siteURL[]}` | **Werte als Arrays von `{text, lang}`** |
| `properties.extendedProperties` | `{text:"SE: … EN: …"}` | Zusatzhinweis |

### 2.3 WFS-Layer (Drönarkartan-Inhalt)

| Layer | Inhalt | Features | Größe (roh) | Wichtige Felder |
|---|---|---|---|---|
| `mais:CTR` | Kontrollzonen | 43 | 32 KB | `NAMEOFAREA`, `POSITIONINDICATOR`, `UPPER`, `LOWER`, `WEF` |
| `mais:TIZ` | Trafikinformationszonen | 11 | 7 KB | wie oben, `COMMENT_2` |
| `mais:ATZ` | Trafikzonen | 2 | 2 KB | |
| `DAIM_TOPO:RWY5K` | 5-km-Zone um Flugplätze | 47 | 125 KB | `NAMEOFAREA` (zugehörige CTR/TIZ), `POSITIONIN` |
| `DAIM_TOPO:HKP1K` | 1-km-Zone um Heliports | 38 | **899 KB** (dichte Kreise) | `POSITIONIN`, `LOCATION` |
| `mais:RSTA` | R-Gebiete | 170 (162 mit `LOWER=GND`) | 208 KB | `NAMEOFAREA`, `LOCATION`, `UPPER`, `LOWER`, `COMMENT_2` (sv+en) |
| `mais:DNGA` | D-Gebiete | 21 | 29 KB | wie RSTA |
| `DAIM_TOPO:SUP` | AIP SUP (temporär) | 63 | 84 KB | `FROM`/`TO` (ISO UTC), `SCHEDULE` (Text), `LOWER`/`LOW_UOM`, `UPPER`/`UP_UOM`, `COM_SE`/`COM_EN`, `URL` |
| `dynais:NOTAM` | NOTAM (nicht in GetCapabilities!) | 290 (nur 24 mit `CODE23` R/W) | 1,0 MB | `STARTVALIDITY`/`ENDVALIDITY`, `CODE23`, `CODE45`, `LOWER`/`UPPER`, `ITEM_E` |
| `mais:ARP`, `mais:HKP_ARP` | Flugplatz-/Heliport-Punkte | 139 / 45 | | nur Info |

Einheiten laut Doku: Höhenwert ohne Einheit = **ft AMSL**, `FL` = Flight
Level, `GND`/`SFC` = Boden, `UNL` = unbegrenzt. Die Drönarkarta zeigt nur
Gebiete mit Untergrenze ≤ 500 ft AMSL bzw. `LOWER = GND`. Bei NOTAM nur
`CODE23` mit R/W am Anfang und ohne `CODE45 = 'TT'`.

### 2.4 Aktualisierung

- ED-318 und WFS-Luftraumlayer: zum **AIRAC-Zyklus (28 Tage)**. Zitat:
  „Den information som LFV publicerar uppdateras regelbundet på AIRAC-datum
  … Observera dock att kartlager RArea_temp uppdateras oftare“.
- `dynais:NOTAM` ist live. Hinweis: „Får ej användas operativt, detta är ej
  en certifierad AIS service“.
- Empfehlung: ED-318 und Luftraumlayer täglich per `If-Modified-Since`/ETag
  laden (ED-318 hat `ETag` und `Last-Modified`). NOTAM/SUP bei App-Start und
  vor der Flugprüfung laden.

### 2.5 Lizenz

Zitat aus `AccessConstraints` der WFS-Capabilities und der API-Seite: „This
service is licensed under under Creative Commons 4.0 BY
(https://creativecommons.org/licenses/by/4.0/). LFV does not take
responsibility for the availability, continuity or quality of the service.“
`Fees: No fees applicable.`

Attribution: **„Quelle: LFV Drönarkartan / Transportstyrelsen, CC BY 4.0“**.

### 2.6 Eigenheiten

- Für SE braucht es **zwei Quellen**: ED-318 (Transportstyrelsen-UAS-Zonen)
  plus WFS (CTR/RWY5K/HKP1K/R/D/SUP/NOTAM).
- **ED-318 ≠ ED-269:** Mehrsprachige Arrays, Höhe in `geometry.layer`,
  Kreise als `Point` + `extent`, `limitedApplicability`, `type` statt
  `restriction`. Dafür braucht es einen eigenen kleinen Normalizer
  (`shared/swedishGeozones.ts`), der in die ED-269-Form der App übersetzt.
- WFS-Höhen sind Strings (`"2500"`, `"FL 85"`, `"GND"`), keine Zahlen.
- Militärische CTRs (SAAB, Karlsborg, Malmen, Kallax, Ronneby, Vidsel,
  Visby) haben andere Regeln. Die Liste steht nur in der Doku und nicht als
  Attribut im WFS.
- SUP-Gebiete mit mehreren Aktivierungszeiträumen kommen als **mehrfache
  identische Geometrien** mit eigener `ID` und eigenem `FROM`/`TO`.

### 2.7 Vorschlag Restriction-Mapping

| Quelle | Mapping |
|---|---|
| ED-318 `type=REQ_AUTHORIZATION` | `REQ_AUTHORISATION` |
| ED-318 `type=CONDITIONAL` | `CONDITIONAL` |
| `RWY5K`, `HKP1K` | `REQ_AUTHORISATION` (laut Transportstyrelsen: Flug im 5-km-Bereich nur mit Genehmigung der Flugverkehrsleitung. 1 km Heliport ist laut älterer Quelle genehmigungspflichtig, **fachlich prüfen**) |
| `CTR`, `TIZ`, `ATZ` (Restfläche) | `CONDITIONAL` (Höhengrenze, im Militär-CTR niedriger, **fachlich prüfen**) |
| `RSTA` mit `LOWER=GND` | `REQ_AUTHORISATION` („Särskilda tillstånd från Transportstyrelsen krävs“) |
| `DNGA` mit `LOWER=GND` | `CONDITIONAL` |
| `SUP` (zeitlich aktiv) | `REQ_AUTHORISATION`, Gültigkeit aus `FROM`/`TO` |
| `NOTAM` mit `CODE23` R… | `REQ_AUTHORISATION` (Text `ITEM_E` prüfen, ggf. `PROHIBITED`); W… → `CONDITIONAL` |

### 2.8 Schnelltest

```bash
curl -s https://dronechart.lfv.se/data/uas_zones_ED318.json | jq '{n:(.features|length), meta:.metadata.issued, types:([.features[].properties.type]|group_by(.)|map({(.[0]):length})|add)}'
W='https://daim.lfv.se/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&outputFormat=application/json&srsname=EPSG:4326&typename='
for l in mais:CTR DAIM_TOPO:RWY5K mais:RSTA DAIM_TOPO:SUP dynais:NOTAM; do echo "$l $(curl -s --compressed "$W$l" | jq '.features|length')"; done
```

---

## 3. Norwegen (Luftfartstilsynet / dronesoner.no)

### 3.1 Zugang

| Punkt | Wert |
|---|---|
| ED-269 | `GET https://dronesoner.no/Downloads/NOR_ED269_compliant_geozones_<YYYY-MM-DD>.json` |
| ED-318 | `GET https://dronesoner.no/Downloads/NOR_ED318_compliant_geozones_<YYYY-MM-DD>.json` |
| KML | `GET https://dronesoner.no/Downloads/Dronesoner_<YYYY-MM-DD>.kml` |
| Auth | keine |
| Hosting | Netlify (`cache-control: public,max-age=0,must-revalidate`), gzip ja |
| User-Agent | nicht nötig |
| Parameter | keine. Es gibt keine bbox und kein Zeitfenster |

**Wichtig – Dateiname mit Datum:** Es gibt nur die Datei vom aktuellen
Build-Datum. Der Vortag (`…_2026-11-13.json`) sowie undatierte Namen
(`…_geozones.json`, `…_latest.json`) liefern **404**. Lösung: `index.html`
laden und den Namen per Regex lesen:

```ts
const html = await (await fetch("https://dronesoner.no/")).text();
const m = html.match(/Downloads\/(NOR_ED269_compliant_geozones_\d{4}-\d{2}-\d{2}\.json)/);
const url = m ? `https://dronesoner.no/Downloads/${m[1]}` : null;
```

Beim Datumswechsel kann es kurz dauern, bis die neue Datei existiert. Laut
ED-318-Metadaten gilt `issued: 2026-11-14T01:02Z`, um 00:30 UTC war noch die
Datei vom 14.11. aktuell. Darum immer erst `index.html` lesen und den Namen
nicht aus dem heutigen Datum raten.

### 3.2 Format ED-269

Die Datei ist ein **nacktes JSON-Array** von `UASZone`-Objekten (ohne
`features`-Hülle). Gemessen: **1391 Zonen**, 1647 Polygone, 2 913 758 B roh,
664 542 B gzip.

| Feld | Beispiel / Verteilung | Hinweis |
|---|---|---|
| `identifier` | `666927C`, `ENR147` | |
| `name` | `Sandane lufthamn, Anda` | Norwegisch |
| `type` | `COMMON` | immer |
| `restriction` | `REQ_AUTHORISATION` 1198, `CONDITIONAL` 193 | |
| `reason[]` | `NATURE` 773, `SENSITIVE` 377, `AIR_TRAFFIC` 214, `OTHER` 27 | |
| `message` | „5 km-sone rundt lufthavn. Droneflyging krever tillatelse fra flygeledelsen (tårnet).“ | NOTAM-Texte gekürzt mit „…“ |
| `zoneAuthority[]` | `{name, purpose:"AUTHORIZATION", siteURL}` | Avinor, Miljødirektoratet, NSM, Kriminalomsorgen, Luftfartstilsynet … |
| `applicability[]` | nur bei NOTAM-Zonen (aktuell 2): `{permanent:"NO", startDateTime, endDateTime}` | fehlt = permanent |
| `restrictionConditions`, `otherReasonInfo` | selten, oft `null` | |
| `geometry[]` | `{uomDimensions:"M"\|"FT", lowerLimit, lowerVerticalReference, upperLimit, upperVerticalReference, horizontalProjection:{type:"Polygon"}}` | Bis zu 119 Volumes pro Zone (69 Zonen haben mehrere), **alle mit gleichen Höhen** |

Höhen: 1520 Volumes `300 M AGL` (Default „unbegrenzt“ für Drohnen),
Luftraum-/R-Gebiete in `FT AMSL` bzw. `M AMSL`. Koordinaten sind bereits auf
5 Nachkommastellen gerundet.

Die ED-318-Variante hat dieselben 1391 Features mit mehrsprachigen
`{text, lang}`-Arrays sowie `metadata` inkl. Lizenztext und bietet keinen
Vorteil gegenüber ED-269.

Ergänzend gibt es die Kartenlayer der Web-App unter
`https://dronesoner.no/data/*.geojson` (siehe `js/config.js`), z. B.
`forbud_notam.geojson` (aktuell leer, 55 B), `forbud_lufthavner_5km.geojson`,
`forbud_verneomrader.geojson`. Damit könnte man NOTAM-Sperrungen häufiger
als täglich nachladen (ungetestet, ob stabil).

### 3.3 Aktualisierung

Zitat `lisensvilkaar.html`: „Nedlastingsfilene (ED-269, ED-318, KML) bygges
automatisk hver dag, som et øyeblikksbilde av kartdataene på
byggetidspunktet. Kildedataene bak de faste sonene … oppdateres manuelt …
NOTAM-restriksjonene i filene viser det som var aktivt eller varslet da
filene ble bygd.“ → **täglicher Build ca. 01:00 UTC**.

### 3.4 Lizenz

Zitat: „Dataene kan fritt brukes, kopieres, endres og videredistribueres,
også i kommersielle produkter og tjenester. Bruk i tredjepartsapplikasjoner
(f.eks. droneapper, planleggingsverktøy) er tillatt. … Ved viderebruk er det
tilstrekkelig å oppgi: Kilde: Luftfartstilsynet / dronesoner.no.“ Lizenz:
**NLOD 2.0**. Disclaimer: „ikke en offisiell luftfartspublikasjon“.

Attribution: **„Kilde: Luftfartstilsynet / dronesoner.no (NLOD 2.0)“**.

### 3.5 Vorschlag Restriction-Mapping

| Bedingung | Mapping |
|---|---|
| `reason` enthält `NATURE` | `NATURE` (Verneområder mit Drohnenverbot; im Popup Hinweis „gilt evtl. nur saisonal“, steht so im `message`: „🗓️ Obs: Forbudet gjelder muligens kun deler av året“) |
| `REQ_AUTHORISATION` + `SENSITIVE` (Gefängnisse, NSM-Sensorverbot, Botschaften, Öl-/Gas-Sicherheitszonen) | `PROHIBITED` empfohlen (Text: „All flyging … er forbudt“, Ausnahme nur mit Sondergenehmigung), alternativ `REQ_AUTHORISATION` |
| `REQ_AUTHORISATION` + `AIR_TRAFFIC` (5 km Flughafen, aktive R-Gebiete, NOTAM) | `REQ_AUTHORISATION` |
| `CONDITIONAL` (Fareområder, MIL-Aktivität, Sanntidsaktivering) | `CONDITIONAL` |

### 3.6 Schnelltest

```bash
F=$(curl -s https://dronesoner.no/ | grep -o 'NOR_ED269_compliant_geozones_[0-9-]*\.json' | head -1); echo $F
curl -s --compressed "https://dronesoner.no/Downloads/$F" | jq '{n:length, restr:([.[].restriction]|group_by(.)|map({(.[0]):length})|add)}'
curl -s --compressed "https://dronesoner.no/Downloads/$F" | jq '[.[].reason[]]|group_by(.)|map({(.[0]):length})|add'
```

---

## 4. Schweiz inkl. Liechtenstein (BAZL / geo.admin.ch)

### 4.1 Zugang

| Punkt | Wert |
|---|---|
| ED-269 (WGS84) | `GET https://data.geo.admin.ch/ch.bazl.einschraenkungen-drohnen/einschraenkungen-drohnen/einschraenkungen-drohnen_4326.json` |
| GeoJSON (flach, WGS84) | `…/einschraenkungen-drohnen_4326.geojson` (13,9 MB) |
| weitere | `_2056.json`, `_2056.gpkg`, `_2056.shp.zip`, `_2056.xtf.zip` (LV95, für die App ungeeignet) |
| Metadaten (STAC) | `https://data.geo.admin.ch/api/stac/v0.9/collections/ch.bazl.einschraenkungen-drohnen/items` (Asset-Liste, `updated`) |
| opendata.swiss | Datensatz `geografische-uas-gebiete-der-schweiz` |
| Auth | keine |
| Kompression | **keine** (auch mit `Accept-Encoding: gzip` kommen 18 089 086 B) |
| Caching | `cache-control: max-age=7200, public`, `last-modified` gesetzt |
| Parameter | keine |

### 4.2 Format ED-269

`{title:"SwissUASGeozones - created on 2026-11-14T22:05:26.340+01:00",
description:"Swiss UAS Geozones according to ED-269 - format version 1.0",
features:[…]}`. Gemessen: **1288 Zonen** (CHE 1285, LIE 3: „LSXB Balzers“,
„LSXB Balzers (Airport perimeter)“, „Castle of Vaduz“), 1360 Polygone.

| Feld | Beispiel / Verteilung | Hinweis |
|---|---|---|
| `identifier` | `KTUR001`, `CTR0016`, `FR157` | Präfix = Herkunft (`BLn`/`BLw` = Naturschutz, `JBG`/`WZV`/`WSG` = Jagdbann-/Wasser- und Zugvogelreservate, `VBS` = Militär, `CTR…`) |
| `country` | `CHE` / `LIE` | |
| `name` | `Reussdelta`, `CTR BALE` | **nur Englisch** |
| `type` | `COMMON` | |
| `restriction` | **immer `REQ_AUTHORISATION`** (1288) | Die Abstufung steckt in `restrictionConditions` |
| `restrictionConditions[]` | „The operation of unmanned aircraft is prohibited.“ (1186) · „… weighing more than 250 g is prohibited.“ (84) · „… more than 250 g is prohibited from an altitude of 120 m above ground.“ (18, CTRs) | |
| `reason[]` | `NATURE` 820, `SENSITIVE` 288, `AIR_TRAFFIC` 180 | |
| `message` | „Exemption permits may be applied for at the competent cantonal specialist office.“ | |
| `regulationExemption`, `uSpaceClass`, `region`, `otherReasonInfo` | meist leer | |
| `applicability[]` | `{permanent:"YES", dailyPeriod:[{day:[""], startTime:"", endTime:""}]}` · temporär (37): `{permanent:"NO", startDateTime:"2026-03-26T00:00:00.000+01:00", endDateTime, dailyPeriod:[{day:["Any"], startTime:"00:00:00.000+01:00", …}]}` | **`dailyPeriod` statt `schedule`**, Zeiten mit Offset statt `Z`, `day` `"Any"` |
| `zoneAuthority[]` | `{name, service, email, contactName, siteURL, phone, purpose, intervalBefore:"P05DT00H"}` | gute Kontaktdaten (Kantone) |
| `geometry[]` | `{uomDimensions:"M", lowerLimit:0, lowerVerticalReference:"AGL", upperLimit:150, upperVerticalReference:"AGL", horizontalProjection}` | `upperLimit: 99999` = unbegrenzt (1037×). CTR: `lowerLimit:120` AGL |

### 4.3 Vergleich mit dem heutigen CH-Pfad der App

Heute (`COUNTRY_GEOZONE_CONFIGS.CH` in `client/lib/geozones.ts`):
WMS-Kacheln von `wms.geo.admin.ch` plus REST-Identify
`api3.geo.admin.ch/rest/services/api/MapServer/identify` auf
`ch.bazl.einschraenkungen-drohnen`, `ch.bazl.uas-aktivitaetszonen` und
`ch.bazl.landschaftsruhezonen`.

| Aspekt | WMS/REST (heute) | ED-269-Datei |
|---|---|---|
| Daten | derselbe Layer `ch.bazl.einschraenkungen-drohnen` | derselbe Layer, ED-269-strukturiert |
| Offline | nein (Kacheln/Identify online) | **ja** (einmal täglich laden) |
| Flugprüfung | Identify je Punkt/Radius | lokal per Geometrie, gleiche Logik wie AT/BE/DK/NL |
| Höhen/Kontakt/Gültigkeit | aus Identify-Attributen | strukturiert (`geometry[]`, `zoneAuthority[]`, `applicability[]`) |
| Liechtenstein | ja (gleicher Layer) | ja (3 Zonen) |
| Aktivitätszonen (BVLOS-Awareness) | ja | **nein** → separat `…/ch.bazl.uas-aktivitaetszonen/uas-aktivitaetszonen/uas-aktivitaetszonen_4326.geojson` (32 Features, 62 KB) |
| Landschaftsruhezonen | ja | **nein** (nur GPKG in LV95) → weiter per WMS/REST |
| Datenvolumen | klein, pro Abfrage | 18 MB pro Abruf (ohne gzip). Nach Rundung auf 5 Nachkommastellen und Minify ca. 6,9 MB auf dem Gerät |

Empfehlung: Den ED-269-Pfad für die Drohnenzonen einführen
(`ED269_DIRECT_COUNTRIES` um `ch` erweitern). WMS nur noch für die Darstellung
der Landschaftsruhezonen behalten. REST-Identify für
`einschraenkungen-drohnen` entfällt. Aktivitätszonen als kleine Zusatzdatei
laden. Wegen der 18 MB sollte der Abruf nur über WLAN oder höchstens einmal
täglich laufen, mit `If-Modified-Since` (`last-modified` wird geliefert).

### 4.4 Aktualisierung

Die Datei wird **nächtlich neu erzeugt** (`last-modified: Sat, 14 Nov 2026
22:01:49 GMT`, STAC `updated` identisch, `title` „created on
2026-11-14T22:05“). In opendata.swiss steht `accrual_periodicity: IRREG`.
Inhaltliche Änderungen kommen also unregelmäßig, die Datei aber täglich.

### 4.5 Lizenz

STAC: `license: proprietary`, Link
`https://opendata.swiss/en/terms-of-use/#terms_by`. Alle opendata.swiss-
Ressourcen haben `rights/license: https://opendata.swiss/terms-of-use#terms_by`
(„Opendata BY“: freie Nutzung, auch kommersiell, **Quellenangabe
Pflicht**). Provider: „Federal Office of Civil Aviation FOCA“ (producer,
licensor).

Attribution: **„Quelle: Bundesamt für Zivilluftfahrt BAZL, geo.admin.ch“**.

### 4.6 Vorschlag Restriction-Mapping

`restriction` ist wertlos (immer `REQ_AUTHORISATION`), entscheidend ist
`restrictionConditions[0]`:

| Bedingung | Mapping |
|---|---|
| „The operation of unmanned aircraft is prohibited.“ + `reason` `NATURE` | `NATURE` (Verbot, kantonale Ausnahmebewilligung) |
| „… is prohibited.“ + `SENSITIVE`/`AIR_TRAFFIC` | `PROHIBITED` (Ausnahme über `zoneAuthority`), alternativ `REQ_AUTHORISATION` |
| „… weighing more than 250 g is prohibited.“ | `CONDITIONAL` (< 250 g erlaubt) |
| „… more than 250 g is prohibited from an altitude of 120 m above ground.“ (CTR, `lowerLimit:120`) | `CONDITIONAL` (unter 120 m AGL frei). Höhenfilter `shared/geozoneAltitudeFilter.ts` nutzt `lowerLimit` |

### 4.7 Schnelltest

```bash
U=https://data.geo.admin.ch/ch.bazl.einschraenkungen-drohnen/einschraenkungen-drohnen/einschraenkungen-drohnen_4326.json
curl -sI "$U" | grep -i 'last-modified\|content-length'
curl -s "$U" | jq '{title, n:(.features|length), country:([.features[].country]|group_by(.)|map({(.[0]):length})|add), cond:([.features[].restrictionConditions[0]]|group_by(.)|map({(.[0][0:110]):length})|add)}'
```

---

## 5. Finnland (Traficom)

### 5.1 Zugang

| Punkt | Wert |
|---|---|
| ED-269 | `GET https://eservices.traficom.fi/Ilmatilasovellus/api/uas-reservations/json?lang=fi` |
| Quelle des Links | `https://www.traficom.fi/fi/miehittamaton-ilmailu/uas-ilmatilavyohykkeet-koneluettavassa-muodossa` („UAS-ilmatilat json-tiedostona“) |
| Auth / Registrierung | **keine** |
| Parameter | `lang` ist wirkungslos (`fi`/`en`/`sv` liefern byte-identisch dasselbe). Keine bbox, kein Zeitfenster |
| Antwort-Header | `Content-Type: application/json`, `Content-Disposition: attachment; filename=uas_reservations.json`, kein gzip, Set-Cookie (F5-Loadbalancer, ignorieren) |
| User-Agent | nicht nötig |

Zitat Traficom: „Tämän sivun kautta Liikenne- ja viestintävirasto Traficom
tarjoaa UAS-ilmatilavyöhykkeiden tiedot koneluettavassa muodossa
ulkopuolisille palveluntarjoajille ja ladattaviksi C-merkittyihin
drooneihin.“ (für externe Dienstanbieter und C-Klassen-Drohnen).

### 5.2 Format ED-269

`{title:"Finnish UASZoneVersion 2026-11-15", description:"", features:[…]}`.
Gemessen: **739 Zonen** (die Angabe „~731“ ist veraltet), alle `Polygon`,
1 735 493 B roh. Nach Rundung auf 5 Nachkommastellen ca. 0,76 MB.

| Feld | Beispiel / Verteilung | Hinweis |
|---|---|---|
| `identifier` | `EFAAUAS`, `FIN306` | |
| `name` | „UAS-ilmatilavyöhyke Aavahelukka“, „Helsingin vankila UAS“ | **nur Finnisch** |
| `type` | `COMMON` | |
| `restriction` | `REQ_AUTHORISATION` 586, `NO_RESTRICTION` 118, `PROHIBITED` 35 | `NO_RESTRICTION` = **erlaubende Zonen** (Modellflugplätze, „sallivat vyöhykkeet“) |
| `reason[]` | `SENSITIVE` 573, `AIR_TRAFFIC` 166 | kein `NATURE` |
| `applicability[]` | `{permanent:"YES", startDateTime, endDateTime:"2027-04-17T21:00:00.00Z", schedule:[{day:["ANY"], startTime:"00:00:00Z", endTime:"23:59:59Z"}]}` | Trotz `permanent:"YES"` gibt es ein Enddatum = Ende der Verordnungsperiode (OPS M1-29), meist April 2027 oder 2050. **Nicht als Ablauf werten** |
| `zoneAuthority[]` | nur `{name:"Traficom"}` | keine Kontaktdaten |
| `extendedProperties.exceptionPermit` | „UAS-toiminta kielletty“, „UAS-toiminta alueella on sallittua ainoastaan erikseen sopimalla lentopaikan pitäjän kanssa …“ | **wichtigster Erklärtext**, Finnisch, fehlt bei 37 Zonen |
| `geometry[]` | `{uomDimensions:"M"\|"FT", lowerLimit?, lowerVerticalReference, upperLimit?, upperVerticalReference, horizontalProjection}` | **`lowerLimit`/`upperLimit` oft `null`**: beide null 138×, nur upper 557×, nur lower 27× |

Höhen: 627× `M AGL`, 112× `FT AMSL`. Fehlende Untergrenze = SFC, fehlende
Obergrenze = unbegrenzt. `lowerLimit:50`/`120` bei Flugplatzzonen heißt:
Die Zone beginnt erst ab 50 bzw. 120 m, darunter ist Flug ohne Absprache
möglich. Auffällig ist ein Volume mit „120 FT AMSL“ (vermutlich
Datenfehler).

### 5.3 Aktualisierung

Der `title` trägt das Abrufdatum. Die Antwort wird offenbar bei jedem Abruf
aus der Datenbank erzeugt (Seite zuletzt geändert 10.4.2026). Temporäre
Zonen gelten höchstens ein Jahr. **Täglicher Abruf reicht.**

### 5.4 Lizenz

Auf der Download-Seite steht **keine** Lizenz. Allgemein gilt laut Traficom
„Data maintained by the Finnish Transport and Communications Agency Traficom
is licensed under the Creative Commons Attribution 4.0 licence“ (Ausnahme:
Seekarten). Musterzitat: „Source: Finnish Transport and Communications Agency
Traficom“. → Bis zur Bestätigung (copyright@traficom.fi) CC BY 4.0 annehmen.

Attribution: **„Lähde: Liikenne- ja viestintävirasto Traficom (CC BY 4.0)“**.

### 5.5 Vorschlag Restriction-Mapping

| Bedingung | Mapping |
|---|---|
| `PROHIBITED` (Gefängnisse u. a., „UAS-toiminta kielletty“) | `PROHIBITED` |
| `REQ_AUTHORISATION` + `AIR_TRAFFIC` (Flugplätze/CTR/FIZ) | `REQ_AUTHORISATION`. Bei `lowerLimit > 0` den Höhenfilter nutzen |
| `REQ_AUTHORISATION` + `SENSITIVE` (Polizei, Häfen, Industrie, Militär) | `REQ_AUTHORISATION` |
| `NO_RESTRICTION` (Modellflugplätze) | `NO_RESTRICTION` mit eigenem Label „Erlaubende Zone (Modellflug)“, Hinweis auf Höchsthöhe AMSL |

### 5.6 Schnelltest

```bash
U='https://eservices.traficom.fi/Ilmatilasovellus/api/uas-reservations/json?lang=fi'
curl -s -o /dev/null -w "%{http_code} %{size_download} B\n" "$U"
curl -s "$U" | jq '{title, n:(.features|length), restr:([.features[].restriction]|group_by(.)|map({(.[0]):length})|add)}'
```

---

## 6. Estland (EANS / Transpordiamet)

### 6.1 Zugang

| Punkt | Wert |
|---|---|
| Geozonen | `GET https://utm.eans.ee/avm/utm/uas.geojson[?start=<ISO>&end=<ISO>][&bounds=w,s,e,n]` |
| Offizieller Verweis | Transpordiamet, „Geographical zones“: Download-Link genau auf diese URL („download and display all currently active UAS relevant areas in Estonia in common digital form“) |
| Plattform | Frequentis/„Skyzr“-AVM, `window.ENV.VERSION = "1.57.19b"`. **Dieselbe Software wie `utm.dronespace.at`** |
| Auth | keine |
| User-Agent | ohne UA und mit curl-UA ebenfalls 200 (anders als AT). Browser-UA schadet nicht |
| Kompression | **keine** (5 089 483 B auch mit `--compressed`), `Cache-Control: private, max-age=1` |
| Parameter | wie AT (siehe `docs/dronespace-at-api-integration.md` §3.1): ohne Zeitfenster 232 Zonen, mit `start=jetzt&end=+1 Jahr` **233**. `bounds=24,59,25,60` → 72 |

### 6.2 Format

`FeatureCollection` (`Polygon`, WGS84). Die `properties` sind **dasselbe
Schema wie AT**: `identifier`, `name`, `country:"EST"`, `type:"COMMON"`,
`restriction`, `reason` (String: `Sensitive`, `Air traffic`, `Nature`,
`Other`, `Foreign territory`), `message`,
`extendedProperties.localizedMessages[]` (`en-GB`, `et-EE`),
`extendedProperties.expirationTime`, `applicability[]`, `zoneAuthority[]`
(`{name, contactName, siteURL, email, purpose:"AUTHORIZATION"|"INFORMATION"}`),
`geometry` (ED-269-Volume in den properties), `lower`/`upper`
(„SFC“, „216 M AGL“), `lowerMeters`/`upperMeters`, `hidden`, `metaData`
(`author: "Lennuliiklusteeninduse AS"` bzw. `"EANS NOTAM PIB"`),
`strokeColor`/`fillColor`.

| Gruppe (Kennung) | Anzahl | `restriction` im Feed | Inhalt |
|---|---|---|---|
| `EEGZ…S/O` | 50 | 29 `REQ_AUTHORISATION`, Rest `NO_RESTRICTION` | Flugplatz-Geozonen (z. B. EEGZ1 Tallinn, 120 m AGL) |
| `EERZ…` | 94 | `NO_RESTRICTION` | Sicherheitszonen, z. B. „You must have a permission from the Estonian Foreign Intelligence Service“ |
| `EER…`, `EER…F` | 46 | `NO_RESTRICTION` | R-Gebiete, davon 31 `Nature` |
| `EED…` | 3 | `NO_RESTRICTION` | D-Gebiete |
| `A####26` (NOTAM-Nr.) | **34** | `NO_RESTRICTION` | NOTAM-Zonen, z. B. „TEMPORARY RESTRICTED AREA EER2427 … ALL AIRCRAFT (INCLUDING UNMANNED AIRCRAFT) ARE PROHIBITED …“ mit `applicability[{permanent:"NO", startDateTime, endDateTime}]` |
| `EEGZS1`, `EERZout` | 2 | `PROHIBITED` | u. a. „Foreign territory“ |
| `hidden: true` | 1 | | ausblenden (wie AT) |

Höhen: 199× `M AGL`, 34× `FT AGL` (NOTAM). `lowerMeters`/`upperMeters`
sind schon in Metern.

### 6.3 Aktualisierung

- Feste Zonen (`metaData.updateDateTime` zuletzt 2026-08-07): selten.
- NOTAM-Zonen: `metaData.updateDateTime` aller NOTAM-Features war bei drei
  Abrufen um 00:15, 00:22 und 00:32 UTC einheitlich
  `2026-11-15T00:00:22Z`. Der Abgleich mit dem NOTAM-PIB läuft also im
  Stapel, um 00:30 kam aber kein neuer Zeitstempel. Entweder ist der Takt
  länger als 30 Minuten, oder der Zeitstempel ändert sich nur bei
  inhaltlichen Änderungen. Den Takt „alle 30 Minuten“ nennt **keine
  offizielle Seite**, und die Messung bestätigt ihn **nicht**.
- Der Socket.io-Push `uas` existiert vermutlich wie in AT (ungetestet).
- Empfehlung: Abruf bei App-Start und vor der Flugprüfung, sonst täglich.
  Wegen NOTAM besser alle paar Stunden im Vordergrund.

### 6.4 Lizenz

Weder Transpordiamet noch EANS nennen eine Lizenz. Transpordiamet bietet die
Datei aber ausdrücklich öffentlich zum Download an. Hinweis der Behörde:
Die Karte „is a supplementary source of information on permanent safety
restrictions in the Estonian airspace“, und NOTAM müssen zusätzlich auf
`aim.eans.ee` geprüft werden.

**Geklärt (2026-11-15):** EANS hat bestätigt, dass die Daten öffentlich sind
und frei genutzt werden dürfen. **Umgesetzt** in `fetchEstonia()` /
`shared/estonianGeozones.ts`.

Attribution (Vorschlag): **„Quelle: EANS (Lennuliiklusteeninduse AS) /
Transpordiamet, utm.eans.ee“**.

### 6.5 Vorschlag Restriction-Mapping

`restriction` aus dem Feed ist **nicht** verwendbar (202 von 233 =
`NO_RESTRICTION`, auch bei Genehmigungs- und Sperrzonen). Vorschlag:

| Bedingung | Mapping |
|---|---|
| `restriction == "PROHIBITED"` | `PROHIBITED` |
| NOTAM (`metaData.author == "EANS NOTAM PIB"`) und Text enthält `PROHIBITED` | `PROHIBITED` (sonst `REQ_AUTHORISATION`) |
| `EERZ…` (Sicherheitszonen, „must have a permission“) | `REQ_AUTHORISATION` |
| `EER…` mit `reason == "Nature"` | `NATURE` |
| `EER…` sonst | `REQ_AUTHORISATION` |
| `EED…` | `CONDITIONAL` |
| `EEGZ…` mit `REQ_AUTHORISATION` | `REQ_AUTHORISATION` |
| `EEGZ…` mit `NO_RESTRICTION` | `CONDITIONAL` (Flugplatzumgebung, Text anzeigen) |
| Fallback | Text aus `localizedMessages` (en) auf „permission“/„prohibited“ prüfen |

### 6.6 Integration

`fetchAustria()` lässt sich generalisieren
(`fetchFrequentisAvm(baseUrl, country)`). Zeitfenster `start`/`end` wie AT
§5.1, `hidden` filtern. `ed269IsActiveAt` funktioniert unverändert
(`applicability`/`schedule`). Neu ist nur der estnische
Restriction-Normalizer.

### 6.7 Schnelltest

```bash
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
S=$(date -u +%Y-%m-%dT%H:%M:%S.000Z); E=$(date -u -d '+1 year' +%Y-%m-%dT%H:%M:%S.000Z)
curl -s -A "$UA" "https://utm.eans.ee/avm/utm/uas.geojson?start=$S&end=$E" | jq '{n:(.features|length), restr:([.features[].properties.restriction]|group_by(.)|map({(.[0]):length})|add), notam:([.features[].properties|select(.metaData.author=="EANS NOTAM PIB")|.metaData.updateDateTime[0:16]]|unique)}'
```

---

## 7. Dänemark (Trafikstyrelsen)

### 7.1 Offizielle Quellen (Stand heute)

Es gibt zwei offizielle Seiten mit **unterschiedlichen** Links:

1. **`https://dronezoner.eu/API/`** („Dronezoner Data API v3.0 –
   Trafikstyrelsen“, verlinkt von `droneregler.dk/dronezoner/dronezoner-data-vejledninger`
   als „API-adgang“). Zitat: „Faste download-URLs til officielle dronezone-geodata
   og naturområder. Designet til automatisk integration — data opdateres dagligt
   kl. 03:00 CET. … Alle URLs er faste og ændres ikke — du kan trygt pege din
   applikation direkte på dem.“ 14 Endpunkte (9 Dronezoner + 5 Natur).
2. **`https://www.en.droneregler.dk/uas-geo-zones/data-for-download`**
   (englisch, älter). Verlinkt die ArcGIS-Items mit dem Titelzusatz **`_old`**.

| Datensatz / Format | URL (`https://trafikstyrelsen.maps.arcgis.com/sharing/rest/content/items/<id>/data`) | Item-Titel | zuletzt geändert |
|---|---|---|---|
| **Dronezoner GeoJSON** | `980697acd04d4a9bb1fd34bbefab924a` | DroneZoner RØD-ORANGE-BLÅ GeoJson | 2026-11-14 02:01 UTC |
| Dronezoner GeoPackage | `048f825f32e3444d8989a6701f477eec` | … GeoPackage | 2026-11-14 |
| Dronezoner Shapefile | `6eaf92665c0244c7b5b2f56f805d8717` | … Shapefile | 2026-11-14 |
| Dronezoner KML Point / Polygon | `19b7580f09d04433b4ce6d2884feeb33` / `878250cbf2504a0db98c49e9a06a25cf` | | 2026-11-14 |
| Dronezoner KMZ Point / RØD / ORANGE / BLÅ | `e2359c1f…` / `67d686c5…` / `2073d3ca…` / `5df3b2a6…` | | 2026-11-14 |
| **Naturområder GeoJSON** | `ff657943724944faaf19807380f5e24a` | NaturOmraader GRØN GeoJSON | 2026-11-14 02:03 UTC |
| Natur GeoPackage / Shapefile / KML / KMZ | `3b8fb690…` / `95f75b5c…` / `92fa2e08…` / `451143b8…` | | 2026-11-14 |
| *alt:* GeoJSON `_old` | `f049a65ae2f34bd1b747895d555dac71` | DroneZoner RØD-ORANGE-BLÅ GeoJson_old | 2026-11-14 (wird weiter befüllt) |
| *alt:* GeoPackage/Shapefile `_old` | `1a629c73…` / `297bf92f…` | `_old` | 2026-11-14 |
| *alt:* KML/KMZ (en-Seite) | `c92fcd16…` / `ecd189c4…` | „DroneZoner 2025 ny bekndg_kml/kmz“ | **2025-11-04, eingefroren** |

### 7.2 Vergleich mit `ed269Sources.ts`

| Konstante | Unser Wert | Bewertung |
|---|---|---|
| `DK_GEOZONES_URL` | `…/980697acd04d4a9bb1fd34bbefab924a/data` | ✅ **offiziell und aktuell** (Haupt-GeoJSON der API-Seite, feste URL) |
| `DK_LEGACY_GEOZONES_URL` | `…/f049a65ae2f34bd1b747895d555dac71/data` | ⚠️ `_old`-Item. Wird noch täglich aktualisiert und von der englischen Seite verlinkt. Enthält **42 Features mehr** (1835 statt 1793): `Type 22 = MMO` (4) und `Type 23 = MGZ` (37) sowie 1× „Sikringskritisk område“. Diese militärischen Typen fehlen im neuen Datensatz. Als Fallback ok, prüfen ob MMO/MGZ bewusst entfernt wurden (Anfrage an dronezoner@trafikstyrelsen.dk) |
| `DK_NATURE_ZONES_URL` | FeatureServer `NaturOmraader2024v2/FeatureServer/0/query?…f=geojson` | ⚠️ funktioniert (140 Features, `maxRecordCount 2000`, `dataLastEditDate 2026-10-31`), ist aber **kein offiziell zugesagter Endpunkt**. Ersetzen durch die feste URL `…/ff657943724944faaf19807380f5e24a/data` (140 Features, 944 KB / 368 KB gzip, gleiches Schema: `Temanavn`, `Fuglebeskyttelsesområder_og_Hab`, `Restriktionsperiode_`, `Årsag__`, `Aktiv` JA/NEJ, `URL`) |

### 7.3 Format (Dronezoner-GeoJSON)

`FeatureCollection`, `crs EPSG:4326`, Geometrien `Polygon`, `MultiPolygon`,
`Point` (Signaturen). Gemessen: **1793 Features**, 10 872 739 B roh,
3 148 814 B gzip (`Accept-Encoding: gzip` wird unterstützt).

Felder: `OBJECTID`, `typeId` (dänischer Typname, z. B. „Vandflyveplads“),
`title` („EKAC - Aarhus Vandflyveplads“), `Farve` (1 = rot, 4 = orange,
5 = blau), `Type` (numerischer Typ), `Bufferzone`, `Lovkrav`, `Enhed`,
`Elevation_fod`, `Elevation_meter`, `ICAO`, `Version`, `Kommentar`.
Verarbeitung: unverändert über `normalizeDanishFeatures` in
`shared/danishGeozones.ts`.

### 7.4 Aktualisierung

**Täglich 03:00 CET** (Item-`modified` 02:01 UTC, Snippet „Opdateret 14/11
2026 kl. 03:01“). Zitat API-Seite: „Udgåede zoner filtreres automatisk fra
ved den daglige opdatering.“ NOTAM und ICAO-Karten sind nicht enthalten
(„hentes hos Naviair“).

### 7.5 Vorschlag Restriction-Mapping

Unverändert gegenüber `shared/danishGeozones.ts`: `Farve 1` (rød,
flyvesikringskritisk) → `REQ_AUTHORISATION` bzw. `PROHIBITED` je nach `Type`,
`Farve 4` (orange, opmærksomhed) → `CONDITIONAL`, `Farve 5` (blå,
sikringskritisk) → `REQ_AUTHORISATION`, Natur `Aktiv = JA` → `NATURE`
(aktiv), `NEJ` → `NATURE` inaktiv bzw. nur Info.

### 7.6 Lizenz – Widerspruch beachten

- ArcGIS-Items (alle) und Fußzeile von `dronezoner.eu/API/`: **„Data kan frit
  anvendes med kildeangivelse“** (darf frei mit Quellenangabe genutzt werden),
  `accessInformation: Trafikstyrelsen`.
- Englische Seite droneregler.dk: „Data for personal use only. The data below
  is exclusively for personal use. For any other purposes, an agreement must be
  made with … the Danish Civil Aviation and Railway Authority.“

Die neuere API-Seite und die Item-Metadaten sprechen für freie Nutzung mit
Quellenangabe.

**Geklärt (2026-11-15):** Trafikstyrelsen hat per E-Mail bestätigt, dass die
Daten wie auf der API-Seite angegeben frei mit Quellenangabe nutzbar sind.
Die Frage nach den militärischen Typen MMO/MGZ im `_old`-Datensatz liegt
dort zur Prüfung vor; bis zur Antwort bleibt der alte Datensatz als
Rückfallquelle. Naturschutz-URL auf `ff657943…` umgestellt.
Attribution: **„Kilde: Trafikstyrelsen (dronezoner.dk)“**.

### 7.7 Schnelltest

```bash
B=https://trafikstyrelsen.maps.arcgis.com/sharing/rest/content/items
curl -s "$B/980697acd04d4a9bb1fd34bbefab924a?f=json" | jq '{title, modified:(.modified/1000|todate), licenseInfo}'
curl -s --compressed "$B/980697acd04d4a9bb1fd34bbefab924a/data" | jq '{n:(.features|length), farve:([.features[].properties.Farve]|group_by(.)|map({(.[0]|tostring):length})|add)}'
curl -s --compressed "$B/ff657943724944faaf19807380f5e24a/data" | jq '{n:(.features|length), aktiv:([.features[].properties.Aktiv]|group_by(.)|map({(.[0]):length})|add)}'
```

---

## 8. Übersichtstabelle

| | SE | NO | CH (+FL) | FI | EE | DK |
|---|---|---|---|---|---|---|
| Endpunkt | ED-318-Datei + WFS | ED-269-Datei (Name mit Datum) | ED-269-Datei | ED-269-API | Frequentis-GeoJSON | ArcGIS-Item-GeoJSON |
| Auth | – | – | – | – | – | – |
| Parameter | WFS: `typename`, `srsname`, opt. `CQL_FILTER` | – | – | – (`lang` wirkungslos) | `start`/`end`, `bounds` | – |
| Format | ED-318 / GeoJSON (eigene Felder) | ED-269 (Array) | ED-269 | ED-269 | GeoJSON + ED-269-Properties (wie AT) | GeoJSON (eigene Felder) |
| Zonen | 72 + WFS | 1391 | 1288 | 739 | 233 | 1793 + 140 |
| Größe roh | 0,58 MB + ~2,5 MB | 2,9 MB | 18,1 MB | 1,7 MB | 5,1 MB | 10,9 MB + 0,9 MB |
| gzip vom Server | ED-318 nein / WFS ja | ja (0,66 MB) | nein | nein | nein | ja (3,1 MB) |
| auf Gerät (5 Nachkommastellen, minify) | ~0,23 MB + WFS | 2,9 MB | ~6,9 MB | ~0,76 MB | ~2,8 MB | ~6,2 MB |
| Höhenfelder | `geometry.layer` / WFS-Strings | `geometry[]` | `geometry[]` (99999 = UNL) | `geometry[]` (oft null) | `lowerMeters`/`upperMeters` | `Elevation_*` |
| Zeitsteuerung | `limitedApplicability`, SUP `FROM`/`TO`, NOTAM | `applicability` (NOTAM) | `applicability` + `dailyPeriod` | `applicability` (Periodenende) | `applicability` + `schedule` | Natur `Aktiv` |
| NOTAM enthalten | ja (WFS `dynais:NOTAM`) | ja (Stand Build) | nein (DABS separat) | nein | **ja (34)** | nein |
| Sprache | sv + en | nb | en | fi | en + et | da |
| Update | AIRAC / NOTAM live | täglich ~01 UTC | täglich ~22 UTC | bei Abruf | NOTAM im Stapel (Takt unbestätigt), fest selten | täglich 03:00 CET |
| Lizenz | CC BY 4.0 | NLOD 2.0 | Opendata BY | (CC BY 4.0, nicht explizit) | nicht angegeben | frei mit Quellenangabe (Widerspruch) |
| Restriction-Feld brauchbar? | ja (`type`) | ja | **nein** → `restrictionConditions` | ja | **nein** → Kennung/Text | Farve/Type |

---

## 9. Empfohlene Integrationsreihenfolge

1. **DK aufräumen (klein):** `DK_GEOZONES_URL` bleibt. `DK_NATURE_ZONES_URL`
   auf `…/ff657943724944faaf19807380f5e24a/data` umstellen (feste offizielle
   URL, gleiches Schema). Legacy-Fallback `f049…` behalten, bis geklärt ist,
   ob MMO/MGZ absichtlich fehlen. Quellen-Doku/Attribution anpassen.
2. **EE (klein, hoher Nutzen):** Gleiche Plattform wie AT. `fetchAustria()`
   zu `fetchFrequentisAvm()` verallgemeinern, Zeitfenster setzen, `hidden`
   filtern, estnischen Restriction-Normalizer (§6.5) ergänzen. NOTAM sind
   schon im Feed. ✅ Umgesetzt, Nutzung von EANS freigegeben.
3. **FI (klein):** Neuer Fetch plus ein generischer Konverter für „reines
   ED-269“ (UASZone mit `geometry[]` → GeoFeature). Der Konverter aus
   `shared/belgianGeozones.ts` (`skeyesGeometryToGeoJson`, `skeyesContact`)
   lässt sich nach `shared/ed269Pure.ts` herausziehen und ist dann auch für
   CH und NO nutzbar. Null-Höhen als SFC/UNL behandeln, `permanent:"YES"` mit
   Enddatum nicht als Ablauf werten.
4. **CH (mittel):** Mit `shared/ed269Pure.ts` übernehmen, Mapping über
   `restrictionConditions` (§4.6), `dailyPeriod` in `schedule` übersetzen.
   18 MB ohne gzip: nur mit `If-Modified-Since`/täglich, sofort runden.
   REST-Identify für `einschraenkungen-drohnen` danach entfernen. WMS für
   Landschaftsruhezonen behalten. Aktivitätszonen optional als Zusatz.
5. **NO (mittel):** `index.html` scrapen, um den Dateinamen zu ermitteln.
   Danach dasselbe Pure-ED-269 (nacktes Array). Mapping §3.5, `NATURE` mit
   Saison-Hinweis.
6. **SE (größter Aufwand):** ED-318-Normalizer (mehrsprachig, Kreise → Polygon,
   `geometry.layer`) plus 5–7 WFS-Layer mit eigenem Mapping (§2.7), Höhen-
   Strings parsen (ft AMSL / FL / GND). NOTAM-Layer filtern (`CODE23` R/W,
   `LOWER` ≤ 500 ft). Regeln für CTR/RWY5K/HKP1K vorher fachlich prüfen.

Für alle neuen Länder:

- `CountryIsoWithGeozones` und `ED269_DIRECT_COUNTRIES` erweitern.
- Testfixtures (gekürzt) unter `client/lib/__tests__/` anlegen, analog
  `austriaGeozones.test.ts`.
- `geozoneCoverage.test.ts` um die neuen Host-Präfixe ergänzen.
- Attributionstexte in der Quellenanzeige (`shared/ed269SourceInfo.ts`)
  hinterlegen.

---

## 10. Offene Punkte

- **DK:** Fehlen `MMO`/`MGZ` (militärisch) im neuen Datensatz absichtlich?
  Gilt die Lizenz „frit med kildeangivelse“ oder „personal use only“?
  → dronezoner@trafikstyrelsen.dk.
- **EE:** Lizenz und Nutzungsfreigabe sowie der tatsächliche NOTAM-Takt sind
  ungeklärt. → utm@eans.ee.
- **FI:** Lizenz nicht auf der Download-Seite. → copyright@traficom.fi. Wie
  sind die `null`-Höhen gemeint (SFC/UNL)? Ist das Volume mit
  „120 FT AMSL“ ein Datenfehler?
- **NO:** Gibt es einen stabilen, undatierten Alias? Ab welcher Uhrzeit
  existiert die neue Tagesdatei?
- **SE:** Genaue aktuelle Regeln in CTR außerhalb RWY5K und für HKP1K
  (Transportstyrelsen, TSFS 2017:110 / Nachfolger).
- **CH:** Würde geo.admin.ch gzip aktivieren (Anfrage), oder lohnt die
  GeoJSON-Variante (13,9 MB, `MultiPolygon`, flache Properties)?
