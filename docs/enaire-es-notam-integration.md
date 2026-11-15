# ENAIRE Drones (Spanien) – NOTAMs verstehen und integrieren

Stand der Analyse: 15.11.2026, ca. 18:00 MEZ · live getestet gegen `servais.enaire.es`
Ergänzung zu `ENAIRE_Geozonen_Integration.md` (dort Abschnitt NOTAM nur grob).

---

## 1. Kurzfassung

- Es gibt **genau einen** NOTAM-Layer: `NOTAM/NOTAM_UAS_APP_V3/MapServer/1` („Áreas“), Polygone.
  Keine weiteren Layer, keine Tabellen, kein Time-Enabled-Layer.
- Der Server liefert eine **bereits gefilterte Liste**: nur UAS-relevante NOTAMs der spanischen
  **Serie V** (Drohnen-Serie), aktuell **728 Stück**, jeder NOTAM = **genau ein Feature** (`notamId` eindeutig).
- **Abgelaufene NOTAMs werden serverseitig entfernt** (kleinstes `itemC` lag 3 Minuten in der Zukunft).
  **Zukünftige NOTAMs sind aber enthalten** (247 von 728 noch nicht begonnen).
- Die Webseite filtert **nicht nach Zeit** – sie zeigt alle Polygone, auch künftige und
  solche, die laut Zeitplan (`itemD`) gerade nicht aktiv sind. Einziger Filter: Flughöhe (siehe 5.).
- **Achtung Einheiten:** `LOWER_VAL`/`UPPER_VAL` sind hier **Fuß**, nicht Meter (anders als bei den Aero-Layern),
  und die Bezugsebene (AGL/AMSL) steckt nur im Text `itemF`/`itemG`.
- Ganze Datenmenge passt in **einen Request** (maxRecordCount 3000) → einfach stündlich komplett neu laden.

## 2. Endpunkt

```
https://servais.enaire.es/insignias/rest/services/NOTAM/NOTAM_UAS_APP_V3/MapServer/1/query
```

Direkt erreichbar (HTTP 200, CORS ok), Capabilities `Query,Map,Data`, unterstützt `f=geojson`,
`outSR=4326`, Statistiken, `orderBy`, `CURRENT_TIMESTAMP` in `where`.

Komplett als GeoJSON (WGS84):

```
?where=1=1&outFields=*&returnGeometry=true&outSR=4326&orderByFields=OBJECTID&resultRecordCount=3000&f=geojson
```

Nur **jetzt gültige** (B ≤ jetzt ≤ C):

```
?where=itemB <= CURRENT_TIMESTAMP and itemC >= CURRENT_TIMESTAMP&...
```
(Test: 475 Treffer.) Nur künftige: `itemB > CURRENT_TIMESTAMP` (247).

Hinweis: In GeoJSON kommen Datumsfelder als **Unix-ms (UTC)**. Bei `resultRecordCount=5` setzt der Server
`exceededTransferLimit: true` sowohl top-level als auch in `properties` – das Export-Skript prüft beides bereits.

## 3. Woher die NOTAMs kommen (Serie V vs. D)

ENAIRE erzeugt für Drohnen eine eigene NOTAM-Serie **V** (alle 728 Features: `notamSerie = V`, Jahr 2026).
Die meisten V-NOTAMs sind aus einem „normalen“ NOTAM abgeleitet:

| Fall | Anzahl | `sourceInformationNotam` / `GFID` |
|---|---|---|
| V-NOTAM abgeleitet aus D-Serie (Luftraum-Aktivierung, TRA/TSA, Übungen …) | 616 | Quell-NOTAM, z. B. `D5296/26` (GFID = identisch) |
| Originärer V-NOTAM (meist UAS-Betrieb selbst, `WULW`) | 112 | `null` |

Im `icaoFormatText` steht das als `FUENTE INF)D0301/26`.
→ **Schlüssel für die App: `notamId`** (immer gesetzt, eindeutig). `GFID` ist hier *nicht* die stabile
Zonen-GUID wie bei den Aero-Layern, sondern die Quell-NOTAM-Nummer und kann `null` sein.
`OBJECTID` ist hoch (≈ 264 700) → Tabelle wird offenbar regelmäßig neu befüllt, nicht als Schlüssel nutzen.

### Dynamische vs. statische Fläche (`incidenceType`)

| `incidenceType` | Anzahl | Bedeutung |
|---|---|---|
| `AREA DINAMICA` | 673 | Fläche wird im NOTAM selbst definiert (Kreis/Polygon aus Koordinaten). `affectedElement` = `DIN` + notamId, `areaSactaName` = Klarname (z. B. „TRA TOTANA“, „UAS SANTANDER“) |
| `AREA ESTATICA` + `incidenceQualifier = ACTIVA` | 55 | Aktivierung eines **festen** AIP-Gebiets, `affectedElement` = Gebietskennung (z. B. `LED90A`, `LETS35`, `LETR66L`) – Geometrie ist das AIP-Gebiet |

Statische Aktivierungen sind die Brücke zum Layer `ZG_Restringidas`: dort ist z. B. `LED90A` dauerhaft
als Zone hinterlegt, der NOTAM sagt „jetzt aktiv, mit diesen Höhen/Zeiten“. Abgleich über
`affectedElement` ↔ `IDENT_TXT` möglich.

## 4. Felder (komplett, 40 Attribute)

| Feld | Typ | Inhalt |
|---|---|---|
| `notamId` | String | z. B. `V03255/26` – **Schlüssel** |
| `notamSerie`, `notamNumber`, `notamYear` | | `V`, 3255, 2026 |
| `icaroCreationTime` | Date | Erstellzeit im ENAIRE-System ICARO (neuester: 13.11.2026) |
| `itemA` | String | betroffene FIR/Flugplätze, ggf. mehrere (`LECM LECB`) |
| `itemB` / `itemC` | Date (UTC) | Gültig von / bis. `itemBstr`/`itemCstr` = `dd/mm/yyyy hh:mm:ss`, `itemBIcaro`/`itemCIcaro` = ICAO-Format `yyMMddhhmm` |
| `itemD` | String | **Zeitplan innerhalb B–C**, z. B. `MON-FRI 0600-1400` oder `03-05 12 17-19 24 2000-2359, 10-11 1900-2359` (Tage des Monats + UTC-Zeiten). Bei ~630 NOTAMs gesetzt |
| `itemE` | String | Klartext (EN, Großbuchstaben) |
| `itemF` / `itemG` | String | Unter-/Obergrenze als Text: `SFC`, `GND`, `00120M AGL`, `04300FT AMSL` |
| `LOWER_VAL` / `UPPER_VAL` | Integer | dieselben Grenzen **in Fuß**, ohne Bezug (120 m AGL → 400; 4300 FT AMSL → 4300) |
| `LOWER_VAL_AGL` | Integer | gedacht als Untergrenze AGL – **derzeit bei allen 728 `null`** |
| `FLYING_LEVELS_DESC` | String | `itemF / itemG` kombiniert, z. B. `SFC / 00120M AGL` – gut zur Anzeige |
| `itemQ` | String | Q-Zeile + ENAIRE-Zusatzzeilen (`LOC)`, `TIPO)`, `NOMBRE CLARO SACTA)`, `AREA)`) |
| `qcode` | String | 4-stelliger Q-Code (siehe unten) |
| `fir` | String | `LECM` (Madrid, 471), `GCCC` (Kanaren, 110), `LEXX` (78), `LECB` (Barcelona, 67), `GMMM` (2) |
| `traffic` / `purpose` / `scope` | String | aus Q-Zeile: `IV` (IFR+VFR) · `BO` 689 / `NBO` 32 / `M` 7 · `W` 377 / `AW` 351 |
| `affectedElement`, `incidenceType`, `incidenceQualifier`, `areaSactaName` | String | siehe 3. |
| `sourceInformationNotam`, `GFID` | String | Quell-NOTAM (D-Serie) oder `null` |
| `icaoFormatText` | String | vollständiger NOTAM im ICAO-Format (mehrzeilig) |
| `DESCRIPTION` | String | fertiger **HTML**-Popuptext (`<b>DESDE:</b> … <b>HASTA:</b> … <b>HORARIO:</b> … <b>DESCRIPCIÓN:</b> …`) |
| `accion` | String | derzeit immer `null` |
| `geom_calc_date` | Date | derzeit immer `null` |

### Q-Codes im aktuellen Bestand

| `qcode` | Anzahl | Bedeutung (ICAO) |
|---|---|---|
| `RTCA` | 346 | Temporäres Beschränkungsgebiet (TRA/TSA) aktiviert |
| `WULW` | 292 | **Drohnenbetrieb** findet statt |
| `RDCA` | 34 | Gefahrengebiet (D) aktiviert |
| `RACA` | 26 | Luftraumreservierung aktiviert |
| `WELW` | 14 | Militärübung |
| `WMLW` | 7 | Schießen (Rakete/Geschütz) |
| `WPLW` | 3 | Fallschirmsprung |
| `WGLW` | 3 | Segelflug |
| `WLLW` | 2 | Freiballon-Aufstieg |
| `WYLW` | 1 | Luftbild-/Vermessungsflug |

Grob: `R***` = Luftraum wird gesperrt/beschränkt → für Drohnen **restriktiv**;
`W***` = Warnung (es findet etwas statt) → Hinweis.

### Darstellung auf drones.enaire.es

Renderer `uniqueValue` (per Arcade-Ausdruck, Feld nicht direkt), Füllung `[255,254,240,102]`, Kontur:

| Klasse | Label | Kontur |
|---|---|---|
| `R` | NOTAM Restrictivo | rot `[255,0,0]` |
| `GFID_R` | NOTAM UAS | gelb `[230,230,0]` |
| `Otros` | NOTAM Warning | orange `[230,148,0]` |

Layer-Deckkraft in der Web-Map: 0,66. Popup zeigt `GFID` („NOTAM/SUP“), Höhen und `DESCRIPTION`.

## 5. Was die Webseite tatsächlich filtert

Aus `widgets/ConfigDrones/config.json` + `Widget.js` der Seite:

- Dropdown „Altura de vuelo“ (60 / 120 / +120 m). Für den NOTAM-Layer setzt die Seite
  `LOWER_VAL_AGL is null or LOWER_VAL_AGL < #valor#` – da `LOWER_VAL_AGL` aktuell immer `null` ist,
  wirkt der Filter **praktisch nicht**; bei „+120“ wird er ganz entfernt.
- **Kein Zeitfilter**, keine Auswertung von `itemD`. Die Karte zeigt also Gebiete, die erst in
  Wochen beginnen oder nur werktags 06–14 UTC aktiv sind, genauso wie gerade aktive.

→ Eine App kann hier **besser** sein als die Originalseite (siehe 6.).

## 6. Empfehlung für die App

1. **Abruf:** stündlich (gern alle 15 min) kompletter Abzug in einem Request, `f=geojson`, `outSR=4326`.
   Bestand vollständig ersetzen – was nicht mehr geliefert wird, ist abgelaufen/storniert.
   Schlüssel `notamId`.
2. **Zeitstatus berechnen** (alles UTC):
   - `itemB > jetzt` → *geplant* (ausgegraut, mit Startdatum)
   - `itemB ≤ jetzt ≤ itemC` und `itemD` leer → *aktiv*
   - mit `itemD` → Zeitplan parsen; gelingt das nicht, konservativ als *aktiv im Zeitraum* anzeigen
     und `itemD` als Text dazu. `itemC` im Jahr 2050 = faktisch permanent (1 Fall).
3. **Höhen:** aus `itemF`/`itemG` parsen (`SFC`/`GND` = 0; `…M AGL`, `…FT AGL`, `…FT AMSL`, `FL…`).
   Für Drohnen relevant ist v. a. die Untergrenze: liegt sie ≤ 120 m AGL, betrifft der NOTAM den
   Open-Category-Betrieb. AMSL-Werte bräuchten Geländehöhe – im Zweifel als „betrifft“ werten.
   `LOWER_VAL`/`UPPER_VAL` nur als Fuß-Werte ohne Bezug verwenden.
4. **Kategorie** für das gemeinsame Schema: `qcode` beginnt mit `R` → `restricted`, `WULW` → `uas_activity`,
   sonstige `W` → `warning` (entspricht den drei Farbklassen der Webseite).
5. **Texte:** `DESCRIPTION` ist HTML und enthält Von/Bis/Zeitplan/Text schon formatiert; für eine
   saubere eigene Darstellung besser `itemE`, `FLYING_LEVELS_DESC`, `itemD` und Zeiten selbst rendern.
   Rohtext für Profis: `icaoFormatText`.
6. **Statische Aktivierungen** (`AREA ESTATICA`) mit `ZG_Restringidas` verknüpfen
   (`affectedElement` = `IDENT_TXT`), damit Nutzer sehen „Zone LED90A ist jetzt aktiv“.
7. **Normalisiertes Schema (Vorschlag):**
   `id=notamId`, `source_notam=sourceInformationNotam`, `category` (s. 4.), `name=areaSactaName|affectedElement`,
   `valid_from=itemB`, `valid_to=itemC`, `schedule=itemD`, `lower_txt=itemF`, `upper_txt=itemG`,
   `lower_m`/`upper_m`/`ref` (geparst), `text=itemE`, `raw=icaoFormatText`, `fir`, `qcode`.
8. Hinweis in der App: NOTAM-Darstellung ohne Gewähr, verbindlich sind die NOTAMs/AIS von ENAIRE.

## 7. Weitere Fallen (Nachprüfung 15.11.2026, 18:05 MEZ)

Geprüft am kompletten GeoJSON-Abzug (725 Features – drei NOTAMs waren seit der ersten Abfrage
abgelaufen, der Bestand ändert sich also laufend).

1. **`UPPER_VAL`/`LOWER_VAL` sind grob gerundet, nicht umgerechnet.** Beispiele:
   `00100M AMSL` → 400 (richtig wären 328 ft), `00060M AMSL` → 200, `00060FT AGL` → 100,
   `00120M AGL` → 400. Die Werte sind offenbar auf volle 100 ft gerundet wie die Q-Zeile.
   `FL100` → 10000 (Flugfläche, also Druckhöhe, wird als Fuß behandelt), `UNL` → 99900.
   **Für Drohnenhöhen ausschließlich `itemF`/`itemG` parsen.**
2. **Gemischte Höhenbezüge.** Untergrenzen: SFC 541, GND 94, FT AMSL 65, FL 25.
   Obergrenzen: M AGL 395, FT AMSL 205, FL 99, FT AGL 22, M AMSL 3, UNL 1.
   Ein Parser muss also M und FT, AGL und AMSL, FL und UNL beherrschen.
3. **Kreise sind grob aufgelöst und liegen *innerhalb* des echten Kreises.** Jeder Kreis-NOTAM hat genau
   37 Stützpunkte (36 Segmente à 10°). Radien liegen zwischen 1,8 km und 27,6 km (Median 11 km).
   Damit ragt der echte Kreis zwischen den Stützpunkten bis zu ~0,4 % des Radius über das
   Polygon hinaus, das sind bis ~105 m. Für einen Punkt-in-Zone-Test einen Puffer
   (z. B. 0,5 % des Radius oder pauschal 150 m) aufschlagen oder den Kreis aus `itemQ`/`itemE`
   (`RADIUS OF …`) selbst neu erzeugen.
4. **Zeitplan `itemD` ist freier ICAO-Text mit vielen Varianten.** Gesehen:
   `0600-1400`, `MON-FRI 0600-1400`, `SR-SS` (145×, Sonnenauf- bis -untergang → Sonnenstand
   je Ort berechnen), `SR-2100`, Tage des Monats (`03-05 12 17-19 24 2000-2359`), Monatsnamen
   (`NOV 02 1900-2359, NOV 03-06 0000-0600 1900-2359 …`, über Monatsgrenzen OCT→NOV→DEC→JAN).
   Nachtzeiten sind über Mitternacht in zwei Blöcke geteilt. Alle Zeiten sind **UTC**, nicht
   spanische Ortszeit (MEZ/MESZ bzw. auf den Kanaren WEZ). Bei 98 NOTAMs ist `itemD` leer, dann gilt
   die ganze Spanne B–C.
5. **Die Website-Felder `itemBstr`/`itemCstr` sind ebenfalls UTC**, obwohl ohne Zeitzone
   (stimmen bei allen 725 mit `itemB`/`itemC` überein). Nicht als Ortszeit anzeigen.
6. **Identische Geometrien mehrfach.** 189 Features teilen ihre Geometrie mit mindestens einem anderen
   NOTAM (gleiches Gebiet, mehrere Aktivierungszeiträume, z. B. `LED120` 5×). Nicht über die Geometrie
   deduplizieren. In der Karte werden diese Flächen sonst übereinandergestapelt und wirken dunkler,
   deshalb besser nur die gerade aktiven zeichnen.
7. **Es gibt MultiPolygone.** 723 Features sind `Polygon`, aber 2 sind `MultiPolygon`
   (zwei getrennte Teilflächen in einem NOTAM). Löcher kommen bei NOTAMs aktuell nicht vor.
   Ringe sind geschlossen und gegen den Uhrzeigersinn orientiert (RFC 7946-konform). Es gibt auch Dreiecke
   (24 Features mit nur 4 Punkten).
8. **FIR ≠ Spanien.** 2 NOTAMs liegen in der FIR `GMMM` (Casablanca), betreffen aber Melilla
   (`itemA = GEML`). Wer nach `fir` filtert (`LE*`/`GC*`), verliert sie. Außerdem `LEXX` (78) als
   Sammel-FIR für mehrere spanische FIRs.
9. **„Permanent“ ist ein Datum.** `itemC` = 01.10.2050 heißt faktisch „bis auf Weiteres“
   (ein V-NOTAM für UAS-Betrieb, Quelle `UAS SUP095/26` – also aus einem AIP-Supplement).
10. **Bestand ändert sich zwischen Seiten.** Bei Paging (falls der Bestand jemals > 3000 wird) kann sich
    die Liste zwischen zwei Seiten ändern. Heute irrelevant, weil ein Request reicht. Sonst nach
    `notamId` deduplizieren.
11. **Texte:** `itemE` hat feste Zeilenumbrüche mit vielen Leerzeichen (Fernschreib-Layout) → Whitespace
    normalisieren. `DESCRIPTION` ist HTML mit gemischten `<br>`/`<br />`.

## 8. Offene Punkte

- Wie oft ENAIRE den Layer tatsächlich aktualisiert, ist nicht dokumentiert. Indiz: abgelaufene NOTAMs
  waren minutengenau entfernt → vermutlich laufende Synchronisation aus ICARO. Durch Logging der
  eigenen Abrufe (Anzahl, neueste `icaroCreationTime`) über ein paar Tage verifizieren.
- Stornierungen (`NOTAMC`) und Ersetzungen (`NOTAMR`) tauchen nicht als eigene Datensätze auf
  (`accion` immer leer) – sie wirken sich nur durch Verschwinden/Neuerscheinen aus. Daher Vollabgleich statt Delta.
- `LOWER_VAL_AGL` und `geom_calc_date` sind angelegt, aber leer – kann sich mit einer neuen Dienstversion
  (`_V4`) ändern; dann Web-Map-Definition neu auslesen.
