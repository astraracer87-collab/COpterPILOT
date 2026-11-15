# Griechenland (GR) & Rumänien (RO) – Analyse-Notiz

Stand: 2026-11-15. Freigaben liegen vor. Beide Quellen sind **aus dieser
Cloud-Umgebung blockiert** und konnten nicht live analysiert werden; hier die
Einstiegspunkte und der nächste Schritt.

---

## Griechenland (GR) – `dagr.hasp.gov.gr`

- Quelle: **HASP** (Hellenic Airspace / „DAGR" Drone Aware GR), `dagr.hasp.gov.gr`.
- Status: **403** für curl **und** für den Headless-Browser (Bot-/Zugangsschutz).
  Die Seite liess sich aus dieser Umgebung nicht laden; ich habe den Schutz
  **nicht umgangen**.
- Nächster Schritt:
  1. **Aus dem Browser (bei euch):** `dagr.hasp.gov.gr/#map_page` öffnen →
     DevTools → Netzwerk → die Datenanfragen (GeoJSON/ArcGIS/WFS/API) notieren
     und mir schicken. HASP ist oft ArcGIS-/Esri-basiert – dann wie Zypern/
     Slowenien lösbar.
  2. **Bei HASP erfragen:** ED-269-/GeoJSON-Export der Geozonen.

---

## Rumänien (RO) – `flightplan.romatsa.ro/init/drones`

- Quelle: **ROMATSA** (rumänische Flugsicherung), Flugplanungsportal.
- Status: **000** (Verbindung bricht ab) – der Host ist vom US-Egress dieses
  Proxys **nicht erreichbar** (vermutlich Geo-Filter auf EU-/RO-IPs), wie zuvor
  bei PANSA (PL).
- Nächster Schritt:
  1. **Von einer EU-/RO-IP** gegenprüfen (die App selbst läuft auf Geräten in
     der EU, dort erreichbar).
  2. **Aus dem Browser (bei euch):** Netzwerk-Tab → die Zonen-Datenanfrage
     kopieren.
  3. **Bei ROMATSA erfragen:** ED-269-/GeoJSON-Export (nach EU-2019/947 sollte
     ein ED-269-Datensatz existieren).

---

## Hinweis
Für beide gilt: Die App (COpterPILOT) läuft auf echten Geräten mit EU-IPs und
kann diese Quellen vermutlich normal erreichen – die Blockade betrifft nur
diese Analyse-Umgebung. Sobald mir aus einem dieser Wege der konkrete
Daten-Endpunkt vorliegt, baue ich den Abruf und das Mapping wie bei den übrigen
Ländern.
