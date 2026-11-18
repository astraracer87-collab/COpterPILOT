// Landesluftfahrtbehörden der 16 Bundesländer: Kontakt sowie Eckdaten zu Einzel- und
// Allgemeinerlaubnis (§ 21i LuftVO) – Gebühren, Bearbeitungszeiten, Formulare.
// Stand der Recherche: 2026-09-08. Datenquelle siehe Einstellungen → Datenquellen.
// Verbindlich ist stets die zuständige Behörde; „uncertain" markiert ungesicherte Angaben.

export interface StateAuthorityOffice {
  name: string;
  coverage?: string;
  address?: string;
  email?: string;
  phone?: string;
  web?: string;
  hours?: string;
}
export interface StatePermit {
  available: boolean;
  feeText?: string;
  processingText?: string;
  leadTimeText?: string;
  formUrl?: string;
  onlineUrl?: string;
  validityText?: string;
  requiresA2?: boolean;
  recognition?: boolean;
}
export interface StateAuthority {
  /** Kürzel des Bundeslandes (z. B. "BY"). */
  code: string;
  name: string;
  authorities: StateAuthorityOffice[];
  /** Einzelerlaubnis (§ 21i). */
  individual?: StatePermit;
  /** Gemeinsame geografische Allgemeinerlaubnis. */
  general?: StatePermit;
  attachments: string[];
  notes: string[];
  uncertain: string[];
  sources: string[];
}

/** Bundesweit geltende Hinweise und Formulare. */
export const STATE_AUTHORITIES_SHARED = {
  generalPermitFormUrl: "https://www.dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/antrag-allgemeinerlaubnis.pdf",
  dipulUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  notes: ["Zuständig ist die Behörde des Flugorts, nicht des Wohnsitzes.", "Kontrollzonen sind nie Teil der § 21i-Erlaubnis – dafür ist eine Flugverkehrskontrollfreigabe der DFS nötig.", "Das gemeinsame Allgemeinerlaubnis-Formular der Länder verlangt mindestens das A2-Fernpilotenzeugnis."],
};

export const STATE_AUTHORITIES: StateAuthority[] = [
  {
    code: "BW", name: "Baden-Württemberg",
    authorities: [{ name: "Regierungspräsidium Stuttgart – Referat 46.2 Luftverkehr, SG Drohnen", coverage: "Ganz Baden-Württemberg", address: "Ruppmannstraße 21, 70565 Stuttgart", email: "bnl@rps.bwl.de", phone: "+49 711 904-14609", web: "https://rp.baden-wuerttemberg.de/themen/verkehr/luft/seiten/drohnen/", hours: "Mo–Fr 9–12 Uhr" }],
    individual: { available: true, feeText: "i. d. R. 250 €", processingText: "2–6 Wochen", formUrl: "https://rp.baden-wuerttemberg.de/fileadmin/RP-Internet/Themenportal/Verkehr/Luftverkehr/_DocumentLibraries/Documents/Drohnen/FOR_UAS_GeoEinzelerlaubnis_LuftVO.pdf", onlineUrl: "https://www.service-bw.de/zufi/leistungen/2467", requiresA2: true },
    general: { available: true, feeText: "200 € (Änderung 30 €, Anerkennung 50 €)", processingText: "2–14 Tage", formUrl: "https://rp.baden-wuerttemberg.de/fileadmin/RP-Internet/Themenportal/Verkehr/Luftverkehr/_DocumentLibraries/Documents/Drohnen/FOR_UAS_Antrag_Gemeins_geogr_Allgerlaubnis.pdf", validityText: "2 Jahre", requiresA2: true, recognition: true },
    attachments: ["map", "insurance", "competence", "eid", "consents"],
    notes: ["Allgemeinerlaubnis für Kitzrettung ist gebührenfrei.", "Naturschutzgebiete: Zustimmung der Naturschutzbehörde nötig, teils direkt ohne RP.", "Betriebsgenehmigung „speziell“ (SORA): ab 250 €, typisch 600 €, 4–16 Wochen."],
    uncertain: ["Ob der Online-Antrag über service-bw wirklich online eingereicht wird."],
    sources: ["https://rp.baden-wuerttemberg.de/themen/verkehr/luft/seiten/drohnen/", "https://www.service-bw.de/zufi/leistungen/2467"],
  },
  {
    code: "BY", name: "Bayern",
    authorities: [{ name: "Luftamt Südbayern (Regierung von Oberbayern, SG 25)", coverage: "Oberbayern, Niederbayern, Schwaben", address: "Postfach 24 14 42, 85336 München-Flughafen", email: "flugbetrieb@reg-ob.bayern.de", phone: "+49 89 2176-2280", web: "https://www.regierung.oberbayern.bayern.de/ueber_uns/zentralezustaendigkeiten/luftamt_suedbayern/index.html", hours: "Mo/Mi/Do 9–12, Di 13–15 Uhr" }, { name: "Luftamt Nordbayern (Regierung von Mittelfranken, SG 25)", coverage: "Oberpfalz, Oberfranken, Mittelfranken, Unterfranken", address: "Flughafenstraße 118, 90411 Nürnberg", email: "ufg@reg-mfr.bayern.de", phone: "+49 911 52700-34", web: "https://www.regierung.mittelfranken.bayern.de/aufgaben/40028/40082/leistung/leistung_50761/index.html" }],
    individual: { available: true, feeText: "50–3.500 € je Einzelfall", leadTimeText: "mindestens 10 Werktage vor dem Start", formUrl: "https://formularserver.bayern.de/intelliform/forms/stmi+regierungen/rob/luftamt/25-luftamt/rob_25-089/index", requiresA2: false },
    general: { available: false, requiresA2: false },
    attachments: ["map", "insurance", "competence", "eid", "consents"],
    notes: ["Die Allgemeinverfügung gilt sofort, ohne Kontakt zur Behörde – Nebenbestimmungen nachlesen.", "Bayerische Schlösserverwaltung verlangt eigene Drehgenehmigung für ihre Liegenschaften."],
    uncertain: ["Konkrete Anlagenliste und Bearbeitungsdauer nicht belegt."],
    sources: ["https://www.regierung.oberbayern.bayern.de/aufgaben/37200/37222/leistung/leistung_50761/index.html", "https://www.bayernportal.de/dokumente/leistung/351293774853"],
  },
  {
    code: "BE", name: "Berlin",
    authorities: [{ name: "Gemeinsame Obere Luftfahrtbehörde Berlin-Brandenburg (LuBB), Dezernat 42", coverage: "Berlin (und Brandenburg)", address: "Mittelstraße 5/5a, 12529 Schönefeld (Post: LBV, Lindenallee 51, 15366 Hoppegarten)", email: "uas@lbv.brandenburg.de", phone: "+49 3342 4266-4204", web: "https://lubb.berlin-brandenburg.de/aufgaben/nutzung-des-luftraums/unbemannte-fluggeraete/" }],
    individual: { available: true, feeText: "ca. 80–200 €", processingText: "2–6 Wochen", leadTimeText: "mindestens 18 Werktage vor dem Aufstieg", formUrl: "https://lubb.berlin-brandenburg.de/wp-content/uploads/FOR_UAS_GEO_REV13-42-2-2.pdf", requiresA2: false },
    general: { available: true, feeText: "200 € (Berlin) / 300 € (Berlin + Brandenburg); Verlängerung 100 € / 150 €", leadTimeText: "mindestens 18 Werktage", validityText: "max. 2 Jahre", requiresA2: true, recognition: false },
    attachments: ["map", "insurance", "competence", "eid", "consents"],
    notes: ["Kein Online-Verfahren – PDF per E-Mail, Post oder Fax.", "Allgemeingenehmigung deckt keine Gebiete mit Zustimmungserfordernis (Wohngrundstücke, Naturschutz).", "Keine Anerkennung von Allgemeinerlaubnissen anderer Länder.", "ED-R 146 Regierungsviertel: nur gewerblich; < 1,85 km um den Bundestag zusätzlich Antrag beim BAF.", "Kontrollzone Berlin: DFS Tower Berlin (tower-berlin@dfs.de).", "Start auf öffentlichem Grund: Sondernutzungserlaubnis des Bezirksamts."],
    uncertain: ["Gültigkeitsdauer der Einzelgenehmigung nicht belegt."],
    sources: ["https://lubb.berlin-brandenburg.de/aufgaben/nutzung-des-luftraums/unbemannte-fluggeraete/", "https://www.berlin.de/sen/uvk/mobilitaet-und-verkehr/verkehrsplanung/luftfahrt/unbemannte-luftfahrt/"],
  },
  {
    code: "BB", name: "Brandenburg",
    authorities: [{ name: "Gemeinsame Obere Luftfahrtbehörde Berlin-Brandenburg (LuBB), Dezernat 42", coverage: "Brandenburg (und Berlin)", address: "Mittelstraße 5/5a, 12529 Schönefeld (Post: LBV, Lindenallee 51, 15366 Hoppegarten)", email: "uas@lbv.brandenburg.de", phone: "+49 3342 4266-4221", web: "https://lubb.berlin-brandenburg.de/aufgaben/nutzung-des-luftraums/unbemannte-fluggeraete/" }],
    individual: { available: true, feeText: "ca. 80–200 €", processingText: "2–6 Wochen", leadTimeText: "mindestens 18 Werktage vor dem Aufstieg", formUrl: "https://lubb.berlin-brandenburg.de/wp-content/uploads/FOR_UAS_GEO_REV13-42-2-2.pdf", requiresA2: false },
    general: { available: true, feeText: "200 € (Brandenburg) / 300 € (beide Länder); Verlängerung 100 € / 150 €", processingText: "2–3 Wochen", leadTimeText: "mindestens 18 Werktage", validityText: "max. 2 Jahre", requiresA2: true, recognition: false },
    attachments: ["map", "insurance", "competence", "eid", "consents"],
    notes: ["Kein Online-Verfahren – PDF per E-Mail, Post oder Fax.", "Naturschutzgebiete/Nationalparks: Zustimmung der Naturschutzbehörde; öffentlicher Grund: örtliche Ordnungsbehörde.", "Flughafen BER: DFS-Freigabe.", "Keine Anerkennung von Allgemeinerlaubnissen anderer Länder."],
    uncertain: [],
    sources: ["https://lubb.berlin-brandenburg.de/aufgaben/nutzung-des-luftraums/unbemannte-fluggeraete/", "https://verwaltung.brandenburg.de/verwalt/en/details/?bus_id=110158935&bus_type=pst"],
  },
  {
    code: "HB", name: "Bremen",
    authorities: [{ name: "Die Senatorin für Wirtschaft, Häfen und Transformation – Referat 33 Luftfahrtbehörde", coverage: "Bremen und Bremerhaven", address: "Katharinenklosterhof 3, 28195 Bremen", email: "uas@haefen.bremen.de", phone: "+49 421 361-98210", web: "https://www.haefen.bremen.de/geozonen-luftvo-56209" }],
    individual: { available: true, feeText: "50–3.500 €, mindestens 200 €", processingText: "1–7 Tage", formUrl: "https://www.haefen.bremen.de/sixcms/media.php/13/FOR_UAS_GEO_REV14.pdf", onlineUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/", validityText: "max. 2 Jahre", requiresA2: false },
    general: { available: true, feeText: "200 € (Änderung 30 €, Anerkennung 50 €)", formUrl: "https://www.haefen.bremen.de/sixcms/media.php/13/Antrag%20Allgemeinerlaubnis%20REV%2012.pdf", validityText: "2 Jahre", requiresA2: true, recognition: true },
    attachments: ["map", "insurance", "competence", "eid", "consents"],
    notes: ["Naturschutzgebiete werden generell nicht freigegeben.", "Kontrollzone Bremen: DFS Tower Bremen (bnl-tower-bremen@dfs.de), mindestens 10 Tage vorher.", "25 m Seitenabstand zu Wasserfahrzeugen; Hafenanlagen nur mit Erlaubnis des Hafenamts."],
    uncertain: [],
    sources: ["https://www.haefen.bremen.de/geozonen-luftvo-56209", "https://www.service.bremen.de/dienstleistungen/genehmigung-fuer-den-betrieb-von-drohnen-in-geografischen-gebieten-beantragen-204805"],
  },
  {
    code: "HH", name: "Hamburg",
    authorities: [{ name: "Behörde für Wirtschaft, Arbeit und Innovation (BWAI) – Landesluftfahrtbehörde, Luftraum-Sondernutzung", coverage: "Hamburg", address: "Alter Steinweg 4, 20459 Hamburg", email: "luftraum-sondernutzung@bwai.hamburg.de", phone: "+49 40 5075-2600", web: "https://www.hamburg.de/go/drohnen" }],
    individual: { available: true, feeText: "100–200 €", processingText: "einzelfallabhängig", leadTimeText: "mindestens 1 Woche vor dem Einsatz", formUrl: "https://www.haefen.bremen.de/sixcms/media.php/13/FOR_UAS_GEO_REV14.pdf", onlineUrl: "https://www.hamburg.de/service/info/111099573/", requiresA2: false },
    general: { available: true, feeText: "200 € (Änderung 30 €, Anerkennung 50 €)", leadTimeText: "mindestens 1 Woche – auch bei Folgeanträgen (keine Verlängerung, neue Erlaubnis)", formUrl: "https://dokumente.hamburg.de/resource/blob/201292/71880e256b442f17969ea353741062e4/drohnen-for-uas-gemeinsame-allgemeinerlaubnis-luftvo-rev12-data.pdf", validityText: "2 Jahre", requiresA2: true, recognition: true },
    attachments: ["map", "insurance", "competence", "eid", "consents"],
    notes: ["Spezielle Kategorie seit 01.07.2026 beim Luftfahrt-Bundesamt.", "Kontrollzone Hamburg: DFS-Freigabe nötig.", "Telefonische Beratung derzeit nicht möglich – Anfragen per E-Mail."],
    uncertain: ["Zwei E-Mail-Domains im Umlauf: @bwai.hamburg.de (Service-Seite, aktuell) und @bwi.hamburg.de (Themenseite). Im Zweifel die BWAI-Adresse nutzen."],
    sources: ["https://www.hamburg.de/service/info/111099573/", "https://www.hamburg.de/go/drohnen"],
  },
  {
    code: "HE", name: "Hessen",
    authorities: [{ name: "Regierungspräsidium Darmstadt – Dezernat 33.3 Luftverkehr", coverage: "Regierungsbezirk Darmstadt (u. a. Frankfurt, Wiesbaden, Offenbach, Darmstadt, Main-Taunus, Hochtaunus, Wetterau, Main-Kinzig, Bergstraße, Odenwald, Groß-Gerau, Rheingau-Taunus)", address: "Luisenplatz 2, 64278 Darmstadt", phone: "+49 6151 12-5398", web: "https://rp-darmstadt.hessen.de/infrastruktur-und-wirtschaft/verkehr/luftverkehr/unbemannte-luftfahrt", hours: "Offene Kategorie: Tel. 06151 12-5398" }, { name: "Regierungspräsidium Kassel – Dezernat 22 Luftverkehr", coverage: "Regierungsbezirke Kassel und Gießen", address: "Am Alten Stadtschloss 1, 34117 Kassel", email: "luftverkehr@rpks.hessen.de", phone: "+49 561 106-0", web: "https://rp-kassel.hessen.de/wirtschaft-und-planung/verkehr/luftverkehr" }],
    individual: { available: true, feeText: "gebührenpflichtig, Satz nach Aufwand", processingText: "bis zu 8 Wochen", formUrl: "https://rp-darmstadt.hessen.de/sites/rp-darmstadt.hessen.de/files/2022-04/antrag_uas_auf_einzelerlaubnis_geo_zonen_rev4_0.pdf", onlineUrl: "https://www.hessenfinder.de/portaldeeplink/?tsa_leistung_id=381430604&tsa_sprache=de_DE", requiresA2: false },
    general: { available: true, feeText: "200 € (Änderung 30 €, Anerkennung 50 €)", formUrl: "https://www.dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/antrag-allgemeinerlaubnis.pdf", validityText: "2 Jahre", requiresA2: true, recognition: true },
    attachments: ["map", "insurance", "competence", "eid", "consents"],
    notes: ["Naturschutzgebiete, Nationalparks, FFH-Gebiete: Zustimmung der Naturschutzbehörde (Ausnahme: > 100 m, kein Freizeitzweck).", "Allgemeinverfügungen: Kitzrettung (Kassel, 2024–2029), ASP-Wärmebild (Darmstadt), Bestandsdrohnen < 2 kg in A2.", "Mindestalter 16 Jahre."],
    uncertain: ["RP Darmstadt nennt nur persönliche Ansprechpartner (keine Sammeladresse) – Kontakt über Telefon oder Website.", "Einzelerlaubnis-Gebühr nicht belegt; verlinktes Einzelformular ist Rev. 4 (2022)."],
    sources: ["https://rp-darmstadt.hessen.de/infrastruktur-und-wirtschaft/verkehr/luftverkehr/unbemannte-luftfahrt", "https://rp-kassel.hessen.de/wirtschaft-und-planung/verkehr/luftverkehr"],
  },
  {
    code: "MV", name: "Mecklenburg-Vorpommern",
    authorities: [{ name: "Ministerium für Wirtschaft, Infrastruktur, Tourismus und Arbeit – Referat V 630 Luftfahrtbehörde", coverage: "Ganz Mecklenburg-Vorpommern", address: "Johannes-Stelling-Straße 14, 19053 Schwerin", email: "luftfahrtbehoerde@wm.mv-regierung.de", phone: "+49 385 588-15631", web: "https://www.regierung-mv.de/Landesregierung/wm/Infrastruktur/Luftverkehr/Luftfahrtbeh%C3%B6rde/" }],
    individual: { available: true, feeText: "50–3.500 €", formUrl: "https://www.regierung-mv.de/static/Regierungsportal/Ministerium%20f%C3%BCr%20Wirtschaft,%20Arbeit%20und%20Gesundheit/Dateien/Downloads/08-1_Genehmigung%20UAS-Geozonen.pdf", onlineUrl: "https://www.behoerden-serviceportal.de/onlineantraege/onlineantrag?prozessKey=m40169.drohneEFA&oeId=L100027.OE.107164784&leistungId=99080103001000", requiresA2: false },
    general: { available: false, requiresA2: false },
    attachments: ["map", "insurance", "competence", "eid", "consents", "expert_opinions"],
    notes: ["Keine Allgemeinerlaubnis – MV nimmt nicht am gemeinsamen Länderverfahren teil.", "Formular hat eigene Felder für NSG, Vogelschutz-, FFH-Gebiete und Nationalparks; ggf. Naturschutzgutachten.", "Nur vollständige Anträge werden bearbeitet."],
    uncertain: ["Bearbeitungsdauer nicht belegt."],
    sources: ["https://www.schwerin.de/politik-verwaltung/dienstleistungen/verwaltungsleistungen/Unbemannte-Luftfahrtsysteme-Drohnen-Aufstiegserlaubnis-beantragen/"],
  },
  {
    code: "NI", name: "Niedersachsen",
    authorities: [{ name: "Niedersächsische Landesbehörde für Straßenbau und Verkehr – Dezernat 42 Luftverkehr", coverage: "Ganz Niedersachsen", address: "Göttinger Chaussee 76A, 30453 Hannover", email: "drohnen@nlstbv.niedersachsen.de", phone: "+49 511 3034-2414", web: "https://www.strassenbau.niedersachsen.de/startseite/aufgaben/luftverkehr/drohnen_unbemannte_luftfahrtgerate/unbemannte-luftfahrzeugsysteme-drohnen-114884.html" }],
    individual: { available: true, feeText: "100 €", processingText: "2–10 Werktage", requiresA2: false },
    general: { available: true, feeText: "200 € (Änderung 30 €, Anerkennung 50 €)", processingText: "2–10 Werktage", formUrl: "https://www.strassenbau.niedersachsen.de/download/208418/Antrag_Allgemeinerlaubnis.pdf", validityText: "2 Jahre", requiresA2: true, recognition: true },
    attachments: ["map", "insurance", "competence", "eid", "consents"],
    notes: ["Behörde meldet verlängerte Bearbeitungszeiten (Stand 02/2026) – früh einreichen.", "Einreichung per E-Mail bevorzugt (kürzere Bearbeitung); Online-Dienst in Planung.", "Keine Vorkasse."],
    uncertain: ["Gebührensätze (100 € Einzel, 200 € AE) stammen aus dem Serviceportal, nicht von der Behördenseite.", "Aktuelles Einzelerlaubnis-Formular nicht verlinkt – Behörde fragen."],
    sources: ["https://www.lkwf.de/Themen-Leistungen/Leistungen/Dienstleistungen-A-Z/Einflug-in-geografische-Gebiete-mit-Drohnen-beantragen.php"],
  },
  {
    code: "NW", name: "Nordrhein-Westfalen",
    authorities: [{ name: "Bezirksregierung Düsseldorf – Dezernat 26 Luftverkehr", coverage: "Regierungsbezirke Düsseldorf und Köln", address: "Postfach 30085, 40408 Düsseldorf", email: "drohnen@brd.nrw.de", phone: "+49 211 475-0", web: "https://www.brd.nrw.de/Themen/Verkehr/Luftverkehr/Unbemannte-Luftfahrzeugsysteme-Drohnen" }, { name: "Bezirksregierung Münster – Dezernat 26 Luftverkehr", coverage: "Regierungsbezirke Münster, Arnsberg, Detmold", address: "Albrecht-Thaer-Straße 9, 48147 Münster", email: "reinhard.benicke@brms.nrw.de", phone: "+49 251 411-2706", web: "https://www.brms.nrw.de/themen/bauen-planen-und-verkehr/luftverkehr/drohnen" }],
    individual: { available: true, feeText: "75 € + 50 € je weiterer Tatbestand", processingText: "ca. 2 Wochen", formUrl: "https://www.brd.nrw.de/system/files/media/document/2025-06/2_26_verkehr_luftverkehr_drohnen_antrag_genehmigung.pdf", requiresA2: false },
    general: { available: true, feeText: "200 € + 150 € je weiterer Tatbestand; Änderung 50 €", processingText: "ca. 2 Wochen", formUrl: "https://www.brd.nrw.de/system/files/media/document/2025-06/2_26_verkehr_luftverkehr_drohnen_antrag_genehmigung.pdf", validityText: "2 Jahre, NRW-weit", requiresA2: false },
    attachments: ["map", "insurance", "competence", "eid", "consents", "eid_photo"],
    notes: ["PDF per E-Mail genügt, keine Nachsendung per Post.", "Münster: eigenes Formular auf der BRMS-Seite.", "Nebenbestimmungen Düsseldorf: Wohngrundstücke ≥ 10 m über Gebäude; Bundeswasserstraßen ≥ 20 m (Rhein 50 m); Bahnanlagen ≥ 15 m; Bundesfernstraßen ≥ 30 m.", "Spezielle Kategorie beim Luftfahrt-Bundesamt."],
    uncertain: ["Münster: nur persönliche E-Mail bekannt, Funktionspostfach nicht belegt."],
    sources: ["https://www.brd.nrw.de/Themen/Verkehr/Luftverkehr/Unbemannte-Luftfahrzeugsysteme-Drohnen", "https://www.brms.nrw.de/themen/bauen-planen-und-verkehr/luftverkehr/drohnen"],
  },
  {
    code: "RP", name: "Rheinland-Pfalz",
    authorities: [{ name: "Landesbetrieb Mobilität Rheinland-Pfalz – Fachgruppe Luftverkehr", coverage: "Ganz Rheinland-Pfalz", address: "Gebäude 667C, 55483 Hahn-Flughafen", email: "drohnen-uas@lbm.rlp.de", phone: "+49 6543 8780-1658", web: "https://lbm.rlp.de/themen/luftverkehr/drohnen-uas-/-modellflug", hours: "Mo–Fr 8–12 Uhr" }],
    individual: { available: true, feeText: "50 € + 30 € je weiterer Tatbestand", processingText: "bis zu 2 Wochen", formUrl: "https://lbm.rlp.de/fileadmin/lbm/Themen/Luftverkehr/Dokumente/Drohnen/D-FB_08_Antrag_Einzelerlaubnis_UAS_geografische_Gebiete_V13.pdf", onlineUrl: "https://www.behoerden-serviceportal.de/onlineantraege/onlineantrag?prozessKey=m40169.drohneEFA&oeId=L100039.OE.13384464&leistungId=99080103001000", requiresA2: false },
    general: { available: true, feeText: "200 € (Änderung 30 €, Anerkennung 50 €)", processingText: "bis zu 2 Wochen", formUrl: "https://lbm.rlp.de/fileadmin/lbm/Themen/Luftverkehr/Dokumente/Drohnen/Antrag_Allgemeinerlaubnis_REV_12.pdf", validityText: "2 Jahre", requiresA2: true, recognition: true },
    attachments: ["map", "insurance", "competence", "eid", "consents"],
    notes: ["Naturschutzgebiete: Genehmigung der Naturschutzbehörde (Ausnahme: > 100 m, kein Freizeitzweck).", "In geschlossenen Ortschaften: Anmeldung bei Ordnungsbehörde/Polizei.", "Spezielle Kategorie seit 01.04.2026 beim Luftfahrt-Bundesamt.", "Keine Vorkasse."],
    uncertain: [],
    sources: ["https://lbm.rlp.de/themen/luftverkehr/drohnen-uas-/-modellflug"],
  },
  {
    code: "SL", name: "Saarland",
    authorities: [{ name: "Ministerium für Umwelt, Klima, Mobilität, Agrar und Verbraucherschutz – Referat F/2 Luftfahrt", coverage: "Ganz Saarland", address: "Keplerstraße 18, 66117 Saarbrücken", email: "drohnen@umwelt.saarland.de", phone: "+49 681 501-84249", web: "https://www.saarland.de/mukmav/DE/portale/mobilitaet/informationen/luftfahrt/unbemannte-fluggeraete/unbemannte-fluggeraete" }],
    individual: { available: true, feeText: "50–3.500 €", processingText: "bis zu 14 Arbeitstage", leadTimeText: "mindestens 14 Tage vor dem Einsatztag", formUrl: "https://www.saarland.de/SharedDocs/Downloads/DE/mukmav/verkehr/Luftfahrt/Antrag_Genehmigung_unbemanntes_Fluggeraet", onlineUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/", requiresA2: false, recognition: false },
    general: { available: true, feeText: "nach Art und Anzahl der Gebiete (50–3.500 €)", processingText: "bis zu 14 Arbeitstage", formUrl: "https://www.saarland.de/SharedDocs/Downloads/DE/mukmav/verkehr/Luftfahrt/Antrag_Genehmigung_unbemanntes_Fluggeraet", requiresA2: false, recognition: false },
    attachments: ["map", "insurance", "competence", "eid", "consents"],
    notes: ["Antrag per E-Mail an drohnen@umwelt.saarland.de oder per Post; nur vollständige Anträge werden bearbeitet.", "Keine Anerkennung von Genehmigungen anderer Bundesländer – für Flüge im Saarland ist immer eine saarländische Genehmigung nötig.", "Flughafen Saarbrücken: bis 1.000 m seitlich der Flugplatzgrenze genehmigungspflichtig, DFS-Freigabe.", "ED-R-Gebiete: Genehmigung des BAF nötig."],
    uncertain: ["Die Behördenseite nennt nur „Genehmigung nach § 21i LuftVO“ (Formulare offen/speziell) – ob eine mehrjährige Allgemeingenehmigung erteilt wird, vorab erfragen.", "Gebührensatz wird im Einzelfall festgelegt (50–3.500 €)."],
    sources: ["https://www.saarland.de/mukmav/DE/portale/mobilitaet/informationen/luftfahrt/unbemannte-fluggeraete/unbemannte-fluggeraete"],
  },
  {
    code: "SN", name: "Sachsen",
    authorities: [{ name: "Landesdirektion Sachsen – Referat 36 Luftverkehr", coverage: "Ganz Sachsen", address: "Stauffenbergallee 2, 01099 Dresden", email: "post@lds.sachsen.de", phone: "+49 351 825-3600", web: "https://lds.sachsen.de/luftverkehr/drohnen/" }],
    individual: { available: true, feeText: "50–3.500 € (auch Ablehnung gebührenpflichtig)", leadTimeText: "mindestens 14 Tage vor Betriebsbeginn", formUrl: "https://www.lds.sachsen.de/anlagen/?ID=19952&art_param=403&abteilung_id=5&referat_id=26", requiresA2: false },
    general: { available: false, requiresA2: false },
    attachments: ["map", "insurance", "competence", "eid", "consents", "datasheet"],
    notes: ["Kontrollzonen Dresden und Leipzig-Halle: DFS-Freigabe.", "Spezielle Kategorie beim Luftfahrt-Bundesamt.", "Zusätzlich gefordert: CE-Kennzeichnungsnachweis, ggf. SORA-GER."],
    uncertain: ["Ob die Landesdirektion Allgemeinerlaubnisse nach § 21i ausstellt, ist nicht belegt (alte Allgemeinverfügung 2021 widerrufen)."],
    sources: ["https://lds.sachsen.de/luftverkehr/drohnen/"],
  },
  {
    code: "ST", name: "Sachsen-Anhalt",
    authorities: [{ name: "Landesverwaltungsamt Sachsen-Anhalt – Referat 307 Luftverkehr", coverage: "Ganz Sachsen-Anhalt", address: "Ernst-Kamieth-Straße 2, 06112 Halle (Saale)", email: "Poststelle@lvwa.sachsen-anhalt.de", phone: "+49 345 514-0", web: "https://lvwa.sachsen-anhalt.de/das-lvwa/wirtschaft-bauwesen-verkehr/oepnv-foerderung-eisenbahn-luftverkehr-binnenschifffahrt/luftverkehr/unbemannte-luftfahrtsysteme" }],
    individual: { available: true, feeText: "nach Aufwand (50–3.500 €)", processingText: "mindestens 5 Arbeitstage nach vollständigem Antrag", formUrl: "https://lvwa.sachsen-anhalt.de/fileadmin/Bibliothek/Politik_und_Verwaltung/LVWA/LVwA/Dokumente/3_wirtschaft_kultur_verbrschutz_bau/307/Luftverkehr/BNLR/FOR_UAS_GEO_REV14.pdf", validityText: "max. 2 Wochen", requiresA2: false },
    general: { available: true, feeText: "200 € Erstantrag (Anerkennung fremder AE 50 €)", processingText: "mindestens 5 Arbeitstage nach vollständigem Antrag", formUrl: "https://lvwa.sachsen-anhalt.de/fileadmin/Bibliothek/Politik_und_Verwaltung/LVWA/LVwA/Dokumente/3_wirtschaft_kultur_verbrschutz_bau/307/Luftverkehr/BNLR/Antrag_Allgemeinerlaubnis_REV_12.pdf", validityText: "2 Jahre", requiresA2: true, recognition: true },
    attachments: ["map", "insurance", "competence", "eid", "consents", "expert_opinions"],
    notes: ["Anerkennung von Allgemeingenehmigungen aus NI, HH, HB, SH, HE, BW und RP im vereinfachten Verfahren (50 €).", "Landesspezifische Nebenbestimmungen für Allgemeingenehmigungen beachten (PDF auf der LVwA-Seite).", "Unterschrift auf dem Formular zwingend; PDF mit Adobe Reader öffnen.", "Allgemeinverfügung für den Flughafen Magdeburg/Cochstedt (NfL 2025-1-3710).", "Spezielle Kategorie beim Luftfahrt-Bundesamt."],
    uncertain: [],
    sources: ["https://halle.de/serviceportal/dienstleistungen/leistung/einflug-in-geografische-gebiete-mit-drohnen-beantragen/397192372"],
  },
  {
    code: "SH", name: "Schleswig-Holstein",
    authorities: [{ name: "Landesbetrieb Straßenbau und Verkehr Schleswig-Holstein – Luftfahrtbehörde", coverage: "Ganz Schleswig-Holstein", address: "Königsweg 59, 24114 Kiel", email: "Luftfahrtbehoerde-uas@lbv-sh.landsh.de", phone: "+49 431 383-2408", web: "https://www.schleswig-holstein.de/DE/landesregierung/ministerien-behoerden/LBVSH/Aufgaben/Luftfahrtbehoerde/Unbemannte_Luftfahrtgeraete/03_Drohnen" }],
    individual: { available: true, feeText: "50–3.500 €", onlineUrl: "https://zufish.schleswig-holstein.de/portaldeeplink?tsa_leistung_id=308311210&tsa_sprache=de_DE", requiresA2: false },
    general: { available: true, feeText: "200 € (Änderung 30 €, Anerkennung 50 €)", formUrl: "https://www.schleswig-holstein.de/DE/landesregierung/ministerien-behoerden/LBVSH/Aufgaben/Luftfahrtbehoerde/Formulare/pdf_9_unbemLuftfahrzeuge/9_09_Allgemeinerlaubnis_LuftVO.pdf?__blob=publicationFile&v=1", validityText: "2 Jahre", requiresA2: true, recognition: true },
    attachments: ["map", "insurance", "competence", "eid", "consents"],
    notes: ["Nord-Ostsee-Kanal und Ostseehäfen: das WSA Ostsee wird von der Luftfahrtbehörde beteiligt.", "Keine Vorkasse."],
    uncertain: ["Adresse laut LBV.SH-Seite (Stand 2020): Königsweg 59 – andere Quellen nennen Mercatorstraße 9. Vor dem Postversand prüfen.", "Das verlinkte Allgemeinerlaubnis-Formular ist Rev. 2 (06/2021); ggf. das aktuelle gemeinsame Formular (dipul) verwenden."],
    sources: ["https://zufish.schleswig-holstein.de/detail?pstId=308311210"],
  },
  {
    code: "TH", name: "Thüringen",
    authorities: [{ name: "Thüringer Landesverwaltungsamt – Referat Straßen- und Luftverkehr (Luftverkehr)", coverage: "Ganz Thüringen", address: "Jorge-Semprún-Platz 4, 99423 Weimar", email: "luftverkehr@tlvwa.thueringen.de", phone: "+49 361 57332-1403", web: "https://landesverwaltungsamt.thueringen.de/verkehr/luftverkehr/unbemannt" }],
    individual: { available: true, feeText: "50 €", formUrl: "https://thformular.thueringen.de/thueform/cfs/eject/pdf/4342.pdf?MANDANTID=26&FORMUID=LUFTSIG-083-TH-TLVWA", onlineUrl: "https://thformular.thueringen.de/thueform/cfs/eject/html5/4342.htm?MANDANTID=26&FORMUID=LUFTSIG-083-TH-TLVWA&page=0", requiresA2: false },
    general: { available: true, feeText: "150 €", formUrl: "https://thformular.thueringen.de/thueform/cfs/eject/pdf/4342.pdf?MANDANTID=26&FORMUID=LUFTSIG-083-TH-TLVWA", requiresA2: false },
    attachments: ["map", "insurance", "competence", "eid", "consents", "id_copy", "datasheet"],
    notes: ["Ein Formular für alle § 21i-Anträge (PDF, Java-XML oder barrierefrei online ausfüllbar), Einreichung per Post oder E-Mail.", "Erlaubnisse nur „in begründeten Fällen“ – ausführliche Begründung beilegen.", "Keine Allgemeinverfügung in Thüringen.", "Spezielle Kategorie beim Luftfahrt-Bundesamt."],
    uncertain: ["Gebühren (Einzel 50 €, AE 150 €) stammen aus dem Serviceportal, die Behördenseite nennt keine Sätze.", "Die Behördenseite spricht nur von einer „Ausnahme in begründeten Fällen“ – ob eine mehrjährige Allgemeinerlaubnis erteilt wird, vorab erfragen."],
    sources: ["https://landesverwaltungsamt.thueringen.de/verkehr/luftverkehr/unbemannt", "https://landesverwaltungsamt.thueringen.de/verkehr/luftverkehr/unbemannt/formulare"],
  },
];

export function getStateAuthority(nameOrCode: string): StateAuthority | undefined {
  const q = nameOrCode.trim().toLowerCase();
  return STATE_AUTHORITIES.find((s) => s.code.toLowerCase() === q || s.name.toLowerCase() === q);
}
