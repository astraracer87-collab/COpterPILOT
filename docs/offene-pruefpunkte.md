# Offene Prüfpunkte – Übergabe für einen frischen Job

Konsolidierte Liste aller noch offenen Verifikations-/Klärungspunkte aus der
Datenquellen-Analyse (Geozonen + Luftverkehr). Stand: 2026-11-15.
Jeder Punkt nennt **was**, **wie** und **wer/woher**. Detaildokumente je Thema
in `docs/` (siehe `docs/geozonen-quellen-uebersicht.md` und
`docs/air-traffic-quellen.md`).

**Kontext:** Die Analyse lief in einer **US-Cloud-Umgebung**. Einige nationale
Portale sind von dort geo-/bot-/WAF-geblockt, aus der App (EU-Geräte-IP) aber
erreichbar. Solche Punkte sind mit 🌐 markiert. Sicherheits-/Bot-Schutz wurde
**nicht umgangen**.

---

## A. Geozonen – Live-Verifikation von EU-IP / echtem Gerät (🌐)

Nur „von hier geblockt", Daten/Endpunkt bekannt. Von einer EU-IP oder im
Gerätetest gegenprüfen und je eine Fixture einchecken.

1. **PL – PANSA** ✅ ERLEDIGT (von DE-IP, 2026-11-15): 1.774 Zonen als KML abgerufen, Fixtures vorhanden. Offen nur noch: KML→GeoJSON-Adapter bauen.
2. **ES – ENAIRE** ✅ ERLEDIGT (von DE-IP, 2026-11-15): Live-Endpunkt `insignias/.../NSF/Drones_ZG_Aero_V3/MapServer` gefunden, Fixtures vorhanden (Doc korrigiert). Offen nur noch: Normalisierer bauen.
3. **RO – ROMATSA** (`docs/greece-romania-geozones-notes.md`)
   - Prüfen: `flightplan.romatsa.ro/init/drones` von EU-IP überhaupt erreichbar? Dann Datenendpunkt (Netzwerk-Tab) ermitteln.
   - Host aus US-Egress nicht erreichbar (000).

## B. Geozonen – Endpunkt/Parameter fehlt (Browser-Capture oder Betreiber)

Öffentlich sichtbar, aber der exakte Datenabruf ließ sich statisch nicht
ableiten. **Je: im eigenen Browser DevTools → Netzwerk → die Datenanfrage
kopieren** und ins jeweilige Doc eintragen; alternativ Betreiber um ED-269 bitten.

4. **MT – iDronect** (`docs/idronect-mt-api-integration.md`)
   - Fehlt: `params`-Objekt von `Zones.getFilteredZones` (DDP/WebSocket `/websocket`).
   - DDP ist anonym offen; nur die Filter-Parameter fehlen.
5. **CZ – ANS CR** (`docs/czech-ans-api-integration.md`)
   - Fehlt: Parameter von `getGJ.php` / `getData.php?cmd=…` auf `dronemap.gov.cz`.
   - Alternativ: ED-269 bei `dronemap@ans.cz`.
6. **LV – LGS** (`docs/latvia-lgs-api-integration.md`)
   - Fehlt: Datenendpunkt der Mobil-App `m.airspace.lv/mob/map` (Angular).
   - Alternativ: ED-269/AIXM 5.1 bei LGS/AIS (`ais.lgs.lv`).
7. **GR – HASP** (🌐, `docs/greece-romania-geozones-notes.md`)
   - Fehlt: Datenanfragen von `dagr.hasp.gov.gr` (Seite aus US-Egress 403 bot-geblockt).
   - Wahrscheinlich Esri/ArcGIS → dann wie CY/SI lösbar.

## C. Geozonen – Login/Zugang beim Betreiber klären

8. **IT – d-flight** (`docs/dflight-it-api-integration.md`)
   - CSRF-Fluss ist **gelöst** (RSA-Double-Submit über `/pre-flight`, §3a im Doc).
   - Offen: **einmal eingeloggt** `GET /geo-awareness/api/ed-269/geo-zones/download`
     abrufen und das **ED-269-Antwortformat als Fixture** erfassen. Account vorhanden.
9. **HU – MyDroneSpace** (`docs/hungary-mydronespace-api-integration.md`)
   - `GET hatosag.mydronespace.hu/api/zones` braucht Login (GoodID/Google).
   - Bei `info@mydronespace.hu` einen **ED-269-/öffentlichen Endpunkt** erfragen
     (erspart den eID-Login). WMTS-AIXM-Kacheln sind öffentlich.

## D. Geozonen – fachlich bestätigen (einsatzbereit, aber Review nötig)

10. **SI – Slovenia**: ArcGIS-Layer tragen **Stände von 2021** (AMDT 108) –
    Aktualität/aktuelleren Layer oder ED-269 bei Slovenia Control prüfen.
11. **IT – conditional zones**: Mapping `uas:zone:conditional` (orange
    „Genehmigung" vs. gelb „bedingt") mit Fachseite klären.
12. **SK – RAS**: nicht nach `TYPE_CODE="RAS"` filtern – MRVA/NPZ über den
    120-m-Höhenfilter ausschließen, ATZ/RMZ behalten (im SK-Doc §3 beschrieben).
13. **CY – Griechisch**: `PopupInfo` (griechisches HTML) parsen; alle
    `FolderPath`-Kategorien auf Beschränkungen mappen.
14. **GB – NATS/AIP**: NOTAM-Lücke kennzeichnen (kurzfristige Sperren nicht in
    der Karte); Google-My-Maps als offiziellen NATS-Kanal bestätigen.
15. **NL – GoDrone**: schriftliche Bestätigung zur Nutzung des öffentlichen
    API-Keys ablegen.
16. **AT/LT**: Zeitfenster-Abruf (`start`/`end`) zwingend; MATZ/MCTR-Platzhalter
    (Enddatum 2100) über `normalizeAustrianEd269Placeholder` – für LT prüfen.

## E. Luxemburg – vorhandenes Modul reparieren & einbinden

17. **LU** (`docs/luxembourg-geozones-integration.md`)
    - `client/lib/luGeozones.ts` ist **gebaut, aber (a) Feed defekt, (b) nicht eingebunden**.
    - **(a)** `fetchLuZonesFeed()` von `drones.geoportail.lu/zones` (konstant 422)
      auf die funktionierende **OGC-Features-API**
      `features.geoportail.lu/collections/1928/items` umstellen (+ Adapter,
      anderes Schema). Alternativ DAC (`uas.zones@av.etat.lu`) um Feed-Reparatur bitten.
    - **(b)** Modul in den Karten-/Flugplanungs-Flow verdrahten (kein Import bisher),
      `LU_PERMANENT_ZONES` als Offline-Fallback.

## F. Luftverkehr / FlightRadar24

18. **FR24 feed.js** (`docs/air-traffic-quellen.md`)
    - Code ist **fertig** (copy-paste, §4.1): `parseFr24Feed`, `fetchFr24`,
      Dispatcher-/Aggregator-Änderung, Parser-Test.
    - **Prüfen:** Kommt der RN-`fetch` **auf echtem Gerät** (Android/iOS) durch
      FR24s Cloudflare? Vom Server-Egress ja; Geräte-IPs können abweichen.
    - **Prüfen:** Rate-Limit-Verhalten bei regelmäßigem Polling (Intervall ~5–8 s,
      Bounding-Box klein halten); leere Hüllen (`full_count`>0, keine Flüge)
      ggf. mit Retry behandeln.
    - **Ablegen:** FR24-Zustimmung schriftlich ins Projekt.

## G. Implementierung (baufertig – 13 Länder)

19. **Generische Loader bauen** und die einsatzbereiten Länder daran hängen
    (`docs/geozonen-quellen-uebersicht.md`, Abschnitt „Gruppierung nach Technik"):
    - **ED-269/ED-318-Loader** (vorhanden) → AT, LT, IE, PT, BE, (ES, IT, LU)
    - **WFS-Loader** (neu) → BE, IS, BG
    - **ArcGIS-FeatureServer/MapServer-Loader** (neu) → CY, SI, SK, (GR)
    - **KML→GeoJSON** (neu, `togeojson`) → GB, PL
    - **Sonderfälle** → HR (SignalR, Code-Skizze im HR-Doc §6), MT (DDP)
    - Gemeinsame Helfer: **WKT→GeoJSON** (HR), **Kreis→Polygon** (PT, NL),
      **Höhenumrechnung** (FL/ft/m).
    - Einsatzbereit: **NL, AT, BE, IE, PT, LT, GB, IS, CY, HR, BG, SI, SK**
      (BE bereits integriert).

## H. Übergreifend

20. **Schriftliche Freigaben/Lizenzen je Land** gesammelt im Repo ablegen
    (NL-Key, IT, PL, HU, MT, FR24, …).
21. **Repo nach weiteren halbfertigen Länder-Modulen durchsuchen** (wie
    `luGeozones.ts`): Muster `client/lib/*Geozones.ts`, Länder-Konstanten –
    „neu bauen" von „nur reparieren/einbinden" trennen, bevor gebaut wird.

---

## Statusüberblick (Kurz)

| Kategorie | Länder/Themen |
|---|---|
| ✅ einsatzbereit (13) | NL, AT, BE, IE, PT, LT, GB, IS, CY, HR, BG, SI, SK |
| 🔑 Login/Zugang klären | IT (Format erfassen), HU |
| 🌐 EU-IP/Gerät nötig | PL, ES, RO, GR |
| 🔎 Browser-Capture nötig | MT, CZ, LV, (GR) |
| 🛠 reparieren+einbinden | LU |
| ✈️ Gerätetest | FR24 feed.js |

Verweise: `docs/geozonen-quellen-uebersicht.md` (alle Länder),
`docs/air-traffic-quellen.md` (Radar/FR24), sowie die einzelnen
`docs/<land>-…-integration.md`.
