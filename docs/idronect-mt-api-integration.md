# iDronect / TMCAD (MT) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **tmcad.idronect.com** (Transport Malta Civil Aviation
Directorate, UTM-Plattform von **iDronect / Aviatize**). Stand: 2026-11-15.
Freigabe liegt laut Product Owner vor.

Vergleich: übrige Länder-Dokumente in `docs/` (NL/AT/IT/LU/IE/PL/BE/PT/ES).

---

## 1. Kurzfassung

- Malta nutzt **kein offenes Datenportal**, sondern die **login-geschützte
  UTM-Plattform iDronect** (belgischer Anbieter Aviatize; Brand/Deployment
  „malta"). Technik: **Meteor 3.5.2** mit **DDP (WebSocket)** als
  Datentransport, Mapbox als Basiskarte.
- **Kein öffentlicher ED-269-/GeoJSON-Download gefunden.** Die Karte unter
  `/map` ist ohne Login nicht zugänglich (403); die Zonen werden über
  DDP-Publikationen/-Methoden **hinter dem Login** geladen.
- Auch extern ist **keine maschinenlesbare öffentliche Quelle** für Maltas
  Zonen belegt (Transport Malta verweist nur auf die interaktive Karte).
- **Folge:** Für die Integration braucht es entweder **Zugangsdaten/API-Zugang
  von iDronect/Aviatize bzw. Transport Malta CAD** oder einen von ihnen
  bereitgestellten **ED-269-Export**. Die vorhandene „Freigabe" sollte genau
  das umfassen – bitte klären (siehe §5).

---

## 2. Plattform-Fakten (verifiziert)

| Punkt | Wert |
|---|---|
| Portal | `https://tmcad.idronect.com/` (Login), Karte `/map` (403 ohne Login) |
| Stack | Meteor `METEOR@3.5.2`, DDP über WebSocket (same-origin) |
| Basiskarte | Mapbox (`accessToken` im `meteor_runtime_config.js`, Brand „2minds-web") |
| Betreiber | iDronect / Aviatize (BE); nationales UTM für Transport Malta |
| Zahlung/Weiteres | Stripe (Live-Key im Client), Sentry, FullCalendar – für Geozonen irrelevant |

Im Client-Bundle gefundene zonenbezogene DDP-/Logiknamen (Anhaltspunkte für den
authentifizierten Zugriff):
- **Methoden:** `Zones.getFilteredZones`, `Zones.saveMultipleZones`
- **Publikations-/Abo-/Routennamen:** `operator-zones`, `non-editable-zones`,
  `manage-zones`
- **Zonenfelder:** `zoneName`, `zoneAbbr`, Zonentyp (`flight-zone-types.js`),
  GeoJSON-Geometrie (das Bundle ist stark GeoJSON-basiert)
- Flags: `EDITABLE_ZONES_ENABLED`, `NON_EDITABLE_ZONES_ENABLED`

> Es ist **kein** ED-269-/UASZone-Export im Client enthalten (kein `ed-269`,
> kein `UASZone`-Export-Pfad). Das Zonen-Schema ist iDronect-eigen (GeoJSON +
> `zoneName`/`zoneAbbr`/Typ), **nicht** ED-269.

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

## 5. Offene Punkte (vor dem Bau klären – blockierend)
1. **Was genau deckt die Malta-Freigabe ab?**
   - einen **ED-269-/GeoJSON-Export** (bevorzugt), oder
   - **Zugangsdaten** für den DDP-Zugriff, oder
   - eine **Daten-Datei** von Transport Malta CAD.
2. **Ansprechpartner:** iDronect/Aviatize (Plattformbetreiber) bzw. Transport
   Malta CAD. Frage konkret nach einem ED-269-Feed – das erspart den
   DDP-Sonderweg.
3. **Zugangsdaten** (falls DDP): bitte als Umgebungsvariablen bereitstellen,
   nicht im Chat. Dann kann der Zonenabruf verifiziert und eine Fixture
   erstellt werden.

> **Aktueller Stand:** Ohne ED-269-Feed oder Zugangsdaten ist Malta **nicht
> live abrufbar**. Die Plattform- und Datenpfad-Analyse ist abgeschlossen; der
> nächste Schritt ist eine Entscheidung/Info aus §5.
