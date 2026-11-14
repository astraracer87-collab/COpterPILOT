import type { InfrastructureKind } from "./germanEnergyInfrastructure";
import type { InfrastructureFlightGuidance, InfrastructureFlightRule } from "./geozoneFeatureInfo";

const EU_URL = "https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:02019R0947-20250501";
const CH_URL = "https://www.fedlex.admin.ch/eli/cc/2022/802/de";
const BE_URL = "https://mobilit.belgium.be/fr/aviation/voler-en-piloter/drones-uas/informations-generales/zones-geographiques";
const FR_URL = "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000042635803";
const LU_URL = "https://dac.gouvernement.lu/en/drones/geozones.html";
const NL_URL = "https://wetten.overheid.nl/BWBR0044598/2026-01-01";

const AUTHORITIES: Record<string, InfrastructureFlightGuidance["authority"]> = {
  BE: {
    name: "DGTA / SPF Mobilité – Département Géozones",
    remit: "Auskunft zu Geozonen; Zugangsgenehmigungen erteilt die in Droneguide benannte Stelle, nicht automatisch diese Auskunftsstelle.",
    url: BE_URL, email: "geozones@mobilit.fgov.be",
  },
  CH: {
    name: "BAZL – Unbemannte Luftfahrzeugsysteme",
    remit: "Allgemeine UAS-Auskunft; Ausnahmen für Energieanlagen erteilt die nach VLK zuständige Stelle. Kontakte stehen in der amtlichen Drohnenkarte.",
    url: "https://www.bazl.admin.ch/de/geografische-flugeinschraenkungen", email: "rpas@bazl.admin.ch",
  },
  FR: {
    name: "DGAC / zuständige DSAC und Präfektur",
    remit: "Öffentliches Verzeichnis der regional zuständigen Stellen; der in der Luftfahrtinformation bezeichnete Zonenverwalter ist für die dort genannten Zustimmungen maßgeblich.",
    url: "https://www.ecologie.gouv.fr/politiques-publiques/exploitation-drones-categorie-ouverte",
  },
  LU: {
    name: "Direction de l’aviation civile (DAC)",
    remit: "Auskunft zu UAS-Geozonen; die jeweilige Zugangsbedingung und zuständige Stelle stehen im Geoportail.",
    url: LU_URL, email: "uas.zones@av.etat.lu",
  },
  NL: {
    name: "Inspectie Leefomgeving en Transport (ILT)",
    remit: "Zuständige Luftfahrtbehörde für Betriebsgenehmigungen in der speziellen Kategorie; eine Betreiberzustimmung allein hebt Verbote der offenen Kategorie nicht auf.",
    url: "https://english.ilent.nl/topics/aviation/drones-and-model-aircraft/drones-eu-residents",
  },
};

/** Show verified conditions, not an inferred classification of an inventory asset. */
export function getInfrastructureFlightGuidance(
  countryIso: string,
  kind: InfrastructureKind,
): InfrastructureFlightGuidance | undefined {
  const iso = countryIso.toUpperCase();
  const authority = AUTHORITIES[iso];
  if (!authority) return undefined;
  const rules: InfrastructureFlightRule[] = [];
  switch (iso) {
    case "BE":
      rules.push({
        id: "BE-geozone", title: "Belgische Geozonen",
        condition: "Nur wenn der Flug eine veröffentlichte UAS-Geozone betrifft.",
        guidance: "Die Bedingungen in Droneguide gelten in OPEN und SPECIFIC: je nach Zone Verbot, Auflagen oder vorherige Genehmigung durch Skeyes bzw. den Zonenverwalter. Insbesondere können Nuklearanlagen geschützte Zonen haben. Eine Windanlage, Leitung oder ein Mast allein belegt keine solche Zone.",
        legalBasis: "Art. 15 Durchführungsverordnung (EU) 2019/947; belgische Geozonenbedingungen laut DGTA.",
        sources: [{ label: "DGTA: Geozonen und Zuständigkeiten", url: BE_URL }, { label: "Amtliche Karte: Droneguide", url: "https://map.droneguide.be/" }],
      });
      break;
    case "CH":
      rules.push({
        id: "CH-energy", title: "Schweizer Energieanlagen",
        condition: "Nur bei nachgewiesener Einstufung als eine der in Art. 27 Bst. d–f VLK genannten Anlagen.",
        guidance: "Verboten ist der Betrieb über (Freiluft-)Schaltanlagen bzw. Unterwerken der Netzebene 2, über der Kompressorenstation Ruswil und Messstation Wallbach sowie im Umkreis von 750 m um Kernkraftwerke und das Zwischenlager Würenlingen. Ausnahmen: zuständige Betreiber bei Schalt-/Gasanlagen, zuständige Bau- oder Betriebsbewilligungsinhaber bei Kernanlagen. Eine Leitung, ein Mast oder eine Windanlage belegt weder Netzebene 2 noch eine dieser Einstufungen; keine pauschale Übertragung dieser Verbote.",
        legalBasis: "Art. 27 Bst. d–f und Art. 29 Abs. 1 Bst. a Ziff. 4–6 VLK (SR 748.941).",
        sources: [{ label: "Fedlex: VLK Art. 27 und 29", url: CH_URL }, { label: "BAZL: Drohnenkarte und zuständige Stellen", url: authority.url }],
      });
      break;
    case "FR":
      rules.push({
        id: "FR-airspace", title: "Französische Überflugbedingungen",
        condition: "Nur bei einer veröffentlichten Verbots-/Beschränkungszone oder einer einschlägig gekennzeichneten Einrichtung.",
        guidance: "In Verbotszonen gelten die veröffentlichten Einflugbedingungen. In Beschränkungs-/Gefahrenzonen muss die Luftfahrtinformation den Flug ausdrücklich erlauben oder der dort benannte Verwalter zustimmen. Veröffentlichte Überflugbeschränkungen, insbesondere bei Einrichtungen mit Kennzeichnung für ein Tiefflugverbot, beachten; dort sieht Art. 4 Nr. 3 die Zustimmung des Einrichtungsverwalters vor. Ein Anlagenpunkt belegt weder diese Kennzeichnung noch eine Genehmigungspflicht.",
        legalBasis: "Art. 4 Nr. 1–3 Arrêté du 3 décembre 2020, konsolidiert nach Änderung vom 23. Dezember 2025.",
        sources: [{ label: "Légifrance: Art. 4 (geltende Fassung)", url: FR_URL }, { label: "DGAC: Regeln, Luftfahrtinformation und Behördenkontakte", url: authority.url }],
      });
      break;
    case "LU":
      rules.push({
        id: "LU-geozone", title: "Luxemburgische Zugangsbedingungen",
        condition: "Nur wenn eine im amtlichen Geoportail veröffentlichte UAS-Zone den Flug betrifft.",
        guidance: "Die dort veröffentlichten Bedingungen bestimmen, ob der Flug verboten ist, eine vorherige Genehmigung oder eine Meldung benötigt. Zonen und Aktivierungen vor jedem Flug prüfen. Ein Anlagenpunkt allein belegt keine dieser Anforderungen; Hersteller-Geofencing ersetzt die amtliche Karte nicht.",
        legalBasis: "Règlement ministériel du 16 décembre 2020 (UAS-Zonen); Art. 15 Durchführungsverordnung (EU) 2019/947.",
        sources: [{ label: "DAC: Geozonen, Rechtsgrundlage und Zugang", url: LU_URL }, { label: "Legilux: Règlement ministériel du 16 décembre 2020", url: "https://legilux.public.lu/eli/etat/leg/rmin/2020/12/16/a1028/jo" }, { label: "Amtliche Karte: Geoportail UAS", url: "https://g-o.lu/uas" }],
      });
      break;
    case "NL":
      rules.push({
        id: "NL-transmission", title: "Niederländisches Stromübertragungssystem",
        condition: "Nur in der offenen Kategorie und nur bei nachgewiesener Zugehörigkeit des Objekts/Gebiets zum transmissiesysteem voor elektriciteit.",
        guidance: "Art. 8 verbietet Flüge innerhalb eines horizontalen Abstands von 150 m zu Objekten oder Gebieten des Stromübertragungssystems. Anlagenposition, OSM-Anlagentyp und Spannungsangabe allein reichen nicht als Nachweis. Nicht pauschal auf Verteilungsleitungen oder jede Windanlage übertragen. Die Vorschrift nennt keine Freigabe allein durch Betreiberzustimmung.",
        legalBasis: "Art. 4 und 8 Regeling onbemande luchtvaartuigen; Begriffsbestimmung Art. 1.1 Energiewet (Fassung ab 1. Januar 2026).",
        sources: [{ label: "Wetten.nl: Regeling Art. 4 und 8", url: NL_URL }, { label: "Wetten.nl: Energiewet Art. 1.1", url: "https://wetten.overheid.nl/BWBR0050714/2026-01-01#Hoofdstuk1_Artikel1.1" }],
      });
      break;
  }
  rules.push({
    id: `${iso}-A3`, title: "Abstand in Unterkategorie A3",
    condition: "Nur beim Betrieb in A3 und gegenüber tatsächlich vorliegenden Wohn-, Gewerbe-, Industrie- oder Erholungsgebieten.",
    guidance: iso === "CH"
      ? "Mindestens 150 m horizontaler Abstand; BAZL erläutert die Beurteilung vor Ort anhand von 10 oder mehr unbeteiligten Personen in einem Radius von 100 m. Die Umgebung während des Flugs weiter beobachten. Eine einzelne Anlage allein belegt kein solches Gebiet."
      : "Mindestens 150 m horizontaler Abstand zu diesen Gebieten. Dies ist kein pauschaler 150-m-Radius um jede Energieanlage und keine Abstandsvorschrift für A1/A2.",
    legalBasis: iso === "CH" ? "Art. 22 VLK; UAS.OPEN.040 Nr. 2; BAZL-Erläuterung A3." : "UAS.OPEN.040 Nr. 2, Durchführungsverordnung (EU) 2019/947.",
    sources: [{ label: "EU: UAS.OPEN.040", url: EU_URL }, ...(iso === "CH" ? [{ label: "BAZL: Sicherheitsabstand A3", url: "https://www.bazl.admin.ch/de/flugregeln-drohnen" }] : [])],
  });
  // Lines lack a reliable obstacle-top height; never offer a line-height exception.
  if (kind !== "power_line") rules.push({
    id: `${iso}-obstacle`, title: "Bedingte Höhen-Ausnahme am hohen Hindernis",
    condition: "Nur in OPEN, bei einem künstlichen Hindernis höher als 105 m, innerhalb von 50 m horizontal und auf Antrag der für das Hindernis zuständigen Stelle.",
    guidance: "Dann kann die maximale Betriebshöhe bis 15 m über der Hindernishöhe liegen. Die tatsächliche Höhe und der Antrag müssen nachgewiesen sein; ein Register-Höhenwert oder Betreibername allein genügt nicht. Andere Geozonen, Verbote und Betriebsbedingungen bleiben einzuhalten. Keine automatische Freigabe.",
    legalBasis: iso === "NL" ? "UAS.OPEN.010 Nr. 3; Art. 5 Abs. 2 Regeling onbemande luchtvaartuigen (Zustimmung des Hindernisverwalters)." : `${iso === "CH" ? "Art. 22 VLK; " : ""}UAS.OPEN.010 Nr. 3, Durchführungsverordnung (EU) 2019/947.`,
    sources: [{ label: "EU: UAS.OPEN.010", url: EU_URL }, ...(iso === "NL" ? [{ label: "Wetten.nl: Art. 5 (Zustimmung)", url: NL_URL }] : [])],
  });
  return {
    checkedOn: "2026-10-12",
    limitation: "Bedingte Rechtsinformation, keine Einstufung dieser Anlage. Position und Verlauf beweisen weder Zonengrenzen noch Genehmigungspflicht oder erteilte Zustimmung. Dieser Hinweis sperrt die Flugplanung nicht und gibt sie nicht frei. Amtliche Geozonen, NOTAMs und örtliche Regeln bleiben maßgeblich.",
    rules, authority,
  };
}

/** One text presentation reused by native details, WebViews and web popups. */
export function infrastructureFlightGuidanceText(info: InfrastructureFlightGuidance): string {
  return [
    "Flugregeln – Geltungsbereich vor Ort prüfen",
    info.limitation,
    ...info.rules.map((rule) => `${rule.title}\nGilt nur: ${rule.condition}\n${rule.guidance}\nRechtsgrundlage: ${rule.legalBasis}`),
    `Zuständige Stellen: ${info.authority.name}\n${info.authority.remit}`,
    `Quellen geprüft am ${info.checkedOn}.`,
  ].join("\n\n");
}

export function infrastructureFlightGuidanceLinks(info: InfrastructureFlightGuidance): { label: string; url: string }[] {
  const links = [
    ...info.rules.flatMap((rule) => rule.sources),
    { label: info.authority.name, url: info.authority.url },
    ...(info.authority.email ? [{ label: `Behördenauskunft: ${info.authority.email}`, url: info.authority.email }] : []),
  ];
  return links.filter((link, index) => links.findIndex((other) => other.url === link.url) === index);
}
