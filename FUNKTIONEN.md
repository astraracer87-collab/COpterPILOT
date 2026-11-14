# Pre-Flight Check App

A professional drone pre-flight check application for iOS that guides pilots through a comprehensive pre-flight verification process based on LBA guidelines.

## Overview

This app helps drone pilots conduct thorough pre-flight checks with:
- **Unified Session Lifecycle** - Planning → Pre-Check → Flight-Check → Post-Check → Debriefing → Logbook
- **dipul Karte** - Integration with DFS dipul Map Tool for airspace verification (with coordinate-based location viewing)
- **Wetter** - Real-time weather data from dipul Weather Service v2 (DWD ICON-D2 model, 2km grid) with 24h forecast, altitude profiles (temperature, humidity at 2/50/100/150/200/250m AGL, cloud cover at 50/100/150/200/250m AGL, wind at 10/50/100/150/200/250m AGL), QNH, snow
- **BrightSky Wetter** - Additional DWD weather source via BrightSky API with hourly wind chart and flight assessment
- **NOTAMs** - dipul temporäre Betriebseinschränkungen deutschlandweit via dipul Geoapi v4 (authenticated JWT, full date ranges with startTs/endTs), active/upcoming split with date badges, expandable cards with altitude info + legal reference; notaminfo.com map WebView; NOTAM tab shows ALL active + upcoming temp restrictions across Germany with exact validity periods
- **Naturschutzgebiete** - BfN nature protection areas map via geodienste.bfn.de WebView
- **Geozonen WMS** - dipul WMS tile overlay on native map (all 33 official layers incl. Kontrollzonen, Flugbeschränkungsgebiete, Flughäfen, Bundeswasserstraßen, Naturschutz, etc.) with per-layer toggle and map style switcher (OSM/Dezent/Standard/Satellit/Hybrid); CTR & ED-R zones include contact data (email/phone/web) from official NfL publications with tap-to-call/email/browse
- **CTR-Daten** - Comprehensive CTR airport database with ATC provider assignment: DFS (NfL 2023-1-2705: BER, BRE, DRS, DUS, ERF, FRA, HAM, HAJ, CGN, LEJ, MUC, FMO, NUE, SCN, STR), DAS (NfL 2022-1-2670: DTM, FKB, FMM, MGL, NRN, PAD, FDH, BWE), Austro Control (NfL 2024-1-3081: AGB, HDF, LBC, HOQ, KSF, GWT, HHN), TRIAC (NfL 2024-1-3082: OBF), military (7 airports); each with tower phone, tower frequency (MHz), AV PDF links, AV conditions (1.5km/rectangle_4km exclusion zones, 50m max, 5km vis, 1500ft ceiling); floating red emergency TOWER call button on radar map when in CTR (15km range); CTR emergency bottom sheet with all nearby towers, AV reference, provider, frequency; BOS reference NfL 2025-1-3658
- **Go/Caution/No-Go** - Automated weather assessment against configurable limits
- **Drone Management** - Support for different drone types (standard, FPV-only, hybrid FPV) with maintenance tracking
- **PDF Export** - Export individual or all logbook entries as PDF via expo-print/expo-sharing; enhanced protocol PDF with SVG map overlay (zone circles + aircraft trail paths), structured geozone sections by category, dipul restriction tables with dates/altitude/legal ref, forecast vs actual weather comparison
- **Betriebskategorie** - Comprehensive EU UAS classification data (source: LBA OpenUAV lba-openuav.de); C0-C6 technical classes with MTOM limits, speed limits (C0/C1: 19 m/s), height limiters, altimeters, Remote-ID, Geo-Sensibilisierung requirements; A1/A2/A3 subcategories with full safety distance rules (A2: 30m/5m slowmode <=3m/s; A3: 150m settlements, >30m persons, 1:1 height rule, 2s reaction distance); Open/Specific/Certified category definitions with conditions; Menschenansammlung definition; legacy/transition rules (Art. 22 expired 2024); LBA contact (uas@lba.de, Referat B5); EU regulation links (2019/945, 2019/947); PlanningResultScreen shows safety distances + technical requirements per drone class
- **Live Flugverkehr** - Multi-source aircraft tracking (OpenSky + adsb.fi + adsb.one + airplanes.live + adsb.lol + OGN) with deduplication, category-based icons (airplane/light/helicopter/glider/balloon/ultralight/drone), source status indicators, movable radar center (long-press on map), map-rotation-aware icon heading, ground vehicle filtering, smooth trail rendering with direction consistency, AGL altitude via Open-Meteo Elevation API (batch terrain lookup with caching), dual AGL/MSL display
- **OGN Integration** - Open Glider Network (APRS-IS) backend client connecting to aprs.glidernet.org:10152; parses FLARM/OGN/FANET/ICAO APRS position reports; stores recent aircraft in memory with 120s TTL; exposed via `/api/ogn/nearby` REST endpoint; covers all of Germany (500km filter); adds gliders, ultralight, and FLARM-equipped drones not visible on ADS-B
- **Wetter-Overlay** - Permanent weather badge on radar map (temperature, cloud cover, humidity, rain, visibility) + scrollable 24h hourly forecast in Wetter side tab with per-hour wind/gusts/cloud/rain and critical condition highlighting
- **KP-Index Integration** - NOAA KP geomagnetic index displayed in pre-flight WeatherScreen with color-coded badge (GPS OK/Einschränkung/Warnung), assessed in Go/Caution evaluation (Kp>=4 caution, Kp>=6 warning with expert tip), saved in weather snapshot, included in PDF exports
- **Proximity-Alarm** - TCAS-style alarm system: outer warning zone = "Traffic, Traffic" voice + haptic (TA), inner critical zone = "Descend, Descend" repeated voice + strong haptic (RA); approach detection (ANFLUG visual + voice warning); configurable radius 500-5000m; max altitude filter 50-800m; uses expo-speech for voice callouts; relative altitude filtering (aircraft MSL minus pilot ground elevation MSL) for accurate proximity assessment
- **Traffic Recording** - Automatic aircraft traffic logging during active sessions (preflight→postlanding); records all aircraft entering warning zones with ID, altitude, position, route trails
- **Flight Protocol PDF** - Comprehensive flight protocol export with all check phases (planning, preflight, hover, postlanding, debriefing), traffic log table, route details, map snapshot with SVG aircraft trail overlay, geozone/restriction detail tables, weather comparison (forecast vs actual)
- **Glossar** - Comprehensive drone/aviation glossary (29 terms from dipul.de) with search, alphabetical grouping, expandable cards
- **Nützliche Links** - Curated resource links for drone pilots (regulations, maps, weather, forums)

## Session Lifecycle

1. **Planning Phase** - Select drone, location with radius + geozone detection, date/time (on location screen), weather forecast
2. **Pre-Check Phase** - Two paths:
   - **From Planning**: Shows `PreCheckOverviewScreen` with geozones + NOTAMs at planned location (skips dipul Map)
   - **Without Planning**: Full flow with dipul Map → Restrictions → Weather
3. **Flight-Check Phase** - In-air hover check after takeoff
4. **Post-Check Phase** - Post-landing inspection and documentation
5. **Debriefing Phase** - Final review and logbook entry creation

## Pilot Profile

- Accessible from Settings → Pilotenprofil
- Stores: name, eID-Nummer, Betreiber-Nummer, licenses (A1/A3, A2, STS)
- **Allgemeinverfügung (AV)**: toggle with Bundesländer + Geozonen-Typen selection
- **Country-Specific Registrations** (CountrySpecificPilot): CH insurance 1M CHF, AT insurance 750k SZR, FR AlphaTango, IT D-Flight QR, UK CAA registration
- AV data is used in PlanningRestrictionsScreen to auto-classify geozones as "covered" vs "uncovered"

## Drone Compliance System

- **DronePreset** extended with `hasRemoteId` and `altitudeLocked120m` boolean fields; all DJI presets updated (2021+ models have Remote-ID, pre-2021 do not)
- **DroneProfile** stores `hasRemoteId` and `altitudeLocked120m` per drone; backward compatible with `?? false` defaults
- **countryCompliance.ts** - Compliance engine evaluating drone + pilot + country → checklist:
  - EU base rules (e-ID, A1/A3, A2, insurance, Remote-ID, legacy drone warnings)
  - Country-specific rules: DE, FR (AlphaTango/Balise), IT (D-Flight), CH (1M CHF insurance), AT (SZR insurance), ES (AESA declaration), LU, NL, UK (separate CAA system, EU docs invalid)
  - GB→UK normalization for ISO code handling
- **PlanningRestrictionsScreen** shows compliance cards after geozones section, sorted by severity (error → warning → ok), with category badges (Pilot/Drohne/Land) and external links
- **DroneSetupScreen** has visible toggles for Remote-ID and altitude lock in details step

## ED-R Flugbeschränkungsgebiete

- **edrData.ts** — Complete ED-R module with zone data, proximity detection, classification (ROT/GELB), AV conditions/exclusions
- **ED-R 146 Berlin** — Coordinate-based proximity detection (3 NM / 5.556 km around Reichstag), inner circle (1 NM) vs outer circle (2./3. NM) differentiation, § 62 LuftVG criminal offense warning, BAF contact (ed-r@baf.bund.de), Polizei Berlin Lagezentrum ((030) 4664-707110, 2h advance notice), NfL 2024-1-3127/3128 links
- **AV ED-R Energie/Forschung/Wartburg** — NfL 2025-1-3652: 17 AV-covered zones (ED-R 1, 3, 5-8, 23-25, 27, 38-41, 90, 111, 133) with interactive AV conditions checklist (open category, daylight/VMC, max 50m AGL, 200m horizontal distance, Remote-ID) and exclusion list; ED-R 4 Wannsee + ED-R 146 Berlin NOT covered by this AV
- **ED-R zones in PlanningRestrictionsScreen** — ROT/GELB severity badges, operator names, AV coverage status, BAF Antragsformulare links
- **geozones.ts** — Updated ED-R regulatory info with new BAF numbering, added ed-r@baf.bund.de + Polizei Berlin contacts

## Restrictions Flow

PlanningRestrictionsScreen auto-detects geozones at the selected location:
- If pilot has AV and geozones match AV geozone types: shown as "Durch Allgemeinverfügung abgedeckt" with acknowledgment checkbox
- Uncovered geozones require manual choice: Genehmigung vorhanden / Flug mit Auflagen / Flug nicht möglich
- If all geozones are AV-covered, pilot only needs to acknowledge awareness
- Date/time flows: PlanningLocation → PlanningRestrictions → PlanningDetails (read-only display)

The `restrictionStatus` parameter ("approved" | "limited") is passed through navigation params to downstream screens (Weather, Checklist, Results).

## Luxembourg (LU) Geozones

- **luGeozones.ts** — Complete LU geozone module: DAC contacts (uas@av.etat.lu, uas.zones@av.etat.lu, uas.training@av.etat.lu), zone type classifications (PROHIBITED/REQ_AUTHORISATION/CONDITIONAL), Rot/Gelb/Grau color coding, legal framework (Loi 20.12.2024, Art. 15 EU 2019/947), distance rules (5km airport, 2km heliports), permanent zone catalog (Findel, Palais Grand-Ducal, Berg, Fischbach, Uerschterhaff, military)
- **Live JSON Feed** — `https://drones.geoportail.lu/zones` (EUROCAE ED-269 compliant, updated every 5 min): `fetchLuZonesFeed()` + `findNearbyLuZones()` for point-in-polygon proximity detection with polygon centroid distance calculation
- **geozones.ts** — Updated LU regulatory info (lu_uas_0_50, lu_uas_50_120) with correct DAC emails, Farbcodierung explanation, geo-awareness JSON feed link, penalty info, Benutzerhandbuch PDF links
- **countryCompliance.ts** — LU rules: insurance (mandatory since 2024), MyGuichet.lu registration, geo-awareness JSON feed reminder; fixed hints for DAC portal, g-o.lu/uas map, Géoportail Benutzerhandbuch (DE, PDF)
- **Key warning**: Manufacturer geofence data does NOT cover all LU restricted areas — only g-o.lu/uas is legally binding

## Centralized Data Cache (server-side)
Long-running daily background sync (`server/dataSync.ts`) keeps two heavy upstream
datasets in our own DB so all clients (web + mobile) hit just one local endpoint:

- `cached_dataset` table holds one row per `source` (e.g. `geozones-de`, `notams-ch`)
  with the full feature/row collection as JSONB plus status/lastError metadata.
- `startDailySyncCron()` runs once on boot (if cache stale > 12h) and then every 24h.
- New endpoints:
  - `GET /api/cached/status` — list of all datasets, freshness, errors, item counts.
  - `GET /api/cached/geozones?country=de|ch|lu|nl[&bbox=lonW,latS,lonE,latN]`
  - `GET /api/cached/notams?bbox=…` or `?lat=&lon=&radius=` (km)
  - `POST /api/cached/refresh` — admin-only manual trigger.
- Frontend `fetchNotams()` now prefers the cached endpoint, falls back to the live
  `/api/proxy/notams` if cache is empty/missing.
- Required env vars (set in Secrets to enable real data):
  - `AUTOROUTER_TOKEN` — Bearer token for autorouter.aero NOTAM API.
  - `GEOZONES_DE_URL`, `GEOZONES_CH_URL`, `GEOZONES_LU_URL`, `GEOZONES_NL_URL` —
    GeoJSON FeatureCollection URLs (EPSG:4326) for each country's drone geozones.
- Weather stays live (no server-side cache, by design). Traffic stays in
  `server/traffic.ts` (already centralized with 3s in-memory cache). WMS map tiles
  continue to be loaded directly from each portal (license / bandwidth reasons).

## Tech Stack

- **Frontend**: React Native with Expo
- **Backend**: Express.js (minimal, serving landing page)
- **Storage**: AsyncStorage for local persistence
- **Weather API**: DFS dipul Weather Service (https://utm-service.dfs.de) - wind at 10m/50m/100m/150m AGL
- **Weather API 2**: BrightSky (https://api.brightsky.dev) for DWD open data
- **KP Index**: NOAA SWPC (https://services.swpc.noaa.gov) for geomagnetic activity
- **Elevation API**: Open-Meteo (https://api.open-meteo.com/v1/elevation) for terrain elevation (free, no key, batch)
- **Map**: dipul Map Tool WebView (https://maptool-dipul.dfs.de)
- **NOTAM Map**: notaminfo.com WebView (https://notaminfo.com/germanymap)
- **Nature Protection**: BfN geodienste WebView (https://geodienste.bfn.de/schutzgebiete)
- **Geozonen WMS**: dipul WMS (https://uas-betrieb.de/geoservices/dipul/wms) - official airspace restriction layers as map tile overlays
- **Live Traffic**: OpenSky Network (https://opensky-network.org) + adsb.fi (https://opendata.adsb.fi) + adsb.one (https://api.adsb.one) + airplanes.live (https://api.airplanes.live) + adsb.lol (https://api.adsb.lol)
- **PDF**: expo-print + expo-sharing for logbook PDF export + flight protocol PDF
- **Map Capture**: react-native-view-shot for traffic map snapshots in protocols

## Project Structure

```
client/
├── components/          # Reusable UI components
│   ├── Button.tsx       # Primary/secondary buttons with loading state
│   ├── Card.tsx         # Card container with elevation
│   ├── Checkbox.tsx     # Animated checkbox
│   ├── StatusBadge.tsx  # Go/Caution/No-Go status badges
│   └── ...
├── constants/
│   └── theme.ts         # Aviation design system colors & typography
├── lib/
│   ├── storage.ts       # AsyncStorage for briefings & settings
│   ├── weather.ts       # dipul Weather API client
│   ├── brightsky.ts     # BrightSky API client (DWD open data)
│   ├── assessment.ts    # Weather limit assessment logic (supports restrictionStatus)
│   ├── notams.ts        # NOTAM utilities (legacy, dipul Geoapi now primary)
│   ├── kpindex.ts       # KP geomagnetic index from NOAA SWPC
│   ├── proximityAlarm.ts # Proximity alarm logic + audio/haptic triggers
│   ├── trafficRecorder.ts # Traffic recording service (session-bound)
│   ├── elevation.ts     # Open-Meteo Elevation API client (batch + cache)
│   ├── markerColors.ts  # Shared marker pin color helper (altitude-based)
│   ├── resourceLinks.ts # Curated external links data module
│   ├── pdfExport.ts     # PDF export + flight protocol export
│   ├── categoryAdvice.ts # EU drone operation category suggestions
│   ├── geozones.ts      # dipul WMS geozone layer config + settings (text/plain parser for GetFeatureInfo)
│   └── countryMaps.ts   # Country detection + bounding boxes for international support
├── navigation/
│   ├── MainTabNavigator.tsx      # Bottom tabs (Briefings, History, NOTAMs, Settings)
│   ├── FlightCheckNavigator.tsx  # Modal flow for flight checks
│   ├── FlightPlanningNavigator.tsx # Planning flow navigator
│   ├── NotamsStackNavigator.tsx  # NOTAMs stack (NotamMap, Naturschutz, LiveTraffic)
│   ├── SettingsStackNavigator.tsx # Settings stack (ResourceLinks, Naturschutz, etc.)
│   └── ...
├── screens/
│   ├── ChecklistScreen.tsx       # Pre-flight checklist
│   ├── MapScreen.tsx             # dipul Map WebView
│   ├── RestrictionsScreen.tsx    # 3-option restriction flow (approved/limited/nofly)
│   ├── WeatherScreen.tsx         # Weather display & forecast
│   ├── ResultsScreen.tsx         # Go/Caution/No-Go assessment
│   ├── NotamsScreen.tsx          # Real NOTAM info with map button
│   ├── NotamMapScreen.tsx        # notaminfo.com WebView (GPS-centered)
│   ├── NaturschutzMapScreen.tsx  # BfN nature protection WebView
│   ├── ResourceLinksScreen.tsx   # Curated links with collapsible categories
│   ├── LiveTrafficScreen.tsx     # OpenSky live aircraft map
│   ├── BrightSkyWeatherScreen.tsx # BrightSky hourly weather
│   ├── PlanningResultScreen.tsx  # Planning summary with category advice
│   └── ...
server/
└── index.ts             # Express server for static landing page
```

## Key Features

### Weather Assessment Logic
- **No-Go**: Wind/gusts exceed limits, heavy rain, temperature below minimum
- **Caution**: Near limits, light rain, high cloud cover, restrictions with "limited" status
- **Go**: All parameters within configured limits, restrictions with "approved" status

### Default Weather Limits
- Max Wind: 10 m/s
- Max Gusts: 12 m/s
- Max Rain: 0.5 mm/h
- Min Temperature: 0°C
- Max Cloud Cover: 80%

## Workflows

- `Start Frontend` - Expo dev server on port 8081
- `Start Backend` - Express server on port 5000

## Language

The app UI is in German (Deutsch) as requested.

## Automated Tests

Logic tests for the web flight execution flow live in
`web/src/lib/__tests__/`. They cover phase transitions, the logbook payload
(duration + weather snapshot) and the resume-banner predicate.

Run them with:

```
bash web/run-tests.sh
```

The runner uses `tsx` plus Node's built-in test runner — no extra dev
dependencies are required.
