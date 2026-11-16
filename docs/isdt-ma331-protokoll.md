# ISDT MA331 – BLE-Protokoll (nur lesen)

Stand: 2026-11-16. Quelle: statische Analyse der Android-App „Polying“ (`co.isdt.polylink`, Debug-APK 2.1.5), dekompiliert mit jadx 1.5.1. Abgleich mit der öffentlich (MIT) dokumentierten ISDT-Transportschicht aus `mtheli/isdt_air_ble` und `DittelHome/ISDT-Charge-Utility`.

Dieses Dokument beschreibt das Protokoll **in eigenen Worten und mit eigenen Datenstrukturen**. Es enthält keinen ISDT-Code. Fundstellen stehen nur als Klassen- oder Methodennamen in Klammern, damit man sie nachprüfen kann.

**Konfidenz-Legende**
- **H (hoch):** direkt im dekompilierten Parser oder Sender gelesen.
- **M (mittel):** aus UI- oder Formatierungscode abgeleitet, also daraus, wie die App den Wert anzeigt.
- **N (niedrig):** Vermutung; braucht einen Live-Mitschnitt.

Bisher gibt es **keinen Live-Mitschnitt**. Alles hier ist statisch abgeleitet.

---

## 0. Kurzfassung

| Punkt | Ergebnis | Konf. |
|---|---|---|
| GATT | Service `0000af00-…`, Characteristics `af01` (Daten/Polling) und `af02` (Binden, Hardware-Info). `db00/db01` ist ein Debug-Textkanal, `fee0/fee1` gehört zu OTA. Für das Lesen braucht man nur AF00. | H |
| MTU | Die App fordert **240** an. Die Verbindung gilt erst nach erfolgreichem MTU-Wechsel als hergestellt. Die App setzt **keine** Fragmente zusammen. | H |
| Status-Abfrage | Anfrage `12 C2` auf AF01, Antwort `31 C3 …` mit **90 Byte** und festem Layout: 1 Byte Betriebsmodus, 3 USB-Ports à 5 Byte, 3 Schächte à 24 Byte. | H |
| Pro Schacht | Status, SoC in %, Zeit, Restkapazität (mAh), Temperatur (°C), Strom (0,1 A), Leistung (0,1 W), Zyklen, Produktionsdatum (J/M/T), 4 Zellspannungen (mV) | H (Layout) / M (Skalierung) |
| **Akku-Seriennummer** | **Wird nicht übertragen.** Der Parser liest kein SN-Feld, und das Layout ist mit 90 Byte vollständig belegt. | H (für das, was die App liest) |
| Polling | Die Zustandsmaschine tickt alle 200 ms. Die nächste Anfrage geht erst raus, wenn die vorige beantwortet ist. | H |
| Erkennung | Hersteller-Daten `BA AB AF FA` (Company-ID 0xABBA, danach `AF FA`), dann Modell-ID **`01 40 00 00`** (MA331) oder `81 40 00 00` (MA331 im Bootloader/OTA-Modus). | H |

---

## 1. Discovery (Scan)

### 1.1 Scan-Filter der App (`BleManager.scanBle`)
- Die App scannt mit Service-UUID-Filter **`0000fee0-…` ODER `0000af00-…`** im Modus `SCAN_MODE_LOW_LATENCY`.
- Danach liest sie die rohen Scan-Bytes (`ScanRecord.getBytes()`, also Advertisement und Scan-Response hintereinander, 62 Byte). Sie akzeptiert nur Geräte, bei denen Bytes **9–12 = `BA AB AF FA`** sind (u32 LE `0xFAAFABBA`).

### 1.2 Advertisement-Layout (`BroadcastPacket.parse`, rohe Offsets)

Die App nimmt **feste Offsets** im rohen 62-Byte-Puffer an. Sie geht also davon aus, dass vorne ein Flags-AD (3 Byte) und ein 16-Bit-Service-UUID-AD (4 Byte) stehen. Unsere App sollte stattdessen die AD-Strukturen richtig parsen und mit den Offsets *innerhalb* der Herstellerdaten arbeiten. Die Tabelle nennt beides.

| Roh-Offset | Offset in Herstellerdaten (nach Company-ID) | Länge | Inhalt | Konf. |
|---|---|---|---|---|
| 0–2 | – | 3 | AD Flags (vermutet `02 01 06`) | N |
| 3–6 | – | 4 | AD 16-Bit-Service-UUID (vermutet `03 03 00 AF`) | N |
| 7–8 | – | 2 | AD-Länge, Typ `0xFF` | M |
| 9–10 | – | 2 | Company-ID `BA AB` (= 0xABBA LE) | H |
| 11–12 | 0–1 | 2 | Kennung `AF FA` | H |
| 13–16 | 2–5 | 4 | **Modell-ID**, als Hex-String gelesen (`%02x` × 4) | H |
| 17–30 | 6–19 | 14 | Benutzername (ASCII, mit Leerzeichen aufgefüllt, getrimmt) | H |
| 31–32 | – | 2 | wird gelesen, aber nicht verwendet; vermutlich AD-Kopf der Scan-Response | M |
| 33–36 | – | 4 | OEM-ID (ASCII; `"0020"` = LKTOP-Branding) | H |
| 37–44 | – | 8 | Gerätename ASCII (z. B. `MA331`) | H (Feld) / N (Inhalt) |
| 45–57 | – | 13 | Status-Text ASCII, durch Leerzeichen getrennt. 1. Zeichen des 1. Worts = Arbeitszustand, Rest des Worts = „Binding-Action“. Ein optionales 2. Wort mit 3 Zeichen = SoC-Wert. | H (Parsing) / N (Bedeutung) |
| 58 | – | 1 | „addState“ (ASCII) | H / N |
| 59–61 | – | 3 | Kurz-Geräte-ID (ASCII) | H / N |

**Modell-IDs der Familie 0x0140xx** (`ScanItemModel.setScanItemModel`):

| Modell-ID | Gerät | Präfix `81…` |
|---|---|---|
| `01400000` | **MA331** | `81400000` = dasselbe Gerät im Bootloader. Polying erzwingt dann ein OTA-Update. **Nicht verbinden.** |
| `01400100` | NP2Go | `81400100` |
| `01400200` | ActionGo | `81400200` |
| `01400300` / `01400301` | MC234AC / BC237AC („MC237“) | `814003xx` |
| `01400400` / `01400401` | UC342 | `814004xx` |
| `01400500` | AC341 | `81400500` |
| `01400600` | NeoGo | `81400600` |

**Empfehlung für unsere App:**
1. Scan ohne Service-Filter oder mit Filter `af00`.
2. Herstellerdaten mit Company-ID `0xABBA` suchen. Payload[0..1] muss `AF FA` sein, Payload[2..5] muss `01 40 00 00` sein.
3. Die Scan-Response nur auswerten, wenn sie bequem verfügbar ist.

| Kriterium | Konf. |
|---|---|
| Modell-ID-Filter | H |
| Scan-Response-Felder | N |

---

## 2. Verbindung und Handshake

### 2.1 Ablauf (`BleGattCallback`, `BleManager.connectionProcess`)

| # | Schritt | Detail | Konf. |
|---|---|---|---|
| 1 | `connectGatt(autoConnect=false)` | – | H |
| 2 | Bei `STATE_CONNECTED` | 50 ms warten, `requestConnectionPriority(HIGH)`, dann `discoverServices()` | H |
| 3 | Characteristics holen | `af01` und `af02` aus Service `af00`. Optional `db01` (Debug, liefert ASCII-Text) und `fee1` (OTA). | H |
| 4 | Notifications | `setCharacteristicNotification` für AF01 und AF02. **Nacheinander:** CCCD (`2902`) von AF01 = `01 00`, dann im Descriptor-Callback CCCD von AF02 = `01 00`. | H |
| 5 | MTU | Nach dem AF02-CCCD-Callback `requestMtu(240)`. Erst wenn `onMtuChanged` Status 0 meldet, gilt die Verbindung als hergestellt. | H |
| 6 | Bind | Auf **AF02** schreiben: `BindReq` (siehe 2.2). Alle Schreibzugriffe sind **Write Without Response** (`WRITE_TYPE_NO_RESPONSE`). | H |
| 7 | Bind-Antwort | Kommt auf AF02: `19 rr`. `rr = 00` → gebunden. Jeder andere Wert → nicht gebunden; die App sendet den Bind dann im nächsten Tick (200 ms) erneut. | H |
| 8 | Hardware-Info | Nach **jeder** `19 xx`-Antwort schreibt die App `E0` (1 Byte) auf AF02. Die Antwort kommt auf AF02 und beginnt mit `E1` (siehe 3.2). | H |
| 9 | Kommunikation | Ab jetzt laufen Anfragen auf **AF01**. Antworten kommen auf AF01 mit Kopf `31`. | H |

**Timeouts der App:**

| Phase | Grenze | Folge |
|---|---|---|
| Verbinden (inkl. MTU) | > 6 s | Reconnect: `disconnect` + `close`, dann neu verbinden |
| Binden | > 8 s ohne `19 00` | Reconnect |
| Kommunikation | > 10 s ohne Antwort | Reconnect |

### 2.2 Bind-Frame (19 Byte)

```
Offset 0     : 0x18
Offset 1..16 : App-ID, 16 Byte
Offset 17    : 0x00
Offset 18    : Modus  (0x00 = Erstkopplung, 0x01 = bekannte Kopplung erneuern)
```

| Aspekt | Detail | Konf. |
|---|---|---|
| Modus beim ersten Hinzufügen | `ScanActivity` → `BleManager.clearPack()` setzt **0** | H |
| Modus bei jedem späteren Öffnen | `BaseFragment.onCreate` setzt **1** | H |
| Erzeugung der App-ID | Polying erzeugt **pro Gerät beim Hinzufügen** eine zufällige UUIDv4 und formatiert sie als 32 Hex-Zeichen (MSB zuerst, ohne Bindestriche). Die 16 Byte im Frame sind diese Hex-Paare in derselben Reihenfolge, also die UUID in Big-Endian-Byte-Reihenfolge. | H |
| Speicherung | Zusammen mit der MAC in der lokalen Gerätedatenbank (`DeviceDBModel.deviceUUID`) | H |

**Empfehlung:** pro Ladegerät (MAC) eine eigene Zufalls-ID erzeugen und dauerhaft speichern.

**Erstkopplung in Polying:** Ein 30-s-Dialog zeigt „Handy nah ans Gerät halten oder den Anweisungen auf dem Gerätedisplay folgen“. Die App verbindet sich erst, wenn eine der folgenden Bedingungen gilt:
- der RSSI ist besser als **−70 dBm** (Konf. H);
- die „Binding-Action“ im Advertisement ändert sich, z. B. nach einer Bestätigung am Gerät (Konf. H, Bedeutung M).

Dann sendet sie Bind mit Modus 0, bis `19 00` kommt.

Beispiel (App-ID `3f2a9c1e5b7d40a89e1c6d2f8b4a7c10`, Erstkopplung):
```
18 3f 2a 9c 1e 5b 7d 40 a8 9e 1c 6d 2f 8b 4a 7c 10 00 00
```
Antwort, wenn gebunden: `19 00`

**Sonderfall:** Wenn eine Antwort `xx FF` kommt (Byte 1 = `0xFF`), stoppt Polying das Polling und meldet „Geräteinformationen abgelaufen, bitte neu binden“ (`MA331Fragment.onBleByte`). Wir sollten das genauso als „nicht (mehr) gebunden“ werten. Konf. H für die Reaktion, N für die Bedingung auf Geräteseite.

### 2.3 Weitere UUIDs (für das Lesen nicht nötig)

| UUID | Zweck laut App | Konf. |
|---|---|---|
| `db00/db01` | Notify-Kanal; die App zeigt die Bytes als Text in einer versteckten Debug-Ansicht | H |
| `fee0/fee1` | OTA/Bootloader: Lesen, Schreiben, Block-Infos | H |

---

## 3. Befehle

Alle Anfragen sind **ohne Prüfsumme und ohne Längenfeld**: ein Kopfbyte, ein Befehlsbyte, dann Nutzdaten. Antworten auf AF01 sind `31 <cmd+1> …`. Alle Mehrbyte-Integer sind **Little-Endian und vorzeichenlos** (`GlobalFunctions.byteArrayToInteger`). Konf. H.

### 3.1 Übersicht MA331

| Zweck | Kanal | Anfrage | Antwort | Lesend? | Konf. |
|---|---|---|---|---|---|
| Binden | AF02 | `18` + 16 B ID + `00` + Modus | `19 rr` | (Handshake) | H |
| Hardware/Firmware-Info | AF02 | `E0` | `E1 …` | ja | H |
| **Work-Status (zyklisch)** | AF01 | `12 C2` | `31 C3` + 88 B | ja | H |
| Einstellungen lesen (einmalig) | AF01 | `12 C6` | `31 C7` + 7 B | ja | H |
| Einstellungen schreiben | AF01 | `12 C4 d0 … d6` | `31 C5 rr` | **nein – nicht verwenden (v1 nur lesen)** | H |
| Umbenennen | AF01 | `12 C0` + 14 B ASCII (mit Leerzeichen aufgefüllt) | `31 C1 rr` | **nein – nicht verwenden (v1 nur lesen)** | H |

Für das MA331 hat die App **keine** weiteren Befehle: keinen IR-Befehl, keine Batterie-Detailabfrage, keine Seriennummer-Abfrage. Die Akku-Details stecken vollständig im Work-Status.

### 3.2 Hardware-Info `E1` (`HardwareInfoResp.parse`, Pfad mit Kopf `E1`)

| Offset | Länge | Feld | Konf. |
|---|---|---|---|
| 0 | 1 | `0xE1` (hier **ohne** `31`-Präfix) | H |
| 1 | 1 | BLE-Hardware Haupt | H |
| 2 | 1 | BLE-Hardware Neben | H |
| 3 | 1 | BLE-Software Haupt | H |
| 4 | 1 | BLE-Software Neben | H |
| 5–12 | 8 | Geräte-ID (u64 LE) | H (Feld) / N (Inhalt) |
| 13–16 | 4 | MCU-HW Haupt/Neben, MCU-SW Haupt/Neben; nur wenn der Frame länger als 16 Byte ist | H |

Polying zeigt als „Firmware-Version“ `b1.b2.b3.b4` an.

- Die Geräte-ID ist die des **Ladegeräts**, nicht die eines Akkus. Polying setzt sie beim Zusammenbauen mit Vorzeichen-Erweiterung zusammen, was fehleranfällig ist. Wir sollten die 8 Byte roh als Hex ablegen.
- Laut isdt_air_ble-Doku enthält das Feld bei manchen Geräten ASCII-Text, `00…` oder `FF…`.

### 3.3 Work-Status `31 C3` (`MA331WorkStatus`)

Gesamtlänge **90 Byte**. Die Länge wird nicht geprüft; die App liest feste Offsets.

#### Kopf und USB-Ports

| Offset | Typ | Feld | Einheit/Skalierung | Konf. |
|---|---|---|---|---|
| 0 | u8 | `0x31` | – | H |
| 1 | u8 | `0xC3` | – | H |
| 2 | u8 | Betriebsmodus des Hubs (siehe Enum `Ma331Mode`) | – | H (Feld) / M (Bedeutung) |
| 3 + 5·p | u8 | USB-Port p: Status (0 = nicht verbunden „NC“, ≠0 = aktiv) | – | H / M |
| 4 + 5·p | u16 LE | USB-Port p: Spannung | 0,1 V | M |
| 6 + 5·p | u16 LE | USB-Port p: Leistung | 0,1 W | M |

Dabei ist p = 0, 1, 2, also Port 0 ab Offset 3, Port 1 ab 8, Port 2 ab 13. Die UI beschriftet:

| Port | Beschriftung in der UI |
|---|---|
| 0 | „OUTPUT“ |
| 1 | „INPUT-1“ |
| 2 | „INPUT-2“ |

#### Schacht-Block (3 × 24 Byte)

Basis `B = 18 + 24·s` für s = 0, 1, 2, also Schacht 1 ab 18, Schacht 2 ab 42, Schacht 3 ab 66.

| Offset | Typ | Feld | Einheit/Skalierung | Konf. |
|---|---|---|---|---|
| B+0 | u8 | Schacht-Status (Enum `Ma331SlotState`) | – | H / M |
| B+1 | u8 | Ladestand | % (0–100) | H |
| B+2 | u16 LE | Zeit (Polying zeigt `HH:MM` = Wert/60 : Wert%60) | Minuten | M |
| B+4 | u16 LE | Restkapazität („Remain Capacity“) | mAh | H |
| B+6 | u8 | Temperatur | °C, ganzzahlig, **vorzeichenlos** | M |
| B+7 | u16 LE | Strom | 0,1 A | M |
| B+9 | u16 LE | Leistung | 0,1 W (Polying zeigt ganze W, Wert/10) | M |
| B+11 | u16 LE | Ladezyklen | Anzahl | H |
| B+13 | u8 | Produktionsdatum: Jahr − 2000 | – | H |
| B+14 | u8 | Produktionsdatum: Monat | 1–12 | H |
| B+15 | u8 | Produktionsdatum: Tag | 1–31 | H |
| B+16 | u16 LE | Zelle 1 | mV | H |
| B+18 | u16 LE | Zelle 2 | mV | H |
| B+20 | u16 LE | Zelle 3 | mV | H |
| B+22 | u16 LE | Zelle 4 | mV | H |

Hinweise:
- **4 Zellen fest.** Das passt zum DJI-Air-3-Akku (4S).
- Polying zeigt Detailwerte wie Zellen, Kapazität, Temperatur, Strom/Leistung, Zyklen und Datum nur, wenn der Status **≠ 0 und ≠ 6** ist. Bei Status 0 und 6 sind die Felder als ungültig zu betrachten.
- Die Packspannung wird nicht übertragen. Wir berechnen sie als Summe der 4 Zellen. Konf. H, da es nur eine Rechnung ist.
- Polying formatiert das Datum als `TT/MM/20JJ`.
- **Keine Seriennummer, keine Akku-ID, kein Gesundheitswert (SoH), kein Innenwiderstand.**

#### Enums

`Ma331Mode` (Offset 2). Abgeleitet aus den Bedienknöpfen. Dieselben Werte stehen in `settings[6]`.

| Wert | Bedeutung | Konf. |
|---|---|---|
| 0 | Normal/Laden („CHARGE“) | M |
| 1 | Ausgabe/Powerbank („OUTPUT“) | M |
| 2 | Sammeln („GATHER“, Ladung in einen Akku umladen) | M |
| 3 | Ausgleichen („AVERAGE“) | M |

`Ma331SlotState` (B+0). Abgeleitet aus Farben, Animationen und Icons in `MA331Fragment` und der Layout-Bindung.

| Wert | Darstellung in Polying | Unsere Deutung | Konf. |
|---|---|---|---|
| 0 | grau, keine Werte | leer / kein Akku | M |
| 1 | violett, keine Animation | eingelegt, Standby / wartet | N |
| 2 | gelb, Animation „Energie rein“ | lädt | M |
| 3 | grün | voll / fertig | M |
| 4 | rosa, Animation „Energie raus“ | entlädt / gibt ab (Output/Gather) | N |
| 5 | wie 4 | entlädt / gibt ab (Variante, z. B. Ausgleich) | N |
| 6 | rot, Icon „abnormal“, Detailwerte ausgeblendet | Fehler / Akku nicht lesbar | M |
| 7 | rot, Icon „overheat“ | Übertemperatur | M |
| 8 | türkis, Icon „cold“ | zu kalt | M |

`UsbPortState` (Offset 3 + 5·p):

| Wert | Darstellung | Konf. |
|---|---|---|
| 0 | „NC“, grau | M |
| 1 | orange | N |
| 2 | grün | N |

Wahrscheinlich bedeuten 1 und 2 unterschiedliche Richtungen oder Protokolle, z. B. Eingang und Ausgang.

### 3.4 Einstellungen `31 C7` (nur lesen)

`31 C7 d0 d1 d2 d3 d4 d5 d6`. Die App kopiert `bytes.length − 2` Byte.

| Index | Bedeutung | Werte | Konf. |
|---|---|---|---|
| d0 | Lade-Ziel | 0 = nur 60 %, 1 = 100 %, 2 = schnell bis 95 %, 3 = schnell bis 99 % | M |
| d1 | „Entladen auf 0 %“ | 0/1 | M |
| d2 | Alarmton | 0/1 | M |
| d3 | Lampe | 0/1 | M |
| d4 | Stumm | 0/1; schließt sich mit d5 gegenseitig aus | M |
| d5 | Display automatisch aus | 0/1 | M |
| d6 | Betriebsmodus | wie `Ma331Mode` | M |

**Schreiben** (`12 C4` + 7 Byte, Antwort `31 C5 rr`): **nicht verwenden (v1 nur lesen).** Polying wertet `rr = 0` als „abgelehnt“, also alte Werte behalten, und `rr ≠ 0` als „übernommen“. Damit würden Ladeziel (60/100 %), Entladen, Sammeln und Ausgleichen umgeschaltet.

---

## 4. Beispiel-Frames

**Poll:** `12 C2` auf AF01.

**Antwort (synthetisch, mit eigenem Testskript erzeugt und rückgeparst; kein Mitschnitt):**

```
31 c3 00                                   Modus 0 (Laden)
00 00 00 00 00                             USB0: NC
02 c8 00 c2 01                             USB1: Status 2, 20,0 V, 45,0 W
00 00 00 00 00                             USB2: NC
-- Schacht 1 (Offset 18)
02 39 22 00 2e 09 1f 20 00 1c 02 2f 00     Status 2, 57 %, 34 min, 2350 mAh, 31 °C, 3,2 A, 54,0 W, 47 Zyklen
18 05 0d                                   Produktion 13.05.2024
48 0f 4b 0f 46 0f 49 0f                    3912 / 3915 / 3910 / 3913 mV
-- Schacht 2 (Offset 42)
03 64 00 00 91 10 1c 00 00 00 00 70 00     Status 3, 100 %, 0 min, 4241 mAh, 28 °C, 0 A, 0 W, 112 Zyklen
17 0b 02                                   Produktion 02.11.2023
fe 10 fc 10 ff 10 fd 10                    4350 / 4348 / 4351 / 4349 mV
-- Schacht 3 (Offset 66)
00 × 24                                    leer
```

Als eine Zeile (90 Byte):
```
31 c3 00 00 00 00 00 00 02 c8 00 c2 01 00 00 00 00 00 02 39 22 00 2e 09 1f 20 00 1c 02 2f 00 18 05 0d 48 0f 4b 0f 46 0f 49 0f 03 64 00 00 91 10 1c 00 00 00 00 70 00 17 0b 02 fe 10 fc 10 ff 10 fd 10 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
```

**Bind:** siehe 2.2.

**Hardware-Info:** Anfrage `E0`. Antwort z. B. `E1 01 00 01 05 <8 B ID> [4 B MCU-Versionen]`; die Werte hier sind nur ein Beispiel.

---

## 5. Timing

| Aspekt | Verhalten in Polying | Konf. |
|---|---|---|
| Takt | Feste Zustandsmaschine alle **200 ms** (`period = 200`) | H |
| Sende-Regel | Pro Tick höchstens eine Anfrage, und nur wenn die vorige beantwortet ist. Jede Notification auf AF01 oder AF02 gibt das Senden wieder frei. | H |
| Effektive Rate | Bis zu ~5 Abfragen/s | H |
| Priorität | 1. Benutzerbefehl, 2. Einmal-Befehle (`12 C6` bis `31 C7` kommt), 3. zyklische Liste. Beim MA331 enthält die Liste nur `12 C2`. | H |
| Keep-Alive | Kein eigenes. Das Dauer-Polling hält die Verbindung. | H |
| Reconnect | Bei Disconnect oder Timeout (6 s / 8 s / 10 s, siehe 2.1): `disconnect` + `close`, danach komplett neu verbinden, inkl. CCCD, MTU, Bind (Modus 1) und Hardware-Info. GATT-Status 133 → `close`, 1 s Pause. | H |
| Fremddoku | isdt_air_ble berichtet, dass ISDT-Geräte nach ~2 min trennen. Für das MA331 ist das nicht belegt; Auto-Reconnect trotzdem einbauen. | N |

**Empfehlung für unsere App:** alle 1 s `12 C2` senden. Das reicht für die Anzeige und schont den BLE-Stack des RC Pro 2. Nach 10 s ohne Antwort neu verbinden.

---

## 6. Verwandte Geräte (gleicher Code-Pfad)

| Gerät | Modell-ID | Gemeinsamkeit mit MA331 | Unterschiede | Konf. |
|---|---|---|---|---|
| MC234AC / BC237AC | `01400300` / `01400301` | Gleiche Befehle (`12 C2`/`31 C3`, `12 C6`/`31 C7`, `12 C4`) und derselbe Parser | **Kein** Modus-Byte: der USB-Block beginnt bei Offset 2. **1** USB-Port, **2** Schächte, **2** Zellen pro Schacht; Schacht-Block 20 Byte. | H |
| AC341 | `01400500` | Gleiche Befehle | Selbstbeschreibendes Layout: Offset 2 = Anzahl USB-Ports, danach 5 Byte pro Port, dann 1 Byte Anzahl Schächte. Pro Schacht dieselben 16 Byte wie MA331, danach 1 Byte Zellenzahl n und n × u16 mV. | H |

Damit lässt sich ein generischer Parser für alle drei bauen.

---

## 7. TypeScript-Typen (eigene Benennung)

```ts
/** Betriebsmodus des Hubs (Work-Status Offset 2, Settings d6). */
export enum IsdtHubMode {
  Charge = 0,
  Output = 1,
  Gather = 2,
  Balance = 3,
}

/** Zustand eines Akkuschachts (Konfidenz siehe Doku). */
export enum IsdtSlotState {
  Empty = 0,
  Standby = 1,
  Charging = 2,
  Full = 3,
  Discharging = 4,
  DischargingAlt = 5,
  Error = 6,
  OverTemp = 7,
  UnderTemp = 8,
}

export interface IsdtUsbPort {
  index: 0 | 1 | 2;          // 0 = "OUTPUT", 1 = "INPUT-1", 2 = "INPUT-2"
  state: number;             // 0 = nicht verbunden
  voltageV: number;          // raw / 10
  powerW: number;            // raw / 10
}

export interface IsdtProductionDate {
  year: number;              // 2000 + raw
  month: number;
  day: number;
}

export interface IsdtSlot {
  index: 0 | 1 | 2;
  state: IsdtSlotState | number;
  hasData: boolean;          // state !== 0 && state !== 6
  socPercent: number;
  timeMinutes: number;       // Semantik (verstrichen/Rest) offen
  remainingMah: number;
  temperatureC: number;      // vorzeichenlos
  currentA: number;          // raw / 10
  powerW: number;            // raw / 10
  cycleCount: number;
  productionDate: IsdtProductionDate;
  cellMillivolts: [number, number, number, number];
  packVoltageV: number;      // Summe der Zellen / 1000 (abgeleitet)
}

export interface IsdtMa331Status {
  mode: IsdtHubMode | number;
  usb: IsdtUsbPort[];        // Länge 3
  slots: IsdtSlot[];         // Länge 3
  receivedAt: number;        // ms epoch
  raw: Uint8Array;           // für Debug / Fingerprinting
}

export interface IsdtMa331Settings {
  chargeTarget: 0 | 1 | 2 | 3;   // 60 % / 100 % / 95 % schnell / 99 % schnell
  dischargeToZero: boolean;
  alarm: boolean;
  lamp: boolean;
  mute: boolean;
  screenAutoOff: boolean;
  mode: IsdtHubMode | number;
}

export interface IsdtHardwareInfo {
  bleHw: [number, number];
  bleFw: [number, number];
  deviceIdHex: string;           // 8 Byte roh
  mcuHw?: [number, number];
  mcuFw?: [number, number];
}

/** Persistenter Kopplungseintrag in unserer App. */
export interface IsdtPairing {
  mac: string;
  appId: string;                 // 32 Hex-Zeichen, zufällig, pro Gerät
  modelId: string;               // "01400000"
  boundOnce: boolean;            // false → Bind-Modus 0, true → 1
}
```

Parser-Skizze in Worten (eigene Implementierung):
1. Frame-Länge ≥ 90 prüfen, `f[0] == 0x31`, `f[1] == 0xC3`.
2. `mode = f[2]`.
3. Für p in 0..2 ab `o = 3 + 5p`: Status u8, Spannung u16le, Leistung u16le.
4. Für s in 0..2 ab `b = 18 + 24s` die Felder laut Tabelle lesen.
5. Längere Frames tolerieren; den Rest als `extra` loggen.

---

## 8. Offene Fragen und was ein Live-Mitschnitt klären muss

| # | Frage | Warum offen | Priorität |
|---|---|---|---|
| 1 | Liefert die MA331-Firmware genau 90 Byte, oder hängt sie Bytes an, die Polying ignoriert (z. B. eine Akku-SN)? | Polying prüft die Länge nicht | **hoch** (SN-Frage) |
| 2 | Bedeutung von Schacht-Status 1, 4, 5 | nur aus Farben abgeleitet | hoch |
| 3 | Zeitfeld: verstrichene oder verbleibende Minuten? Oder Sekunden? | nur Formatierung `/60` gesehen | mittel |
| 4 | Strom und Leistung beim Entladen: vorzeichenbehaftet (Zweierkomplement) oder immer positiv? | App liest vorzeichenlos | mittel |
| 5 | Negative Temperaturen: Offset-Codierung oder nur ≥ 0 °C? Status 8 „kalt“ existiert. | u8 ohne Offset | mittel |
| 6 | USB-Status 1 vs. 2; welcher Port ist physisch welcher; was bedeuten „INPUT-1/2“ am MA331? | nur aus UI-Beschriftung | niedrig |
| 7 | Antwortet das Gerät bei unbekannter App-ID mit Modus 1 mit `19 01` oder mit `xx FF`? Ist für die Erstkopplung ein Tastendruck nötig, oder reicht Nähe? | Gerätelogik nicht im APK | hoch (Onboarding) |
| 8 | Inhalt der Scan-Response (AD-Typ, Status-Text) | nur feste Roh-Offsets gesehen | niedrig |
| 9 | Kommt die Antwort bei MTU 240 sicher in einer Notification? (Die App setzt nicht zusammen, also ja, solange die MTU greift.) | RC Pro 2 nicht getestet | mittel |
| 10 | Trennt das MA331 nach ~2 min trotz Polling? | nur aus Fremddoku | niedrig |

**Minimaler Mitschnitt-Plan:** HCI-Snoop-Log oder nRF Connect mit Notifications auf AF01/AF02 nach erfolgreichem Bind. Szenarien:
- leer;
- 1 Akku lädt;
- 3 Akkus, darunter einer voll;
- Modus OUTPUT mit USB-Verbraucher;
- ein kalter Akku (Kühlschrank), falls möglich.

Je Szenario mindestens 5 Frames `31 C3` sichern.

---

## 9. Batterie-Identifikation (Konsequenz für COpter Pilot)

Weil keine Seriennummer übertragen wird, empfehlen wir einen **Fingerabdruck** aus Produktionsdatum (J/M/T) und Zyklenzahl, die nur steigt. Optional kommt die Restkapazität bei 100 % dazu. Beim ersten Erkennen bestätigt der Nutzer die Zuordnung zu einem registrierten Akku (`DroneBattery`). Danach wird zugeordnet, wenn das Datum gleich ist und die Zyklen ≥ dem letzten Wert und ≤ letzter Wert + 2 sind. Gleiches Produktionsdatum bei zwei Akkus ist möglich; dann muss der Nutzer wählen.

---

## 10. Rechtlicher Hinweis

Die Analyse diente ausschließlich der **Interoperabilität**: Unsere eigene App soll das Ladegerät des Nutzers lesen können. Grundlage ist **Art. 6 der Richtlinie 2009/24/EG** (in Deutschland umgesetzt in § 69e UrhG). Der Nutzer besitzt das Gerät und hat die Analyse veranlasst. Es wurde nur das untersucht, was für die Schnittstelle nötig ist.

**Es wurde kein ISDT-Code übernommen.** Dieses Dokument beschreibt das Protokoll mit eigenen Worten, Tabellen und Typnamen. Die dekompilierten Quellen liegen nur im temporären Arbeitsverzeichnis und gelangen nicht ins Repository. Kopierschutz oder Lizenzprüfungen wurden nicht umgangen.

Die MIT-lizenzierten Referenzprojekte (isdt_air_ble © 2026 mtheli, ISDT-Charge-Utility © 2026 DittelHome) wurden nur zum Abgleich der Transportschicht genutzt. Wird daraus Code portiert, ist deren Copyright-Hinweis mitzuführen.
