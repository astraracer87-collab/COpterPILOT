# FCC Tool für die DJI RC Pro 2

Eigenständige kleine Android-App, getrennt von COpter Pilot. Sie läuft direkt auf
der Fernsteuerung und schickt DJI-DUML-Befehle an den lokalen Funkdienst, um die
Funkregion von CE auf FCC umzustellen (z. B. Air 3S an der RC Pro 2).

> **Rechtlicher Hinweis:** In Deutschland und der EU ist der Flugbetrieb mit
> FCC-Sendeleistung nicht zulässig (Funkrecht, BNetzA). Versicherungsschutz und
> DJI Care Refresh können entfallen. Nutzung auf eigene Verantwortung.

## Bedienung

Die App führt Schritt für Schritt durch den Ablauf. Oben rechts zeigt ein Feld den
Status (bereit / FCC aktiv / CE), rechts läuft ein farbiges Protokoll mit, das jeden
Schritt und sein Ergebnis beschreibt (ohne Zeitstempel).

Startbildschirm, zwei große Modus-Knöpfe:

- **Fluggerät an dieser Fernsteuerung** (z. B. Air 3S an der RC Pro 2) – geführter Ablauf:
  1. Fluggerät einschalten und verbinden
  2. FCC aktivieren (die App sucht die Verbindung selbst und sendet die Befehle)
  3. FCC dauerhaft halten (optional) oder überspringen
  4. In DJI Fly prüfen
- **Fluggerät an Goggle** (z. B. Avata 2) – geführter SD-Karten-Ablauf (siehe unten).

Darunter **CE wiederherstellen** (eigener geführter Ablauf) und **Erweitert**
(ausführliches Protokoll, Verbindung/Teilnehmer suchen, USB-Tests).

### Was die Verbindung und die „Befehle gesendet“ bedeuten

- Die App sucht den lokalen DUML-Port automatisch: `127.0.0.1` Port 8901–8904
  (RC Pro 2 / RC Plus) bzw. 40009 (RC 2). Das passiert vor jedem Vorgang selbst, der
  gemerkte Port wird wiederverwendet, solange er erreichbar ist. Ein eigener Knopf dafür
  ist nur unter „Erweitert“.
- FCC sendet `profiles/fcc.json`: 21 Befehle × 2 Runden = **42 Befehle**. Das Halten
  sendet nur `fcc_keepalive.json`: 4 Befehle. Daher „42“ beim Aktivieren und „4“ beim
  Halten – das ist die Zahl der gesendeten Befehle, nicht ein Fehler.
- Wichtig: Wie beim Original-FreeFCC bedeutet „gesendet“ nur, dass der Befehl ohne Fehler
  rausging. Das Fluggerät schickt **keine Bestätigung** zurück, die hier ausgewertet wird.
  Die einzige verlässliche Kontrolle ist **DJI Fly → Übertragung**: im FCC-Modus reicht
  die Reichweitenanzeige über 1 km hinaus. (Unter „Erweitert → Ausführliches Protokoll“
  werden zusätzlich die rohen Antwortrahmen angezeigt, die je nach Teilnehmer schwanken –
  nur zur Diagnose.)

## Goggle über SD-Karte (Avata 2 usw.)

Die Goggle lässt sich nicht über USB umstellen – die Funkgegenstelle am Boden wird
stattdessen über eine Datei auf ihrer microSD-Karte auf FCC gestellt (öffentlich
beschriebene „ham file“-Methode). Der Ablauf „Fluggerät an Goggle“ führt durch:

1. **Goggle-Modell wählen:**
   - **Goggles 2 / 3 / N3 / Integra:** leere Datei `ham_cfg_support` (ohne Endung)
   - **Goggles V1 / V2:** Textdatei `naco_pwr.txt` mit Inhalt `pwr_2`
2. **SD-Karte in die Fernsteuerung:** Goggle ausschalten, microSD herausnehmen, in die
   Fernsteuerung stecken, im Schritt bestätigen.
3. **FCC-Datei schreiben:** im Auswahldialog die SD-Karte als Speicherort wählen.
4. **SD-Karte zurück in die Goggle.**
5. **Einschaltreihenfolge:** zuerst die Goggle einschalten (Karte steckt drin), danach
   das Fluggerät, dann in DJI Fly prüfen.

Hinweise:
- Die App schreibt über den Android-Dateidienst (Storage Access Framework), ohne
  besondere Speicherrechte. Legt der SD-Anbieter eine Endung wie `.bin` an, meldet die
  App das; dann die Datei auf der Karte in genau `ham_cfg_support` umbenennen.
- Ob die Datei-Methode bei Goggles 3 / N3 mit aktueller Firmware wirkt, ist **nicht
  bestätigt** – sie stammt aus Community-Hinweisen (u. a. M4TH1EU/DJI-FCC-HACK, Issue #2).

## Installation auf der RC Pro 2

1. APK holen: GitHub → Actions → „FCC Tool bauen“ → letzter Lauf → Artefakt `FCC-Tool`
   (ZIP enthält `FCC-Tool.apk`).
2. Die RC Pro 2 installiert Apps nur über Umwege: microSD-Karte in der RC formatieren,
   APK draufkopieren und mit einem Dateimanager/Paketinstaller öffnen (z. B. die
   Helfer-Apps aus dem FreeFCC-Projekt: PackageInstaller, FileManager, ATV-Launcher).
3. App starten, Hinweis bestätigen und dem passenden Modus-Knopf folgen.

## CE wiederherstellen

FCC liegt nur im Arbeitsspeicher und ist nach dem Ausschalten des Fluggeräts ohnehin weg.
Der Ablauf „CE wiederherstellen“ schaltet erst das Halten aus, sendet dann den CE-Befehl
(`ce_restore.json`) und weist darauf hin, dass CE **am zuverlässigsten nach einem Neustart
des Fluggeräts** greift. Hilft das nicht, zusätzlich die Fernsteuerung neu starten. Das
erklärt, warum ein reines „CE senden“ ohne Neustart nicht immer sofort wirkt.

## Stand / Einschränkungen

- Nicht auf echter Hardware getestet. Die Rahmenfolge stammt aus FreeFCC, dort ist sie
  für RC 2 und RC Pro 2 berichtet (u. a. Mini 4/5 Pro, Air 3S, Mavic 4 Pro).
- Höhen-, Distanz- und Geozonen-Grenzen ändern sich dadurch nicht.
- Erfolg wird nicht vom Fluggerät zurückgemeldet – immer in DJI Fly gegenprüfen.
- Avata 2: Die Funkgegenstelle am Boden ist die Goggle; sie wird über die SD-Karte
  umgestellt, nicht über USB. Der USB-Test unter „Erweitert“ zeigt nur, ob ein per Kabel
  angeschlossenes Gerät überhaupt antwortet.

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
