# Datenquellen-Dokumentation – Index

Zentraler Einstieg zu allen analysierten Datenquellen für COpterPILOT:
Drohnen-Geozonen (31 Länder) und Live-Luftverkehr. Stand: 2026-11-15.

Methode: Analyse der offiziellen Portale/Apps (Netzwerk-Capture, öffentliche
Bundles/Specs), Abrufe über die **öffentlichen** Endpunkte. Kein Bot-/WAF-Schutz
umgangen, keine privaten Logins missbraucht. Teile der Abrufe liefen aus einer
**DE-IP** (einige Portale sind nur von EU-IP erreichbar).

---

## 🧭 Zentrale Dokumente (hier starten)

| Dokument | Zweck |
|---|---|
| [geozonen-quellen-uebersicht.md](geozonen-quellen-uebersicht.md) | **Länder-Gesamttabelle** (Quelle, Auth, Format, Status) + Technik-Gruppierung + wiederverwendbare Loader |
| [offene-pruefpunkte.md](offene-pruefpunkte.md) | **Übergabeliste** aller offenen Punkte (für einen frischen Job) |
| [geozonen-daten-abruf-DE-2026-11-15.md](geozonen-daten-abruf-DE-2026-11-15.md) | Bericht der **tatsächlich von DE abgerufenen Daten** (ES/PL/RO/LU) inkl. Größenwarnungen |
| [handover-hauptjob-DE-2026-11-15.md](handover-hauptjob-DE-2026-11-15.md) | **Konsolidierte DE-Übergabe**: Erreichbarkeit DE/US, Abruf-Rezepte je Land, Datei-Inventar (`fixtures/`), MT-Normalizer |
| [air-traffic-quellen.md](air-traffic-quellen.md) | **Luftverkehr**: ADS-B/OGN-Quellen + FlightRadar24 (feed.js, fertiger Code) |

**Test-Fixtures** (getrimmte echte Antworten): [`docs/fixtures/`](fixtures/)
(PL-KML, RO-Zonen, RO-NOTAM, ES-Aerodrome, LU-OGC).

---

## 🌍 Geozonen – Länder-Dokumente

**Legende:** ✅ einsatzbereit · 📥 Daten abgerufen (Fixtures) · 🔑 Login/Betreiber ·
🔎 Browser-Capture nötig · 🛠 reparieren/einbinden · ⚠️ kein Vektor-Feed

| Land | Status | Dokument |
|---|---|---|
| 🇳🇱 NL Niederlande | ✅ | [godrone-api-integration.md](godrone-api-integration.md) |
| 🇦🇹 AT Österreich | ✅ | [dronespace-at-api-integration.md](dronespace-at-api-integration.md) |
| 🇧🇪 BE Belgien | ✅ (integriert) | [droneguide-be-api-integration.md](droneguide-be-api-integration.md) |
| 🇮🇪 IE Irland | ✅ | [ireland-geozones-integration.md](ireland-geozones-integration.md) |
| 🇵🇹 PT Portugal | ✅ | [anac-pt-api-integration.md](anac-pt-api-integration.md) |
| 🇱🇹 LT Litauen | ✅ | [lithuania-ans-api-integration.md](lithuania-ans-api-integration.md) |
| 🇬🇧 GB Vereinigtes Königreich | ✅ (AIXM 5.1, 1.069 Zonen) | [uk-geozones-integration.md](uk-geozones-integration.md) |
| 🇪🇪 EE Estland | ✅ (ED-269, ~230) | [estonia-eans-api-integration.md](estonia-eans-api-integration.md) |
| 🇫🇷 FR Frankreich | ✅ (WFS, ~89.700) | [france-geoportail-api-integration.md](france-geoportail-api-integration.md) |
| 🇮🇸 IS Island | ✅ | [iceland-samgongustofa-api-integration.md](iceland-samgongustofa-api-integration.md) |
| 🇨🇾 CY Zypern | ✅ | [cyprus-dca-api-integration.md](cyprus-dca-api-integration.md) |
| 🇭🇷 HR Kroatien | ✅ | [croatia-amc-api-integration.md](croatia-amc-api-integration.md) |
| 🇧🇬 BG Bulgarien | ✅ | [bulgaria-caa-api-integration.md](bulgaria-caa-api-integration.md) |
| 🇸🇮 SI Slowenien | ✅ | [slovenia-caa-api-integration.md](slovenia-caa-api-integration.md) |
| 🇸🇰 SK Slowakei | ✅ | [slovakia-lps-api-integration.md](slovakia-lps-api-integration.md) |
| 🇪🇸 ES Spanien | ✅ 📥 komplett abgerufen | [enaire-es-api-integration.md](enaire-es-api-integration.md) |
| 🇵🇱 PL Polen | ✅ 📥 1.774 Zonen | [pansa-pl-api-integration.md](pansa-pl-api-integration.md) |
| 🇷🇴 RO Rumänien | ✅ 📥 1.272 + 226 | [greece-romania-geozones-notes.md](greece-romania-geozones-notes.md) |
| 🇱🇺 LU Luxemburg | 📥 🛠 Modul reparieren/einbinden | [luxembourg-geozones-integration.md](luxembourg-geozones-integration.md) |
| 🇮🇹 IT Italien | 🔑 CSRF gelöst, Download erfassen | [dflight-it-api-integration.md](dflight-it-api-integration.md) |
| 🇭🇺 HU Ungarn | 🔑 Vektor nur per Login (öffentl. Weg raster-only, verifiziert) | [hungary-mydronespace-api-integration.md](hungary-mydronespace-api-integration.md) |
| 🇲🇹 MT Malta | ✅ (DDP `{managedZones:true}`, 195) | [idronect-mt-api-integration.md](idronect-mt-api-integration.md) |
| 🇨🇿 CZ Tschechien | 🔎 getGJ.php-Params | [czech-ans-api-integration.md](czech-ans-api-integration.md) |
| 🇱🇻 LV Lettland | ✅ (ArcGIS + SOE-Aktivfilter) | [latvia-lgs-api-integration.md](latvia-lgs-api-integration.md) |
| 🇩🇰 DK Dänemark | ✅ (ArcGIS, dronezoner.eu) | [denmark-dronezoner-api-integration.md](denmark-dronezoner-api-integration.md) |
| 🇨🇭 CH Schweiz | ✅ (ED-269 STAC, 1.288) | [switzerland-bazl-api-integration.md](switzerland-bazl-api-integration.md) |
| 🇱🇮 LI Liechtenstein | ✅ (über CH-Datensatz) | [switzerland-bazl-api-integration.md](switzerland-bazl-api-integration.md) |
| 🇳🇴 NO Norwegen | ✅ (statische GeoJSON) | [norway-dronesoner-api-integration.md](norway-dronesoner-api-integration.md) |
| 🇸🇪 SE Schweden | ✅ (ED-318 + WFS, Skript) | [sweden-lfv-api-integration.md](sweden-lfv-api-integration.md) |
| 🇬🇷 GR Griechenland | ⚠️ nur WMS-Raster → ED-269 erfragen | [greece-romania-geozones-notes.md](greece-romania-geozones-notes.md) |

---

## ✈️ Luftverkehr (Radar)

[air-traffic-quellen.md](air-traffic-quellen.md) – Details, Feld-Mappings und
**fertiger Code**:
- **Aktiv/integriert:** ADS-B (adsb.fi, adsb.one, airplanes.live, adsb.lol) + OGN.
- **FlightRadar24** (feed.js): live verifiziert, **nicht Cloudflare-geblockt**,
  copy-paste-Code für `client/lib/traffic/sources.ts` liegt bei.

---

## 🔧 Wiederverwendbare Bausteine (für die Umsetzung)

Siehe „Gruppierung nach Technik" in
[geozonen-quellen-uebersicht.md](geozonen-quellen-uebersicht.md):
- **ED-269/ED-318-Loader** (vorhanden) → AT, LT, EE, IE, PT, BE, ES, IT, LU, **CH** (+LI)
- **WFS-Loader** → BE, IS, BG, RO, FR (~90k → PMTiles), CZ(ED-318)
- **ArcGIS-FeatureServer/MapServer-Loader** → CY, SI, SK, ES, **DK**, **LV** (+SOE-Aktivfilter, Referer)
- **Statische GeoJSON-Dateien** → **NO** (dronesoner.no, pro Zonenart eine Datei)
- **KML→GeoJSON** → PL; **AIXM 5.1** → GB (Bögen/Kreise densifizieren)
- **Sonderfälle** → HR (SignalR), MT (Meteor-DDP), GR (WMS-KML-Skript)
- Wiederkehrendes Muster: viele Quellen tragen **Höhen/Farben/Aktiv-Flags direkt
  im Feature** (NL, CH, DK, PT, EE …) → internes Einheitsschema nutzen.
- Helfer: WKT→GeoJSON (HR), Kreis→Polygon (PT, NL), Höhenumrechnung (FL/ft/m)

---

## 📌 Hinweise
- **Schriftliche Freigaben/Lizenzen** je Land gehören gesammelt ins Repo
  (NL-Key, IT, PL, HU, MT, FR24 …).
- Vorhandene halbfertige Module prüfen (z. B. `client/lib/luGeozones.ts`) –
  „neu bauen" von „nur reparieren/einbinden" trennen.
- Große ES-Layer (Infra 177 MB, ENP 221 MB) nicht roh laden – vereinfachen /
  bbox-basiert / paginieren (Details im ES-Doc).
