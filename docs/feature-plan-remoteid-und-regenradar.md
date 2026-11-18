# Umsetzungsplan: Remote-ID-Empfang & Regenradar

Zwei neue Features, abgeleitet aus der Analyse der App *SkyCompanion* (etana-systems),
eingepasst in die bestehende COpterPilot-Architektur (RN/Expo, Leaflet-in-WebView,
Traffic-Aggregator). **Keine** Übernahme von Fremdcode — nur die Ideen, neu in unserem Stack gebaut.

Betroffene Bausteine (Stand heute):
- Verkehr: `client/lib/traffic/{aggregator,sources,merge,types,classify,geo}.ts`, Typen in `client/lib/opensky.ts`
- Alarm: `client/lib/proximityAlarm.ts`
- Karte (RC): `client/lib/leafletRc.ts` (Leaflet-JS mit `window.__rc.*`), Konsument `client/components/TrafficMapView.native.tsx`
- Hintergrund: `client/lib/background/{service,traffic}.ts`, `client/lib/trafficBackground.ts`
- Native-Config: `app.json`, `plugins/withFccBackground.js`

---

## Feature B zuerst: Regenradar (RainViewer) — klein, schnell, sichtbar

**Ziel:** animierter Niederschlagsradar-Layer über der Karte, ein-/ausschaltbar, Einstellung persistent.

**Datenquelle:** RainViewer (kostenlos, kein API-Key).
- Index: `GET https://api.rainviewer.com/public/weather-maps.json`
  → liefert `host` + `radar.past[]` (letzte ~2 h, 10-Min-Schritte) + `radar.nowcast[]` (Prognose). Jeder Frame hat `time` (Unix-Sek.) und `path`.
- Tile-URL-Schema: `{host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png`
  z. B. `https://tilecache.rainviewer.com/v2/radar/1699999999/256/{z}/{x}/{y}/2/1_1.png`
  - `size` 256 oder 512, `color` 2 (Universal Blue) o. Ä., `smooth`=1, `snow`=1.
- Attribution: „RainViewer" muss sichtbar sein (Footer/Info).

### B1 — Leaflet-Seite: Radar-Layer in `client/lib/leafletRc.ts`

Im String `RC_LEAFLET_JS` beim `window.__rc`-Objekt (nach `rc.setObstacles`, ~Zeile 229) eine Methode ergänzen:

```js
// --- Regenradar (RainViewer) ---
rc.radarLayer = null;
rc.radarFrames = [];     // [{time, url}] aufsteigend
rc.radarIdx = 0;
rc.radarTimer = null;
rc.radarOpacity = 0.6;

rc.setRadar = function(cfg){                 // cfg: { enabled, frames, opacity, animate }
  var map = window.__rcMap; if (!map) return;
  if (rc.radarTimer){ clearInterval(rc.radarTimer); rc.radarTimer = null; }
  if (rc.radarLayer){ map.removeLayer(rc.radarLayer); rc.radarLayer = null; }
  rc.radarFrames = (cfg && cfg.frames) || [];
  rc.radarOpacity = (cfg && cfg.opacity != null) ? cfg.opacity : 0.6;
  if (!cfg || !cfg.enabled || rc.radarFrames.length === 0) return;
  rc.radarIdx = rc.radarFrames.length - 1;   // neuester Frame zuerst
  var show = function(i){
    var f = rc.radarFrames[i]; if (!f) return;
    var next = L.tileLayer(f.url, { opacity: rc.radarOpacity, zIndex: 450, tileSize: 256, crossOrigin: true });
    next.addTo(map);
    var prev = rc.radarLayer; rc.radarLayer = next;
    // sanfter Wechsel: alten Layer erst nach dem Laden entfernen
    next.on("load", function(){ if (prev) { try { map.removeLayer(prev); } catch(e){} } });
    setTimeout(function(){ if (prev && map.hasLayer(prev)) { try { map.removeLayer(prev); } catch(e){} } }, 800);
  };
  show(rc.radarIdx);
  if (cfg.animate){
    rc.radarTimer = setInterval(function(){
      rc.radarIdx = (rc.radarIdx + 1) % rc.radarFrames.length;
      show(rc.radarIdx);
    }, 600);
  }
};
```

> `zIndex: 450` hält den Radar-Layer über den Basiskacheln, aber unter den Overlays
> (Geozonen/Hindernisse/Marker liegen als Panes/SVG höher). Feinjustieren, falls nötig.

### B2 — Frames laden: `client/lib/rainRadar.ts` (neu)

```ts
export interface RadarFrame { time: number; url: string }

let cache: { at: number; frames: RadarFrame[] } | null = null;

export async function getRadarFrames(opts?: { size?: 256|512; color?: number }): Promise<RadarFrame[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.frames; // 5-Min-Cache
  const size = opts?.size ?? 256;
  const color = opts?.color ?? 2;
  const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
  const j = await res.json();
  const host: string = j.host;
  const list = [...(j.radar?.past ?? []), ...(j.radar?.nowcast ?? [])];
  const frames: RadarFrame[] = list.map((f: any) => ({
    time: f.time,
    url: `${host}${f.path}/${size}/{z}/{x}/{y}/${color}/1_1.png`,
  }));
  cache = { at: Date.now(), frames };
  return frames;
}
```

### B3 — Hook: Radar in `useRcLeaflet` einspeisen (`leafletRc.ts`)

In `useRcLeaflet(...)` einen neuen Effekt + ein Argument `radar: { enabled: boolean; animate: boolean }` ergänzen
(oder einen zweiten kleinen Hook `useRcRadar(webRef, ready, radar)`), der bei Änderung die Frames holt und injiziert:

```ts
useEffect(() => {
  if (!ready) return;
  if (!radar?.enabled) { run(`window.__rc.setRadar({enabled:false})`); return; }
  let alive = true;
  getRadarFrames().then((frames) => {
    if (!alive) return;
    run(`window.__rc.setRadar(${JSON.stringify({ enabled: true, animate: radar.animate, opacity: 0.6, frames })})`);
  }).catch(() => {});
  const refresh = setInterval(() => {
    getRadarFrames().then((frames) => alive && run(`window.__rc.setRadar(${JSON.stringify({ enabled: true, animate: radar.animate, opacity: 0.6, frames })})`)).catch(()=>{});
  }, 5 * 60_000); // Frames alle 5 Min nachladen
  return () => { alive = false; clearInterval(refresh); };
}, [ready, radar?.enabled, radar?.animate]);
```

### B4 — UI-Toggle in `client/components/TrafficMapView.native.tsx`

- Analog zu den bestehenden Layer-Schaltern (Geozonen/Hindernisse): ein Button „Regen" in der Layer-Leiste.
- State `radarOn`/`radarAnimate` + Übergabe an `useRcLeaflet`/`useRcRadar`.
- Persistenz über die vorhandenen Settings (siehe `getSettings()` in `client/lib/storage.ts`): neues Feld `radarLayerEnabled: boolean` ergänzen und beim Mount lesen.
- „RainViewer"-Attribution in die Karten-Info/Legende aufnehmen.

### B5 — Offline-Verhalten
- Radar braucht Netz; im Offline-Fall (ihr habt `OfflineBanner`/NetInfo) den Toggle ausgrauen und den Layer entfernen (`setRadar({enabled:false})`).

**Aufwand B:** ~0,5–1 Tag. Kein Native-Build nötig (reines JS/Leaflet), per CI-APK testbar.

---

## Feature A: Remote-ID-Empfang fremder Drohnen (BLE / OpenDroneID)

**Ziel:** Das Gerät (RC Pro 2 = Android) empfängt die gesetzlich vorgeschriebenen
Direct-Remote-ID-Funkbaken umliegender Drohnen und zeigt sie als Verkehr an — eingespeist
in euren bestehenden Merge + Proximity-Alarm, als neue Quelle `remoteid`.

### A0 — Scope & ehrliche Grenzen (wichtig vorab)
- **BLE (Bluetooth 4 Legacy + 5 Long-Range):** machbar in v1 über `react-native-ble-plx` (liest Advertising-/Service-Daten). **Hier liegt der Fokus.**
- **WiFi (NaN / Beacon):** braucht natives WiFi-Scanning (`WifiManager`/`WifiAwareManager`), kein fertiges RN-Modul → **v2/optional**, separates Kotlin-Modul. In v1 bewusst weglassen.
- **DJI-Spezifika:** EU-C-Klassen-Drohnen (z. B. Air 3S, Mini 4 Pro) senden **Standard-OpenDroneID über Bluetooth** → werden erfasst. Ältere/proprietäre DJI-„DroneID" (teils nur über WiFi, proprietär) → **nicht** v1. Das klar kommunizieren, sonst Erwartungsbruch.
- **Testbarkeit:** BLE lässt sich **nicht** in der CI/Headless prüfen. Verifikation nur auf echter Hardware mit einer sendenden Drohne in der Nähe (oder einem OpenDroneID-Sender/Simulator-App auf einem zweiten Android-Gerät).

### A1 — Abhängigkeit & Permissions

```bash
npx expo install react-native-ble-plx
```

Config-Plugin (eigenes `plugins/withBle.js`, analog zu `withFccBackground.js`) ODER das
mitgelieferte Plugin von `react-native-ble-plx` in `app.json` nutzen. Nötige Android-Permissions:

- `android.permission.BLUETOOTH_SCAN` — mit `usesPermissionFlags="neverForLocation"` (wir brauchen keine Standortableitung aus BLE; die Position kommt aus der RID-Nachricht selbst)
- `android.permission.BLUETOOTH_CONNECT` (ble-plx-Init)
- Für Android < 12 zusätzlich: `BLUETOOTH`, `BLUETOOTH_ADMIN`, `ACCESS_FINE_LOCATION` (bereits vorhanden)

`app.json` → `plugins`:
```json
["react-native-ble-plx", { "isBackgroundEnabled": true, "modes": ["central"], "bluetoothAlwaysPermission": null }]
```
(Android-only; iOS-Strings hier egal, da RC = Android.)

> Hinweis: Scannen nur starten, wenn der Live-Traffic-/Karten-Screen aktiv ist **oder** der
> Hintergrunddienst läuft (Akku!). BLE-Scan ist stromintensiv → `ScanMode.Balanced`/`LowLatency`
> bewusst wählen.

### A2 — OpenDroneID-Parser: `client/lib/traffic/remoteid/openDroneId.ts` (neu)

ASTM F3411 / ASD-STAN prEN 4709-002. Über **Bluetooth** kommt der Payload als **Service Data**
zu 16-bit-UUID **`0xFFFA`** (ASTM International), erstes Byte = **`0x0D`** (ODID AD App Code),
dann 1 Byte Message-Counter, danach entweder eine 25-Byte-Nachricht oder ein **Message Pack** (Typ `0xF`).

Nachrichten-Grundform (25 Byte):
- Byte 0: Header = `(messageType << 4) | protocolVersion`
  - `0x0` Basic ID, `0x1` Location/Vector, `0x2` Auth, `0x3` Self-ID, `0x4` System, `0x5` Operator ID, `0xF` Message Pack
- Byte 1..24: typ-abhängiger Inhalt

Mindestens diese Typen parsen:
- **Basic ID (0x0):** UA-Typ + ID-Typ (Nibble), dann 20-Byte-ASCII-UAS-ID (Serien-/Registrierungsnummer) → unsere stabile `id`.
- **Location/Vector (0x1):** Status/Flags, Track (°), Speed (kodiert), Vert-Speed, **Lat/Lon** (int32, Grad × 1e7), Druck-/Geo-Höhe & Höhe-AGL (jeweils `(wert·0,5) − 1000` m), Zeitstempel.
- **System (0x4):** **Operator-/Startpunkt-Lat/Lon** (Pilot-Standort!), Flughöhe-Referenz. Für uns sehr wertvoll (zeigt, wo der fremde Pilot steht).

Parser-Skizze:
```ts
export interface OdidMessage {
  kind: "basic" | "location" | "system" | "operator" | "selfid" | "auth" | "unknown";
  uasId?: string;              // Basic ID
  lat?: number; lon?: number;  // Location
  altGeoM?: number | null; altAglM?: number | null;
  trackDeg?: number | null; speedMs?: number | null; vspeedMs?: number | null;
  operatorLat?: number; operatorLon?: number; // System
}

const decodeLatLon = (v: number) => v / 1e7;          // int32 → Grad
const decodeAlt = (raw: number) => raw * 0.5 - 1000;  // ODID-Höhenkodierung

export function parseOdidMessage(b: Uint8Array): OdidMessage { /* Header lesen, per Typ dispatchen */ }

// Service-Data -> eine oder mehrere Nachrichten (Message Pack aufdröseln)
export function parseOdidServiceData(sd: Uint8Array): OdidMessage[] {
  // sd[0] === 0x0D (App Code) erwartet; sd[1] = counter; ab sd[2] der/die Message(s)
  // Message Pack (Typ 0xF): [msgSize=25][msgCount] + count×25 Byte
}
```
> Byte-Reihenfolge der Mehrbyte-Felder ist **little-endian**. Referenz: `opendroneid/opendroneid-core-c`
> (Struktur-Layout) bzw. die ASD-STAN-Spezifikation. Mit Unit-Tests gegen bekannte Beispiel-Frames
> absichern (analog zu `client/lib/fcc/__tests__/duml.test.ts`).

### A3 — Scanner + Store: `client/lib/traffic/remoteid/bleScanner.ts` + `remoteIdStore.ts` (neu)

`react-native-ble-plx` liefert im Scan-Callback `device.serviceData` (Map UUID→Base64) und
`device.manufacturerData`. Vorgehen:

```ts
import { BleManager, ScanMode } from "react-native-ble-plx";
import { Buffer } from "buffer";

const SD_UUID = "0000fffa-0000-1000-8000-00805f9b34fb"; // 0xFFFA in 128-bit-Form
const mgr = new BleManager();

export function startRemoteIdScan() {
  mgr.startDeviceScan(null, { allowDuplicates: true, scanMode: ScanMode.Balanced }, (err, dev) => {
    if (err || !dev) return;
    const sdMap = dev.serviceData ?? {};
    const b64 = sdMap[SD_UUID];
    if (!b64) return;                              // kein ODID-Advertising
    const bytes = new Uint8Array(Buffer.from(b64, "base64"));
    const msgs = parseOdidServiceData(bytes);
    remoteIdStore.ingest(dev.id, msgs, Date.now()); // dev.id = BT-MAC (Fallback-Schlüssel)
  });
}
export function stopRemoteIdScan() { mgr.stopDeviceScan(); }
```

`remoteIdStore`:
- hält pro Drohne (Schlüssel = `uasId` aus Basic ID, Fallback BT-MAC) den zuletzt gemergten Zustand
  (Position aus Location, Operator-Standort aus System, letzter Zeitpunkt),
- räumt Einträge > ~60 s ohne Update weg (`isStale`/Entfernen),
- `getRemoteIdAircraft(): AircraftState[]` wandelt in euren Verkehrstyp um.

### A4 — In den bestehenden Verkehrstyp mappen (`client/lib/opensky.ts`)

- Neue Quelle in den Union-Typ aufnehmen: `DataSource = ... | "remoteid"` und in `EMPTY_STATUS` ergänzen.
- Mapping auf `AircraftState`:
  - `icao24`: `"rid-" + uasId` (synthetisch, stabil)
  - `callsign`: UAS-ID (gekürzt)
  - `latitude`/`longitude`: aus Location-Message
  - `geoAltitude`/`aglAltitude`: aus ODID-Höhen
  - `trueTrack`, `velocity`, `verticalRate`: aus Location/Vector
  - `category: "drone"` (habt ihr bereits), `sources: ["remoteid"]`
  - `operator`/zusätzliche Felder: Operator-Lat/Lon als Extra (ggf. neues optionales Feld `operatorLat/operatorLon` für einen „Pilot steht hier"-Marker)

### A5 — In Aggregator/Merge einhängen (`client/lib/traffic/{aggregator,merge}.ts`)

Zwei saubere Optionen:
- **(empfohlen) Merge-Ebene:** Der Aggregator bleibt HTTP-Poll-basiert; die lokal gescannten
  RID-Drohnen werden **beim Zusammenführen** zugemischt. In `fetchNearbyAircraft(...)` (bzw. im
  Merge, der `states` erzeugt) `getRemoteIdAircraft()` dazunehmen und per bestehender Dedupe-Logik
  (`merge.ts`) vereinen. Dieselbe Entfernungs-/BBox-Filterung wie bei ADS-B anwenden (`geo.ts`).
- Alternativ als „pseudo-Quelle" im Aggregator registrieren (passt aber schlechter, da Push statt Poll).

Dadurch erscheinen RID-Drohnen **automatisch**:
- in `TrafficMapView` (als Marker, Kategorie Drohne),
- im Proximity-Alarm (`proximityAlarm.ts` arbeitet auf `AircraftState[]` → TA/RA inkl. Drohnen),
- in euren Verkehrslisten/Screens.

### A6 — Lebenszyklus & Hintergrund
- Scan starten/stoppen an den Lebenszyklus koppeln: beim Öffnen des Live-Traffic-/Karten-Screens
  (A3-Funktionen) und — falls gewünscht — im vorhandenen Vordergrunddienst
  (`client/lib/background/service.ts`, Flag analog zu `traffic`). BLE-Scan im Hintergrund kostet Akku
  → nur wenn „Verkehr im Hintergrund" aktiv ist.
- `BleManager.state()` prüfen (Bluetooth aus? → Hinweis an den Nutzer, nicht still scheitern).
- Permission-Flow beim ersten Start (Android 12+ Laufzeit-Dialog für `BLUETOOTH_SCAN`).

### A7 — UI
- Eigener Marker-Stil/Legendeneintrag für RID-Drohnen (unterscheidbar von ADS-B-Verkehr).
- Optional: Linie Drohne → Operator-Standort (aus System-Message), wenn vorhanden.
- Quellen-Badge „Remote ID (lokal)" im Verkehrsstatus (`client/lib/trafficStatus.ts`).

### A8 — Tests
- Reine Byte-Parser-Tests (`openDroneId.test.ts`) mit aufgezeichneten/konstruierten Frames — RN-frei, laufen in Jest/CI.
- Scanner/Store nur manuell auf Gerät.

**Aufwand A:** ~1–2 Wochen inkl. Parser-Härtung und Gerätetests. Native-Rebuild nötig (neue BLE-Lib). Hoher Differenzierungswert.

---

## Empfohlene Reihenfolge
1. **Regenradar (B)** — klein, sofort sichtbar, kein Native-Risiko. Zuerst mergen.
2. **Remote-ID (A)** — als eigenständiges Feature-Paket; v1 **BLE-only**, WiFi als v2.

## Datenschutz/Recht (kurz)
- Empfangene RID enthält Seriennummer/Operator-Position Dritter. Nur **lokal/flüchtig** verarbeiten,
  nicht dauerhaft speichern/hochladen (wir haben keinen Server → passt). In Datenschutz-Text kurz erwähnen.
