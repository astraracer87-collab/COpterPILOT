# ENAIRE (ES) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **drones.enaire.es** / ENAIRE AIS (Spanien).
Stand: 2026-11-15. Freigabe liegt laut Product Owner schriftlich vor.

Grundlage ist die **offizielle ENAIRE-API-Spezifikation** „Digital AIS Data
Services – AIS Data Service for UAS Geographical Zones" **v3.1 (2026-09-17)**
(`https://aip.enaire.es/recursos/descargas/ZGUAS/servAIS_APIDOC.pdf`), nicht
ein eigener Live-Abruf (siehe §6).

Vergleich: NL/AT/IT/LU/IE/PL/BE/PT-Dokumente in `docs/`.

---

## 1. Kurzfassung

- ENAIRE stellt die spanischen UAS-Geozonen als **offenen AIS-Datendienst**
  bereit – **ohne API-Key**, über drei Standard-Transporte: **ArcGIS REST**,
  **OGC WFS 2.0** und **OGC WMS 1.3.0**.
- Datenmodell ist **EUROCAE ED-318** (Nachfolger von ED-269); die Spec liefert
  eine vollständige Feld-Zuordnung auf das ED-318-Modell → passt sehr nah an die
  vorhandene ED-269-Logik der App.
- **Daten-Host:** `servais.enaire.es` (ArcGIS „insigniads").
- ⚠️ **Aus dieser Umgebung nicht testbar:** sowohl `drones.enaire.es` als auch
  `servais.enaire.es` werden von einer **WAF** mit `403 "The requested URL was
  rejected"` blockiert (Datacenter-/Nicht-ES-IP). Aus der App (echte Geräte,
  EU-IPs) ist der Dienst normal erreichbar. Die Endpunkte und Felder unten
  stammen **verbatim aus der offiziellen ENAIRE-Spec**.

---

## 2. Datenebenen (3 Layer)

| Layer (typeName) | Inhalt | Rechtsgrundlage (RD 517/2024) |
|---|---|---|
| `ZGUAS_Aero` | Zonen aeronautischen Ursprungs (aus AIP) | Art. 37, 41, 42 |
| `ZGUAS_Urbano` | Öffentliche Sicherheit / Schutz von Personen & Gütern im urbanen Raum | Art. 40 |
| `ZGUAS_Infraestructuras` | Schutz von Anlagen/Infrastruktur (inkl. Bahn-Zonen von CIDETRA) | Art. 39 |

---

## 3. Zugriff (aus der Spec, §6)

> ✅ **Korrektur (live verifiziert von DE-IP, 2026-11-15):** Der in der PDF-Spec
> genannte `…/insigniads/.../SRV_UAS_ZG_data_V2/FeatureServer` ist **veraltet**.
> Die Live-Karte `drones.enaire.es` nutzt aktuell **`insignias`** (anderer Pfad)
> und **MapServer/<Layer>/query**. Von einer EU-IP direkt erreichbar
> (HTTP 200, `application/geo+json`), **ohne Auth**. Der WAF-403 trat nur aus
> der US-Cloud auf.

**Aktuelle Basis:** `https://servais.enaire.es/insignias/rest/services/`

### 3.1 ArcGIS REST – AKTUELLE Services (live)
| Service / Layer | Zweck |
|---|---|
| `NSF/Drones_ZG_Aero_V3/MapServer` | **Luftfahrt-Zonen (Hauptservice)** |
| `NSF/Drones_ZG_Infra_V0/MapServer/11` | Infrastruktur |
| `NSF/Drones_ZG_Urbano_V0/MapServer/11` | Urbane Zonen |
| `NOTAM/NOTAM_UAS_APP_V3/MapServer/1` | NOTAM |
| `ENP/ENP_APP_Local_V4/MapServer/0,1` | Naturschutz |

Layer in `Drones_ZG_Aero_V3`: [0] AERODROMOS · [1] ZG_EAC_FIZ · [2] AVISOS ·
[3] ZG_RVF · [4] AEROMODELISMO · [6] ZG_Aeródromos · [10] ZG_Restringidas.

- Abruf als GeoJSON:
  `…/insignias/rest/services/NSF/Drones_ZG_Aero_V3/MapServer/<layer>/query?where=1=1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`
- **Höhenfilter (<120 m):** `where=RESTRICCION_LOWER < 120` (Feld existiert nicht
  auf jedem Layer – pro Layer prüfen).
- Beispiel (funktioniert):
  `https://servais.enaire.es/insignias/rest/services/NSF/Drones_ZG_Aero_V3/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson`
- **Fixtures (lokal erfasst):** `fixtures/enaire_Drones_ZG_Aero_V3_MapServer.json`
  (Metadaten), `fixtures/enaire_aero_layer0_sample.geojson` (echte Features).

#### Veraltet (nur als Referenz, aus PDF-Spec v3.1)
```
https://servais.enaire.es/insigniads/rest/services/NSF_SRV/SRV_UAS_ZG_data_V2/FeatureServer   # veraltet
```
- Punkt-in-Polygon (Standort-Check): `…/query?geometry=<lon>,<lat>&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=geojson`

### 3.2 OGC WFS 2.0
```
https://servais.enaire.es/insigniads/services/NSF_SRV/SRV_UAS_ZG_data_V2/MapServer/WFSServer
```
- Capabilities: `…/WFSServer?request=GetCapabilities&service=WFS`
- Beispiel (Aero-Layer): `…/WFSServer?service=WFS&version=2.0.0&request=GetFeature&typeName=ZGUAS_Aero`
- GeoJSON erzwingen: `&outputFormat=GEOJSON` (sonst GML).

### 3.3 OGC WMS 1.3.0 (Raster/Overlay)
```
https://servais.enaire.es/insigniads/services/NSF_SRV/SRV_UAS_ZG_data_V2/MapServer/WMSServer
…/WMSServer?request=GetCapabilities&service=WMS
```

Keine Authentifizierung. Produktionsdienst, hohe Verfügbarkeit (kein 24/7-
Support). Kontakt: `ais@enaire.es`.

---

## 4. Datenmodell (ED-318, aus der Spec §4)

Service-Attribut → ED-318-Feld (Auszug der wichtigsten):

| Service | ED-318 | Hinweis |
|---|---|---|
| `Identifier` | `UASZone.identifier` | Dedupe |
| `Country` | `UASZone.country` | `ESP` |
| `Type` | `UASZoneVersion.name`/type | |
| `Name` | `UASZoneVersion.name` | |
| `Reasons` | `UASZoneVersion.reason` | |
| `RestrictionConditions` | `UASZoneVersion.restrictionConditions` | |
| `RegulationExemption` | `UASZoneVersion.regulationExemotion` (sic) | |
| `Message` | `UASZoneVersion.message` | |
| `Lower`/`LowerReference`/`Upper`/`UpperReference`/`UOM` | `VerticalLayer.*` | Höhen + Bezug + Einheit |
| `StartDateTime`/`EndDateTime` | `TimePeriod.*` | Gültigkeit |
| `Day`/`StartTime`/`StartEvent`/`EndTime`/`EndEvent` | `DailyPeriod.*` | Wiederkehrende Aktivzeiten |
| `Purpose`/`Service`/`ContactName`/`SiteURL`/`Email`/`Phone`/`Name_Authority`/`IntervalBefore` | `Authority*.*` | Freigabestelle |
| `Issued`/`ValidFrom`/`ValidTo`/`Provider`/`Description` | `DatasetMetadata.*` | Versionsinfo |
| `CreationDateTime`/`UpdateDateTime` | `Metadata.*` | |
| `Shape` | `Geometry` | Polygon |

> ED-318 ist aufwärtskompatibel zu ED-269. Die vorhandene
> `normalizeEd269Restriction`/Höhen-/Zeitlogik lässt sich wiederverwenden; nur
> die Feldnamen (ArcGIS-/WFS-Attribute, z. B. `RestrictionConditions`,
> `Lower`/`Upper`, `StartDateTime`) auf das interne Modell mappen.

---

## 5. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- ES ist in der App nur verlinkt (`shared/countryMaps.ts`), keine Geodaten.
- ED-269-Pipeline vorhanden; ED-318-Felder lassen sich darauf mappen.

### Schritte
1. **Quelle** `client/lib/geozoneDirect/enaireSource.ts`:
   - `ES_ENAIRE_FS = "https://servais.enaire.es/insigniads/rest/services/NSF_SRV/SRV_UAS_ZG_data_V2/FeatureServer"`
   - `fetchSpain()`: für jeden der 3 Layer `…/<id>/query?where=1=1&outFields=*&outSR=4326&f=geojson`, paginiert
     (`resultOffset`/`resultRecordCount`, ArcGIS-Default-Limit beachten).
2. **Normalisierung** `shared/spanishGeozones.ts`: ArcGIS-/ED-318-Attribute →
   internes Modell (Restriction, Höhen `Lower`/`Upper`+`UOM`+`*Reference`,
   Gültigkeit `StartDateTime`/`EndDateTime` + `DailyPeriod`, Autoritätskontakt).
3. `"es"` in die Länderliste; da nicht reines ED-269-GeoJSON, eigener Pfad (wie
   PL), nicht einfach `ED269_DIRECT_COUNTRIES`.
4. **Label**: `ES: "ENAIRE (ED-318)"`. **Pflicht-Attribution:** Laut
   Nutzungsbedingungen muss **ausdrücklich** genannt werden, dass **ENAIRE**
   Inhaber der Rechte ist („© ENAIRE"). In Popup/Impressum aufnehmen.
5. **Alternativ/ergänzend WMS** als Raster-Overlay, falls Vektorabruf zu groß.
6. **Tests**: ED-318-Feld-Mapping, Höhen/Zeitfenster, 3-Layer-Merge, Dedupe
   über `Identifier`.
7. **Refresh**: täglich; Updates erfolgen an AIRAC-Donnerstagen (28 Tage).
   `ValidFrom`/`ValidTo`/`Issued` zur Versionskontrolle.

---

## 6. Offene Punkte
1. **Live-Verifikation von einer EU-/ES-IP:** Aus dieser Umgebung durch die
   ENAIRE-WAF (403) nicht möglich. FeatureServer-Layer-IDs, Feldnamen (exakte
   Schreibweise) und GeoJSON-Ausgabe dort einmal gegenprüfen und eine Fixture
   einchecken.
2. **Nutzungsbedingungen:** ENAIRE verlangt den ausdrücklichen Rechtehinweis.
   Freigabe/Bedingungen im Repo ablegen. NOTAM offiziell über „Ícaro XXI",
   nicht aus diesem Dienst.
3. **ED-318 vs. ED-269:** Feldnamen der ArcGIS-Attribute final an der echten
   Antwort verifizieren (die Spec nennt Service-Attribut ↔ ED-318, aber die
   tatsächlichen ArcGIS-`outFields`-Namen können leicht abweichen).

---

## 7. Schnelltest (von einer EU-/ES-IP ausführen)

```bash
BASE="https://servais.enaire.es/insigniads/rest/services/NSF_SRV/SRV_UAS_ZG_data_V2/FeatureServer"
curl -s "$BASE?f=json" | jq '.layers'
curl -s "$BASE/0/query?where=1%3D1&outFields=*&outSR=4326&resultRecordCount=1&f=geojson" \
  | jq '.features[0].properties'
```

---

## 8. Verifizierte Daten – KOMPLETT abgerufen (DE-IP, 2026-11-15)

Alle Layer live als GeoJSON geholt (`features/`-Zähler bestätigt). Übersicht:
`docs/geozonen-daten-abruf-DE-2026-11-15.md`.

**Service `NSF/Drones_ZG_Aero_V3/MapServer`:**
| Layer | Name | Features |
|---|---|---|
| 0 | AERODROMOS | 563 |
| 1 | ZG_EAC_FIZ | 223 |
| 2 | AVISOS | 184 |
| 3 | ZG_RVF | 119 |
| 4 | AEROMODELISMO | 257 |
| 6 | ZG_Aeródromos | 1.305 |
| 10 | ZG_Restringidas | 370 |

**Weitere Services:** `Drones_ZG_Infra_V0/11` (Infrastruktur, **14.163**),
`Drones_ZG_Urbano_V0/11` (urban, 4), `NOTAM_UAS_APP_V3/1` (NOTAM, 745),
`ENP_APP_Local_V4/0` (Naturschutz, 1.814), `ENP_APP_Local_V4/1` (1.321).

### ⚠️ Größenwarnung (wichtig für die App)
- **`Drones_ZG_Infra_V0/11` ≈ 177 MB** und **`ENP_APP_Local_V4/0` ≈ 221 MB**
  (sehr detaillierte Geometrie). Diese Layer **nicht** roh ins Gerät laden.
- Empfehlung: serverseitig/beim Abruf **vereinfachen** (ArcGIS-Parameter
  `maxAllowableOffset=<grad>` bzw. `geometryPrecision`), nur benötigte
  `outFields` holen, und/oder **bbox-/viewport-basiert** statt landesweit laden
  (`geometry=<bbox>&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects`).
  ArcGIS liefert maximal `maxRecordCount` (hier 2000) pro Request → **paginieren**
  (`resultOffset`/`resultRecordCount`).
- Für die reine Drohnen-Geo-Awareness sind v. a. `ZG_Restringidas`, `ZG_EAC_FIZ`,
  `ZG_RVF` und NOTAM relevant; Infra/ENP (Naturschutz) als optionaler Layer.

### Höhenfilter
`where=RESTRICCION_LOWER < 120` – Feld existiert nur auf Layern mit Höhen;
pro Layer prüfen (Flugplatz-Punktlayer haben es nicht).

---

## Anhang ES: vollständige Layer-Liste + Skript (DE-Session, 2026-11-15)

**Werkzeug im Repo:** [`docs/tools/spain/enaire_es_geozones.py`](tools/spain/enaire_es_geozones.py)
(requests) → je Layer eine GeoJSON + Gesamtdatei, Paging über `resultOffset`.

Basis `https://servais.enaire.es/insignias/rest/services/` (direkt, **nicht** der
Webseiten-Proxy `drones.enaire.es/proxy_Insignia`). Alle Layer: `f=geojson`,
`outSR=4326`, Paging; `GFID` = stabiler Schlüssel; `LASTMOD_DATE` für Diffs.

| Layer | Pfad | Anz. | max |
|---|---|---|---|
| EAC/FIZ | `NSF/Drones_ZG_Aero_V3/MapServer/1` | 223 | 2000 |
| Aeródromos (Schutzzonen) | `NSF/Drones_ZG_Aero_V3/MapServer/6` | 1.305 | 2000 |
| Restringidas (P/R/TSA/TRA) | `NSF/Drones_ZG_Aero_V3/MapServer/10` | 370 | 2000 |
| RVF (Foto) | `NSF/Drones_ZG_Aero_V3/MapServer/3` | 119 | 2000 |
| Avisos | `NSF/Drones_ZG_Aero_V3/MapServer/2` | – | 2000 |
| **Infraestructuras** | `NSF/Drones_ZG_Infra_V0/MapServer/11` | **14.163** | 4000 |
| Urbano | `NSF/Drones_ZG_Urbano_V0/MapServer/11` | 4 | 2000 |
| NOTAM (dynamisch) | `NOTAM/NOTAM_UAS_APP_V3/MapServer/1` | 744 | 3000 |
| ENP (Naturschutz) | `ENP/ENP_APP_Local_V4/MapServer/0` | 1.814 | 2000 |
| ZEPA (Vogelschutz) | `ENP/ENP_APP_Local_V4/MapServer/1` | 1.321 | 2000 |

- **Höhen:** `RESTRICCION_LOWER`/`RESTRICCION_UPPER` (Meter, drohnenmaßgeblich);
  Infra-Layer nutzt ED-269-nahe Felder (`type`, `lower`/`upper`+Reference).
- Polygone teils **mit Löchern** (Ring-Zonen) → innere Ringe behalten. Überlappung
  → strengste Zone (kleinstes `RESTRICCION_UPPER`). `REMARKS_TXT*` enthält **HTML**.
- NOTAM stündlich (`itemB`/`itemC` filtern); Rest täglich. Attribution „© ENAIRE – AIS".
- ⚠️ Dienstnamen `_V3`/`_V0` können sich mit neuer Version ändern → dann Web-Map-
  Definition (`…/insigniap/sharing/rest/content/items/b0449bba…/data?f=json`) neu lesen.

---

## Anhang ES (2): letzte Gap-Punkte umsetzbar (NOTAM-Filter + dynamische Namen)

### NOTAM zeitlich filtern (Layer `NOTAM/NOTAM_UAS_APP_V3/MapServer/1`)
Gültigkeit in **`itemB`** (von) / **`itemC`** (bis); zusätzlich `itemB_str`/
`itemC_str` (Text), `itemD` (Tagesplan), `itemE` (Klartext), `itemF`/`itemG` bzw.
`LOWER_VAL`/`UPPER_VAL`/`LOWER_VAL_AGL` (Höhen), `qcode`, `notamId`/`GFID`.
→ Nur **aktive/kommende** NOTAMs anzeigen: `itemB ≤ jetzt ≤ itemC`.
- Wenn `itemB`/`itemC` als Datum/Epoch abfragbar sind, serverseitig per `where`
  (z. B. `itemC >= TIMESTAMP '<jetzt>'`); sonst **alle** NOTAM laden und
  client-/serverseitig über die geparsten `itemB`/`itemC` filtern (Format beim
  ersten Abruf prüfen, analog ROMATSA/`dto`). **Stündlich** neu laden; abgelaufene
  (`itemC < jetzt`) verwerfen.

### Dienstnamen dynamisch auflösen (statt `_V3`/`_V0` hart zu verdrahten)
Die internen Versionssuffixe (`Drones_ZG_Aero_V3`, `Drones_ZG_Infra_V0`,
`NOTAM_UAS_APP_V3`, `ENP_APP_Local_V4`) können mit neuen ENAIRE-Versionen wechseln.
→ Beim Sync zuerst die **Web-Map-Definition** lesen und die Layer-URLs von dort
nehmen (wie bei SI):
```
GET https://servais.enaire.es/insigniap/sharing/rest/content/items/b0449bba555240e9b93207cd8c190f21/data?f=json
→ .operationalLayers[] (+ geschachtelte .layers[]) mit .title und .url
```
Mapping über den **Titel** (stabil: „ZG_EAC_FIZ", „ZG_Aeródromos",
„ZG_Restringidas", „ZG_Infraestructuras", „NOTAM", „ENP", „ZEPA" …) → `url`,
statt über den versionierten Pfad. Bei 404 die Item-Definition neu lesen. Die
festen Pfade in §Anhang-ES-Tabelle bleiben nur **Fallback/Referenz**.

→ **Damit ist ES vollständig** (Geometrie, Höhen `RESTRICCION_*`, NOTAM-Zeitfilter,
versionsrobuste Auflösung). Skript `docs/tools/spain/enaire_es_geozones.py` ggf.
um das Item-Lookup erweitern.
