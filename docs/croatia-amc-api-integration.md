# Kroatien (HR) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **amc.crocontrol.hr/amc/maps/** (Hrvatska kontrola
zračne plovidbe / Croatia Control – Airspace Management Cell, AMC).
Stand: 2026-11-15, **live verifiziert**. Freigabe liegt vor.

> **Korrektur gegenüber einer früheren Fassung:** Die Daten sind **anonym
> (ohne Login) vollständig abrufbar** – entgegen meiner ersten Einschätzung.
> Der Zugang läuft über einen **öffentlichen SignalR-Hub**. Unten der
> vollständige, verifizierte Weg.

Vergleich: übrige Länder-Dokumente in `docs/`.

---

## 1. Kurzfassung

- Das AMC-Portal lädt seine Daten über einen **klassischen ASP.NET-SignalR-Hub**
  (`aMCHub`) unter **`/amc/signalr`** – **ohne Authentifizierung** erreichbar.
- Nach `CLIC_ClientReady` pusht der Server u. a.:
  - **`SRVC_Areas`** – die **Luftraum-/Geozonen** als **WKT-Polygone** mit Typ
    und Höhen (**live: 565 Gebiete**).
  - `SRVC_DroneReservations` – drohnenspezifische Reservierungen/CTR-Zonen.
  - `SRVC_activeNotams` / `SRVC_activeFullNotams` – aktive NOTAMs (inkl.
    „UNMANNED ACFT").
  - `SRVC_aUPUUPs` – AUP/UUP (Airspace Use Plans).
  - `SRVC_ClientSettings` – Zonentyp-Legende (inkl. **drohnenspezifischer
    Typen UTR/UAG/ULG/URG**).
  - `SRVC_MetLayers` – METAR/Wetter.
- **Kein ED-269/GeoJSON**, aber ein sauberes, strukturiertes, anonym
  abrufbares Format (WKT + Felder). Integrierbar.

---

## 2. Zugang (klassisches SignalR, anonym)

**Hub:** `aMCHub` · **Endpoint-Basis:** `https://amc.crocontrol.hr/amc/signalr`

Ablauf (verifiziert):
```
1) GET  /amc/signalr/negotiate?clientProtocol=2.1&connectionData=[{"name":"aMCHub"}]
        → { ConnectionToken, TryWebSockets:true, ... }
2) WS   wss://amc.crocontrol.hr/amc/signalr/connect?transport=webSockets
            &clientProtocol=2.1&connectionToken=<TOKEN>&connectionData=[{"name":"aMCHub"}]
3) GET  /amc/signalr/start?transport=webSockets&clientProtocol=2.1
            &connectionToken=<TOKEN>&connectionData=[{"name":"aMCHub"}]
4) WS → senden:  {"H":"aMCHub","M":"CLIC_ClientReady","A":[],"I":0}
5) WS ← empfangen: {"C":"...","M":[{"H":"aMCHub","M":"SRVC_Areas","A":[[ ...zonen... ]]}, ...]}
```
- `connectionData` muss URL-codiert werden.
- Der Hub-Proxy (Methodenliste) steht offen unter `/amc/signalr/hubs`.
- Server→Client-Methoden heißen `SRVC_*`, Client→Server `CLIC_*`
  (nur `CLIC_ClientReady` nötig; die meisten übrigen `CLIC_*` sind
  authentifizierte Aktionen – Reservierungen, Konflikte – und für den reinen
  Datenabruf irrelevant).

---

## 3. Schema

### `SRVC_Areas` (Zonen) – 565 Gebiete, Verteilung D:147, TSA:183, TRA:230, MTA:4, R:1

| Feld | Beispiel | Bedeutung |
|---|---|---|
| `DBId` | `-883` | ID (Dedupe) |
| `Name` | `LDAD82` | Zonenkennung |
| `AreaType` | `D` | Zonentyp (siehe Legende §3.1) |
| `Poligon` | `POLYGON ((14.0108 45.3828, 14.095 45.2725, …))` | **WKT**-Polygon (lon lat), EPSG:4326 |
| `Lowerflightlevel` / `LowerUnit` | `0` / `FL` | Untergrenze |
| `Upperflightlevel` / `UpperUnit` | `4500` / `ft AMSL` | Obergrenze (Einheit `FL` oder `ft AMSL`) |
| `UpperreservedFL` / `LowerreservedFL` | | reservierte Grenzen |
| `ZaPrikazString` | `LDAD82 (D)` | Anzeigename |

### 3.1 Zonentyp-Legende (`SRVC_ClientSettings.FilterZona`)
`CTR` (Controlled Traffic Region), `ATZ` (Aerodrome Traffic Zone),
**`UTR` (UTR – drones)**, **`UAG` (UAS Allowed Geographical zone)**,
**`ULG` (UAS Limited geographical area)**, **`URG` (UAS Restricted
Geographical zone)**, `D` (Danger), `R` (Restricted), `P` (Prohibited),
`TRA` (Temporary Restricted Area), `TSA` (Temporary Segregated Area),
`CBA` (Cross Border Area), `MTA` (Military Access Corridor), `NO FLY`.
Jeder Typ hat Farbe + mehrsprachige Namen (hr/en/bs/sr/de).

> Mapping-Vorschlag: `P`/`NO FLY`/`URG` → `PROHIBITED`; `R`/`TRA`/`TSA`/`D`/
> `ULG`/`CTR`/`ATZ` → `REQ_AUTHORISATION`/`RESTRICTED`; `UAG` → `NO_RESTRICTION`.
> Höhen `FL` → Meter (×100 ft × 0,3048), `ft AMSL` → Meter. Mit der Fachseite
> abstimmen.

### Weitere Pushes
- `SRVC_DroneReservations`: drohnenspezifische Zonen/Reservierungen (z. B.
  „CTR SPLIT 1"), mit Gültigkeitszeiten.
- `SRVC_activeNotams`/`SRVC_activeFullNotams`: aktive NOTAMs (strukturiert,
  inkl. unbemannter Luftfahrt).
- `SRVC_aUPUUPs`: AUP/UUP-Text (tägliche Luftraumnutzung).

---

## 4. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- HR ist nur über Bounding-Box bekannt (`shared/countryDetection.ts`), **keine
  Geodaten**.

### Schritte
1. **SignalR-Client** `client/lib/geozoneDirect/croatiaSource.ts`:
   - Ablauf aus §2 (negotiate → WS connect → start → `CLIC_ClientReady`).
   - Eingehende `SRVC_Areas` (und optional `SRVC_DroneReservations`) sammeln,
     dann Verbindung schließen (einmaliger Abzug, kein Dauer-Socket nötig).
   - In React Native: WebSocket ist nativ vorhanden; die 3 HTTP-Schritte per
     `fetch`. Kein SignalR-SDK nötig – das Protokoll ist das oben gezeigte
     einfache JSON-Framing.
2. **Normalisierung** `shared/croatiaGeozones.ts`:
   - **WKT `Poligon` → GeoJSON** parsen (`POLYGON ((lon lat, …))`; `turf` oder
     ein kleiner WKT-Parser).
   - `AreaType` → `restriction` (Mapping §3.1).
   - Höhen `FL`/`ft AMSL` → Meter.
   - Dedupe über `DBId`/`Name`.
3. `"hr"` in die Länderliste; eigener SignalR-Pfad (kein ED-269).
4. **Label**: `HR: "Croatia Control (HKZP) / AMC"`. Attribution
   „© Hrvatska kontrola zračne plovidbe".
5. **Tests**: WKT→GeoJSON, `AreaType`-Mapping, Höheneinheiten (FL/ft), Dedupe.
6. **Refresh**: täglich (einmaliger SignalR-Abzug). Optional NOTAMs/Drohnen-
   Reservierungen als „heute aktiv"-Zusatz.

---

## 5. Offene Punkte
1. **AreaType-Mapping** fachlich bestätigen (v. a. die UAS-Typen UTR/UAG/ULG/URG
   und TRA/TSA/MTA).
2. **Vollständigkeit:** Prüfen, ob alle drohnenrelevanten Zonen in `SRVC_Areas`
   stecken oder teils nur in `SRVC_DroneReservations` (beide abrufen).
3. **Höhenbezug:** `FL` vs. `ft AMSL` sauber umrechnen; Bezug (AMSL/AGL)
   dokumentieren.
4. Nutzungsbedingungen der Freigabe im Repo ablegen.

---

## 6. Schnelltest (Node)

```js
// negotiate -> ws connect -> start -> CLIC_ClientReady -> SRVC_Areas
const BASE="https://amc.crocontrol.hr/amc/signalr";
const cd=encodeURIComponent(JSON.stringify([{name:"aMCHub"}]));
const neg=await (await fetch(`${BASE}/negotiate?clientProtocol=2.1&connectionData=${cd}`)).json();
const tok=encodeURIComponent(neg.ConnectionToken);
const ws=new WebSocket(`wss://amc.crocontrol.hr/amc/signalr/connect?transport=webSockets&clientProtocol=2.1&connectionToken=${tok}&connectionData=${cd}`);
ws.onopen=()=>fetch(`${BASE}/start?transport=webSockets&clientProtocol=2.1&connectionToken=${tok}&connectionData=${cd}`)
  .then(()=>ws.send(JSON.stringify({H:"aMCHub",M:"CLIC_ClientReady",A:[],I:0})));
ws.onmessage=e=>{for(const x of (JSON.parse(e.data).M||[])) if(x.M==="SRVC_Areas") console.log("areas:",x.A[0].length);};
```
