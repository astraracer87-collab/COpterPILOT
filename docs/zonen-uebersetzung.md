# Behördentexte auf Deutsch – ohne Übersetzungsdienst

Stand: 2026-11-15. PO-Vorgabe: **alle** Behördentexte aller Länder werden auf
Deutsch angezeigt, **ohne** externen Übersetzungsdienst (DeepL entfällt). Die
App übersetzt vollständig offline mit einem mitgelieferten Wörterbuch und
Satzmustern für formelhafte, wechselnde Texte.

## Ablauf je Zeile (`shared/zoneTranslate.ts`)

1. **Wörterbuch** `shared/data/zoneTranslationsDe.json` – exakte Zeile
   (Leerraum vereinheitlicht; Groß-/Kleinschreibung und Satzzeichen am Ende
   tolerant).
2. **Deutsche Etiketten** der Normalisierer („Typ:“, „Hinweis:“, „Höhe laut …:“)
   bleiben, der Wert wird übersetzt. Bei Namens-/Kontakt-Etiketten („Kontakt:“,
   „Rufzeichen:“, „Zuständig:“ …) bleibt der Wert unverändert.
3. **Satzmuster** (`shared/zoneTranslatePatterns.ts`): geordnete Vorlagen mit
   Platzhaltern für Kennungen, Höhen („00120M AGL“, „FL95“), Zeiten
   („0600-1400“), Daten, Koordinaten, Radien („2NM“), Kontakte und Namen in
   Anführungszeichen; dazu ein **NOTAM-Glossar** für englische Großschrift-NOTAMs
   (Phrase für Phrase, Namen nur an festen Stellen – bleibt ein englisches Wort
   übrig, gilt der Text als nicht übersetzt, damit kein halbes Deutsch entsteht).
4. **Fremde Feldnamen** der Quellen („Subject:“, „Omejitev:“, „Označenie /
   Identification:“, „Ηλεκτρονική Διεύθυνση:“ …) → deutsches Etikett.
5. **Abschnittsweise**: an „ · “/„ | “, dann an Satzgrenzen, dann an „ / “
   zerlegen und jeden Teil einzeln über 1–4 übersetzen.
6. Sonst bleibt das **Original** stehen; in der Anzeige mit dem Zusatz
   **„(nicht übersetzt)“**.

Namen (`translateZoneNameDe`): Wörterbuch → Namensmuster (Gattungswörter wie
„Protected natural object X“ → „Geschütztes Naturobjekt X“, „X flugvöllur“ →
„Flugplatz X“, „Grid ATZ n“ → „Höhenraster ATZ n“) → bulgarische Namen werden
umschrieben (Кирилица → lateinisch). Eigennamen bleiben; Bezeichnungen aus
Luftraum-Kennung + Eigenname („EGR1U025A HALTON“, „ATZ VARAZDIN“, „LSZH Zürich“)
gelten als unverändert richtig, ebenso Namen mit deutschem Gattungswort aus dem
Normalisierer. Geprüfte Eigennamen stehen in `unchangedNames`.

**Deutsch-Erkennung** (`looksGerman`, für „schon deutsch“ und gegen falsche
Markierungen): starke deutsche Funktionswörter, typische Endungen/Wortbestandteile
(„-ung“, „-pflichtig“, „…flug…“, „…gebiet…“) und eine einmal erzeugte Liste
häufiger Wörter aus den deutschen Fassungen des Wörterbuchs, die in keinem
Quelltext vorkommen (`GERMAN_LEXICON`, ~900 Wörter). Kennungen in Großschrift
und Klammerzusätze zählen nicht mit.

Alles ist rein (ohne React Native), Regeln werden beim Laden einmal kompiliert,
jede Regel hat ein Pflichtwort für eine schnelle `includes()`-Vorprüfung,
Ergebnisse (auch Teilstücke) werden zwischengespeichert.

## Anzeige (`client/lib/ed269.ts`)

- Meldung ohne Originalblock: Zeilen werden übersetzt; wurde mindestens eine
  Zeile übersetzt, steht das Original wie bisher unter „Originaltext der
  Behörde:“. Nicht übersetzbare Zeilen tragen „(nicht übersetzt)“. Ist **gar
  nichts** übersetzbar, wird kein Originalblock angehängt (sonst stünde der Text
  doppelt da).
- Meldung mit Originalblock (deutsche Normalisierer-Meldung, z. B. SI, SK, BG,
  CY, HR, NO-Zusatzebenen): der Originalblock bleibt unverändert; seine
  übersetzten Zeilen stehen davor unter **„Behördentext (deutsch):“**
  (zweisprachige Doppelungen zusammengefasst). Lässt sich davon nichts
  übersetzen, steht dort nur „Behördentext (nicht übersetzt) – siehe
  Originaltext unten.“ Das Original erscheint immer genau einmal; ein
  übersetzter Zonenname wird in den vorhandenen Block eingetragen.
- Deutsche Zeilen der Normalisierer werden nie als „nicht übersetzt“ markiert.
- `p.reason` („Grund: …“) wird ebenfalls übersetzt.

## DeepL entfernt

`client/lib/zoneTranslationStore.ts` enthält keinen DeepL-Code mehr: kein
Netzabruf, kein Schlüssel, kein Laufzeit-Cache aus DeepL-Ergebnissen (ein alter
Cache auf dem Gerät wird nicht mehr gelesen). Geblieben sind `missingTexts`,
`missingTextsYielding` (Diagnose) und `startZoneTranslation()` (App-Start; meldet
im Entwicklungsmodus fehlende Texte nach einem Länder-Download). Die Einstellungen
(DeepL-Schlüssel) sind bereits entfernt; die Übersetzung hängt von keiner
DeepL-Funktion ab. `addRuntimeTranslations` bleibt für Tests/gerätelokale
Ergänzungen.

## Abdeckung (alle Quellen, 15.11.2026)

Gemessen auf allen Fixtures (`client/lib/__tests__/fixtures`, `docs/fixtures`)
plus Live-Abruf aller Registry-Länder (22 von 25 erreichbar; IT nur mit
d-flight-Zugang, PL/RO lieferten HTTP 503 → nur Fixtures) und Kachelspeicher
CZ/FR. Gezählt werden eindeutige angezeigte Zeilen/Namen, die deutsch, übersetzt
oder bewusst unverändert (Kennungen, Kontakte, Eigennamen) sind.

| Land | Zeilen vorher | Zeilen nachher | Namen vorher | Namen nachher |
|---|---|---|---|---|
| AT | 96,4 % | 100 % (252) | 82,9 % | 100 % (286) |
| BE | 100 % | 100 % (1399) | 100 % | 100 % (1024) |
| BG | 49,4 % | 100 % (2048) | 82,1 % | 100 % (901) |
| CH | 38,7 % | 100 % (93) | 0,7 % | 100 % (1018) |
| CY | 80,3 % | 100 % (289) | 0,7 % | 100 % (141) |
| CZ (Kacheln) | 0,6 % | 100 % (174) | 0,2 % | 96,1 % (73 015) |
| DK | 75,6 % | 100 % (312) | 91,3 % | 100 % (978) |
| EE | 91,7 % | 100 % (84) | 100 % | 100 % (213) |
| ES | 33,8 % | 100 % (160) | 0 % | 100 % (26) |
| FI | 99,5 % | 100 % (388) | 100 % | 100 % (739) |
| FR (Kacheln) | 1,3 % | 100 % (857) | – | – |
| GB | 26,6 % | 100 % (1569) | 4,0 % | 100 % (1047) |
| HR | 85,7 % | 100 % (237) | 89,2 % | 100 % (673) |
| IE | 100 % | 100 % (70) | 100 % | 100 % (80) |
| IS | 93,8 % | 100 % (16) | 81,6 % | 100 % (201) |
| IT (Fixtures) | 28,9 % | 100 % (45) | 0 % | 100 % (7) |
| LT | 19,0 % | 100 % (310) | 94,4 % | 100 % (337) |
| LU | 97,4 % | 100 % (38) | 74,3 % | 100 % (35) |
| LV | 96,4 % | 100 % (111) | 100 % | 100 % (405) |
| MT | 26,1 % | 100 % (291) | 2,1 % | 100 % (192) |
| NL | 100 % | 100 % (3828) | 100 % | 100 % (1950) |
| NO | 85,4 % | 100 % (903) | 91,7 % | 100 % (1504) |
| PL (Fixtures) | 19,0 % | 100 % (58) | 92,9 % | 100 % (14) |
| PT | 98,4 % | 100 % (126) | 100 % | 100 % (354) |
| RO (Fixtures) | 48,7 % | 100 % (39) | 0 % | 100 % (4) |
| SE | 97,1 % | 100 % (475) | 100 % | 100 % (452) |
| SI | 25,2 % | 100 % (353) | 1,2 % | 100 % (81) |
| SK | 34,2 % | 100 % (1305) | 3,0 % | 100 % (401) |

„Vorher“ = alter Code + altes Wörterbuch. Der alte Code zählte deutsche
Normalisierer-Zeilen ohne bekanntes Etikett als fehlend (zu pessimistisch) und
App-Etikett-Zeilen pauschal als übersetzt (zu optimistisch) – die Spalte ist
daher nur ein Anhaltspunkt.

**CZ-Namen:** 2 844 übrige Namen sind Eigennamen tschechischer Schutzgebiete
(„Louky u Černého lesa“, „Rybník Svět“) und bleiben bewusst unverändert; sie sind
nicht in `unchangedNames`, weil der CZ-Kachelpfad
(`client/lib/geozoneTiles/tileZones.ts`) Namen heute gar nicht übersetzt (siehe
unten) und die Liste das Wörterbuch nur aufblähen würde (~50 KB).

**Grenze:** 100 % gilt für den heutigen Datenbestand. Neue Formulierungen, die
weder im Wörterbuch stehen noch einem Muster folgen, erscheinen im Original mit
„(nicht übersetzt)“. Der Test `zoneTranslationCoverage.test.ts` listet solche
Zeilen für die Fixtures; im Entwicklungsmodus meldet `startZoneTranslation()`
sie nach jedem Länder-Download.

## Offen (außerhalb des Anzeigepfads `ed269.ts`)

- **CZ/FR-Kacheln** (`client/lib/geozoneTiles/tileZones.ts`, `frZoneFromWfsFeature`
  in `client/lib/geozoneQueries.ts`) rufen die Übersetzung nicht auf. Wörterbuch
  und Muster decken die Texte bereits ab („Hinweis der Behörde: lower limit FL95,
  upper limit FL225“, „Altitude de référence de l'aérodrome : 281 m“,
  „Grid ATZ 924013“). Einhängen: in `czZoneFromStored` den Namen über
  `translateZoneNameDe` und die Detailzeilen über `translateTextDe(…, {
  markUntranslated: true }).text` führen, in `frZoneFromStored` ebenso die
  Details.
- `ed269SourceInfo` („Rechtsgrundlage:“, „Zuständige Stelle:“) läuft nicht über
  die Übersetzung (Werte sind meist Namen/Rechtsquellen).

## Wörterbuch pflegen

- Format: `{"lines":{…},"names":{…},"unchangedNames":[…]}`, kompakt, Schlüssel
  sortiert, Schlüssel und Werte mit vereinheitlichtem Leerraum (Test
  „Wörterbuch …“ prüft das).
- Formelhafte Texte mit wechselnden Zahlen/Namen gehören als Regel in
  `zoneTranslatePatterns.ts` (Vorlage + Platzhalter), nicht als viele
  Wörterbuchzeilen.
- Größe: 1 242 775 → 1 311 016 Byte (+5,5 %): Zeilen 4 214 → 4 527 (+313,
  davon 117 CY-Paare Original → deutscher Name/Zonenverwalter), Namen
  3 626 → 3 806 (+180), `unchangedNames` 3 171 → 3 294 (+149 geprüfte
  Eigennamen, 26 Einträge entfernt, die zugleich übersetzt waren).
- Regeln: 477 Zeilenmuster, 98 Namensmuster, 117 Feldnamen, ~100
  NOTAM-Glossarphrasen.
