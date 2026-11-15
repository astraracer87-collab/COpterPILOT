# FCC Tool für die DJI RC Pro 2

Eigenständige kleine Android-App, getrennt von COpter Pilot. Sie läuft direkt auf
der Fernsteuerung und schickt DJI-DUML-Befehle an den lokalen Funkdienst, um die
Funkregion von CE auf FCC umzustellen (z. B. Air 3S an der RC Pro 2).

> **Rechtlicher Hinweis:** In Deutschland und der EU ist der Flugbetrieb mit
> FCC-Sendeleistung nicht zulässig (Funkrecht, BNetzA). Versicherungsschutz und
> DJI Care Refresh können entfallen. Nutzung auf eigene Verantwortung.

## Funktionen

| Knopf | Was passiert |
|---|---|
| Port suchen + Version abfragen | Probiert `127.0.0.1` Port 8901–8904 (RC Pro 2 / RC Plus) und 40009 (RC 2), schickt eine Versionsabfrage und merkt sich den Port, der antwortet. |
| Teilnehmer suchen (nur lesen) | Versionsabfrage an alle 32 DUML-Gerätetypen (Index 0 und 1). Zeigt, wer antwortet. Ändert nichts. |
| FCC einmal anwenden | Sendet `profiles/fcc.json` (21 Rahmen, 2 Runden). |
| FCC halten (Keepalive) | Hintergrunddienst: einmal das volle Profil, danach alle 2 s `fcc_keepalive.json` (4 Rahmen). Startet nach dem Einschalten der Fernsteuerung automatisch neu, bis er wieder ausgeschaltet wird. |
| CE wiederherstellen | Stoppt den Keepalive und sendet `ce_restore.json`. Ohne Keepalive ist FCC nach einem Neustart ohnehin weg. |
| USB-Geräte anzeigen | Listet angeschlossene USB-Geräte mit ihren Schnittstellen. |
| USB: Teilnehmer suchen (nur lesen) | Für Brille/Drohne per USB-C-Kabel (DJI-Hersteller-ID `0x2ca3`): öffnet jede Bulk-Schnittstelle (CDC: 115200 8N1) und macht die gleiche Versionsabfrage. Gedacht als Test für Avata 2 + Goggles 3/N3. |

Das Protokoll rechts kann markiert und kopiert werden.

## Installation auf der RC Pro 2

1. APK holen: GitHub → Actions → „FCC Tool bauen“ → letzter Lauf → Artefakt `FCC-Tool`
   (ZIP enthält `FCC-Tool.apk`).
2. Die RC Pro 2 installiert Apps nur über Umwege: microSD-Karte in der RC formatieren,
   APK draufkopieren und mit einem Dateimanager/Paketinstaller öffnen (z. B. die
   Helfer-Apps aus dem FreeFCC-Projekt: PackageInstaller, FileManager, ATV-Launcher).
3. App starten, Hinweis bestätigen, Drohne einschalten und mit DJI Fly verbinden.
4. Zuerst „Port suchen + Version abfragen“, dann „FCC einmal anwenden“ oder „FCC halten“.
5. Prüfen in DJI Fly → Übertragung: im FCC-Modus reicht die Signalanzeige über 1 km hinaus.

## Stand / Einschränkungen

- Nicht auf echter Hardware getestet. Die Rahmenfolge stammt aus FreeFCC, dort ist sie
  für RC 2 und RC Pro 2 berichtet (u. a. Mini 4/5 Pro, Air 3S, Mavic 4 Pro).
- Höhen-, Distanz- und Geozonen-Grenzen ändern sich dadurch nicht.
- Avata 2: Die Funkgegenstelle am Boden ist die Brille. Für sie gibt es noch keine
  bekannte Befehlsfolge – der USB-Test zeigt nur, ob sie überhaupt antwortet.

## Bauen

```sh
cd fcc-tool
./gradlew testReleaseUnitTest assembleRelease   # braucht Android SDK 35, Java 17+
# Ergebnis: app/build/outputs/apk/release/app-release.apk (Debug-signiert)
```

## Herkunft und Lizenz

- Der Programmcode in `app/src/main/java` ist eigenständig geschrieben. Das DUML-Format
  (Rahmen, CRC-8/CRC-16) ist im Projekt
  [dji-firmware-tools](https://github.com/o-gs/dji-firmware-tools) (GPL-3.0) dokumentiert.
- Die Profile in `app/src/main/assets/profiles/` stammen aus
  [FreeFCC](https://github.com/doesthings/FreeFCC) (AGPL-3.0). Wer die APK weitergibt,
  sollte den Quellcode dieses Ordners unter AGPL-3.0 mitliefern.
