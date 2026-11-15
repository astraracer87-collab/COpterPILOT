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
