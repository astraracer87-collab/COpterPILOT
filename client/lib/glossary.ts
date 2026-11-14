export interface GlossaryEntry {
  term: string;
  definition: string;
  link?: { label: string; url: string };
}

export const glossaryEntries: GlossaryEntry[] = [
  {
    term: "AGL",
    definition: 'Die Abk\u00FCrzung AGL steht f\u00FCr "above ground level" und bezeichnet die Flugh\u00F6he \u00FCber Grund. Somit wird mit AGL die Flugh\u00F6he \u00FCber einem bestimmten Punkt am Boden (z.\u00A0B. der Startposition) angegeben. In h\u00FCgeligem Gel\u00E4nde kann die H\u00F6he des UAS im Flug jedoch schnell ungenau oder falsch werden.',
  },
  {
    term: "Mil. Tieffluggebiet (Tag)",
    definition:
      'Großräumige militärische Tieffluggebiete am Tage über Land, in denen Strahlflugzeuge und Hubschrauber der Bundeswehr typischerweise unterhalb von 250 ft AGL operieren. Aktivierung in der Regel Mo–Fr 07:00–17:00 Ortszeit. Auch wenn diese Gebiete nicht generell für UAS gesperrt sind, besteht ein erhöhtes Kollisionsrisiko mit bemannten Tiefflügen — vor jedem Start ist eine NOTAM-Prüfung verpflichtend.',
    link: {
      label: "Karte und Details auf dipul.de",
      url: "https://www.dipul.de/homepage/de/temporaere-betriebseinschraenkungen/tieffluege-mit-militaerischen-luftfahrzeugen-am-tage-ueber-land/",
    },
  },
  {
    term: "Autonomer Betrieb",
    definition: "Im autonomen Betrieb ist das UAS vollkommen eigenst\u00E4ndig unterwegs und es besteht keine M\u00F6glichkeit, von au\u00DFen in den Betrieb einzugreifen. Daf\u00FCr ist jedoch eine Betriebsgenehmigung in der speziellen Kategorie bei der zust\u00E4ndigen Beh\u00F6rde einzuholen.",
  },
  {
    term: "Betreiber",
    definition: 'Ein UAS-Betreiber ist eine nat\u00FCrliche oder juristische Person, die eine oder mehrere Drohnen betreibt oder plant zu betreiben. In der Durchf\u00FChrungsverordnung (EU) 2019/947 wird diese Person als "UAS-Operator" bezeichnet. Der Betreiber ist f\u00FCr die Einhaltung der gesetzlichen Auflagen verantwortlich. Seit dem 31.12.2020 muss sich jeder Betreiber eines UAS registrieren, der ein UAS mit einer Startmasse von mindestens 250\u00A0g betreibt. Eine Registrierungspflicht besteht auch f\u00FCr UAS unter 250\u00A0g, wenn das UAS mit einem Sensor zur Erfassung personengebundener Daten (z.\u00A0B. Kamera) ausgestattet ist.',
  },
  {
    term: "Betriebsgenehmigung",
    definition: "Werden die Anforderungen f\u00FCr den Drohnenbetrieb in der offenen Kategorie nicht eingehalten, so hat der Betrieb in den genehmigungspflichtigen Kategorien zu erfolgen. Genehmigungen f\u00FCr die spezielle Betriebskategorie erfolgen gem. Artikel 12 der Durchf\u00FChrungsverordnung (EU) 2019/947. Den Antrag stellen Sie bei der f\u00FCr Sie \u00F6rtlich zust\u00E4ndigen Luftfahrtbeh\u00F6rde des Landes. In einigen Bundesl\u00E4ndern (Bayern, Berlin, Brandenburg, NRW, Mecklenburg-Vorpommern, Saarland, Sachsen, Sachsen-Anhalt, Th\u00FCringen) wurde die Zust\u00E4ndigkeit auf das Luftfahrt-Bundesamt (LBA) \u00FCbertragen.",
  },
  {
    term: "Betriebskategorie",
    definition: "Der Betrieb von Drohnen wird in drei Betriebskategorien unterteilt: offene Kategorie, spezielle Kategorie und zulassungspflichtige Kategorie. Die Betriebskategorien unterscheiden sich durch das Risiko der Gef\u00E4hrdung Dritter, bspw. durch das Gewicht der Drohne, das Fliegen in der N\u00E4he von Menschen sowie Flugh\u00F6he und -entfernung. F\u00FCr jede Betriebskategorie ergeben sich unterschiedliche Regelungen und Vorschriften.",
  },
  {
    term: "BVLOS",
    definition: 'Die Abk\u00FCrzung steht f\u00FCr "beyond visual line of sight operation" und beschreibt den UAS-Betrieb au\u00DFerhalb der Sichtweite. Dieser ist in der offenen Kategorie nicht erlaubt.',
  },
  {
    term: "STS",
    definition: 'Die Abk\u00FCrzung steht f\u00FCr "Standard Scenario" (Standardszenario) in der speziellen Kategorie. F\u00FCr vordefinierte Standardszenarien (STS-01 in Sichtweite, STS-02 au\u00DFerhalb der Sichtweite) gen\u00FCgt eine Betreibererkl\u00E4rung an die zust\u00E4ndige Beh\u00F6rde statt einer Einzelgenehmigung. Voraussetzung sind passende Drohnen (C5 f\u00FCr STS-01, C6 f\u00FCr STS-02) und der erforderliche Kompetenznachweis des Fernpiloten.',
    link: { label: "EASA — Spezielle Kategorie", url: "https://www.easa.europa.eu/domains/drones-air-mobility/operating-drone/specific-category-civil-drones" },
  },
  {
    term: "PDRA",
    definition: 'Die Abk\u00FCrzung steht f\u00FCr "Predefined Risk Assessment" (vordefinierte Risikobewertung). Die Beh\u00F6rde stellt f\u00FCr h\u00E4ufige Einsatzarten eine vorab erstellte Risikobewertung bereit. Der Betreiber bezieht sich darauf und muss die SORA nicht vollst\u00E4ndig selbst durchf\u00FChren, was den Antrag auf Betriebsgenehmigung in der speziellen Kategorie vereinfacht.',
    link: { label: "EASA — Spezielle Kategorie", url: "https://www.easa.europa.eu/domains/drones-air-mobility/operating-drone/specific-category-civil-drones" },
  },
  {
    term: "SORA",
    definition: 'Die Abk\u00FCrzung steht f\u00FCr "Specific Operations Risk Assessment". Es ist die vollst\u00E4ndige eigene Risikobewertung eines geplanten Betriebs in der speziellen Kategorie. Sie ist erforderlich, wenn kein Standardszenario (STS) und keine PDRA passt. Das Ergebnis ist die Grundlage f\u00FCr den Antrag auf Betriebsgenehmigung bei der Luftfahrtbeh\u00F6rde.',
    link: { label: "EASA — Spezielle Kategorie", url: "https://www.easa.europa.eu/domains/drones-air-mobility/operating-drone/specific-category-civil-drones" },
  },
  {
    term: "LUC",
    definition: 'Die Abk\u00FCrzung steht f\u00FCr "Light UAS Operator Certificate" (Zeugnis f\u00FCr Betreiber von Leicht-UAS). Wird der LUC von der Beh\u00F6rde erteilt, darf der Betreiber bestimmte Betriebsarten in der speziellen Kategorie selbst genehmigen, ohne f\u00FCr jeden Flug eine Einzelgenehmigung beantragen zu m\u00FCssen.',
    link: { label: "EASA — Spezielle Kategorie", url: "https://www.easa.europa.eu/domains/drones-air-mobility/operating-drone/specific-category-civil-drones" },
  },
  {
    term: "U-Space",
    definition: "Ein Teil des unteren Luftraums, in dem der Drohnenbetrieb digital verwaltet wird (z. B. Anmeldung, Verkehrsinformation, Geo-Awareness). U-Space-Luftr\u00E4ume werden in der EASA-Geo-Zonen-Farblegende blau dargestellt und erm\u00F6glichen viele Drohnen gleichzeitig sicher im selben Luftraum zu betreiben.",
    link: { label: "EASA — Geo-Zonen", url: "https://www.easa.europa.eu/light/topics/geo-zones-know-where-fly-your-drone" },
  },
  {
    term: "Geo-Zone (Farblegende)",
    definition: "EASA-Farbcodierung f\u00FCr geografische UAS-Gebiete, die Mitgliedstaaten verwenden k\u00F6nnen: Rot = Excluded (Flug verboten), Gelb = Restricted (vorherige Genehmigung n\u00F6tig, z. B. nahe Flugh\u00E4fen/Krankenh\u00E4usern), Gr\u00FCn = Facilitated (Flug in der offenen Kategorie erlaubt), Blau = U-Space (verwalteter Luftraum). Es ist die Verantwortung des Fernpiloten, vor jedem Flug die aktuellen Geo-Zonen zu pr\u00FCfen.",
    link: { label: "EASA — Geo-Zonen", url: "https://www.easa.europa.eu/light/topics/geo-zones-know-where-fly-your-drone" },
  },
  {
    term: "Charakteristische Dimension",
    definition: "Die charakteristische Dimension (CD) beschreibt die Ausma\u00DFe des UAS einschlie\u00DFlich aller Rotoren oder anderer Anbauteile. CD beschreibt die gr\u00F6\u00DFtm\u00F6gliche Entfernung zwischen zwei Punkten am UAS. Beispiele: Flugzeuge \u2014 Fl\u00FCgelspannweite oder Rumpfl\u00E4nge; Hubschrauber \u2014 Rotordurchmesser; Multicopter \u2014 diagonaler Abstand der Rotorspitzen.\n\nHinweis zu den App-Werten: Die in den Drohnen-Presets hinterlegten CD-Werte sind bewusst OHNE rotierende Propeller gerechnet (nur Frame/Tragarme; bei Cinewhoop-Modellen mit Propellerschutzk\u00E4fig z\u00E4hlt der Au\u00DFenring). Damit liegt der Wert ggf. unter dem LBA-Wert „inkl. Propeller“ \u2014 die berechneten Sichtweiten (ALOS) sind dadurch konservativer.",
    link: { label: "LBA-Leitfaden FG/CV/GRB (PDF)", url: "https://www.lba.de/SharedDocs/Downloads/DE/B/B5_UAS/Leitfaden_FG_CV_GRB.pdf?__blob=publicationFile" },
  },
  {
    term: "180\u00B0-Shutter-Regel",
    definition: "Filmische Faustregel f\u00FCr Videoaufnahmen: Die Verschlusszeit der Kamera sollte etwa halb so lang sein wie ein Frame, also Shutter \u2248 1 / (2 \u00B7 fps). Bei 24 fps entspricht das 1/48 s, bei 25 fps 1/50 s, bei 30 fps 1/60 s, bei 60 fps 1/120 s usw. Damit entsteht eine nat\u00FCrliche Bewegungsunsch\u00E4rfe (Motion Blur), die das menschliche Auge als „filmisch“ empfindet \u2014 ohne diesen Effekt wirken Bewegungen ruckartig (z. B. bei zu kurzer Belichtung) oder verschwommen (bei zu langer). Da Drohnen-Kameras tags\u00FCber sonst stark \u00FCberbelichten, wird die Lichtmenge \u00FCber ND-Filter (Graufilter) reduziert. Der ND-Filter-Finder dieser App berechnet die passende ND-St\u00E4rke auf Basis von Ziel-fps, Drohnen-Blende und aktuellem Wetter.",
  },
  {
    term: "ALOS",
    definition: "Attitude Line of Sight \u2014 maximale Distanz, bis zu der ein Fernpilot Lage und Position des UAS optisch sicher erkennen kann. Praktisch ermittelte Grenzwerte (LBA-Leitfaden): Multirotor/Drehfl\u00FCgler ALOS = 327 \u00B7 CD + 20 m; Fl\u00E4chenflieger ALOS = 490 \u00B7 CD + 30 m.",
    link: { label: "LBA-Leitfaden FG/CV/GRB (PDF)", url: "https://www.lba.de/SharedDocs/Downloads/DE/B/B5_UAS/Leitfaden_FG_CV_GRB.pdf?__blob=publicationFile" },
  },
  {
    term: "DLOS",
    definition: "Detection Line of Sight \u2014 Entfernung, in der andere Luftfahrzeuge noch rechtzeitig erkannt werden k\u00F6nnen, um auszuweichen. DLOS = 0,3 \u00B7 GV (Bodensicht), wobei f\u00FCr die VLOS-Berechnung maximal GV = 5 km angenommen werden darf (entspricht Sichtweite Luftraum G nach VFR). Daraus folgt DLOSmax = 1500 m.",
    link: { label: "LBA-Leitfaden FG/CV/GRB (PDF)", url: "https://www.lba.de/SharedDocs/Downloads/DE/B/B5_UAS/Leitfaden_FG_CV_GRB.pdf?__blob=publicationFile" },
  },
  {
    term: "VLOS-Grenze",
    definition: "Die VLOS-Grenze ist der kleinere Wert aus ALOS und DLOS \u2014 alles dar\u00FCber hinaus gilt als BVLOS und ist in der offenen Kategorie nicht erlaubt. Ist die Entfernung zwischen Pilotenstandort und \u00E4u\u00DFerer Grenze des Contingency Volumes gr\u00F6\u00DFer als VLOS, kann der Betrieb nicht in VLOS durchgef\u00FChrt werden.",
    link: { label: "LBA-Leitfaden FG/CV/GRB (PDF)", url: "https://www.lba.de/SharedDocs/Downloads/DE/B/B5_UAS/Leitfaden_FG_CV_GRB.pdf?__blob=publicationFile" },
  },
  {
    term: "Flight Geography (FG)",
    definition: "Das Volumen, in dem der Betreiber das UAS im Rahmen seines normalen Betriebs bewegt. Mindestma\u00DFe laut Leitfaden: Breite und H\u00F6he jeweils \u2265 3 \u00B7 CD.",
    link: { label: "LBA-Leitfaden FG/CV/GRB (PDF)", url: "https://www.lba.de/SharedDocs/Downloads/DE/B/B5_UAS/Leitfaden_FG_CV_GRB.pdf?__blob=publicationFile" },
  },
  {
    term: "Contingency Volume (CV)",
    definition: "Volumen unmittelbar au\u00DFerhalb der Flight Geography, das diese vollst\u00E4ndig umschlie\u00DFt. Beim Eindringen sind Contingency Procedures auszul\u00F6sen. Laterale Breite SCV = SGPS + SPos + SK + SRZ + SCM (Fehlerquellen + Reaktionsweg + Contingency-Man\u00F6ver).",
    link: { label: "LBA-Leitfaden FG/CV/GRB (PDF)", url: "https://www.lba.de/SharedDocs/Downloads/DE/B/B5_UAS/Leitfaden_FG_CV_GRB.pdf?__blob=publicationFile" },
  },
  {
    term: "Ground Risk Buffer (GRB)",
    definition: "Bodensicherheitsbereich, der am Contingency Volume angrenzt und das Aufschlagrisiko Dritter abf\u00E4ngt. Vereinfachte 1:1-Regel: SGRB = HCV + 0,5 \u00B7 CD. Ballistischer Ansatz (nur Drehfl\u00FCgler/Multicopter): SGRB = V0 \u00B7 \u221A(2HCV/g) + 0,5 \u00B7 CD.",
    link: { label: "LBA-Leitfaden FG/CV/GRB (PDF)", url: "https://www.lba.de/SharedDocs/Downloads/DE/B/B5_UAS/Leitfaden_FG_CV_GRB.pdf?__blob=publicationFile" },
  },
  {
    term: "CTR",
    definition: "Kontrollzone (Controlled Traffic Region). Ein Luftraumbereich um einen Flughafen, in dem besondere Regeln f\u00FCr den Flugverkehr gelten.",
  },
  {
    term: "Drohne",
    definition: "Siehe UAS. Im allgemeinen Sprachgebrauch wird ein zivil genutztes unbemanntes Luftfahrzeugsystem als Drohne bezeichnet.",
  },
  {
    term: "ED-R",
    definition: "Europa Deutschland Restricted Area. Gebiete mit Flugbeschr\u00E4nkung, in denen der Betrieb von UAS ohne Genehmigung untersagt ist.",
  },
  {
    term: "e-ID",
    definition: "Drohnen-Betreiber m\u00FCssen sich beim Luftfahrtbundesamt (LBA) online registrieren und erhalten eine Registrierungsnummer: die elektronische UAS-Betreiber-Nummer (e-ID). Die Drohne muss mit dieser e-ID gekennzeichnet werden, damit sie eindeutig dem Besitzer zugeordnet werden kann.",
  },
  {
    term: "EU-Fernpilotenzeugnis",
    definition: "Das EU-Fernpilotenzeugnis ist ein Zeugnis \u00FCber die Kompetenz von Fernpiloten nach der EU-Verordnung 2019/947. Es ist f\u00FCr das Betreiben einer Drohne in der Unterkategorie A2 vorgeschrieben. In Erg\u00E4nzung zum EU-Kompetenznachweis ist die Durchf\u00FChrung eines praktischen Selbststudiums sowie das Bestehen einer Theoriepr\u00FCfung erforderlich.",
  },
  {
    term: "EU-Kompetenznachweis",
    definition: "Der EU-Kompetenznachweis wird f\u00FCr den Drohnenbetrieb in den Unterkategorien A1 und A3 ben\u00F6tigt und nach erfolgreichem Abschluss eines Online-Lehrgangs und einer Online-Theoriepr\u00FCfung ausgestellt.",
  },
  {
    term: "Fernpilot",
    definition: "Ein Fernpilot ist eine nat\u00FCrliche Person, die f\u00FCr die sichere Durchf\u00FChrung des Drohnenflugs verantwortlich ist. Dabei wird die Flugsteuerung entweder manuell vorgenommen oder bei autonomem Betrieb \u00FCberwacht.",
  },
  {
    term: "Geografisches UAS-Gebiet",
    definition: "Gebiete, in denen der UAS-Betrieb explizit erm\u00F6glicht wird, ausgeschlossen ist oder nur unter bestimmten Voraussetzungen m\u00F6glich ist. Die Festlegung von geografischen UAS-Gebieten tr\u00E4gt dazu bei, die mit dem UAS-Betrieb verbundenen Risiken f\u00FCr die Sicherheit, Schutz der Privatsph\u00E4re und personenbezogener Daten sowie Umweltrisiken zu minimieren.",
  },
  {
    term: "Gleitzahl",
    definition: "Als Gleitverh\u00E4ltnis wird das Verh\u00E4ltnis von Luftwiderstand zu aerodynamischem Auftrieb bezeichnet. UAS mit einer hohen Gleitzahl haben eine gro\u00DFe Reichweite bei niedrigem Energieeinsatz.",
  },
  {
    term: "GPS-Ungenauigkeit",
    definition: "Der Parameter gibt die Ungenauigkeit des im UAS verbauten GPS an, um eine m\u00F6gliche Abweichung der Standortangabe zu berechnen. Dieser Wert ist in der Regel in den Dokumentationen des Herstellers zu finden.",
  },
  {
    term: "Ground Risk Buffer",
    definition: "Ein definierter Bereich am Boden, der unmittelbar an das Contingency Volumen angrenzt. Sollte das UAS das Contingency Volumen verlassen, wird davon ausgegangen, dass es nicht mehr unter Kontrolle ist. Der Flug muss beendet werden und das UAS muss innerhalb dieses Bereichs den Boden erreichen.",
  },
  {
    term: "Kartenfehler",
    definition: "Die Abweichung der zur Planung verwendeten Karte, um eine m\u00F6gliche Positionsabweichung zu berechnen. Dieser Wert ist in der Regel in den Dokumentationen des Kartenanbieters zu finden.",
  },
  {
    term: "Kontrollzone",
    definition: "Siehe CTR. Ein Luftraumbereich um einen Flughafen mit besonderer Verkehrsregelung.",
  },
  {
    term: "Landesluftfahrtbeh\u00F6rde",
    definition: "Die Landesluftfahrtbeh\u00F6rden sind die f\u00FCr die einzelnen Bundesl\u00E4nder festgelegten Stellen, die u.\u00A0a. f\u00FCr die Bearbeitung von Antr\u00E4gen f\u00FCr Fl\u00FCge innerhalb geografischer Gebiete und die Erteilung einer Betriebsgenehmigung f\u00FCr die spezielle Kategorie verantwortlich sind.",
  },
  {
    term: "LBA",
    definition: "Das Luftfahrt-Bundesamt ist eine Bundesoberbeh\u00F6rde im Gesch\u00E4ftsbereich des Bundesministeriums f\u00FCr Verkehr. Das LBA ist u.\u00A0a. f\u00FCr die Betreiberregistrierung, das Ausstellen der EU-Kompetenznachweise und in bestimmten Bundesl\u00E4ndern f\u00FCr die Erteilung einer Betriebsgenehmigung in der speziellen Kategorie zust\u00E4ndig.",
  },
  {
    term: "MTOM",
    definition: 'Die Abk\u00FCrzung steht f\u00FCr "maximum take-off mass" und ist die vom Hersteller oder Erbauer festgelegte h\u00F6chstzul\u00E4ssige Startmasse des UAS, einschlie\u00DFlich Nutzlast und Kraftstoff, mit dem das UAS betrieben werden kann.',
  },
  {
    term: "Offene Kategorie",
    definition: "Eine der drei Betriebskategorien f\u00FCr den Drohnenbetrieb. Drohnen in privater Nutzung werden \u00FCblicherweise im Rahmen der offenen Kategorie genutzt. Der Betrieb wird innerhalb der offenen Kategorie in die Unterkategorien A1, A2 und A3 unterteilt.",
  },
  {
    term: "Positionshaltefehler",
    definition: "Eine Abweichung der kommandierten Position zur tats\u00E4chlichen Position des UAS durch z.\u00A0B. Wind oder Messungenauigkeiten in der Lageregelung (ohne GPS-Signal).",
  },
  {
    term: "Spezielle Kategorie",
    definition: "Eine der drei Betriebskategorien f\u00FCr den Drohnenbetrieb. Werden die Anforderungen der offenen Kategorie nicht erf\u00FCllt, erfolgt die Einteilung in die spezielle Kategorie. Hierf\u00FCr ist eine Betriebsgenehmigung erforderlich.",
  },
  {
    term: "UAS",
    definition: 'Die Abk\u00FCrzung steht f\u00FCr "unmanned aircraft system" (unbemanntes Luftfahrzeugsystem) und bezeichnet ein unbemanntes Luftfahrzeug sowie dessen Ausr\u00FCstung zur Fernsteuerung. Im allgemeinen Sprachgebrauch wird ein zivil genutztes UAS als Drohne bezeichnet.',
  },
  {
    term: "Unterkategorien",
    definition: "Unterkategorien sind als weitere Spezifikationsstufen innerhalb der offenen Betriebskategorie zu verstehen. Es gibt aktuell die Unterkategorien A1 (\u00FCber, aber nicht absichtlich \u00FCber unbeteiligte Personen), A2 (in der N\u00E4he von unbeteiligten Personen) und A3 (weit entfernt von Personen).",
  },
  {
    term: "VLOS",
    definition: 'Die Abk\u00FCrzung steht f\u00FCr "visual line of sight operation" und meint den Betrieb in direkter Sicht zwischen dem Fernpiloten und dem UAS. Der Betrieb in der offenen Kategorie ist ausschlie\u00DFlich als VLOS-Betrieb erlaubt. Dabei ist stets die tats\u00E4chliche Sichtweite ohne technische Hilfsmittel zu beachten.',
  },
  {
    term: "Zulassungspflichtige Kategorie",
    definition: "Eine der drei Betriebskategorien f\u00FCr den Drohnenbetrieb. Umfasst i.\u00A0d.\u00A0R. den Betrieb von gro\u00DFen und schweren Drohnen, den Betrieb \u00FCber Menschenansammlungen, den Transport von Menschen sowie risikoreicher Gefahrg\u00FCter.",
  },
];
