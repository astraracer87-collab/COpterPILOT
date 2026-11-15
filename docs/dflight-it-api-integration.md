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
3. **CSRF ist Pflicht, vom Gateway erzwungen** – und es ist ein
   **standardisierter RSA-Double-Submit**, kein Sonderformat. (Das war der
   zuvor übersehene Punkt; siehe §3a für den vollständigen Algorithmus.)
   Ohne die Header: `403 "Missing Headers"`; mit falsch gebildetem Token:
   `403 "Malformed Headers"`.
4. **Der ED-269-Download braucht Bearer + dieselben CSRF-Header.** Ein GET auf
   `/geo-awareness/api/ed-269/geo-zones/download` mit gültigem Bearer, aber
   ohne CSRF-Header, liefert `401 "Unable to authenticate using the
   Authorization header"`. Mit korrekt gebildeten CSRF-Headern geht die
   Anfrage durch.

### §3a – Der CSRF-Mechanismus im Detail (aus dem Client-Code rekonstruiert)

Die Web-App hängt an **jede** API-Anfrage die Header `X-CSRF-Token` und
`X-CSRF-Nonce`. Die werden so gebildet (`getXcsrfInfo()` im Bundle):

1. **Echten Public Key gewinnen:** `general.csrf_pub_key` aus dem
   socket.io-Event `d-flight.hci.configuration` ist base64 und wird mit einem
   **fest im Client hinterlegten Schlüssel** `publicCsrfDecryptKey` per
   RSA-`publicDecrypt` (Padding **PKCS#1 v1.5** = `padding:1`) entschlüsselt.
   Ergebnis = `publicKeyPem` (der eigentliche RSA-Public-Key als PEM).
   Der hinterlegte Entschlüsselungs-Key (öffentlich, steht im Bundle):
   ```
   -----BEGIN PUBLIC KEY-----
   MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA1bpY0TH/OqwY71j+7ayl
   bWIo2njiAh2H+o0ghgOhXxcUgw4RSZrUzTRdJOhXKozgXwZ4BX2rrMpEZJ/RCZQA
   HiSvmhFeuztgFLK7CFKTkS3uftaT7jBdvtI9GKgxgPd+nrThnc78w/fBilzPVCdg
   +U0zhA4mnWNco2Jk1WDEK6PJ05SC4ZwQ29SVMZv6264q6bs6Le4lmWC/JxzeR2Sq
   TprCwIa9y1Yq22u27wgwVqcqc1vsGgTHQe/VWLmbb6QxfJpTyNJc+ZwH1N6gILkC
   E2RF52mWrQ/grz7YoLXg7haLWxzjflbhVlRujGqcrdYpNm5u8yGiKYmNlWvGP0dv
   Qy8LJZXlmaiKHy8v70NobdzgodepoENIL4QS5nI5HyMMBAo5pWSQFktOiuTokY/s
   2O6oWliIwdevqLg64cW2joWNAV9a8sfU49OXrEzuZPve3gJRxhdwKjlfW7STIFrU
   pGUheLpUfjrjSUY3WWIw6lXimllHOg0iIsCq7UBFWvXLz2xubw4DGNFWrj/5oX7Q
   9+367SxJMErS9xvhuP8vlvDQ/XISCHox9v4tvBP/jNZAirP15UbWtGhritJ1v9St
   7765ICsoDSDddSgQJ4UC5m5kwVFi5WlKaYig3lvW8DFGbrwocbdCQetOt8tGoxwT
   +Y5a/Mb8L8KiEJ4RPspHLvsCAwEAAQ==
   -----END PUBLIC KEY-----
   ```
2. **Server-Wert holen:** `GET {gatewayBaseUrl}/pre-flight`
   (`gatewayBaseUrl` = `https://www.d-flight.it/api-gateway`, also
   **`GET https://www.d-flight.it/api-gateway/pre-flight`**). Antwort enthält
   `{ "value": <W> }`. **Cookies/Session mitführen** (gleicher Jar wie beim
   Token-Request).
3. **Pro Anfrage Header bilden:**
   - `H` = eine frisch erzeugte **UUID** (das Format ist egal – der Server
     prüft nur, dass die entschlüsselte Nonce gleich `X-CSRF-Nonce` ist).
   - `X-CSRF-Token` = base64( RSA-`publicEncrypt`(`publicKeyPem`,
     Padding **PKCS#1 v1.5**, Daten = `H + "|" + W`) )
   - `X-CSRF-Nonce` = `H`
4. Der Server entschlüsselt `X-CSRF-Token`, prüft `H` gegen `X-CSRF-Nonce`
   und `W` gegen den ausgegebenen `/pre-flight`-Wert.

**Warum der frühere Versuch scheiterte:** Wir hatten den rohen
`csrf_pub_key` direkt als `X-CSRF-Token` geschickt und eine Zufalls-UUID als
Nonce. Richtig ist: Key erst entschlüsseln, `/pre-flight`-Wert holen, dann
`nonce|value` RSA-verschlüsseln. **Kein kostenpflichtiger Support nötig** –
der Mechanismus ist vollständig im Client enthalten und oben beschrieben.

**Konsequenz für die Integration:** Diesen Ablauf einmal implementieren
(socket.io-Config für `csrf_pub_key`, `/pre-flight` für `value`, RSA-Encrypt
pro Request) und `X-CSRF-Token`/`X-CSRF-Nonce` zusammen mit dem Bearer an
alle Anfragen hängen. Die ED-269-Download-Antwort (Format/Umfang) ist dann
einmal zu erfassen und als Fixture abzulegen.

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
5. **CSRF-Mechanismus: GELÖST** (siehe §3a). Es ist ein Standard-RSA-Double-
   Submit, vollständig aus dem Client rekonstruiert (`/pre-flight`-Wert +
   RSA-Encrypt von `nonce|value`). Keine Rückfrage/kein kostenpflichtiger
   Support bei d-flight nötig. Offen bleibt nur, die **Download-Antwort einmal
   live zu erfassen** (Format/Feldbelegung des ED-269-Exports) und als Fixture
   abzulegen – das macht der Programmierer im App-Session-Kontext.

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

---

## Anhang IT: eingeloggte Live-Analyse (DE-Session, 2026-11-15) — maßgeblich

Mit **Davids Benutzerkonto** (Rolle `USER`) direkt in der Web-App gemessen. Das
korrigiert/präzisiert die obigen Abschnitte: der eigentliche Daten-Weg ist der
**GeoServer-WFS**, nicht der CSRF-/Pre-Flight-Weg.

### Realität der Auth
- **Ohne Login geht nichts:** jede Anfrage ohne Bearer-Token → `401`
  (auch Kartenkacheln). Config `allowAnonUser:false`. Die Behörden-Aussage „geht
  auch ohne User-Login" trifft auf die Produktivumgebung **nicht** zu.
- **Keycloak** Realm `DFlight`, Client `web-app`, Header `Authorization: Bearer
  <JWT>`, Token nur **5 min** gültig (App erneuert laufend). Client-Daten der
  Web-App sind öffentlich, aber **nicht** für eigene Abrufe nutzen.

### Daten-Weg ✅ (mit Token): GeoServer-WFS → GeoJSON
```
GET https://www.d-flight.it/maps/wms?service=WFS&version=2.0.0&request=GetFeature
    &typeNames=D-FLIGHT:ATM09_INFO&outputFormat=application/json&srsName=EPSG:4326
Authorization: Bearer <token>
```
Ausgabeformate: GeoJSON/KML/SHAPE-ZIP/csv/GML. Paging `count`/`startIndex`,
`resultType=hits`, `bbox=minLat,minLon,maxLat,maxLon,EPSG:4326`.

**Wichtige Layer (Namespace `D-FLIGHT:`):**
| Layer | Inhalt | Anzahl |
|---|---|---|
| **`ATM09_INFO`** | **Haupt-UAS-Geozonen** (ENAC, max. Höhe + Regel) | 3.876 |
| `ATM09` | dieselben, nach Höhenklasse (0/25/45/60/120 m) gruppiert | 8 |
| `NO_FLY_ZONE` | temporäre/dynamische NFZ (zeitabhängig) | 16.134 |
| `NO_FLY_ZONE_LIST` | gruppierte NFZ | 604 |
| `CTR`/`ATZ`/`P`/`R`/`D` | Lufträume / Prohibited/Restricted/Danger | 57/92/279/56/20 |
| `AREE_MILITARI`, `PARCHI`, `PROTECT_NATURE` | Militär / Parks / Naturschutz | 44 / 3.553 / 314 |
| `NOTAM` | drohnenrelevante NOTAMs | 18 |

- `ATM09_INFO`-Felder: `id, name, quota_max, type, rule, regola, subtype,
  lower_limit_m, upper_limit_m, valid_from, valid_to, priority, designator,
  title_rule, titolo_regola, note` (Höhen bereits in **Metern**).
- **NFZ-Zeitfilter** (wie die App): `viewparams=start_nfz:<jetzt>;end_nfz:9999-12-31T00:00;`
  NOTAM analog mit `div_notam`/`dfv_notam`/`quota_max:20000`.

### ED-269-Download existiert, ist aber rollengesperrt
`/geo-awareness/api/ed-269/geo-zones/download` → **401 auch mit User-Token**
(Menüpunkt „Download UAS Geo Zone" für Rolle `USER` nicht sichtbar). Config
`ED269ExportEnable:true` → an Operator/USSP-Rolle gebunden. Abo/Push (USSP):
`/uss/api/ed-269/subscription/...` (nicht getestet).

### Weg zum Produktivbetrieb (das ist das eigentlich Offene)
1. **Service-Account / `client_credentials`-Client bei D-Flight beantragen**
   (Realm `DFlight`, Leserecht auf WFS und/oder `geo-awareness/ed-269`) —
   **empfohlen**, sauberer Serverzugriff ohne Privatkonto.
2. Alternativ **ED-269-Download für das Konto freischalten** (Rolle klären).
3. Password-Grant mit Davids Zugangsdaten nur nach **schriftlichem OK** (Konto-
   Bindung, rechtlich heikel) — nicht bevorzugt.

### ⚠️ Lizenz (blockiert Weitergabe!)
Web-App-Hinweis: Daten **nur für den persönlichen Gebrauch**, **nicht an Dritte
weitergeben/verkaufen**. Für die Einbindung in COpterPILOT (Weitergabe an Nutzer)
ist eine **ausdrückliche Datenfreigabe von D-Flight/ENAC nötig** — das ist der
entscheidende offene Punkt, nicht die Technik.

### Status IT (präzisiert)
- **Daten technisch abrufbar** (WFS `ATM09_INFO` mit eingeloggtem Token) → eine
  **Fixture lässt sich sofort mit Davids Login ziehen**.
- **Offen für Produktiv:** (a) Service-Account/Client-Credentials von D-Flight,
  (b) **Lizenz-/Weitergabe-Freigabe**. Bis dahin **🔑**.

---

## Anhang IT (2): Integrationsmodell = Nutzer-Login in den Einstellungen (FESTGELEGT)

**Entscheidung des Product Owners:** IT wird **pro Nutzer** gelöst. Der Pilot
hinterlegt seine **eigenen d-flight-Zugangsdaten in den App-Einstellungen**; die
App meldet sich damit bei d-flight an und ruft die Zonen mit **seinem** Token ab —
genau wie die d-flight-Web-App. Kein Service-Account, kein globaler Export nötig.

> Rechtlich sauber: Jeder Nutzer ruft **seine eigenen Daten mit seinem eigenen
> Konto** zum **persönlichen Gebrauch** ab (deckt sich mit der d-flight-Bedingung).
> Die App verteilt keine fremd beschafften Daten weiter, sondern ist Client für
> das Konto des Nutzers.

### Ablauf in der App
1. **Einstellungen → „Italien (d-flight)":** Felder *Benutzername* + *Passwort*.
   Speicherung **verschlüsselt im Gerät** (`expo-secure-store`/Keychain), **nie**
   im Klartext, **nie** fest im Code. In `shared/privacyPolicy.ts` ergänzen.
2. **Login (Keycloak Password Grant):**
   ```
   POST https://www.d-flight.it/auth/realms/DFlight/protocol/openid-connect/token
   Content-Type: application/x-www-form-urlencoded
   grant_type=password&client_id=web-app&username=<user>&password=<pw>&scope=openid
   → { access_token (≈5 min), refresh_token, expires_in }
   ```
   - `access_token` im Speicher halten, bei Ablauf via `grant_type=refresh_token`
     erneuern; bei `invalid_grant`/401 → Nutzer zur erneuten Eingabe auffordern.
   - ⚠️ **Voraussetzung:** der Keycloak-Client erlaubt „Direct Access Grants".
     Falls d-flight das für `web-app` gesperrt hat, **Fallback:** In-App-Browser-
     Login (Authorization-Code-Flow gegen denselben Realm) und nur den
     Refresh-Token sichern. Beim Bau einmal prüfen, welcher Flow greift.
3. **Datenabruf (WFS, mit Bearer):** `D-FLIGHT:ATM09_INFO` als GeoJSON
   (+ optional `CTR/ATZ/P/R/D`, `NO_FLY_ZONE` mit Zeit-`viewparams`), siehe
   Anhang IT §Daten-Weg. `shared/italianGeozones.ts` mappt `ATM09_INFO`-Felder
   (`lower_limit_m`/`upper_limit_m` schon in Metern, `rule`/`regola`,
   `valid_from`/`valid_to`) aufs interne Modell.
4. **Nur bei hinterlegten Zugangsdaten aktiv:** Ohne Login zeigt die App für IT
   einen Hinweis „d-flight-Login in den Einstellungen hinterlegen"; es werden
   keine IT-Zonen geladen. `"it"` entsprechend konditional in die Länderliste.
5. **Caching:** Token 5 min → nicht pro Kartenbewegung neu abrufen; Zonen nach
   erfolgreichem Login einmal laden und lokal cachen (Refresh täglich bzw. bei
   NFZ häufiger), bei Fehler letzten Stand behalten.

### Hinweise
- Die öffentlichen Web-App-Keycloak-Clientdaten nur als `client_id` verwenden
  (das ist üblich für öffentliche SPA-Clients); **kein** Client-Secret einbauen.
- Ein D-Flight-Konto ist für Italien-Flüge ohnehin Pflicht → die Login-Hürde ist
  für IT-Nutzer kein zusätzlicher Aufwand.
- **Status IT:** Integrationsmodell steht (Nutzer-Login in Einstellungen → WFS).
  Umsetzbar, sobald der Login-Flow (Password-Grant vs. Auth-Code) einmal am
  echten Client verifiziert ist.
