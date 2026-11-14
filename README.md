# COpter Pilot – Version für die DJI-Fernsteuerung

Pre-Flight-Check-App für Drohnenpiloten (Planung, Geozonen/dipul, NOTAMs, Wetter,
Live-Flugverkehr mit Annäherungsalarm, Checklisten, Logbuch, PDF-Protokoll) –
umgebaut, damit sie als APK direkt auf einer **DJI RC Pro 2** (und anderen
Android-Fernsteuerungen ohne Google-Dienste) läuft.

Funktionsbeschreibung: [FUNKTIONEN.md](FUNKTIONEN.md)

## Unterschiede zur Replit-Version

| Bereich | Replit-Version | RC-Version |
|---|---|---|
| Karten | Google Maps (`react-native-maps`) | MapLibre (`client/components/maps`), Kacheln: CARTO/OSM, Esri-Satellit, dipul-WMS |
| Standort | expo-location (Google Fused Location) | Android-LocationManager (GPS) über `client/lib/location.ts`, Geocoding über Nominatim |
| Server | Express + PostgreSQL (Login, Proxy, OGN) | entfällt – alles lokal auf dem Gerät |
| OGN-Verkehr | APRS-Verbindung des Servers | direkt über `live.glidernet.org` |
| Eigene Glossar-Einträge / Links | Datenbank | lokal (AsyncStorage) |
| Links öffnen | Custom Tabs | Custom Tabs, sonst System-Browser |
| Ausrichtung | beliebig | Querformat |

Internet (WLAN oder Hotspot) wird für Karten, Wetter, Geozonen und Verkehr gebraucht.

## APK bekommen

Jeder Push baut die App per GitHub Actions (`.github/workflows/android-apk.yml`).
Die fertige `COpterPilot-RC.apk` liegt danach unter **Releases → latest**.

Installation auf der RC: APK per microSD/USB kopieren oder im Browser der RC
herunterladen, im Dateimanager antippen, „Unbekannte Quellen“ erlauben. Beim
ersten Start den Standortzugriff erlauben.

### Signatur

Ohne weitere Einstellung wird mit dem Standard-Debug-Schlüssel von React Native
signiert (Updates lassen sich drüber installieren, der Schlüssel ist aber
öffentlich). Für einen eigenen Schlüssel diese Repository-Secrets anlegen:

- `CP_KEYSTORE_BASE64` – Keystore-Datei, base64-kodiert
- `CP_KEYSTORE_PASSWORD`, `CP_KEY_ALIAS`, `CP_KEY_PASSWORD`

Achtung: Beim Wechsel des Schlüssels muss die App einmal deinstalliert werden.

## Entwicklung

```bash
npm ci
npx tsc --noEmit                     # Typprüfung
npx expo prebuild --platform android # android/ erzeugen
cd android && ./gradlew assembleRelease
```
