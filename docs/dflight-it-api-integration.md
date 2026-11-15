# d-flight (IT) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **www.d-flight.it/web-app** (d-flight S.p.A., ENAV-Gruppe).
Die Analyse vom 2026-11-15 ist **ohne Login** entstanden. Alles, was eine
Anmeldung braucht, ist aus dem Web-App-Bundle (Angular, HCI-Version
002.002.043-1) und der öffentlichen Laufzeitkonfiguration abgeleitet und
**nicht live verifiziert**.

Laut Product Owner liegt eine **schriftliche Zustimmung** von d-flight zur
Nutzung der Daten vor. Diese Zustimmung bitte zusammen mit den
Zugangsregeln (welcher Account, welche Grant-Art) im Projekt ablegen.

Vergleich: `docs/godrone-api-integration.md` (NL), `docs/dronespace-at-api-integration.md` (AT).

---

## 1. Kurzfassung

- **Alle Geodaten brauchen ein Login.** Die Konfiguration sagt
  `allowAnonUser: false`, und die Web-App schreibt: „per visualizzare ed
  interrogare le mappe, iscriviti“. GeoServer, geoapi und der ED-269-Download
  antworten anonym mit `401 {"error":"Authentication failed",…}`.
- Die Authentifizierung läuft über **Keycloak**, Realm `DFlight`. Der
  Access-Token geht als `Authorization: Bearer <token>` mit.
- Beste Datenquelle: **ED-269-Gesamtdownload**
  `GET https://www.d-flight.it/geo-awareness/api/ed-269/geo-zones/download`.
  Er hat dasselbe Standardformat wie AT, ist also mit der vorhandenen
  ED-269-Logik der App kompatibel. Das muss nach dem Login verifiziert werden.
- Alternative bzw. Ergänzung: GeoServer-WMS mit Workspace `D-FLIGHT`. Er
  läuft in **EPSG:32633** (UTM 33N), nicht in Web-Mercator. Viele Layer sind
  nur für bestimmte Rollen bzw. Abos sichtbar.
- Weitere Hinweise:
  - Der Disclaimer der Web-App erlaubt die Nutzung „esclusivamente per il
    proprio utilizzo“ und verbietet die Weitergabe an Dritte. Deshalb ist
    die schriftliche Zustimmung entscheidend.
  - Der Disclaimer nennt außerdem den aktuellen AIRAC-Stand: „AIRAC del
    29/10/2026 – ultimo aggiornamento ENAC 29/10/2026“.

---

## 2. Öffentliche Laufzeitkonfiguration (ohne Login)

Die Web-App verbindet sich per socket.io mit `https://www.d-flight.it/socket.io/`
(`EIO=4`) und bekommt ohne Login das Event `d-flight.hci.configuration` mit
allen Service-URLs. Relevante Teile:

```jsonc
{
  "general":   { "gatewayBaseUrl": "https://www.d-flight.it:443/api-gateway", "session_timeout": 1800 },
  "capabilities": { "allowAnonUser": false, "ED269ExportEnable": true, "listNfz": true, ... },
  "iam": {
    "baseUrl": "https://www.d-flight.it:443/user-management",
    "keyCloakUrl": "https://www.d-flight.it:443/auth-iam",
    "clientId": "web-app",
    "newToken": true            // => kein client_secret im Token-Request
  },
  "geoserver": {
    "baseUrl":   "https://www.d-flight.it:443/maps",     // + /wms, /gwc
    "geoApiUrl": "https://www.d-flight.it:443/geoapi"
  },
  "geoawareness": { "baseUrl": "https://www.d-flight.it:443/geo-awareness/api/ed-269/geo-zones/download" },
  "impExp":       { "baseUrl": "https://www.d-flight.it:443/impExp" },
  "mapcache": {
    "map_projection": "EPSG:32633",
    "geoserver_workspace": "D-FLIGHT",
    "gridsetNameAtm09Cache": "GRIDSET_ATM09_32633"
  },
  "globalTempFilter": { "startsAt": "now", "endsIn": "2 days" },
  "broker": { "baseUrl": "wss://www.d-flight.it:443/dflight-messaging" }   // STOMP, Live-Geo-Messages
}
```

> ⚠️ In derselben Nachricht steht auch ein `iam.clientSecret`. Er wird
> **nicht verwendet** (`newToken: true`) und darf auch von uns **nicht**
> verwendet werden. Er gehört nicht in Code oder Doku.

---

## 3. Authentifizierung (aus dem Bundle, ungetestet)

Die Web-App nutzt den OAuth2 **Resource Owner Password Grant**:

```
POST https://www.d-flight.it/auth-iam/realms/DFlight/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=password
&client_id=web-app
&scope=openid email profile user-data personal-data pilot-license dflight-identification
&username=<email, lowercase>
&password=<passwort>
```

- Die Antwort ist ein Keycloak-Token (`access_token`, `refresh_token`,
  `expires_in`). Erneuert wird er per `grant_type=refresh_token` am selben
  Endpunkt.
- Logout: `…/realms/DFlight/protocol/openid-connect/logout`.
- Userinfo: `…/realms/DFlight/protocol/openid-connect/userinfo`.
- Die Web-App verschlüsselt das Passwort-Feld zusätzlich per CSRF-Key
  (`general.csrf_pub_key`, Feldname aus `getPwdKey()`). Ob der Endpunkt das
  Klartextfeld `password` akzeptiert, **muss getestet werden**.
- Fehlertexte: `invalid_grant`, „Account is not fully set up“, „Invalid user
  credentials“, „Account disabled“.
- Danach bei allen Daten-Requests `Authorization: Bearer <access_token>` senden.

**Verifiziert (2026-11-15) mit dem Account `coperpilot`:**

1. **Login funktioniert** per Password-Grant – aber über den **kurzen,
   Gateway-gerouteten Pfad**, nicht über den langen Keycloak-Pfad:
   ```
   POST https://www.d-flight.it/auth-iam/token
   Content-Type: application/x-www-form-urlencoded
   X-CSRF-Token: <csrf_pub_key aus der Socket-Konfiguration>
   X-CSRF-Nonce: <von der App erzeugte Nonce>

   grant_type=password&client_id=web-app
   &scope=openid email profile user-data personal-data pilot-license dflight-identification
   &username=<user>&password=<klartext>
   ```
   Antwort: Keycloak-Token (`access_token`, `refresh_token`, `expires_in` ~300 s).
   Userinfo analog: `POST https://www.d-flight.it/auth-iam/userinfo`.
2. **Der Client-Credentials-Grant (ohne Nutzer) scheitert mit 401** – der
   Client `web-app` ist ein reiner Login-Client, kein Service-Account. Der
   öffentliche Client liefert also nur die `client_id`; es braucht einen
   echten Nutzer-Login.
3. **CSRF ist Pflicht, vom Gateway erzwungen.** Ohne die beiden Header
   antwortet der Token-Endpunkt mit `403 "Missing Headers CSRF protection
   policy exception"`. Der `X-CSRF-Token` ist der `general.csrf_pub_key` aus
   dem Socket-Event `d-flight.hci.configuration`; die `X-CSRF-Nonce` erzeugt
   die Web-App clientseitig in einem **eigenen Format** (kein Standard-UUIDv4;
   eine Standard-UUID wird mit `403 "Malformed Headers"` abgelehnt).
4. **Der ED-269-Download braucht Bearer + dieselben CSRF-Header.** Ein GET auf
   `/geo-awareness/api/ed-269/geo-zones/download` mit gültigem Bearer, aber
   ohne CSRF-Header, liefert `401 "Unable to authenticate using the
   Authorization header"`. Mit korrekten CSRF-Headern (die die App erzeugt)
   geht die Anfrage durch.

**Konsequenz für die Integration:** Der Client muss den Login-Fluss der App
nachbilden – socket.io-Konfiguration holen (liefert `csrf_pub_key`), die
Nonce im App-Format erzeugen und beide Header an **jede** Anfrage hängen.
Das genaue Nonce-Format bzw. eine offizielle Integrationsanleitung sollte bei
d-flight angefragt werden (siehe §6), statt die Schutzfunktion
nachzukonstruieren. Der Download selbst war mit diesem Account technisch
erreichbar; Format und Umfang sind noch mit korrekt erzeugter Nonce zu
verifizieren.

**Architekturfrage (vor dem Bau klären, siehe §6):** Die App hat kein eigenes
Backend mehr. Möglich sind zwei Wege:
- (a) Jeder Pilot meldet sich in COpterPILOT mit **seinem eigenen
  d-flight-Account** an. In Italien braucht ohnehin jeder Betreiber einen.
- (b) d-flight stellt uns einen **Service-Account bzw. API-Client**
  (Client-Credentials) bereit. Den dürfte man aber nicht im App-Binary
  ausliefern, dafür bräuchte es einen Proxy bzw. Backend-Dienst.

---

## 4. Datenendpunkte

### 4.1 ED-269-Gesamtdownload (empfohlen)

```
GET https://www.d-flight.it/geo-awareness/api/ed-269/geo-zones/download
Authorization: Bearer <token>
```

- Anonym: **401** (geprüft).
- Erwartet wird **EUROCAE ED-269 / EASA-UAS-Geozone-JSON** (`features[]`
  mit `identifier`, `restriction`, `reason`, `geometry[]` inkl.
  `lowerLimit`/`upperLimit`/`uomDimensions`/`…VerticalReference`,
  `applicability[]`, `zoneAuthority[]`). Format, Größe und ob gezippt **nach
  dem Login prüfen**.
- In der Web-App heißt der Menüpunkt „Download UAS Geo Zone“, die Capability
  `ED269ExportEnable: true`.
- Verwandte Endpunkte für einzelne Zonen bzw. Abos (vermutlich nur für
  USSPs/Behörden):
  - `GET {impExp}/uasgeozoneapi/eurocae/uaszoneversion?id_idenntifier=<id>`
    (Schreibfehler im Original). Das ist der Export einer einzelnen Zone.
  - `{gateway}/uss/api/ed-269/subscription/subscribe-to-uaszones-updates`,
    dazu `…unsubscribe…`, `…pause…`, `…resume…` und
    `/geo-awareness/uss/api/ed-269/subscription/get-subscriptions`. Das sind
    Push-Abos für Zonenänderungen (U-Space/USSP).
  - `/uaszone-schedule-manager/api/uaszone-schedule`: Zeitpläne der Zonen.

### 4.2 GeoServer (WMS / GWC)

| Zweck | URL |
|---|---|
| WMS | `https://www.d-flight.it/maps/wms` (anonym 401) |
| Tile-Cache | `https://www.d-flight.it/maps/gwc/service/tms/1.0.0/…` bzw. WMTS (anonym 401) |
| Workspace | `D-FLIGHT` |
| Projektion | **EPSG:32633**. Feste Maßstäbe 1:5 000 000 bis 1:1 000; GWC-Gridset `GRIDSET_ATM09_32633`, Extent `[-256473, 3900000, 1177127, 5333600]` |

Die Web-App fragt Zoneninfos per **GetFeatureInfo** ab:

```
{maps}/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&INFO_FORMAT=application/json
  &LAYERS=<l1,l2,…>&QUERY_LAYERS=<…>&CRS=EPSG:32633&WIDTH=..&HEIGHT=..&i=..&j=..&BBOX=..
```

Die Antwort wird auf Felder wie `regola`/`rule`, `maxHeight` (Default `"120"`),
`titolo_regola`/`title_rule`, `notam[]`, `missionArea[]` gemappt. Damit lässt
sich ein **Standort-Check** bauen („Was gilt hier, wie hoch darf ich?“).

Layer laut Konfiguration (`maplayer`), in Klammern die Rollen, die den Layer
**umschalten** dürfen. Ob ein normaler User einen Layer sieht, steuert
zusätzlich das Abo:

| Layer | Inhalt | Rollen |
|---|---|---|
| `D-FLIGHT:NO_FLY_ZONE` (Vektor) | „Reserved Air Spaces“ / NFZ | AUTHORITY |
| `D-FLIGHT:CTR`, `AIRPORT`, `ATZ` | Kontrollzonen, Flughäfen | AUTHORITY |
| `D-FLIGHT:P`, `R`, `D` | Prohibited / Restricted / Danger | AUTHORITY |
| `D-FLIGHT:AREE_MILITARI`, `AREE_MILITARI_BASSA_QUOTA`, `RAS_ARTILLERY` | Militär | AUTHORITY |
| `D-FLIGHT:AVIO_ELI_IDRO`, `ULM` | Flug-, Heli-, Wasserlande- und UL-Plätze | AUTHORITY |
| `D-FLIGHT:PROTECT_NATURE`, `PROTECT_ACROBAT`, `PROTECT_PARACHUTE`, `AERIAL_WORK_TRAINING`, `AREE_DEDICATE` | Schutz- und Sondergebiete | AUTHORITY |
| `D-FLIGHT:ATM09` | ENAC-Karten nach ATM-09 (Höhenlimits rund um Flugplätze) | AUTHORITY, SUPERVISOR, USER_PRO. Laut Text „nur mit Abo Base oder Pro“ |
| `D-FLIGHT:NOTAM` | NOTAM | AUTHORITY, SUPERVISOR, USER_PRO |
| `D-FLIGHT:PARCHI` | Parks | … USER_BASIC |
| `D-FLIGHT:MISSIONS_BVLOS` | BVLOS-Missionen | … USER_BASIC |
| `D-FLIGHT:USO_SUOLO`, `CENSIMENTO` | Bodennutzung, Bevölkerung (Zensus) | AUTHORITY, USER_PRO |
| `D-FLIGHT:MISSIONS`, `BUBBLE_MISSIONS`, `ITALY_ROUTING_KEY` | operativ | AUTHORITY, SUPERVISOR |

### 4.3 Sonstige (ungetestet, Login nötig)

| Endpunkt | Zweck |
|---|---|
| `GET {geoapi}/car?lon=<lon>&lat=<lat>` | Geländehöhe am Punkt („getTerrainAltitude“) |
| `/notam/list`, `/notam/download` | NOTAM |
| `/mission/retrieve-missions-in-area` | Missionen im Gebiet |
| `/geo-awareness/api/uspace-airspace…` | U-Space-Lufträume |
| `wss://www.d-flight.it/dflight-messaging` (STOMP, Topic `/exchange/geo_messages`) | Live-Geo-Nachrichten |
| `GET /web-app/api/v1/datetime` | Serverzeit |

Nicht anfassen: Missionsanmeldung, Drohnenregistrierung, QR-Codes,
Zahlungen (`/epay`, `/store`), Nutzerverwaltung.

---

## 5. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- Für IT gibt es **keine Geozonen-Daten** in der App. Vorhanden sind nur
  `shared/countryMaps.ts` (Link auf d-flight.it), der
  `DflightItalyGuideScreen` und das `dflightDocument` an der Drohne.
- Die vorhandene ED-269-Logik
  (`client/lib/geozoneDirect/ed269Sources.ts`, `client/lib/ed269.ts`,
  `shared/ed269Restriction.ts`, `shared/ed269SourceInfo.ts`) ist für AT
  gebaut und passt auf das ED-269-Format von d-flight.

### Schritte (nach Klärung von §6)

1. **Spike / Verifikation** mit einem Test-Account:
   - Token holen (§3) und prüfen, ob `password` im Klartext akzeptiert wird.
   - Den ED-269-Download abrufen: Format, Größe, Gzip/Zip,
     Feldbelegung (`restriction`, `reason`, Höhenbezüge,
     `applicability`), Anzahl Zonen.
   - Eine **gekürzte Fixture** einchecken, ohne personenbezogene Daten.
2. **Auth-Modul** `client/lib/dflightAuth.ts`:
   - Login mit dem d-flight-Account des Nutzers.
   - Token im SecureStore ablegen (**nicht** AsyncStorage), Refresh-Token
     nutzen, 401 als „neu anmelden“ behandeln.
   - Logout, Löschen der Daten bei Account-Entfernung.
   - Datenschutz: in `shared/privacyPolicy.ts` ergänzen, dass
     d-flight-Zugangsdaten bzw. -Tokens gespeichert werden.
3. **Quelle** in `ed269Sources.ts`:
   - `IT_DFLIGHT_ED269_URL`
   - `fetchItaly(token)`
   - Normalisierung: Wenn das Format echtes ED-269 ist, reicht vermutlich
     `finalize(raw, "it")`. Sonst `shared/italianGeozones.ts` nach dem
     Muster von `belgianGeozones.ts` bauen.
   - `"it"` zu `ED269_DIRECT_COUNTRIES` hinzufügen, **aber nur laden, wenn
     ein Token vorhanden ist**. Ohne Login den Hinweis „Mit d-flight
     anmelden, um italienische Geozonen zu sehen“ zeigen.
4. **Label**: `IT: "d-flight / ENAC (ED-269)"` in `ED269_SOURCE_LABELS`, dazu
   die Attribution und den d-flight-Disclaimer (inkl. AIRAC-Stand) im Popup.
5. **Optional, Standort-Check** per WMS-GetFeatureInfo (§4.2):
   - liefert `maxHeight` und die Regel am Punkt, inkl. ATM-09 für
     Pro-Accounts
   - Koordinaten nach EPSG:32633 transformieren (proj4 o. ä.)
6. **Tests** analog AT: Normalisierung, Höhen-/Zeitlogik, Auth-Fehlerfälle
   (401/Refresh), kein Laden ohne Token.
7. **Refresh**: täglich plus beim App-Start, wenn ein Token vorhanden ist.
   Die AIRAC-Änderungen kommen alle 28 Tage, NOTAM-bezogene Zonen öfter.

---

## 6. Offene Punkte (vor dem Bau klären)

1. **Welcher Zugang ist von der schriftlichen Zustimmung abgedeckt?**
   - (a) jeder Nutzer mit seinem eigenen d-flight-Account, oder
   - (b) ein Service-Account / API-Client für COpterPILOT.

   Für (b) braucht es einen eigenen Proxy, weil Secrets nicht ins
   App-Binary gehören. Die Zustimmung bzw. Bedingungen bitte im Repo ablegen
   oder verlinken.
2. **Password Grant für Drittanbieter-Apps:** Ob d-flight den Client
   `web-app` für fremde Apps freigibt oder einen eigenen `client_id`
   vergibt, bei d-flight anfragen.
3. **Abo-Stufen:** ATM-09 und NOTAM gibt es nur mit Base/Pro. Was ein
   Gratis-Account im ED-269-Download sieht, ist zu prüfen.
4. **Rate-Limits und Nutzungsbedingungen** für automatisierte Abrufe.
5. **CSRF-Nonce-Format / offizielle Integrationsanleitung:** Die App hängt an
   jede Anfrage `X-CSRF-Token` (= `csrf_pub_key`) und eine `X-CSRF-Nonce` im
   eigenen Format. Für eine Fremd-App bei d-flight erfragen, wie die Nonce
   korrekt zu bilden ist bzw. ob es dafür eine dokumentierte Schnittstelle
   gibt. Diese Schutzfunktion nicht selbst nachkonstruieren.

---

## 7. Schnelltest (nach Login)

```bash
# Token holen (Zugangsdaten NICHT ins Repo / in Logs)
TOKEN=$(curl -s https://www.d-flight.it/auth-iam/realms/DFlight/protocol/openid-connect/token \
  -d grant_type=password -d client_id=web-app \
  -d "scope=openid email profile user-data personal-data pilot-license dflight-identification" \
  --data-urlencode "username=$DFLIGHT_USER" --data-urlencode "password=$DFLIGHT_PASS" | jq -r .access_token)

curl -s --compressed -H "Authorization: Bearer $TOKEN" -o it_ed269.out \
  -w "%{http_code} %{content_type} %{size_download}\n" \
  https://www.d-flight.it/geo-awareness/api/ed-269/geo-zones/download
```
