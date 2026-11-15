# iDronect / TMCAD (MT) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **tmcad.idronect.com** (Transport Malta Civil Aviation
Directorate, UTM-Plattform von **iDronect / Aviatize**). Stand: 2026-11-15.
Freigabe liegt laut Product Owner vor.

Vergleich: übrige Länder-Dokumente in `docs/` (NL/AT/IT/LU/IE/PL/BE/PT/ES).

---

## 1. Kurzfassung

- Malta nutzt die **UTM-Plattform iDronect** (belgischer Anbieter Aviatize;
  Brand/Deployment „malta"). Technik: **Meteor 3.5.2** mit **DDP (WebSocket)**
  als Datentransport, deck.gl + Mapbox-Basiskarte.
- Laut Betreiber werden die **Geozonen auf der Karte ohne Login angezeigt**.
  Das deckt sich mit der Technik: Der **DDP-WebSocket ist anonym erreichbar**
  (verifiziert), und die Zonen werden client-seitig aus DDP-Daten gerendert –
  **nicht** aus einer öffentlichen GeoJSON-Datei oder aus den Mapbox-Styles
  (die sind nur Basiskarten).
- **Kein öffentlicher ED-269-/GeoJSON-Download** – weder auf der Plattform noch
  bei Transport Malta. Das Zonen-Schema ist iDronect-eigen (GeoJSON unter
  `flightArea` + Felder), **nicht** ED-269.
- **Ein konkreter Blocker bleibt:** Die Daten-Methode `Zones.getFilteredZones`
  ist anonym aufrufbar, validiert ihren Filter aber **streng**. Mit leerem
  Filter kommen 0 Zonen; `{managedZones:true}` braucht Login; jeder andere
  geratene Schlüssel → „Internal server error". Die **exakten Filter-Parameter
  für die öffentlichen Anzeige-Zonen** ließen sich aus dem Client-Bundle nicht
  ableiten (siehe §5 für den einfachen nächsten Schritt).

> Die Browser-UI (`/map`) ist aus dieser Cloud-Umgebung zusätzlich
> bot-geschützt (403 für den Headless-Browser). Ich habe diesen Schutz
> **bewusst nicht umgangen**. Der DDP-Datenkanal selbst ist aber offen und
> wurde als legitimer Client genutzt.

---

## 2. Plattform-Fakten (verifiziert)

| Punkt | Wert |
|---|---|
| Portal | `https://tmcad.idronect.com/` (Login), Karte `/map` (403 ohne Login) |
| Stack | Meteor `METEOR@3.5.2`, DDP über WebSocket (same-origin) |
| Basiskarte | Mapbox (`accessToken` im `meteor_runtime_config.js`, Brand „2minds-web") |
| Betreiber | iDronect / Aviatize (BE); nationales UTM für Transport Malta |
| Zahlung/Weiteres | Stripe (Live-Key im Client), Sentry, FullCalendar – für Geozonen irrelevant |

### Verifizierter DDP-Zugriff (anonym)
- **Endpoint:** `wss://tmcad.idronect.com/websocket` (Meteor-DDP). Handshake
  `{"msg":"connect","version":"1","support":["1","pre2","pre1"]}` → `connected`.
  **Ohne Login erreichbar.**
- **Daten-Methode:** `Zones.getFilteredZones(filter)` – DDP
  `{"msg":"method","method":"Zones.getFilteredZones","params":[<filter>]}`.
  - Gibt ein **Array** zurück; jedes Element hat `flightArea` (= GeoJSON der
    Zonengeometrie); das Bundle mappt `.map(e => e.flightArea)` in die
    Kartenlayer.
  - `params:[{}]` → OK, aber **0 Zonen**.
  - `params:[{managedZones:true}]` → „You have no access to the zones for this
    company" (Betreiber-eigene Zonen, Login nötig).
  - Unbekannte Filterschlüssel → „Internal server error" (strenges
    `check()`-Schema). **Die Parameter für die öffentlichen Zonen sind noch
    unbekannt.**
- **Weitere Methode:** `getAerodromes` (Flugplätze).
- Es ist **kein** ED-269-/UASZone-Export im Client (kein `ed-269`, kein
  `UASZone`). Zonen-Schema iDronect-eigen (`flightArea`-GeoJSON + Felder wie
  `zoneName`/`zoneAbbr`/Typ), **nicht** ED-269.

---

## 3. Mögliche Zugriffswege (zu klären)

1. **ED-269-Export von iDronect/Aviatize anfordern** *(bevorzugt).* iDronect
   betreibt mehrere nationale UTM-Systeme und kann i. d. R. einen
   ED-269-konformen Zonen-Feed liefern. Das wäre der sauberste Weg und würde
   direkt auf die vorhandene ED-269-Pipeline passen.
2. **Authentifizierter DDP-Zugriff** mit Malta-Zugangsdaten:
   - Meteor-Login (Passwort oder SSO) → DDP-Session.
   - Zonen über die Publikation (`operator-zones`/`non-editable-zones`) abonnieren
     oder `Zones.getFilteredZones` aufrufen.
   - Ergebnis sind iDronect-Zonen-Dokumente (GeoJSON + `zoneName`/`zoneAbbr`/
     Typ/Höhen) → eigener Normalisierer nötig (kein ED-269).
   - Aufwändiger (DDP-Client in RN, Session-Handling) und an die
     Nutzungsbedingungen gebunden.
3. **Offizieller Datensatz von Transport Malta CAD** erfragen (ED-269 oder
   GeoJSON als Datei), falls iDronect keinen direkten Feed gibt.

---

## 4. Integrationsauftrag für COpterPILOT

### Ist-Zustand
- MT ist in der App nur über die Länder-/Bounding-Box-Erkennung bekannt
  (`shared/countryDetection.ts`), **keine Geodaten**, kein Karten-Link in
  `countryMaps.ts`.

### Schritte (abhängig vom Zugriffsweg aus §3)
1. **Zuerst klären (§5):** Liefert iDronect/Aviatize einen **ED-269-Feed**?
   - **Falls ja:** wie AT/PT behandeln – URL + `fetchMalta()` +
     `finalize(raw,"mt")`, `"mt"` in die Länderliste, Label
     `MT: "Transport Malta / iDronect"`.
   - **Falls nein (nur DDP):** `shared/malteseGeozones.ts` + DDP-Client-Pfad;
     iDronect-Zonen-Schema (GeoJSON + `zoneName`/`zoneAbbr`/Typ/Höhen) auf das
     interne Modell mappen. Login/Token im SecureStore, Datenschutz in
     `shared/privacyPolicy.ts` ergänzen.
2. **Attribution:** „© Transport Malta CAD / iDronect".
3. **Tests & Refresh** wie bei den übrigen Ländern (täglich).

---

## 5. Offene Punkte (ein einfacher Schritt entsperrt Malta)

Die öffentlichen Zonen werden ohne Login angezeigt, es fehlen nur die
**exakten Filter-Parameter** für `Zones.getFilteredZones`. Zwei einfache Wege,
das herauszufinden:

1. **Aus eurem eigenen Browser (schnellster Weg):** `tmcad.idronect.com/map` im
   normalen Browser öffnen (dort greift kein Bot-Schutz), Entwicklertools →
   Netzwerk → WS-Verbindung `/websocket`. Dort die Nachricht
   `{"msg":"method","method":"Zones.getFilteredZones","params":[…]}` suchen und
   das `params`-Objekt notieren. Mit genau diesen Parametern kann die App die
   Zonen anonym per DDP ziehen.
2. **Bei iDronect/Aviatize erfragen:** entweder diese Filter-Parameter **oder**
   – besser – einen **ED-269-Feed**. iDronect betreibt mehrere nationale UTMs
   und kann einen solchen Export i. d. R. liefern; das würde direkt auf die
   vorhandene ED-269-Pipeline passen und den DDP-Sonderweg ersparen.

> **Aktueller Stand:** DDP-Zugang und Methode sind verifiziert; es fehlen nur
> die Filter-Parameter für die öffentlichen Zonen. Sobald die vorliegen (aus
> §5.1 oder §5.2), kann ich den Abruf fertig verifizieren und eine Fixture
> anlegen. Ein ED-269-Feed wäre die sauberere Alternative.

---

## 6. Live-Nachtest (2026-11-15): `{}` liefert **0 Zonen** ⚠️

- **Verifiziert (erneut):** `Zones.getFilteredZones({})` über den anonymen DDP
  gibt **0 Features** zurück (nicht „alle öffentlichen Zonen"). Eine Annahme,
  `{}` liefere alle Zonen, stammt aus der Bundle-Rekonstruktion und ist **live
  falsch**.
- Weiterhin: `{managedZones:true}` → „no access" (Login), unbekannte Keys →
  „Internal server error".
- **Das echte Filter-Objekt der Karte ist weiterhin unbekannt.** Es muss die
  **tatsächlich gesendete** WS-Nachricht der laufenden App erfasst werden
  (DevTools → Netzwerk → WS `/websocket` → Tab **Messages** → die reale
  `Zones.getFilteredZones`-Nachricht mit ihrem `params`-Objekt), **nicht** aus
  dem Bundle abgeleitet.
- Alternativ: ED-269/öffentlichen Export bei iDronect/Transport Malta erfragen.
- **Status MT: weiterhin offen** (Filter-Parameter fehlt).
