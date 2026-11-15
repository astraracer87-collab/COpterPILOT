# Lettland (LV) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu Lettlands UAS-Geozonen (LGS / SJSC „Latvijas gaisa
satiksme", AIS Latvia). Stand: 2026-11-15. Freigabe liegt vor.

Quellen vom Product Owner: `m.airspace.lv/mob/map`, `ais.lgs.lv/page/UAS_geozones`.

---

## 1. Kurzfassung

- Lettland hat **zwei Einstiegspunkte**:
  1. **`ais.lgs.lv/page/UAS_geozones`** – Seite des lettischen AIS, die auf das
     **„Latvian AIXM 5.1 Web Portal"** verweist (AIM-Umgebung). Deutet auf
     einen **AIXM-5.1-/ED-269-Datensatz** hin.
  2. **`m.airspace.lv/mob/map`** – mobile **Angular-Karte** (AIRSPACE.LV) für
     Piloten.
- Beide sind **ohne Login** erreichbar (HTTP 200). Der konkrete
  maschinenlesbare Daten-Endpunkt (GeoJSON/AIXM/WFS) ließ sich statisch noch
  nicht sicher festnageln (Angular-Bundle lädt die API dynamisch).
- Lettland (LGS) ist ein bekannter **ED-269-Veröffentlicher** – es existiert
  mit hoher Wahrscheinlichkeit ein sauberer ED-269-Feed.

## 2. Offener Punkt (nächster Schritt)
1. **Aus dem Browser:** `m.airspace.lv/mob/map` öffnen → DevTools → Netzwerk →
   die Datenanfrage mit den Zonen (GeoJSON/WFS/JSON) kopieren. Damit baue ich
   den Abruf sofort.
2. **Bei LGS/AIS (`ais.lgs.lv`) erfragen:** den **ED-269-/AIXM-5.1-Export** der
   UAS-Geozonen (bevorzugt – passt auf die vorhandene ED-269-Pipeline).

## 3. Verifizierte Fakten
- `ais.lgs.lv/page/UAS_geozones` → Verweis auf „Latvian AIXM 5.1 Web Portal".
- `m.airspace.lv/mob/map` → Angular-App (`main.*.js`, `runtime.*.js`), AIRSPACE.LV.
- Keine Authentifizierung auf den Einstiegsseiten.

## 4. Integration (sobald Endpoint vorliegt)
- Bei ED-269: wie AT/PT (`finalize(raw,"lv")`). Bei AIXM 5.1: Parser nötig
  (XML → internes Modell) oder, falls die Mobile-App GeoJSON nutzt, direkt das.
- `"lv"` in die Länderliste. Label `LV: "LGS / AIS Latvia (ED-269/AIXM)"`.
  Refresh täglich.

> **Stand:** Zwei öffentliche Einstiegspunkte verifiziert; der exakte
> Daten-Endpunkt fehlt noch (Browser-Capture oder ED-269/AIXM von LGS).

---

## 5. Befund (DE-IP, 2026-11-15): ArcGIS über Referer-Proxy 🟡 abrufbar

- Technik: **ArcGIS** (interner Server `LGS-AGS`) über einen Proxy:
  `https://m.airspace.lv/mob//proxy/proxy.ashx?<ziel-URL>`
- Services:
  - `DRONES/DronesZonesUAS/MapServer` – Zonen (AGL)
  - `DRONES/DronesZonesUASAMSL/MapServer` – Zonen (AMSL)
  - `DRONES/FIR_drones/MapServer`
  - Aktiv-Status (SOE): `…/MapServer/exts/DronesRestSOE/getJSONZones?oids=true&f=json&time=<ms>&endTime=<ms>`
    → aktive Zonen als OIDs, **unverschlüsseltes JSON**.
- **Hürde:** Der Proxy verlangt einen `Referer`-Header (sonst **403**). Mit
  gesetztem Referer (wie der Browser) direkt abrufbar:
  ```bash
  # Layer-Liste
  curl -s -H "Referer: https://m.airspace.lv/mob/map" \
    "https://m.airspace.lv/mob//proxy/proxy.ashx?https://LGS-AGS/rest/services/DRONES/DronesZonesUAS/MapServer/layers?f=json"
  # Zonen als GeoJSON (Layer-ID aus layers?f=json)
  curl -s -H "Referer: https://m.airspace.lv/mob/map" \
    "https://m.airspace.lv/mob//proxy/proxy.ashx?https://LGS-AGS/rest/services/DRONES/DronesZonesUAS/MapServer/0/query?where=1=1&outFields=*&returnGeometry=true&f=geojson"
  ```
  (Für AMSL-Zonen `DronesZonesUASAMSL` nehmen.) **Status LV: abrufbar** (mit
  Referer); Fixtures von der DE-Session nachziehen. Alternativ ED-269/AIXM 5.1
  bei LGS/AIS (`ais.lgs.lv`).

---

## Anhang LV: vollständig verifiziert (DE-Session, 2026-11-15) → ✅ einsatzbereit

Der **Desktop-Pfad** liefert dasselbe ohne Verschlüsselung, direkt als GeoJSON:
```
GET https://www.airspace.lv/Drones/proxy.ashx?https://LGS-AGS/pngzqkggemmzgqqj/rest/services/DRONES/DronesZonesUAS/MapServer/{LAYER}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson
Header: Referer: https://www.airspace.lv/Drones/app/2D/default/en-us
```
> Das Pfadsegment `pngzqkggemmzgqqj` ist LGS-konfigurationsabhängig → als Config
> ablegen; bei 404 `…/Drones/2DAppConfig.json` prüfen. `maxRecordCount` 5000
> (ein Request/Layer reicht). Formate: json/**geojson**/pbf.

### Vier Layer = Kategorie (`DronesZonesUAS/MapServer`)
| Layer | `RESTRICTIONNAME` | Bedeutung | Bestand (aktiv) |
|---|---|---|---|
| 0 | `PROHIBITED` | Flug verboten | 36 (17) |
| 1 | `REQ_AUTHORISATION` | nur mit Genehmigung | 713 (676) |
| 2 | `CONDITIONAL` | erlaubt unter Bedingungen | 61 (59) |
| 3 | `NO_RESTRICTION` | nur Info | 6 (3) |

(`DronesZonesUASAMSL` = AMSL-Darstellung; `FIR_drones` = FIR Riga/Landesgrenze.)

### Aktive Zonen: SOE `getJSONZones` (empfohlen statt eigener Zeitlogik)
```
GET .../DronesZonesUAS/MapServer/exts/DronesRestSOE/getJSONZones?time=<ISO>&endTime=<ISO>&oids=true&f=json
```
→ `results[].oids` je Layer = die **jetzt (oder im Zeitfenster) aktiven**
`OBJECTID`. **Vorgehen:** alle Zonen als GeoJSON cachen + regelmäßig
`getJSONZones` abfragen; in der App nur Features mit `OBJECTID ∈ oids` zeigen.

### Feldschema (ED-269-nah, 58 Felder – Auszug)
- **ID/Kategorie:** `IDENTIFIER` (ED-269-Zonen-ID, **mehrfach** = je Zeitscheibe
  eine Zeile), `ZONENAME` (EVR…=Restricted, EVD=Danger, EVCA=CTR), `COUNTRY`=`LVA`,
  `RESTRICTIONNAME`, `REASONNAME` (mehrere mit `#`, z. B. `SENSITIVE#PRIVACY`),
  `METADATADESC`/`CRC32` → **Änderungserkennung**.
- **Höhen:** `LOWERLIMIT`/`UPPERLIMIT` (Meter, `UOMDIMENSIONS=M`),
  `LOWERVERTICALREFNAME`/`UPPERVERTICALREFNAME` (`AGL`/`AMSL`). ⚠️ Viele
  Flugverbote haben **AMSL-Untergrenze** (z. B. 300 m AMSL, Militär EVR5F) →
  **nicht pauschal als Verbot** anzeigen, Höhen ausweisen / mit Geländemodell
  prüfen (LV ist flach, meist <300 m).
- **Zeit:** `TIMEPERIODSTARTDATE`/`ENDDATE` (ms UTC), `PERMANENT`=`NO` (immer),
  `MON…SUNSTARTTIME/ENDTIME` (tägliche Fenster, nur ~20 Zonen; nur Uhrzeit zählt,
  Datum 1988-12-30 Dummy; UTC/Ortszeit vor Produktiv prüfen).
- **Bedingungen (Layer 2)** `RESTRICTIONCONDITIONS`: kodiert, `/`-getrennt, `OR`
  für Alternativen (z. B. `PERMITTED/NOTIFICATION=YES`;
  `…/OP_CATEGORY=OPEN/MAX_UA_MASS=2000/OR/…`). Klartext-Wörterbuch:
  `https://www.airspace.lv/Drones/Content/restrictionConditionsDictionary-en.json`.
- **Kontakt/Genehmigung:** `MESSAGEENG`/`MESSAGE`, `TOFLYNAME`/`TOFLYSERVICE`/
  `TOFLYEMAIL`/`TOFLYPHONE`/`TOFLYSITEURL`, `TOFLYPURPOSE`
  (INFORMATION/AUTHORISATION/NOTIFICATION), `TOFLYINTERVALBEFORE…` (ISO-Dauer,
  z. B. `PT15M`).

### Integration
- `shared/latvianGeozones.ts`: Layer→`category`, Felder mappen (Referenz-Python
  im Quellbericht), `active_now` aus `getJSONZones`-OIDs. Backend-Abruf (Referer
  nicht in die App), alle 15 min; nur bei geänderter `METADATADESC`/`CRC`
  neu schreiben. `LV: "LGS / airspace.lv"`.
- **Status LV: einsatzbereit** (Desktop-GeoJSON + SOE-Aktivfilter verifiziert).
