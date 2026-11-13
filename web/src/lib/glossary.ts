export interface GlossaryEntry {
  term: string;
  definition: string;
}

export const glossaryEntries: GlossaryEntry[] = [
  {
    term: "AGL",
    definition: 'Die Abk\u00FCrzung AGL steht f\u00FCr "above ground level" und bezeichnet die Flugh\u00F6he \u00FCber Grund. Somit wird mit AGL die Flugh\u00F6he \u00FCber einem bestimmten Punkt am Boden (z.\u00A0B. der Startposition) angegeben. In h\u00FCgeligem Gel\u00E4nde kann die H\u00F6he des UAS im Flug jedoch schnell ungenau oder falsch werden.',
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
    term: "Charakteristische Dimension",
    definition: "Die charakteristische Dimension (CD) beschreibt die Ausma\u00DFe des UAS einschlie\u00DFlich aller Rotoren oder anderer Anbauteile. CD beschreibt die gr\u00F6\u00DFtm\u00F6gliche Entfernung zwischen zwei Punkten am UAS. Beispiele: Flugzeuge \u2014 Fl\u00FCgelspannweite oder Rumpfl\u00E4nge; Hubschrauber \u2014 Rotordurchmesser; Multicopter \u2014 diagonaler Abstand der Rotorspitzen.",
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
