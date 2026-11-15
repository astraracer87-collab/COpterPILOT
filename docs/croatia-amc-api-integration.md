# Kroatien (HR) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **amc.crocontrol.hr/amc/maps/** (Hrvatska kontrola
zračne plovidbe / Croatia Control – Airspace Management Cell, AMC).
Stand: 2026-11-15. Freigabe liegt laut Product Owner vor.

Vergleich: übrige Länder-Dokumente in `docs/`.

---

## 1. Kurzfassung

- Die gelieferte URL ist das **AMC-Portal von Croatia Control** (Airspace
  Management Cell) – eine **ASP.NET-Webanwendung** für
  **Luftraum-Reservierungen/-Aktivierungen** (vergleichbar einem AUP/UUP-
  System), mit VFR/IFR-Kartenlayern (`vfr3`, `lower3`, `upper3`),
  Reservierungs- und Taktik-Funktionen.
- Die Kartendaten laufen über eine **WebSocket-Verbindung („amcwss")**, die
  erst nach Initialisierung/Interaktion – und für die vollen Funktionen
  vermutlich **nach Login** – Daten liefert. Im anonymen Seitenaufruf wurden
  **keine öffentlichen Geozonen-/GeoJSON-Endpunkte** ausgelöst.
- **Folge:** Dies ist **kein sauberer, direkt nutzbarer Drohnen-Geozonen-Feed**
  wie bei den ED-269-Ländern. Für eine saubere Integration sollte bei Croatia
  Control ein **ED-269-/WFS-/GeoJSON-Export** erfragt werden (siehe §4).

---

## 2. Beobachtungen (verifiziert)

| Punkt | Wert |
|---|---|
| Portal | `https://amc.crocontrol.hr/amc/maps/` (HTTP 200) |
| Technik | ASP.NET (DNN), jQuery, jsGrid, Turf, Lobipanel; Skripte `AMC/tactical.js`, `mapCommunication.js`, `reservationMode.js`, `liveTrack.js` |
| Datentransport | WebSocket „amcwss" (dynamisch aufgebaut); REST-Pfade u. a. `/TRANS_ReservationUrl`, `/View-Reservation` |
| Kartenlayer | `vfr3`, `lower3`, `upper3` (VFR/IFR-Tiles) |
| Beim anonymen Laden | nur HTML + Assets; **keine** Geozonen-/GeoJSON-Requests |

Das Portal ist auf **Luftraumreservierung und taktische Luftraumnutzung**
ausgelegt (professionelle AMC-Nutzer), nicht primär auf eine öffentliche
Drohnen-Geozonen-Darstellung. Ob und welche Drohnen-Geozonen-Schicht hier
ohne Login verfügbar ist, ließ sich **nicht** verifizieren.

---

## 3. Warum noch nicht integrierbar

- **Kein öffentlicher Zonen-Endpunkt gefunden.** Die Daten kommen über einen
  dynamisch aufgebauten WebSocket; ein maschinenlesbarer, stabiler
  Geozonen-Feed war anonym nicht greifbar.
- Das WebSocket-Protokoll „amcwss" ist proprietär und müsste erst
  reverse-engineered werden – aufwändig und fragil, und für die vollen
  Funktionen vermutlich login-pflichtig.

---

## 4. Integrationsauftrag / nächste Schritte

### Ist-Zustand
- HR ist nur über Bounding-Box bekannt (`shared/countryDetection.ts`), **keine
  Geodaten**.

### Empfohlenes Vorgehen (vor dem Bau klären – blockierend)
1. **Bei Croatia Control (crocontrol.hr) nachfragen**, ob die UAS-Geozonen als
   **ED-269-Datei** oder über **WFS/GeoJSON/ArcGIS** bereitstehen. Nach
   EU-Verordnung 2019/947 müssen die Geozonen in einem gemeinsamen digitalen
   Format (ED-269) veröffentlicht werden – es existiert also mit hoher
   Wahrscheinlichkeit eine saubere Quelle außerhalb des AMC-Reservierungstools.
2. **Falls nur das AMC-Portal:** klären, ob es eine **öffentliche
   REST-Schnittstelle** für die Zonen gibt (ohne Login), und deren
   Spezifikation anfordern. Erst dann Normalisierer bauen.
3. Erst nach vorliegendem Feed: `fetchCroatia()` + `shared/croatiaGeozones.ts`,
   `"hr"` in die Länderliste, Label `HR: "Croatia Control (HKZP)"`.

> **Aktueller Stand:** Plattform analysiert; es fehlt eine nutzbare,
> öffentliche Datenquelle. Der nächste Schritt ist eine Info/Freigabe von
> Croatia Control zu einem ED-269-/WFS-Feed (§4.1).

---

## 5. Offene Punkte
1. **ED-269-/WFS-Quelle bei Croatia Control erfragen** (wahrscheinlich
   vorhanden, nach EU-Pflicht).
2. Falls nur WebSocket: öffentliche REST-Alternative + Spezifikation anfordern.
3. Nutzungsbedingungen der Freigabe im Repo ablegen.
