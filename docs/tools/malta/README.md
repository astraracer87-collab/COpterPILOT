# Ablauf: Geozonen Malta aus tmcad.idronect.com holen

## Was hinter der Karte steckt
- Die Karte (`tmcad.idronect.com/map`) ist eine Meteor-App mit deck.gl auf Mapbox.
- Die Zonen kommen **nicht** als Datei oder REST-URL, sondern einmalig beim Laden über die
  Meteor-Methode `Zones.getFilteredZones` (Websocket/DDP). Beim Verschieben der Karte wird nichts nachgeladen.
- Im Browser liegen sie danach als GeoJSON-FeatureCollection im Layer `GeoJsonLayers` → `operator-zones`.
- Stand 15.11.2026: **195 Polygone**, ca. 400 KB, Ausdehnung 14,19–14,64° O / 35,72–36,07° N (Malta, Gozo, Comino).

## Felder im Rohdatensatz
| Feld | Bedeutung | vorhanden bei |
|---|---|---|
| `zoneId` | eindeutige ID | allen |
| `name` | Bezeichnung inkl. Kontakt (z. B. Botschaft + E-Mail) | allen |
| `type` | Zonentyp-Code (bisher nur `1`) | 194 |
| `forbidden` | Flugverbot (1/true) | 76 |
| `minHeight` / `maxHeight` | Höhengrenzen (60–8800, **Einheit nicht angegeben** – vermutlich ft, prüfen) | 76 / 185 |
| `maxPilots`, `cost` | Kapazität / Gebühr | ~67 |
| `center`, `radius` | Kreiszonen: Mittelpunkt „lon,lat“ + Radius in m (Polygon ist bereits angenähert) | 124 |
| `archived`, `color`, `visible` | Darstellung/Status | — |

## Ablauf (manuell, ca. 2 Minuten)
1. **Karte öffnen:** `https://tmcad.idronect.com/map` – kein Login nötig, warten bis die orangen Zonen erscheinen.
2. **Exportieren:** F12 → Konsole → Inhalt von `export_tmcad_geozonen.js` einfügen → Enter.
   Der Browser lädt `malta_geozonen_roh_<datum>.geojson` herunter (Konsole meldet „✔ 195 Zonen exportiert“).
3. **Normalisieren:** `python normalisieren.py malta_geozonen_roh_<datum>.geojson`
   → `malta_geozonen.geojson` (einheitliche Felder, Land `MT`, ohne archivierte Zonen)
   → `malta_geozonen.csv` (Excel-tauglich, `;`-getrennt)
   → `malta_geozonen_diff.txt` ab dem zweiten Lauf: neue / entfernte / geänderte Zonen.
4. **Prüfen:** GeoJSON in geojson.io oder QGIS laden und stichprobenartig mit der Karte vergleichen.
5. **Ablegen:** Ergebnis in die Sammlung der europäischen Geozonen übernehmen (gleiches Schema wie die anderen Länder).

## Empfohlener Rhythmus
Monatlich bzw. vor Einsätzen in Malta wiederholen; die Diff-Datei zeigt sofort, ob sich etwas geändert hat.

## Rechtliches / sauberer Weg
- Das Skript liest nur, was die Seite ohnehin öffentlich anzeigt, und schickt keine eigenen Serveranfragen.
- Für automatisierten, regelmäßigen Bezug (Serverabfrage von `Zones.getFilteredZones` per Skript)
  vorher eine **Datenfreigabe bei Transport Malta (Civil Aviation Directorate)** einholen – analog zu
  Griechenland und Slowakei. Erst mit Freigabe lohnt es sich, Schritt 2 per Headless-Browser zu automatisieren.
- Die Namensfelder enthalten Kontakt-E-Mails – bei Weitergabe ggf. entfernen.
