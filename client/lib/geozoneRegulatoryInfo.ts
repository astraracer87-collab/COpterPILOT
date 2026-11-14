// Kuratierte Geozonen-Regulierungsinfos (Definitionen, Betriebsvoraussetzungen,
// Kontakte, Links) pro Layer. Reine Datenquelle ohne React-Native-Abhaengigkeiten,
// damit sie sowohl von der Mobile-App (client/lib/geozones.ts) als auch vom
// Web-Frontend (web/src) als einzige Quelle der Wahrheit importiert werden kann.

import { isDfsZonenEffective } from "./ctrAltitude";

// Datumsgesteuerte Textbausteine zum Stichtag des DFS-4-Zonen-Modells
// (NfL 2026-1-3960): Vor dem 6.8.2026 wird auf den Stichtag hingewiesen,
// ab dem Stichtag entfallen die "gültig ab"-Hinweise automatisch.
const DFS_ZONEN_IN_KRAFT = isDfsZonenEffective();

export interface GeozoneContact {
  type: "email" | "phone" | "web";
  label: string;
  value: string;
}

export interface GeozoneRegulatoryInfo {
  title: string;
  referenz: string;
  definition: string;
  abstandsregel: string;
  betriebsvoraussetzung: string;
  hinweis?: string;
  links?: { label: string; url: string }[];
  contacts?: GeozoneContact[];
}

export const GEOZONE_REGULATORY_INFO: Record<string, GeozoneRegulatoryInfo> = {
  kontrollzonen: {
    title: "Kontrollzonen (CTR)",
    referenz: "\u00a7 21h Absatz 3 Nr. 9 LuftVO",
    definition: "Luftraum",
    abstandsregel: "0 m",
    betriebsvoraussetzung: (DFS_ZONEN_IN_KRAFT
      ? "4-Zonen-Modell (NfL 2026-1-3960, hebt NfL 2023-1-2705 auf): "
      : "Neues 4-Zonen-Modell (NfL 2026-1-3960, g\u00fcltig ab 06.08.2026, hebt NfL 2023-1-2705 auf): ") + "Gilt ausschlie\u00dflich in den Kontrollzonen der 15 Flugh\u00e4fen mit DFS-Flugplatzkontrolle (Berlin Brandenburg, Bremen, Dresden, D\u00fcsseldorf, Erfurt-Weimar, Frankfurt Main, Hamburg, Hannover, K\u00f6ln/Bonn, Leipzig/Halle, M\u00fcnchen, M\u00fcnster/Osnabr\u00fcck, N\u00fcrnberg, Saarbr\u00fccken, Stuttgart). Zone 1 (Flughafenbereich + 1-km/5-km-Bereich): immer individuelle FVK-Freigabe der DFS; f\u00fcr die offene Kategorie zus\u00e4tzlich Genehmigung der Landesluftfahrtbeh\u00f6rde (\u00a7 21i LuftVO). Zone 2 (bis 4 km um den Flugplatzbezugspunkt): max. 25 m \u00fcber Grund oder \u00fcber Flugplatzh\u00f6he \u2013 der niedrigere Wert z\u00e4hlt. Zone 3 (bis 6 km): max. 45 m \u2013 der niedrigere Wert z\u00e4hlt. Zone 4 (restliche CTR): 100 m \u00fcber Flugplatzh\u00f6he oder 50 m \u00fcber Grund \u2013 der h\u00f6here Wert z\u00e4hlt (EU-Grenze 120 m bleibt). F\u00fcr andere Flugh\u00e4fen/Flugpl\u00e4tze gelten weiterhin die Regelungen der jeweils zust\u00e4ndigen Flugsicherung. Bei ED-R ist weiterhin das Bundesaufsichtsamt f\u00fcr Flugsicherung (BAF) zust\u00e4ndig.",
    hinweis: (DFS_ZONEN_IN_KRAFT
      ? "Wichtig \u2013 Geometrie:\n"
      : "Wichtig \u2013 Stichtag und Geometrie:\nDie neue NfL 2026-1-3960 gilt ab dem 6. August 2026; bis einschlie\u00dflich 5. August 2026 gilt die bisherige Regelung. ") + "Die \u00f6rtliche Darstellung der Zonen wird je Flughafen in Erg\u00e4nzungen zur AIP GERMANY sowie auf dipul ver\u00f6ffentlicht. Die in der App angezeigten Distanzgrenzen (4-km-/6-km-Kreis, Zone-1-N\u00e4herung) sind eine N\u00e4herung \u2013 ma\u00dfgeblich ist stets die AIP der jeweiligen CTR.\n\nWeitere Bedingungen (NfL 2026-1-3960): Bodensicht mind. 800 m laut offizieller Flugplatzwettermeldung (nicht gesch\u00e4tzt); max. Startmasse 5 kg Flugmodelle / 25 kg UAS; hindernisnahe Fl\u00fcge bis 30 m seitlich und 15 m \u00fcber dem Hindernis auch oberhalb der Zonenh\u00f6hen zul\u00e4ssig; BVLOS- und Schwarmfl\u00fcge im CTR-Au\u00dfenbereich von der allgemeinen Freigabe umfasst (Betriebsgenehmigungen bleiben erforderlich); vollautonome Fl\u00fcge nicht zul\u00e4ssig; keine Staffelung und keine Verkehrsinformation durch die Flugsicherung.\n\nDFS-Freigabe und \u00a7 21h LuftVO sind zwei getrennte Pr\u00fcfungen: Eine allgemeine oder individuelle FVK-Freigabe bedeutet nicht automatisch, dass der gesamte Flug erlaubt ist (Wohngrundst\u00fccke, Naturschutz, NOTAMs, EU-H\u00f6hengrenze usw. gelten zus\u00e4tzlich).\n\nTrotz Freigabe kann der Flugbetrieb f\u00fcr unbemannte Luftfahrzeuge jederzeit wieder eingestellt werden. Alle bereits erteilten Freigaben verlieren dann sofort ihre G\u00fcltigkeit!\n\nF\u00fcr bestimmte CTR und ED-R gibt es Allgemeinverf\u00fcgungen von den Flugverkehrskontrolldiensten. Diese werden in den Nachrichten f\u00fcr Luftfahrer (NfL) ver\u00f6ffentlicht und stellen eine allgemeing\u00fcltige Flugverkehrskontrollfreigabe dar, sofern die darin genannten Bedingungen vollst\u00e4ndig eingehalten werden.",
    links: [
      { label: DFS_ZONEN_IN_KRAFT ? "NfL 2026-1-3960 (DFS 4-Zonen-Modell) \u2013 Antr\u00e4ge & Genehmigungen" : "NfL 2026-1-3960 (DFS 4-Zonen-Modell, ab 06.08.2026) \u2013 Antr\u00e4ge & Genehmigungen", url: "https://www.dfs.de/homepage/de/drohnenflug/antraege-und-genehmigungen/" },
      { label: "DFS: Karten der Flugh\u00e4fen (Kontrollzonen)", url: "https://www.dfs.de/homepage/de/drohnenflug/karten-flughaefen/" },
      { label: "NfL 2026-1-3960 (DFS – 15 deutsche CTR)", url: "https://dipul.bund.de/homepage/en/applications-administrative-services/air-traffic-control-clearance/allgemeinverfuegung-uas-in-ctr-flugplatzkontrolle-der-dfs-deutsche-flugsicherung-gmbh-nfl-2026-1-3960.pdf" },
      { label: "NfL 2026-1-3884 (DFS, Flugverkehrskontrollfreigaben CTR)", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/nfl-2026-1-3884.pdf?cid=6cw" },
      { label: "NfL 2026-1-3885 (BOS in Kontrollzonen)", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/nfl-2026-1-3885.pdf?cid=6cz" },
      { label: "NfL 2024-1-3081 (Austro Control – 7 deutsche CTR)", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/allgemeinverfuegung-uas-in-ctr-flugplatzkontrolle-der-austro-control-gmbh-nfl-2024-1-3081.pdf?cid=3b6" },
      { label: "NfL 2026-1-3981 (DFS Aviation Services – 9 deutsche CTR)", url: "https://dipul.bund.de/homepage/en/applications-administrative-services/air-traffic-control-clearance/allgemeinverfuegung-uas-in-ctr-flugplatzkontrolle-der-dfs-aviation-services-gmbh-nfl-2026-1-3981.pdf" },
      { label: "NfL 2024-1-3127 (BAF ED-R 146 Berlin)", url: "https://dipul.de/homepage/en/applications-administrative-services/air-traffic-control-clearance/allgemeinverfuegung-uas-in-ed-r-146-berlin-zur-erteilung-von-durchfluggenehmigungen-nfl-2024-1-3127.pdf?cid=3be" },
      { label: "NfL 2024-1-3082 (TRIAC Oberpfaffenhofen)", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/allgemeinverfuegung-uas-in-ctr-flugplatzkontrolle-der-triac-oberpfaffenhofen-nfl-2024-1-3082.pdf?cid=3k3" },
      { label: "Freigabe online beantragen (DFS)", url: "https://ais.dfs.de/pilotservice/bnl/leisure/airdrone/airdrone_edit.jsp" },
      { label: "Alle Allgemeinverfügungen CTR", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/" },
    ],
    contacts: [
      { type: "email", label: "DFS — Berlin Brandenburg (BER)", value: "tower-ber@dfs.de" },
      { type: "phone", label: "DFS — Berlin Brandenburg (BER)", value: "+493060916131" },
      { type: "email", label: "DFS — Bremen (BRE)", value: "tower-bre@dfs.de" },
      { type: "phone", label: "DFS — Bremen (BRE)", value: "+494215592451" },
      { type: "email", label: "DFS — Dresden (DRS)", value: "tower-drs@dfs.de" },
      { type: "phone", label: "DFS — Dresden (DRS)", value: "+493512131146" },
      { type: "email", label: "DFS — Düsseldorf (DUS)", value: "tower-dus@dfs.de" },
      { type: "phone", label: "DFS — Düsseldorf (DUS)", value: "+492114212451" },
      { type: "email", label: "DFS — Erfurt-Weimar (ERF)", value: "tower-erf@dfs.de" },
      { type: "phone", label: "DFS — Erfurt-Weimar (ERF)", value: "+493614580201" },
      { type: "email", label: "DFS — Frankfurt Main (FRA)", value: "tower-fra@dfs.de" },
      { type: "phone", label: "DFS — Frankfurt Main (FRA)", value: "+496969024451" },
      { type: "email", label: "DFS — Hamburg (HAM)", value: "tower-ham@dfs.de" },
      { type: "phone", label: "DFS — Hamburg (HAM)", value: "+4940507522451" },
      { type: "email", label: "DFS — Hannover (HAJ)", value: "tower-haj@dfs.de" },
      { type: "phone", label: "DFS — Hannover (HAJ)", value: "+495119772451" },
      { type: "email", label: "DFS — Köln/Bonn (CGN)", value: "tower-cgn@dfs.de" },
      { type: "phone", label: "DFS — Köln/Bonn (CGN)", value: "+492203402451" },
      { type: "email", label: "DFS — Leipzig/Halle (LEJ)", value: "tower-lej@dfs.de" },
      { type: "phone", label: "DFS — Leipzig/Halle (LEJ)", value: "+493412240451" },
      { type: "email", label: "DFS — München (MUC)", value: "tower-muc@dfs.de" },
      { type: "phone", label: "DFS — München (MUC)", value: "+498997524451" },
      { type: "email", label: "DFS — Münster/Osnabrück (FMO)", value: "tower-fmo@dfs.de" },
      { type: "phone", label: "DFS — Münster/Osnabrück (FMO)", value: "+492571940451" },
      { type: "email", label: "DFS — Nürnberg (NUE)", value: "tower-nue@dfs.de" },
      { type: "phone", label: "DFS — Nürnberg (NUE)", value: "+49911935451" },
      { type: "email", label: "DFS — Saarbrücken (SCN)", value: "tower-scn@dfs.de" },
      { type: "phone", label: "DFS — Saarbrücken (SCN)", value: "+496893832451" },
      { type: "email", label: "DFS — Stuttgart (STR)", value: "tower-str@dfs.de" },
      { type: "phone", label: "DFS — Stuttgart (STR)", value: "+497117948451" },
      { type: "email", label: "DFS Aviation — Braunschweig (BWE)", value: "TWR-BWE@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Braunschweig (BWE)", value: "+495312952391" },
      { type: "email", label: "DFS Aviation — Dortmund (DTM)", value: "TWR-DTM@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Dortmund (DTM)", value: "+492319211024" },
      { type: "email", label: "DFS Aviation — Friedrichshafen (FDH)", value: "TWR-FDH@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Friedrichshafen (FDH)", value: "+497541284251" },
      { type: "email", label: "DFS Aviation — Karlsruhe/Baden-Baden (FKB)", value: "TWR-FKB@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Karlsruhe/Baden-Baden (FKB)", value: "+497229662821" },
      { type: "email", label: "DFS Aviation — Lahr (LHA)", value: "TWR-LHA@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Lahr (LHA)", value: "+497821959110" },
      { type: "email", label: "DFS Aviation — Memmingen (FMM)", value: "TWR-FMM@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Memmingen (FMM)", value: "+498331984421" },
      { type: "email", label: "DFS Aviation — Mönchengladbach (MGL)", value: "TWR-MGL@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Mönchengladbach (MGL)", value: "+492161682920" },
      { type: "email", label: "DFS Aviation — Niederrhein/Weeze (NRN)", value: "TWR-NRN@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Niederrhein/Weeze (NRN)", value: "+492837664991" },
      { type: "email", label: "DFS Aviation — Paderborn-Lippstadt (PAD)", value: "TWR-PAD@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Paderborn-Lippstadt (PAD)", value: "+492955774251" },
      { type: "email", label: "TRIAC — Oberpfaffenhofen (OBF)", value: "uas@triac-gmbh.de" },
      { type: "phone", label: "TRIAC — Oberpfaffenhofen (OBF)", value: "+498153282116" },
      { type: "web", label: "Freigabe online beantragen (DFS)", value: "https://ais.dfs.de/pilotservice/bnl/leisure/airdrone/airdrone_edit.jsp" },
    ],
  },
  flugbeschraenkungsgebiete: {
    title: "Flugbeschränkungsgebiete (ED-R)",
    referenz: "§ 21h Absatz 3 Nr. 9 LuftVO",
    definition: "Luftraum",
    abstandsregel: "0 m",
    betriebsvoraussetzung: "Grundsätzlich gilt, dass der Betrieb von unbemannten Luftfahrzeugen in Flugbeschränkungsgebieten (ED-R) nur dann zulässig ist, wenn zuvor beim Bundesaufsichtsamt für Flugsicherung (BAF) eine Durchfluggenehmigung gem. § 17 Abs. 2 LuftVO eingeholt wurde. Ein Einflug ohne Genehmigung stellt nach § 62 LuftVG eine Straftat dar.\n\nFür bestimmte ED-R zum Schutz von Energie-, Rückbau- und Forschungsanlagen sowie der Wartburg besteht eine Allgemeinverfügung (NfL 2025-1-3652), die unter bestimmten Bedingungen eine allgemeine Durchfluggenehmigung erteilt.\n\nBetroffene ED-R (NfL 2025-1-3652, neue Nummerierung):\nED-R 1 Garching (Forschungsreaktor)\nED-R 3 Geesthacht/Krümmel\nED-R 5 Biblis (Kernkraftwerk)\nED-R 6 Brokdorf (Kernkraftwerk)\nED-R 7 Brunsbüttel (Kernkraftwerk)\nED-R 8 Emsland (Kernkraftwerk)\nED-R 23 Grafenrheinfeld (Kernkraftwerk)\nED-R 24 Grohnde (Kernkraftwerk)\nED-R 25 Gundremmingen (Kernkraftwerk)\nED-R 27 Isar (Kernkraftwerk)\nED-R 38 Neckarwestheim (Kernkraftwerk)\nED-R 39 Obrigheim (Kernkraftwerk)\nED-R 40 Philippsburg (Kernkraftwerk)\nED-R 41 Unterweser (Kernkraftwerk)\nED-R 90 Wartburg (Kulturdenkmal)\nED-R 111 Jülich (Forschungszentrum)\nED-R 133 Karlsruhe (Forschungszentrum)\n\nED-R 146 (Berlin) ist NICHT von dieser AV umfasst — eigene AV (NfL 2024-1-3127).",
    hinweis: "Wichtig:\nTrotz Freigabe kann der Flugbetrieb für unbemannte Luftfahrzeuge jederzeit wieder eingestellt werden. Alle bereits erteilten Freigaben verlieren dann sofort ihre Gültigkeit!\n\nEine Flugverkehrskontrollfreigabe betrifft nur den jeweiligen Luftraum. Eine ggf. erforderliche Genehmigung des Drohnenbetriebs ist weiterhin einzuholen!\n\nBedingungen der AV (NfL 2025-1-3652):\n- Betrieb nur in der offenen Kategorie gem. DVO (EU) 2019/947\n- Betrieb nur bei Tageslicht und bei Sichtflugbedingungen (VMC)\n- Maximale Flughöhe 50 m über Grund (AGL)\n- Mindestabstand zur Anlage: 200 m horizontal\n- Fernpilot muss sich vor dem Flug über die genaue Lage der Anlage informieren\n- ED-R 146 (Berlin) ist NICHT von dieser AV umfasst — eigene AV (NfL 2024-1-3127)",
    links: [
      { label: "NfL 2025-1-3652 (AV ED-R Energie/Forschung/Wartburg)", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugbeschraenkungsgebiete-ed-r/allgemeinverfuegung-uas-in-verschiedenen-ed-r-zum-schutz-von-energie-rueckbau-und-forschungsanlagen-sowie-der-wartburg-nfl-2025-1-3652.pdf?cid=5ay" },
      { label: "NfL 2024-1-3127 (BAF ED-R 146 Berlin)", url: "https://dipul.de/homepage/en/applications-administrative-services/air-traffic-control-clearance/allgemeinverfuegung-uas-in-ed-r-146-berlin-zur-erteilung-von-durchfluggenehmigungen-nfl-2024-1-3127.pdf?cid=3be" },
      { label: "Alle Allgemeinverfügungen ED-R", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugbeschraenkungsgebiete-ed-r/" },
    ],
    contacts: [
      { type: "email", label: "BAF — Allgemein (Drohnen)", value: "drohne@baf.bund.de" },
      { type: "email", label: "BAF — ED-R 146 Berlin", value: "ed-r@baf.bund.de" },
      { type: "phone", label: "BAF — Referat LFR", value: "+496103707290" },
      { type: "phone", label: "Polizei Berlin — Lagezentrum (ED-R 146)", value: "+49304664707110" },
      { type: "web", label: "BAF — ED-R Informationen", value: "https://www.baf.bund.de/DE/Themen/Luftraum_Flugverfahren_Recht/Flugbeschraenkungsgebiete_UAS/Flugbeschraenkungsgebiete_UAS_node.html" },
      { type: "web", label: "BAF — Antragsformulare", value: "https://www.baf.bund.de/DE/Themen/Luftraum_Flugverfahren_Recht/Flugbeschraenkungsgebiete_UAS/Antraege_Durchflug/Antraege_Durchflug_node.html" },
    ],
  },
  temporaere_betriebseinschraenkungen: {
    title: "Tempor\u00e4re Betriebseinschr\u00e4nkungen",
    referenz: "\u00a7 21h Absatz 3 LuftVO",
    definition: "Zeitlich begrenzte Einschr\u00e4nkungen des Drohnenbetriebs, z.B. bei Gro\u00dfveranstaltungen, Staatsbesuchen oder besonderen Sicherheitslagen.",
    abstandsregel: "Variabel",
    betriebsvoraussetzung: "Betrieb nur mit ausdr\u00fccklicher Genehmigung der zust\u00e4ndigen Stelle m\u00f6glich. Aktuelle tempor\u00e4re Einschr\u00e4nkungen sind \u00fcber NOTAMs und dipul abrufbar.",
  },
  flughaefen: {
    title: "Flugh\u00e4fen",
    referenz: "\u00a7 21h Absatz 3 Nr. 2 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 1000 m von der Begrenzung eines Flughafens sowie von den in den An- und Abflugrichtungen um jeweils 5000 m verl\u00e4ngerten Bahnmittellinien eines Flughafens.",
    abstandsregel: "1000 m",
    betriebsvoraussetzung: "Betrieb in der Kategorie \u201eSpecific\u201c.",
  },
  flugplaetze: {
    title: "Flugpl\u00e4tze",
    referenz: "\u00a7 21h Absatz 3 Nr. 1 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 1500 m von der Begrenzung eines Flugplatzes.",
    abstandsregel: "1500 m",
    betriebsvoraussetzung: "Betrieb in der Kategorie \u201eSpecific\u201c oder Vorliegen einer Genehmigung der Luftaufsichtsstelle, der Flugleitung oder des Betreibers am Flugplatz.",
  },
  binnenwasserstrassen: {
    title: "Binnenwasserstra\u00dfen",
    referenz: "\u00a7 21h Absatz 3 Nr. 5 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Bundeswasserstra\u00dfen.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "a. Betrieb in der Kategorie \u201eSpecific\u201c oder\nb. Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder der Betreiber der Einrichtungen oder\nc. H\u00f6he des Flugger\u00e4tes \u00fcber Grund ist stets kleiner als der seitliche Abstand zur Infrastruktur und der seitliche Abstand zur Infrastruktur ist stets gr\u00f6\u00dfer als 10 m oder\nd. Beim \u00dcberflug von Bundeswasserstra\u00dfen wird das Flugger\u00e4t mindestens 100 m \u00fcber Grund oder Wasser betrieben, es erfolgt lediglich eine Querung auf dem k\u00fcrzesten Weg und keine Schiffe und keine Schifffahrtsanlagen, insbesondere Schleusen, Wehre, Schiffshebewerke und Liegestellen, werden \u00fcberflogen.",
  },
  seewasserstrassen: {
    title: "Seewasserstra\u00dfen",
    referenz: "\u00a7 21h Absatz 3 Nr. 5 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Seewasserstra\u00dfen.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "a. Betrieb in der Kategorie \u201eSpecific\u201c oder\nb. Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder der Betreiber der Einrichtungen oder\nc. H\u00f6he des Flugger\u00e4tes \u00fcber Grund ist stets kleiner als der seitliche Abstand zur Infrastruktur und der seitliche Abstand zur Infrastruktur ist stets gr\u00f6\u00dfer als 10 m oder\nd. Beim \u00dcberflug wird das Flugger\u00e4t mindestens 100 m \u00fcber Grund oder Wasser betrieben, es erfolgt lediglich eine Querung auf dem k\u00fcrzesten Weg und keine Schiffe und keine Schifffahrtsanlagen werden \u00fcberflogen.",
  },
  schifffahrtsanlagen: {
    title: "Schifffahrtsanlagen",
    referenz: "\u00a7 21h Absatz 3 Nr. 5 LuftVO",
    definition: "Schleusen, Wehre, Schiffshebewerke, Liegestellen und sonstige Schifffahrtsanlagen an Bundeswasserstra\u00dfen.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "a. Betrieb in der Kategorie \u201eSpecific\u201c oder\nb. Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder der Betreiber der Einrichtungen.",
  },
  industrieanlagen: {
    title: "Industrieanlagen",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von der Begrenzung von Industrieanlagen, Justizvollzugsanstalten, Einrichtungen des Ma\u00dfregelvollzugs, milit\u00e4rischen Anlagen und Organisationen, Anlagen der zentralen Energieerzeugung und Energieverteilung sowie Einrichtungen, in denen erlaubnisbed\u00fcrftige T\u00e4tigkeiten der Schutzstufe 4 nach der Biostoffverordnung (BioStoffV) ausge\u00fcbt werden. Anlagen der zentralen Energieerzeugung sind alle diejenigen an das Verteilernetz angeschlossenen Energieerzeugungsanlagen, die keine dezentrale Erzeugungsanlage im Sinne des \u00a7 3 Nummer 11 des Energiewirtschaftsgesetzes (EnWG) sind.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  naturschutzgebiete: {
    title: "Naturschutzgebiete",
    referenz: "§ 21h Absatz 3 Nr. 6 LuftVO",
    definition: "Ein Bereich über Naturschutzgebieten im Sinne des § 23 Absatz 1 des Bundesnaturschutzgesetzes (BNatSchG), über Nationalparks im Sinne des § 24 des Bundesnaturschutzgesetzes (BNatSchG) und über Gebieten im Sinne des § 7 Absatz 1 Nummer 6 und 7 des Bundesnaturschutzgesetzes (BNatSchG).",
    abstandsregel: "0 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zuständigen Naturschutzbehörde oder der Betrieb ist gemäß anderslautender landesrechtlicher Vorschriften erlaubt oder (nicht bei Nationalparks):\n\na. Der Betrieb erfolgt nicht zu Zwecken des Sports oder der Freizeitgestaltung und\nb. der Betrieb erfolgt in einer Höhe von mehr als 100 m und\nc. der Fernpilot kennt den Schutzzweck des betroffenen Schutzgebietes und berücksichtigt diesen in angemessener Weise und\nd. die Luftraumnutzung durch den Überflug über dem betroffenen Schutzgebiet ist zur Erfüllung des Zwecks für den Betrieb unumgänglich erforderlich.",
    hinweis: "In mehreren Bundesländern gibt es Allgemeinverfügungen (AV), die den Drohnenbetrieb in Naturschutzgebieten unter bestimmten Bedingungen erlauben. Prüfe, ob für dein Bundesland eine AV vorliegt.",
    links: [
      { label: "Allgemeinverfügungen (dipul Übersicht)", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/" },
    ],
  },
  nationalparks: {
    title: "Nationalparks",
    referenz: "\u00a7 21h Absatz 3 Nr. 6 LuftVO",
    definition: "Ein Bereich \u00fcber Nationalparks im Sinne des \u00a7 24 des Bundesnaturschutzgesetzes (BNatSchG).",
    abstandsregel: "0 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Naturschutzbeh\u00f6rde oder der Betrieb ist gem\u00e4\u00df anderslautender landesrechtlicher Vorschriften erlaubt.\n\nWichtig: Die Ausnahmen (Betrieb \u00fcber 100 m H\u00f6he etc.) gelten NICHT f\u00fcr Nationalparks!",
  },
  vogelschutzgebiete: {
    title: "Vogelschutzgebiete",
    referenz: "\u00a7 21h Absatz 3 Nr. 6 LuftVO",
    definition: "Ein Bereich \u00fcber Gebieten im Sinne des \u00a7 7 Absatz 1 Nummer 6 und 7 des Bundesnaturschutzgesetzes (BNatSchG) \u2014 europ\u00e4ische Vogelschutzgebiete (SPA).",
    abstandsregel: "0 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Naturschutzbeh\u00f6rde oder der Betrieb ist gem\u00e4\u00df anderslautender landesrechtlicher Vorschriften erlaubt oder:\n\na. Der Betrieb erfolgt nicht zu Zwecken des Sports oder der Freizeitgestaltung und\nb. der Betrieb erfolgt in einer H\u00f6he von mehr als 100 m und\nc. der Fernpilot kennt den Schutzzweck des betroffenen Schutzgebietes und ber\u00fccksichtigt diesen in angemessener Weise und\nd. die Luftraumnutzung ist zur Erf\u00fcllung des Zwecks f\u00fcr den Betrieb unumg\u00e4nglich erforderlich.",
  },
  "ffh-gebiete": {
    title: "FFH-Gebiete",
    referenz: "\u00a7 21h Absatz 3 Nr. 6 LuftVO",
    definition: "Ein Bereich \u00fcber Fauna-Flora-Habitat-Gebieten gem\u00e4\u00df der FFH-Richtlinie (92/43/EWG), die als Gebiete von gemeinschaftlicher Bedeutung (GGB) oder als besondere Erhaltungsgebiete (BEG) ausgewiesen sind.",
    abstandsregel: "0 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Naturschutzbeh\u00f6rde oder der Betrieb ist gem\u00e4\u00df anderslautender landesrechtlicher Vorschriften erlaubt oder:\n\na. Der Betrieb erfolgt nicht zu Zwecken des Sports oder der Freizeitgestaltung und\nb. der Betrieb erfolgt in einer H\u00f6he von mehr als 100 m und\nc. der Fernpilot kennt den Schutzzweck und ber\u00fccksichtigt diesen angemessen und\nd. die Luftraumnutzung ist zur Erf\u00fcllung des Zwecks unumg\u00e4nglich erforderlich.",
  },
  militaerische_anlagen: {
    title: "Milit\u00e4rische Anlagen",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von der Begrenzung milit\u00e4rischer Anlagen und Organisationen.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  stromleitungen: {
    title: "Stromleitungen",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Freileitungen zur Energieverteilung (Hochspannungsleitungen). Teil der Anlagen der zentralen Energieerzeugung und Energieverteilung.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  umspannwerke: {
    title: "Umspannwerke",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Umspannwerke als Teil der Anlagen der zentralen Energieerzeugung und Energieverteilung.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  kraftwerke: {
    title: "Kraftwerke",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Anlagen der zentralen Energieerzeugung \u2014 alle an das Verteilernetz angeschlossenen Energieerzeugungsanlagen, die keine dezentrale Erzeugungsanlage im Sinne des \u00a7 3 Nr. 11 EnWG sind.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  windkraftanlagen: {
    title: "Windkraftanlagen",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Windenergieanlagen als Teil der Anlagen der zentralen Energieerzeugung und Energieverteilung.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  bundesautobahnen: {
    title: "Bundesautobahnen",
    referenz: "\u00a7 21h Absatz 3 Nr. 5 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Bundesfernstra\u00dfen (Bundesautobahnen).",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "a. Betrieb in der Kategorie \u201eSpecific\u201c oder\nb. Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder der Betreiber der Einrichtungen oder\nc. H\u00f6he des Flugger\u00e4tes \u00fcber Grund ist stets kleiner als der seitliche Abstand zur Infrastruktur und der seitliche Abstand zur Infrastruktur ist stets gr\u00f6\u00dfer als 10 m.",
  },
  bundesstrassen: {
    title: "Bundesstra\u00dfen",
    referenz: "\u00a7 21h Absatz 3 Nr. 5 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Bundesfernstra\u00dfen (Bundesstra\u00dfen).",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "a. Betrieb in der Kategorie \u201eSpecific\u201c oder\nb. Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder der Betreiber der Einrichtungen oder\nc. H\u00f6he des Flugger\u00e4tes \u00fcber Grund ist stets kleiner als der seitliche Abstand zur Infrastruktur und der seitliche Abstand zur Infrastruktur ist stets gr\u00f6\u00dfer als 10 m.",
  },
  bahnanlagen: {
    title: "Bahnanlagen",
    referenz: "\u00a7 21h Absatz 3 Nr. 5 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Bahnanlagen.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "a. Betrieb in der Kategorie \u201eSpecific\u201c oder\nb. Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder der Betreiber der Einrichtungen oder\nc. H\u00f6he des Flugger\u00e4tes \u00fcber Grund ist stets kleiner als der seitliche Abstand zur Infrastruktur und der seitliche Abstand zur Infrastruktur ist stets gr\u00f6\u00dfer als 10 m.",
  },
  diplomatische_vertretungen: {
    title: "Diplomatische Vertretungen",
    referenz: "\u00a7 21h Absatz 3 Nr. 4 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Grundst\u00fccken, auf denen diplomatische und konsularische Vertretungen sowie internationale Organisationen im Sinne des V\u00f6lkerrechts ihren Sitz haben.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  behoerden: {
    title: "Oberste Bundes-/Landesbeh\u00f6rden",
    referenz: "\u00a7 21h Absatz 3 Nr. 4 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Grundst\u00fccken, auf denen die Verfassungsorgane des Bundes oder der L\u00e4nder oder oberste und obere Bundes- oder Landesbeh\u00f6rden ihren Sitz haben.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  internationale_organisationen: {
    title: "Internationale Organisationen",
    referenz: "\u00a7 21h Absatz 3 Nr. 4 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Grundst\u00fccken, auf denen internationale Organisationen im Sinne des V\u00f6lkerrechts ihren Sitz haben.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  justizvollzugsanstalten: {
    title: "JVA / Ma\u00dfregelvollzug",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von der Begrenzung von Justizvollzugsanstalten und Einrichtungen des Ma\u00dfregelvollzugs.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  polizei: {
    title: "Polizeiliegenschaften",
    referenz: "\u00a7 21h Absatz 3 Nr. 4 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Liegenschaften von Polizei und anderen Sicherheitsbeh\u00f6rden.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  sicherheitsbehoerden: {
    title: "Andere Sicherheitsbeh\u00f6rden",
    referenz: "\u00a7 21h Absatz 3 Nr. 4 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Liegenschaften anderer Sicherheitsbeh\u00f6rden.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  krankenhaeuser: {
    title: "Krankenh\u00e4user",
    referenz: "\u00a7 21h Absatz 3 Nr. 10 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von der Begrenzung von Krankenh\u00e4usern.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der Betreiber der Einrichtungen.",
  },
  labore: {
    title: "Einrichtungen BSL-4",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Einrichtungen, in denen erlaubnisbed\u00fcrftige T\u00e4tigkeiten der Schutzstufe 4 nach der Biostoffverordnung (BioStoffV) ausge\u00fcbt werden.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  freibaeder: {
    title: "Freib\u00e4der / Badestr\u00e4nde",
    referenz: "\u00a7 21h Absatz 3 Nr. 8 LuftVO",
    definition: "Ein Bereich \u00fcber Freib\u00e4dern, Badestr\u00e4nden und \u00e4hnlichen Einrichtungen.",
    abstandsregel: "0 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung und Flugbetrieb au\u00dferhalb der Betriebs- oder Badezeiten der Einrichtung.",
  },
  modellflugplaetze: {
    title: "Modellflugpl\u00e4tze",
    referenz: "Darstellung zur Information von Fernpiloten!",
    definition: "Ein Bereich \u00fcber und um Flugpl\u00e4tze f\u00fcr H\u00e4ngegleiter, Gleitschirme u.\u00e4. sowie Modellflugpl\u00e4tzen.",
    abstandsregel: "Keine Beschr\u00e4nkung durch LuftVO, aber lokale Regeln durch jeweiligen Betreiber beachten!",
    betriebsvoraussetzung: "Flugpl\u00e4tze f\u00fcr H\u00e4ngegleiter, Gleitschirme u.\u00e4. sowie Modellflugpl\u00e4tze sind keine geografischen Gebiete im Sinne des \u00a7 21h LuftVO, d.h. der Drohnenbetrieb wird durch diese nicht grunds\u00e4tzlich beschr\u00e4nkt.\n\nEs k\u00f6nnen lokale Betriebsvoraussetzungen durch den jeweiligen Betreiber gelten. Es wird empfohlen, diesen zu kontaktieren.",
    hinweis: "WICHTIG\nIn diesen Gebieten und auch au\u00dferhalb des markierten Bereichs ist stets mit Flugverkehr durch \u2013 teils lautlose! \u2013 Luftfahrzeuge zu rechnen! Fernpiloten m\u00fcssen jedes Kollisionsrisiko mit Luftfahrzeugen vermeiden und m\u00fcssen entsprechend ausweichen oder ihren Flug abbrechen.",
  },
  haengegleiter: {
    title: "H\u00e4ngegleiter",
    referenz: "Darstellung zur Information von Fernpiloten!",
    definition: "Ein Bereich \u00fcber und um Flugpl\u00e4tze f\u00fcr H\u00e4ngegleiter, Gleitschirme u.\u00e4.",
    abstandsregel: "Keine Beschr\u00e4nkung durch LuftVO, aber lokale Regeln durch jeweiligen Betreiber beachten!",
    betriebsvoraussetzung: "Flugpl\u00e4tze f\u00fcr H\u00e4ngegleiter, Gleitschirme u.\u00e4. sind keine geografischen Gebiete im Sinne des \u00a7 21h LuftVO, d.h. der Drohnenbetrieb wird durch diese nicht grunds\u00e4tzlich beschr\u00e4nkt.\n\nEs k\u00f6nnen lokale Betriebsvoraussetzungen durch den jeweiligen Betreiber gelten. Es wird empfohlen, diesen zu kontaktieren.",
    hinweis: "WICHTIG\nIn diesen Gebieten und auch au\u00dferhalb des markierten Bereichs ist stets mit Flugverkehr durch \u2013 teils lautlose! \u2013 Luftfahrzeuge zu rechnen! Fernpiloten m\u00fcssen jedes Kollisionsrisiko mit Luftfahrzeugen vermeiden und m\u00fcssen entsprechend ausweichen oder ihren Flug abbrechen.",
  },
  wohngrundstuecke: {
    title: "Wohngrundst\u00fccke",
    referenz: "\u00a7 21h Absatz 3 Nr. 7 LuftVO",
    definition: "Ein Bereich \u00fcber Wohngrundst\u00fccken.",
    abstandsregel: "0 m",
    betriebsvoraussetzung: "a. Vorliegen einer Genehmigung des Eigent\u00fcmers oder sonstigen Nutzungsberechtigten oder\nb. die Startmasse des unbemannten Flugger\u00e4tes betr\u00e4gt bis zu 0,25 kg und das unbemannte Flugger\u00e4t und seine Ausr\u00fcstung sind zu optischen und akustischen Aufzeichnungen und \u00dcbertragungen sowie zur Aufzeichnung und zur \u00dcbertragung von Funksignalen Dritter nicht in der Lage oder\nc. der Betrieb findet in einer Flugh\u00f6he von mindestens 100 m statt und\n\n   1. die Luftraumnutzung \u00fcber dem betroffenen Wohngrundst\u00fcck ist zur Erf\u00fcllung eines berechtigten Betriebszwecks erforderlich; \u00f6ffentliche Fl\u00e4chen oder Grundst\u00fccke, die keine Wohngrundst\u00fccke sind, k\u00f6nnen f\u00fcr den \u00dcberflug nicht genutzt werden und die Zustimmung des Grundst\u00fcckeigent\u00fcmers oder sonstigen Nutzungsberechtigten kann nicht in zumutbarer Weise eingeholt werden, und\n   2. es werden alle Vorkehrungen getroffen, um einen Eingriff in den gesch\u00fctzten Privatbereich und in das Recht auf informationelle Selbstbestimmung der betroffenen B\u00fcrger zu vermeiden; dazu z\u00e4hlt insbesondere, dass in ihren Rechten Betroffene regelm\u00e4\u00dfig vorab zu informieren sind, und\n   3. der Betrieb findet nicht zwischen 22:00 Uhr und 6:00 Uhr Ortszeit statt und\n   4. es ist nicht zu erwarten, dass durch den Betrieb Immissionsrichtwerte nach Nummer 6.1 der Technischen Anleitung zum Schutz gegen L\u00e4rm \u00fcberschritten werden.",
  },
  ch_drohnen: {
    title: "Drohnen-Einschr\u00e4nkungen (CH)",
    referenz: "BAZL — Verordnung des UVEK \u00fcber unbemannte Luftfahrzeuge (VUL), SR 748.941",
    definition: "Gebiete in der Schweiz, in denen der Betrieb von Drohnen eingeschr\u00e4nkt oder verboten ist. Dazu geh\u00f6ren Kontrollzonen um Flugh\u00e4fen, Naturschutzgebiete, milit\u00e4rische Sperrgebiete und weitere sensible Bereiche.",
    abstandsregel: "Abh\u00e4ngig von Zone — siehe Kartendetails",
    betriebsvoraussetzung: "In Einschr\u00e4nkungszonen ist der Drohnenbetrieb nur mit entsprechender Bewilligung des BAZL oder der zust\u00e4ndigen Stelle (z.\u00a0B. skyguide f\u00fcr CTR) gestattet. F\u00fcr die offene Kategorie gelten die EU-Regeln gem\u00e4ss CH-Umsetzung.",
    hinweis: "Die Schweiz hat die EU-Drohnenverordnung (EU) 2019/947 \u00fcbernommen. F\u00fcr Fl\u00fcge in Kontrollzonen (CTR) ist eine Freigabe von skyguide erforderlich. In Nationalparks und Naturschutzgebieten gelten zus\u00e4tzliche kantonale Einschr\u00e4nkungen.\n\nRegistrierung: Alle Drohnen ab 250\u00a0g oder mit Kamera m\u00fcssen beim BAZL registriert werden.\n\nOnline-Bewilligung f\u00fcr CTR: \u00dcber das skyguide-Portal SWISSDRONE.",
    links: [
      { label: "BAZL Drohnen-Infoseite", url: "https://www.bazl.admin.ch/bazl/de/home/drohnen.html" },
      { label: "Geo-Awareness Karte (BAZL)", url: "https://map.geo.admin.ch/?topic=aviation&layers=ch.bazl.einschraenkungen-drohnen" },
      { label: "skyguide SWISSDRONE (CTR-Freigabe)", url: "https://swissdrone.skyguide.ch/" },
      { label: "VUL (SR 748.941)", url: "https://www.fedlex.admin.ch/eli/cc/2023/202/de" },
    ],
    contacts: [
      { type: "email", label: "BAZL — Sektion UAS", value: "uas@bazl.admin.ch" },
      { type: "phone", label: "BAZL — Zentrale", value: "+41583165511" },
      { type: "web", label: "skyguide SWISSDRONE", value: "https://swissdrone.skyguide.ch/" },
    ],
  },
  ch_aktivitaetszonen: {
    title: "UAS-Aktivit\u00e4tszonen (CH)",
    referenz: "BAZL — Art. 19 VUL (SR 748.941)",
    definition: "Gebiete, die f\u00fcr bestimmte UAS-Aktivit\u00e4ten ausgewiesen sind (z.\u00a0B. Modellflugpl\u00e4tze, Testgebiete).",
    abstandsregel: "Je nach Zone — siehe Kartendetails",
    betriebsvoraussetzung: "Betrieb gem\u00e4ss den Bedingungen der jeweiligen Aktivit\u00e4tszone. Modellflugpl\u00e4tze k\u00f6nnen besondere Regeln und H\u00f6hengrenzen haben.",
    links: [
      { label: "BAZL Drohnen-Infoseite", url: "https://www.bazl.admin.ch/bazl/de/home/drohnen.html" },
    ],
    contacts: [
      { type: "email", label: "BAZL — Sektion UAS", value: "uas@bazl.admin.ch" },
    ],
  },
  ch_bodenrisiko_100: {
    title: "Intrinsisches Bodenrisiko SORA 100J (CH)",
    referenz: "BAZL — SORA-Methodik (Specific Operations Risk Assessment), JARUS Guidelines",
    definition: "Kartierung des intrinsischen Bodenrisikos f\u00fcr die SORA-Bewertung mit einer statistischen Wiederkehrperiode von 100 Jahren. Zeigt die Bev\u00f6lkerungsdichte und kritische Infrastruktur.",
    abstandsregel: "Gem\u00e4ss SORA Ground Risk Class (GRC)",
    betriebsvoraussetzung: "Relevant f\u00fcr Betrieb in der speziellen Kategorie. Die GRC bestimmt die erforderlichen Risikominderungsmassnahmen (M1/M2/M3).",
    links: [
      { label: "BAZL SORA-Info", url: "https://www.bazl.admin.ch/bazl/de/home/drohnen/drohnen-und-flugmodelle/betrieb-in-der-speziellen-kategorie.html" },
    ],
    contacts: [
      { type: "email", label: "BAZL — Sektion UAS", value: "uas@bazl.admin.ch" },
    ],
  },
  ch_bodenrisiko_200: {
    title: "Intrinsisches Bodenrisiko SORA 200J (CH)",
    referenz: "BAZL — SORA-Methodik (Specific Operations Risk Assessment), JARUS Guidelines",
    definition: "Kartierung des intrinsischen Bodenrisikos f\u00fcr die SORA-Bewertung mit einer statistischen Wiederkehrperiode von 200 Jahren. Konservativere Bewertung als 100J.",
    abstandsregel: "Gem\u00e4ss SORA Ground Risk Class (GRC)",
    betriebsvoraussetzung: "Relevant f\u00fcr Betrieb in der speziellen Kategorie mit erh\u00f6htem Risikoprofil.",
    links: [
      { label: "BAZL SORA-Info", url: "https://www.bazl.admin.ch/bazl/de/home/drohnen/drohnen-und-flugmodelle/betrieb-in-der-speziellen-kategorie.html" },
    ],
    contacts: [
      { type: "email", label: "BAZL — Sektion UAS", value: "uas@bazl.admin.ch" },
    ],
  },
  ch_ruhezonen: {
    title: "Landschaftsruhezonen (CH)",
    referenz: "BAZL — Verordnung \u00fcber die Luftfahrt (LFV), kantonale Regelungen",
    definition: "Gebiete mit erh\u00f6htem Schutz f\u00fcr Wildtiere und Natur. In diesen Zonen ist der Drohnenbetrieb eingeschr\u00e4nkt oder verboten.",
    abstandsregel: "Flugverbot oder saisonale Einschr\u00e4nkungen",
    betriebsvoraussetzung: "In Landschaftsruhezonen ist der Drohnenbetrieb grunds\u00e4tzlich nicht gestattet. Ausnahmen erfordern eine kantonale Bewilligung.",
    hinweis: "Besonders relevant in Gebirgsregionen und W\u00e4ldern w\u00e4hrend Brut- und Setzzeiten. Kantonale Jagd- und Naturschutzbeh\u00f6rden k\u00f6nnen zus\u00e4tzliche saisonale Verbote erlassen.",
    links: [
      { label: "BAZL Drohnen-Infoseite", url: "https://www.bazl.admin.ch/bazl/de/home/drohnen.html" },
    ],
    contacts: [
      { type: "email", label: "BAZL — Sektion UAS", value: "uas@bazl.admin.ch" },
    ],
  },
  ch_wohngebiete: {
    title: "Wohngebiete AuLaV (CH)",
    referenz: "BAZL — Aussenlande-Verordnung (AuLaV), SR 748.131.1",
    definition: "Dicht besiedelte Wohngebiete gem\u00e4ss AuLaV-Definition. Fl\u00fcge \u00fcber diesen Gebieten unterliegen besonderen Auflagen.",
    abstandsregel: "Abh\u00e4ngig von Drohnenkategorie und -gewicht",
    betriebsvoraussetzung: "In der offenen Kategorie (A1/A3) gelten Einschr\u00e4nkungen \u00fcber Menschenansammlungen. F\u00fcr die Unterkategorien A2 gelten Mindestabst\u00e4nde zu unbeteiligten Personen.",
    links: [
      { label: "BAZL Drohnen-Infoseite", url: "https://www.bazl.admin.ch/bazl/de/home/drohnen.html" },
    ],
    contacts: [
      { type: "email", label: "BAZL — Sektion UAS", value: "uas@bazl.admin.ch" },
    ],
  },
  lu_uas_0_50: {
    title: "UAS-Zonen 0\u201350\u00a0m (LU)",
    referenz: "Art. 15 DVO (EU) 2019/947 / R\u00e8glement minist\u00e9riel du 16 d\u00e9cembre 2020",
    definition: "Gebiete in Luxemburg, in denen der Betrieb unbemannter Luftfahrzeuge von 0 bis 50\u00a0m H\u00f6he eingeschr\u00e4nkt oder verboten ist. Umfasst Flughafen Findel (ELLX), Residenzen, Haftanstalten, Milit\u00e4rgelände und weitere sensible Bereiche.\n\nFarbcodierung der Karte:\n\u2022 Rot: Aktive Zone \u2014 UAS-Flug verboten/genehmigungspflichtig\n\u2022 Gelb: Demnächst aktiv \u2014 Zone wird in Kürze aktiviert\n\u2022 Grau: Inaktiv \u2014 Zone existiert, aktuell keine Beschr\u00e4nkung",
    abstandsregel: "5 km Flughafen Findel \u2014 2 km Hubschrauberlandeplätze/Flugplätze",
    betriebsvoraussetzung: "Drei Arten von Beschr\u00e4nkungen:\n\u2022 PROHIBITED (Verboten): Jeglicher UAS-Betrieb untersagt\n\u2022 REQ_AUTHORISATION (Genehmigungspflichtig): Genehmigung der DAC oder ATC erforderlich\n\u2022 CONDITIONAL (Unter Auflagen): Meldepflicht oder Bedingungen\n\nGeo-Awareness: Vor jedem Flug JSON-Datei von drones.geoportail.lu/zones in das UAS laden (C1/C2/C3 Pflicht).\n\nVersicherung: Seit Loi du 20 d\u00e9cembre 2024 f\u00fcr alle Betreiber obligatorisch.\n\nStrafe: Bis zu 1 Jahr Freiheitsstrafe und 5.000 \u20ac Geldstrafe.",
    hinweis: "WICHTIG: Die Geozonen des Drohnenherstellers auf der Fernsteuerung decken NICHT unbedingt alle Beschr\u00e4nkungsgebiete Luxemburgs ab. Es findet KEIN automatischer Datenaustausch zwischen Hersteller und G\u00e9oportail statt.\n\nNur die Zonen auf g-o.lu/uas sind rechtlich verbindlich.\n\nDie Karte wird alle 5 Minuten aktualisiert. Durchschnittlich ca. 2.000 Aktivierungen pro Monat.\n\nRegistrierung: Pflicht f\u00fcr alle UAS-Betreiber \u00fcber MyGuichet.lu.\n\nKontrollzone Findel (ELLX): Freigabe \u00fcber DAC/ATC erforderlich.",
    links: [
      { label: "Offizielle UAS-Zonenkarte (g-o.lu/uas)", url: "https://g-o.lu/uas" },
      { label: "DAC Geozonen-Infoseite", url: "https://dac.gouvernement.lu/en/drones/geozones.html" },
      { label: "Benutzerhandbuch G\u00e9oportail (DE, PDF)", url: "https://dac.gouvernement.lu/dam-assets/documents/drones/zoneuas/241216-quick-user-guide-de.pdf" },
      { label: "G\u00e9oportail UAS-Zonen (Vollansicht)", url: "https://map.geoportail.lu/theme/drones" },
      { label: "JSON-Feed (Geo-Awareness, ED-269)", url: "https://drones.geoportail.lu/zones" },
      { label: "Open Data (GeoJSON)", url: "https://data.public.lu/en/datasets/uas-geographical-zones-grand-duchy-of-luxembourg-zones-geographiques-uas-grand-duche-de-luxembourg/" },
      { label: "DAC Drohnen-Hauptseite", url: "https://dac.gouvernement.lu/en/drones.html" },
      { label: "Loi du 20 d\u00e9cembre 2024 (Legilux)", url: "https://legilux.public.lu/eli/etat/leg/loi/2024/12/20/a747/jo" },
      { label: "R\u00e8glement minist\u00e9riel du 16.12.2020 (Legilux)", url: "https://legilux.public.lu/eli/etat/leg/rmin/2020/12/16/a1028/jo" },
    ],
    contacts: [
      { type: "email", label: "DAC — UAS allgemein", value: "uas@av.etat.lu" },
      { type: "email", label: "DAC — Geographische Zonen", value: "uas.zones@av.etat.lu" },
      { type: "email", label: "DAC — Schulung/Prüfungen", value: "uas.training@av.etat.lu" },
      { type: "phone", label: "DAC — Zentrale", value: "+35224782480" },
      { type: "web", label: "DAC Drohnen-Portal", value: "https://dac.gouvernement.lu/en/drones.html" },
    ],
  },
  lu_uas_50_120: {
    title: "UAS-Zonen 50\u2013120\u00a0m (LU)",
    referenz: "Art. 15 DVO (EU) 2019/947 / R\u00e8glement minist\u00e9riel du 16 d\u00e9cembre 2020",
    definition: "Gebiete in Luxemburg mit Einschr\u00e4nkungen f\u00fcr den UAS-Betrieb in H\u00f6hen von 50 bis 120\u00a0m. Zusätzliche Beschr\u00e4nkungen gelten in der N\u00e4he von Flugpl\u00e4tzen und im unkontrollierten Luftraum.\n\nFarbcodierung identisch zur 0\u201350 m Schicht (Rot/Gelb/Grau).",
    abstandsregel: "50\u2013120\u00a0m AGL — zonenabh\u00e4ngig",
    betriebsvoraussetzung: "Betrieb mit erweiterter Genehmigung oder in der speziellen Kategorie. In Kontrollzonen Freigabe der DAC/ATC erforderlich.\n\nGeo-Awareness-Datei vor jedem Flug aktualisieren (drones.geoportail.lu/zones).",
    links: [
      { label: "Offizielle UAS-Zonenkarte (g-o.lu/uas)", url: "https://g-o.lu/uas" },
      { label: "DAC Geozonen-Infoseite", url: "https://dac.gouvernement.lu/en/drones/geozones.html" },
      { label: "Benutzerhandbuch G\u00e9oportail (DE, PDF)", url: "https://dac.gouvernement.lu/dam-assets/documents/drones/zoneuas/241216-quick-user-guide-de.pdf" },
      { label: "G\u00e9oportail UAS-Zonen (Vollansicht)", url: "https://map.geoportail.lu/theme/drones" },
    ],
    contacts: [
      { type: "email", label: "DAC — UAS allgemein", value: "uas@av.etat.lu" },
      { type: "email", label: "DAC — Geographische Zonen", value: "uas.zones@av.etat.lu" },
      { type: "phone", label: "DAC — Zentrale", value: "+35224782480" },
    ],
  },
  nl_no_fly_zones: {
    title: "Flugverbotszonen (NL)",
    referenz: "Verordnung für ferngesteuerte Luftfahrzeuge (RBML) / EU 2019/947",
    definition: "Drohnen-Flugverbotszonen der Niederlande, bereitgestellt durch LVNL (Luchtverkeersleiding Nederland) \u00fcber PDOK. Umfasst CTR, Sperrgebiete, Beschr\u00e4nkungsgebiete und sonstige No-fly-Zonen.",
    abstandsregel: "Zonenabh\u00e4ngig \u2014 siehe Kartendetails",
    betriebsvoraussetzung: "In Kontrollzonen (CTR) und Sperrgebieten ist der Drohnenbetrieb grunds\u00e4tzlich verboten. Ausnahmen erfordern eine Genehmigung der ILT (Inspectie Leefomgeving en Transport) oder eine Freigabe der LVNL. Die EU-Drohnenverordnung gilt unmittelbar.",
    hinweis: "Registrierung: Pflicht f\u00fcr alle UAS-Betreiber \u00fcber das EASA-Portal oder das niederl\u00e4ndische Registrierungssystem.\n\nDie Niederlande verwenden das PDOK-System (Publieke Dienstverlening Op de Kaart) f\u00fcr die Bereitstellung geographischer UAS-Zonen.\n\nSchiphol CTR: Besonders gro\u00dfe Kontrollzone \u2014 Drohnenflug nur mit ausdr\u00fccklicher LVNL-Freigabe.",
    links: [
      { label: "GoDrone.nl \u2014 Offizielle Drohnenkarte", url: "https://map.godrone.nl/" },
      { label: "ILT \u2014 Drohnen-Infoseite", url: "https://www.ilent.nl/onderwerpen/drones" },
      { label: "PDOK No-fly-Zonen", url: "https://www.pdok.nl/introductie/-/article/no-fly-zones-voor-drones" },
    ],
    contacts: [
      { type: "web", label: "ILT \u2014 Inspectie Leefomgeving en Transport", value: "https://www.ilent.nl/onderwerpen/drones" },
      { type: "web", label: "LVNL \u2014 Luchtverkeersleiding Nederland", value: "https://www.lvnl.nl/" },
    ],
  },
  nl_no_fly_ohne_natura: {
    title: "Flugverbotszonen ohne Natura2000 (NL)",
    referenz: "Verordnung für ferngesteuerte Luftfahrzeuge (RBML) / EU 2019/947",
    definition: "Drohnen-Flugverbotszonen der Niederlande ohne Natura-2000-Schutzgebiete. Zeigt nur CTR, Sperrgebiete, Beschr\u00e4nkungsgebiete und vitale Infrastruktur.",
    abstandsregel: "Zonenabh\u00e4ngig \u2014 siehe Kartendetails",
    betriebsvoraussetzung: "In Kontrollzonen (CTR) und Sperrgebieten ist der Drohnenbetrieb grunds\u00e4tzlich verboten. Ausnahmen erfordern eine Genehmigung der ILT oder eine Freigabe der LVNL.",
    hinweis: "Dieser Layer blendet Natura-2000-Schutzgebiete aus und zeigt nur die direkt f\u00fcr den Drohnenbetrieb relevanten Einschr\u00e4nkungen.",
    links: [
      { label: "GoDrone.nl \u2014 Offizielle Drohnenkarte", url: "https://map.godrone.nl/" },
      { label: "ILT \u2014 Drohnen-Infoseite", url: "https://www.ilent.nl/onderwerpen/drones" },
    ],
    contacts: [
      { type: "web", label: "ILT \u2014 Inspectie Leefomgeving en Transport", value: "https://www.ilent.nl/onderwerpen/drones" },
    ],
  },
  nl_natura2000: {
    title: "Natura 2000 (NL)",
    referenz: "Wet natuurbescherming / Richtlinie 92/43/EWG (FFH) + 2009/147/EG (Vogelschutz)",
    definition: "EU-Schutzgebiete (Natura 2000): Vogelschutz- und FFH-Gebiete in den Niederlanden. Quelle: PDOK (RVO).",
    abstandsregel: "Abhängig vom Beheerplan des jeweiligen Gebiets — meist Flugverbot oder strenge Auflagen.",
    betriebsvoraussetzung: "Drohnenbetrieb in Natura-2000-Gebieten ist oft komplett untersagt oder genehmigungspflichtig. Die spezifischen Regeln pro Gebiet stehen im Beheerplan (Bewirtschaftungsplan) der zuständigen Provinz oder Rijkswaterstaat.",
    hinweis: "Auf godrone.nl als gelbe 'NATURE CONSERVATION AREA' sichtbar. Provinzen oder Rijkswaterstaat (für Nordsee, Wattenmeer, Delta, IJsselmeer) sind die zuständigen Behörden. Verstöße können nach Wet natuurbescherming geahndet werden.",
    links: [
      { label: "Natura 2000 NL — Beheerplannen", url: "https://www.bij12.nl/onderwerp/natuurinformatie/natura-2000-beheerplannen/" },
      { label: "Rijkswaterstaat — Gebiete", url: "https://iwsnatura2000.nl/Gebieden/default.aspx" },
      { label: "GoDrone.nl — Offizielle Drohnenkarte", url: "https://map.godrone.nl/" },
    ],
    contacts: [
      { type: "web", label: "BIJ12 — Natura 2000 Info", value: "https://www.bij12.nl/onderwerp/natuurinformatie/" },
    ],
  },
  nl_nnn: {
    title: "Natuurnetwerk Nederland (NNN)",
    referenz: "Wet natuurbescherming / Omgevingswet — Provinziale Naturschutzgebiete",
    definition: "Nationales Naturschutznetzwerk der Niederlande, verwaltet durch die Provinzen (BIJ12). Umfasst Gebiete, die NICHT unter Natura 2000 fallen, aber dennoch geschützt sind (z. B. Duinen Goeree, Volgerland).",
    abstandsregel: "Provinz- und gebietsabhängig — meist Überflug nur mit Genehmigung der zuständigen Provinz oder bei Vermeidung tieffliegender Störung der Tierwelt.",
    betriebsvoraussetzung: "Vor Drohnenbetrieb in NNN-Gebieten ist die zuständige Provinz zu kontaktieren. Brutzeiten (März–Juli) sind besonders sensibel. Manche Provinzen haben eigene Drohnen-Verordnungen (z. B. Zuid-Holland).",
    hinweis: "Auf godrone.nl als gelbe 'GROUND HAZARD: Nature Reserve' sichtbar. Verstöße können nach Wet natuurbescherming / Omgevingswet geahndet werden. Provinz und Gebietsbeheerder (z. B. Staatsbosbeheer, Natuurmonumenten, Provinciale Landschappen) sind die zuständigen Stellen.",
    links: [
      { label: "BIJ12 — Natuurnetwerk Nederland", url: "https://www.bij12.nl/onderwerp/natuurinformatie/natuurnetwerk-nederland/" },
      { label: "PDOK Dataset — NNN Provincies", url: "https://www.pdok.nl/introductie/-/article/natuurnetwerk-nederland-nnn-" },
      { label: "GoDrone.nl — Offizielle Drohnenkarte", url: "https://map.godrone.nl/" },
    ],
    contacts: [
      { type: "web", label: "BIJ12 — Provinz-Kontakte", value: "https://www.bij12.nl/contact/" },
    ],
  },
  nl_landingsite: {
    title: "Landepl\u00e4tze (NL)",
    referenz: "PDOK / LVNL",
    definition: "Registrierte Landepl\u00e4tze in den Niederlanden.",
    abstandsregel: "Standortabh\u00e4ngig",
    betriebsvoraussetzung: "Start- und Landepl\u00e4tze \u2014 informative Ebene.",
    hinweis: "Informative Ebene der PDOK-Drohnenkarte.",
    links: [
      { label: "GoDrone.nl \u2014 Offizielle Drohnenkarte", url: "https://map.godrone.nl/" },
    ],
    contacts: [],
  },
  fr_restrictions: {
    title: "Drohnen-Beschr\u00e4nkungen (FR)",
    referenz: "DGAC \u2014 Arr\u00eat\u00e9 du 3 d\u00e9cembre 2020 / Code des transports / DVO (EU) 2019/947",
    definition: "Gebiete in Frankreich, in denen der Betrieb unbemannter Luftfahrzeuge eingeschr\u00e4nkt oder verboten ist. Die von der DGAC \u00fcber G\u00e9oportail bereitgestellten Restriktionen umfassen Flughafen-Umgebungen (CTR), milit\u00e4rische Sperrgebiete, Atomanlagen, St\u00e4dte/Ballungsr\u00e4ume, Nationalparks und weitere sensible Bereiche.\n\nDie Karte unterscheidet typischerweise H\u00f6henstufen (z.\u00a0B. Flugverbot, max. 30\u00a0m, max. 50\u00a0m, max. 100\u00a0m). Die konkrete H\u00f6hengrenze (limite) und etwaige Bemerkungen (remarque) der angeklickten Zone stehen in den Kartendetails oben.",
    abstandsregel: "Zonenabh\u00e4ngig \u2014 H\u00f6hengrenze (limite) und Bemerkung (remarque) der jeweiligen Zone beachten",
    betriebsvoraussetzung: "Frankreich wendet die EU-Drohnenverordnung (EU) 2019/947 an. In der offenen Kategorie gelten die Unterkategorien A1/A2/A3 mit max. 120\u00a0m H\u00f6he \u00fcber Grund.\n\nIn ausgewiesenen Beschr\u00e4nkungsgebieten ist der Betrieb nur unter den angegebenen Bedingungen (reduzierte H\u00f6he) oder mit Genehmigung zul\u00e4ssig. In Kontrollzonen (CTR) ist eine Abstimmung mit der Flugsicherung (SNA/DSAC) erforderlich; \u00fcber St\u00e4dten und Menschenansammlungen gelten besondere Auflagen.\n\nRegistrierung: Betreiber und (ab 800\u00a0g bzw. mit Kamera) Drohnen m\u00fcssen \u00fcber AlphaTango registriert werden. Fernpiloten ben\u00f6tigen das Online-Training und ggf. das A2-Zertifikat.",
    hinweis: "WICHTIG: Die Geozonen auf der Fernsteuerung des Drohnenherstellers decken nicht zwingend alle franz\u00f6sischen Beschr\u00e4nkungsgebiete ab. Verbindlich ist allein die offizielle DGAC-Karte auf G\u00e9oportail (TRANSPORTS.DRONES.RESTRICTIONS).\n\nNeben den hier dargestellten WMS-Zonen k\u00f6nnen tempor\u00e4re Beschr\u00e4nkungen (NOTAM / ZRT / ZIT) gelten \u2014 vor dem Flug stets aktuelle NOTAMs pr\u00fcfen.\n\nMilit\u00e4rische und besonders sensible Bereiche (z.\u00a0B. Atomanlagen, Gef\u00e4ngnisse) k\u00f6nnen vollst\u00e4ndiges Flugverbot bedeuten. Bei Genehmigungsbedarf ist die zust\u00e4ndige DSAC-Regionaldirektion bzw. die Pr\u00e4fektur zu kontaktieren.",
    links: [
      { label: "G\u00e9oportail \u2014 Drohnen-Restriktionskarte", url: "https://www.geoportail.gouv.fr/donnees/restrictions-pour-drones-de-loisir" },
      { label: "AlphaTango (Registrierung Betreiber/Drohnen)", url: "https://alphatango.aviation-civile.gouv.fr/" },
      { label: "DGAC \u2014 Drohnen-Infoseite", url: "https://www.ecologie.gouv.fr/drones-usages-loisir-ou-professionnel" },
      { label: "Service-public.fr \u2014 Drohnenregeln", url: "https://www.service-public.fr/particuliers/vosdroits/F34630" },
      { label: "Online-Training Fernpilot (Fox AlphaTango)", url: "https://fox-alphatango.aviation-civile.gouv.fr/" },
    ],
    contacts: [
      { type: "web", label: "DGAC \u2014 Drohnen-Portal", value: "https://www.ecologie.gouv.fr/drones-usages-loisir-ou-professionnel" },
      { type: "web", label: "AlphaTango \u2014 Registrierungsportal", value: "https://alphatango.aviation-civile.gouv.fr/" },
    ],
  },
};

// Zonenspezifische Kontakte fuer einzelne ED-R (Schluessel = ED-R-Nummer) bzw.
// CTR (Schluessel = CTR-Bezeichnung). Reine Datenquelle, damit sowohl die
// Mobile-App (client/lib/geozones.ts) als auch das Web-Frontend dieselben
// Betreiber-/Tower-Kontakte anzeigen koennen.
export const EDR_ZONE_CONTACTS: Record<string, GeozoneContact[]> = {
  "401": [
    { type: "email", label: "Betreiber — ED-R 401 Brunsbüttel", value: "kkw-brunsbuettel@vattenfall.de" },
    { type: "phone", label: "Betreiber — ED-R 401 Brunsbüttel", value: "+494852880" },
  ],
  "402": [
    { type: "email", label: "Betreiber — ED-R 402 Krümmel", value: "kkw-kruemmel@vattenfall.de" },
    { type: "phone", label: "Betreiber — ED-R 402 Krümmel", value: "+4941529370" },
  ],
  "403": [
    { type: "email", label: "Betreiber — ED-R 403 Brokdorf", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 403 Brokdorf", value: "+494829760" },
  ],
  "404": [
    { type: "email", label: "Betreiber — ED-R 404 Stade", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 404 Stade", value: "+4941416920" },
  ],
  "405": [
    { type: "email", label: "Betreiber — ED-R 405 Unterweser", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 405 Unterweser", value: "+494735770" },
  ],
  "406": [
    { type: "email", label: "Betreiber — ED-R 406 Grohnde", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 406 Grohnde", value: "+495155670" },
  ],
  "407": [
    { type: "email", label: "Betreiber — ED-R 407 Lingen", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 407 Lingen", value: "+4959160020" },
  ],
  "409": [
    { type: "email", label: "Betreiber — ED-R 409 Hamm-Uentrop", value: "kontakt@htrgmbh.de" },
    { type: "phone", label: "Betreiber — ED-R 409 Hamm-Uentrop", value: "+492388370" },
  ],
  "411": [
    { type: "email", label: "Betreiber — ED-R 411 Würgassen", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 411 Würgassen", value: "+49527140030" },
  ],
  "412": [
    { type: "email", label: "Betreiber — ED-R 412 Jülich", value: "info@fz-juelich.de" },
    { type: "phone", label: "Betreiber — ED-R 412 Jülich", value: "+492461610" },
  ],
  "413": [
    { type: "email", label: "Betreiber — ED-R 413 Mülheim-Kärlich", value: "info@rwe.com" },
    { type: "phone", label: "Betreiber — ED-R 413 Mülheim-Kärlich", value: "+492637640" },
  ],
  "415": [
    { type: "email", label: "Betreiber — ED-R 415 Philippsburg", value: "poststelle@enbw.com" },
    { type: "phone", label: "Betreiber — ED-R 415 Philippsburg", value: "+497256930" },
  ],
  "417": [
    { type: "email", label: "Betreiber — ED-R 417 Obrigheim", value: "poststelle@enbw.com" },
    { type: "phone", label: "Betreiber — ED-R 417 Obrigheim", value: "+496261860" },
  ],
  "418": [
    { type: "email", label: "Betreiber — ED-R 418 Biblis", value: "info@rwe.com" },
    { type: "phone", label: "Betreiber — ED-R 418 Biblis", value: "+496245280" },
  ],
  "419": [
    { type: "email", label: "Betreiber — ED-R 419 Grafenrheinfeld", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 419 Grafenrheinfeld", value: "+499723710" },
  ],
  "420": [
    { type: "email", label: "Betreiber — ED-R 420 Karlstein", value: "kontakt@framatome.com" },
    { type: "phone", label: "Betreiber — ED-R 420 Karlstein", value: "+496023910" },
  ],
  "421": [
    { type: "email", label: "Betreiber — ED-R 421 Isar", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 421 Isar", value: "+498702380" },
  ],
  "422": [
    { type: "email", label: "Betreiber — ED-R 422 Gundremmingen", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 422 Gundremmingen", value: "+498282820" },
  ],
  "423": [
    { type: "email", label: "Betreiber — ED-R 423 Garching", value: "info@frm2.tum.de" },
    { type: "phone", label: "Betreiber — ED-R 423 Garching", value: "+498928914700" },
  ],
  "424": [
    { type: "email", label: "Betreiber — ED-R 424 Neckarwestheim", value: "poststelle@enbw.com" },
    { type: "phone", label: "Betreiber — ED-R 424 Neckarwestheim", value: "+497133180" },
  ],
  "427": [
    { type: "email", label: "Betreiber — ED-R 427 Geesthacht", value: "kontakt@hereon.de" },
    { type: "phone", label: "Betreiber — ED-R 427 Geesthacht", value: "+4941527010" },
  ],
  "450": [
    { type: "email", label: "Betreiber — ED-R 450 Wartburg", value: "info@wartburg.de" },
    { type: "phone", label: "Betreiber — ED-R 450 Wartburg", value: "+493691250" },
  ],
  "451": [
    { type: "email", label: "Betreiber — ED-R 451 Greifswald", value: "info@ewn-gmbh.de" },
    { type: "phone", label: "Betreiber — ED-R 451 Greifswald", value: "+49383486150" },
  ],
  "452": [
    { type: "email", label: "Betreiber — ED-R 452 Rheinsberg", value: "info@ewn-gmbh.de" },
    { type: "phone", label: "Betreiber — ED-R 452 Rheinsberg", value: "+49338318210" },
  ],
  "453": [
    { type: "email", label: "Betreiber — ED-R 453 Rossendorf", value: "kontakt@vkta.de" },
    { type: "phone", label: "Betreiber — ED-R 453 Rossendorf", value: "+493512600" },
  ],
  "146": [
    { type: "email", label: "BAF — ED-R 146 Berlin", value: "drohne@baf.bund.de" },
    { type: "phone", label: "BAF — ED-R 146 Berlin", value: "+496103707290" },
  ],
};

// Austro Control veröffentlicht auf der offiziellen Dronespace-FAQ E-Mail und
// Telefonnummer für allgemeine Fragen zum Dronespace-System, aber keine
// zonenspezifischen Tower-Kontakte. Daher werden diese Kanäle für AT-CTRs
// ausdrücklich als allgemeiner Support gekennzeichnet, nicht als lokale Stelle.
// Quellen:
// - https://www.dronespace.at/faq
// - https://www.dronespace.at/dronespace_app (Online-Karte/Freigaben)
const AUSTRO_CONTROL_CTR_CONTACTS: GeozoneContact[] = [
  {
    type: "email",
    label: "Austro Control Dronespace — allgemeine Fragen (keine lokale CTR-Zuordnung)",
    value: "dronespace@austrocontrol.at",
  },
  {
    type: "phone",
    label: "Austro Control Dronespace — allgemeine Fragen (keine lokale CTR-Zuordnung)",
    value: "+43517037111",
  },
  {
    type: "web",
    label: "Dronespace-Freigabe nur für Austro-Control-verwaltete CTRs (keine lokale Zuordnung)",
    value: "https://utm.dronespace.at/avm/",
  },
];

export const CTR_ZONE_CONTACTS: Record<string, GeozoneContact[]> = {
  "Berlin Brandenburg": [
    { type: "email", label: "DFS — Berlin Brandenburg (BER)", value: "tower-ber@dfs.de" },
    { type: "phone", label: "DFS — Berlin Brandenburg (BER)", value: "+493060916131" },
  ],
  "Bremen": [
    { type: "email", label: "DFS — Bremen (BRE)", value: "tower-bre@dfs.de" },
    { type: "phone", label: "DFS — Bremen (BRE)", value: "+494215592451" },
  ],
  "Dresden": [
    { type: "email", label: "DFS — Dresden (DRS)", value: "tower-drs@dfs.de" },
    { type: "phone", label: "DFS — Dresden (DRS)", value: "+493512131146" },
  ],
  "Düsseldorf": [
    { type: "email", label: "DFS — Düsseldorf (DUS)", value: "tower-dus@dfs.de" },
    { type: "phone", label: "DFS — Düsseldorf (DUS)", value: "+492114212451" },
  ],
  "Erfurt": [
    { type: "email", label: "DFS — Erfurt-Weimar (ERF)", value: "tower-erf@dfs.de" },
    { type: "phone", label: "DFS — Erfurt-Weimar (ERF)", value: "+493614580201" },
  ],
  "Frankfurt Main": [
    { type: "email", label: "DFS — Frankfurt Main (FRA)", value: "tower-fra@dfs.de" },
    { type: "phone", label: "DFS — Frankfurt Main (FRA)", value: "+496969024451" },
  ],
  "Hamburg": [
    { type: "email", label: "DFS — Hamburg (HAM)", value: "tower-ham@dfs.de" },
    { type: "phone", label: "DFS — Hamburg (HAM)", value: "+4940507522451" },
  ],
  "Hannover": [
    { type: "email", label: "DFS — Hannover (HAJ)", value: "tower-haj@dfs.de" },
    { type: "phone", label: "DFS — Hannover (HAJ)", value: "+495119772451" },
  ],
  "Köln": [
    { type: "email", label: "DFS — Köln/Bonn (CGN)", value: "tower-cgn@dfs.de" },
    { type: "phone", label: "DFS — Köln/Bonn (CGN)", value: "+492203402451" },
  ],
  "Leipzig": [
    { type: "email", label: "DFS — Leipzig/Halle (LEJ)", value: "tower-lej@dfs.de" },
    { type: "phone", label: "DFS — Leipzig/Halle (LEJ)", value: "+493412240451" },
  ],
  "München": [
    { type: "email", label: "DFS — München (MUC)", value: "tower-muc@dfs.de" },
    { type: "phone", label: "DFS — München (MUC)", value: "+498997524451" },
  ],
  "Münster": [
    { type: "email", label: "DFS — Münster/Osnabrück (FMO)", value: "tower-fmo@dfs.de" },
    { type: "phone", label: "DFS — Münster/Osnabrück (FMO)", value: "+492571940451" },
  ],
  "Nürnberg": [
    { type: "email", label: "DFS — Nürnberg (NUE)", value: "tower-nue@dfs.de" },
    { type: "phone", label: "DFS — Nürnberg (NUE)", value: "+49911935451" },
  ],
  "Saarbrücken": [
    { type: "email", label: "DFS — Saarbrücken (SCN)", value: "tower-scn@dfs.de" },
    { type: "phone", label: "DFS — Saarbrücken (SCN)", value: "+496893832451" },
  ],
  "Stuttgart": [
    { type: "email", label: "DFS — Stuttgart (STR)", value: "tower-str@dfs.de" },
    { type: "phone", label: "DFS — Stuttgart (STR)", value: "+497117948451" },
  ],
  "Braunschweig": [
    { type: "email", label: "DFS Aviation — Braunschweig (BWE)", value: "TWR-BWE@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Braunschweig (BWE)", value: "+495312952391" },
  ],
  "Dortmund": [
    { type: "email", label: "DFS Aviation — Dortmund (DTM)", value: "TWR-DTM@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Dortmund (DTM)", value: "+492319211024" },
  ],
  "Friedrichshafen": [
    { type: "email", label: "DFS Aviation — Friedrichshafen (FDH)", value: "TWR-FDH@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Friedrichshafen (FDH)", value: "+497541284251" },
  ],
  "Karlsruhe": [
    { type: "email", label: "DFS Aviation — Karlsruhe/Baden-Baden (FKB)", value: "TWR-FKB@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Karlsruhe/Baden-Baden (FKB)", value: "+497229662821" },
  ],
  "Lahr": [
    { type: "email", label: "DFS Aviation — Lahr (LHA)", value: "TWR-LHA@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Lahr (LHA)", value: "+497821959110" },
  ],
  // Magdeburg-Cochstedt ist nicht in der Flughafenliste der NfL 2026-1-3981
  // enthalten und wird deshalb hier keinem Anbieter dieser CTR-Verfügungen
  // zugeordnet.
  "Magdeburg": [],
  "Memmingen": [
    { type: "email", label: "DFS Aviation — Memmingen (FMM)", value: "TWR-FMM@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Memmingen (FMM)", value: "+498331984421" },
  ],
  "Mönchengladbach": [
    { type: "email", label: "DFS Aviation — Mönchengladbach (MGL)", value: "TWR-MGL@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Mönchengladbach (MGL)", value: "+492161682920" },
  ],
  "Niederrhein": [
    { type: "email", label: "DFS Aviation — Niederrhein/Weeze (NRN)", value: "TWR-NRN@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Niederrhein/Weeze (NRN)", value: "+492837664991" },
  ],
  "Paderborn": [
    { type: "email", label: "DFS Aviation — Paderborn-Lippstadt (PAD)", value: "TWR-PAD@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Paderborn-Lippstadt (PAD)", value: "+492955774251" },
  ],
  // NfL 2024-1-3081 belegt Austro Control als Anbieter an diesen CTRs.
  // Die bisherige Sammeladresse flugplatzkontrolle@uas-betrieb.de ist dort
  // nicht als Kontakt genannt und wird daher nicht als Ansprechpartner gezeigt.
  "Augsburg": [],
  "Frankfurt/Hahn": [],
  "Heringsdorf": [],
  "Lübeck": [],
  "Hof": [],
  "Kassel": [],
  "Sylt": [],
  "Oberpfaffenhofen": [
    { type: "email", label: "TRIAC — Oberpfaffenhofen (OBF)", value: "uas@triac-gmbh.de" },
    { type: "phone", label: "TRIAC — Oberpfaffenhofen (OBF)", value: "+498153282116" },
  ],
};

// Pure Aufloesung zonenspezifischer Kontakte direkt ueber die Layer-ID (=
// Schluessel in GEOZONE_REGULATORY_INFO). Liefert fuer ED-R/CTR die konkreten
// Betreiber-/Tower-Kontakte, sonst die Fallback-Kontakte des Layers. Ohne
// React-Native-Abhaengigkeiten, daher auch im Web nutzbar.
export function getContactsForLayerId(layerId: string, zoneName?: string, countryIso?: string | null): GeozoneContact[] {
  const regInfo = GEOZONE_REGULATORY_INFO[layerId];
  const fallbackContacts = regInfo?.contacts || [];

  if (layerId === "flugbeschraenkungsgebiete") {
    if (!zoneName) return fallbackContacts;
    const m = zoneName.match(/ED-R\s+(\d+)/i);
    if (m) {
      const zoneContacts = EDR_ZONE_CONTACTS[m[1]];
      if (zoneContacts) return zoneContacts;
    }
    return fallbackContacts;
  }

  if (layerId === "kontrollzonen") {
    const iso = countryIso?.toUpperCase();
    // Österreichische CTRs erhalten ausschließlich die amtlich veröffentlichten
    // allgemeinen Dronespace-Kanäle. Es gibt hier keine verifizierte Zuordnung
    // zu einem lokalen Tower; die Kennzeichnung oben macht das ausdrücklich.
    if (iso === "AT") return AUSTRO_CONTROL_CTR_CONTACTS;
    // Die CTR-Tabelle darunter enthält deutsche DFS-/Flugplatzkontakte. Ohne
    // bestätigtes DE dürfen diese weder als Fallback noch per Namens-Treffer
    // erscheinen.
    if (iso !== "DE") return [];
    if (!zoneName) return fallbackContacts;

    const ctrName = zoneName.replace(/^CTR\s+/i, "").replace(/\s*\(.*$/, "").trim().toLowerCase();
    const keys = Object.keys(CTR_ZONE_CONTACTS);
    const exact = keys.find((k) => k.toLowerCase() === ctrName);
    if (exact) return CTR_ZONE_CONTACTS[exact];
    const sorted = [...keys].sort((a, b) => b.length - a.length);
    for (const key of sorted) {
      if (ctrName.includes(key.toLowerCase())) {
        return CTR_ZONE_CONTACTS[key];
      }
    }
    return fallbackContacts;
  }

  return fallbackContacts;
}
