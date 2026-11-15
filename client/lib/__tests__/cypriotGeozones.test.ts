import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CY_GEOZONE_SOURCE_LABEL,
  CY_ZONES_LAYER_URL,
  cyFolderCategory,
  cyPopupText,
  cyRestrictionFromFolder,
  cyprusArcgisPage,
  cyprusQueryUrl,
  decideCyRestriction,
  formatCyLimitDe,
  hasGreek,
  normalizeCyAccess,
  normalizeCyprusZones,
  normalizeCyprusZonesWithStats,
  parseCyHeights,
  parseCyPopup,
  splitCySentences,
  translateCyManager,
  translateCyRemarks,
  translateCySentence,
  translateCyZoneName,
  transliterateGreek,
} from "../../../shared/cypriotGeozones";
import { loadCyprus } from "../geozoneDirect/cyprusSource";
import { parseEd269ToGeozoneInfo } from "../ed269";

// Gekürzter ECHTER Auszug aus FeatureServer/12 (abgerufen 2026-11-15,
// f=geojson, outSR=4326): 21 von 141 Zonen, Attribute und Geometrien
// unverändert. Enthält alle Satz-/Etikettvarianten der Live-Daten (inkl.
// Tippfehler „sσε“, abgeschnittenes „ΕΞΟΥΣΙΟΔΟΤΗ“, leere Zugangsbedingung,
// Formular-Link in derselben Zeile, Satzrest „ΟΚΥπΥ .“, Unterordner im FolderPath).
const body = JSON.parse(readFileSync(join(__dirname, "fixtures/cy-dca-arcgis-sample.json"), "utf8"));
const byId = (features: any[], id: string) => features.find((f) => f.properties.identifier === id);
const rawByOid = (oid: number) => body.features.find((f: any) => f.properties.OBJECTID === oid);

describe("cypriotGeozones – Transliteration und Namen", () => {
  it("transliteriert nach ELOT 743 (Digraphen, Groß-/Kleinschreibung)", () => {
    assert.equal(transliterateGreek("Γιαννάκης Ιωάννου"), "Giannakis Ioannou");
    assert.equal(transliterateGreek("Λευκωσία"), "Lefkosia");
    assert.equal(transliterateGreek("Χρυσοχούς"), "Chrysochous");
    assert.equal(transliterateGreek("Ύψωνας"), "Ypsonas");
    assert.equal(transliterateGreek("ΠΑΝΤΕΛΗΣ ΙΟΡΔΑΝΟΥΣ"), "PANTELIS IORDANOUS");
    assert.equal(transliterateGreek("ΓεωΔιαΣ"), "GeoDiaS");
    assert.equal(transliterateGreek("Mιχαήλ"), "Michail"); // lateinisches M im Original
  });

  it("übersetzt Zonennamen (Gattungsbegriffe deutsch, Exonyme, Eigennamen transliteriert)", () => {
    assert.equal(translateCyZoneName("001 - Αγκυροβόλιο Μονής"), "001 – Ankerplatz Moni");
    assert.equal(translateCyZoneName("014 - ΑΗΚ - Η/Σ Δεκέλια"), "014 – EAC-Kraftwerk Dekelia");
    assert.equal(translateCyZoneName("018 - ΑΗΚ - ΚΤΥ Λεμεσού (Ύψωνας)"), "018 – EAC-Anlage KTY Limassol (Ypsonas)");
    assert.equal(translateCyZoneName("040 - Γενικό Νοσοκομείο Αμμοχώστου"), "040 – Allgemeines Krankenhaus Famagusta");
    assert.equal(translateCyZoneName("108 - Διεθνής Αερολιμένας Λάρνακας - Β"), "108 – Internationaler Flughafen Larnaka – B");
    assert.equal(translateCyZoneName("046 - ΕΦ002"), "046 – Nationalgarde EF002");
    assert.equal(translateCyZoneName("098 - Προαναχωρησιακό κέντρο «Λίμνες»"), "098 – Ausreisezentrum „Limnes“");
    assert.equal(translateCyZoneName("118 - Αστυν. Σταθμός Αγίας Νάπας"), "118 – Polizeiwache Agia Napa");
    assert.equal(translateCyZoneName("096 - Πρεσβεία Λαικής Δημοκρατίας Κίνας"), "096 – Botschaft der Volksrepublik China");
  });

  it("Zonenverwalter: Behörden deutsch, Personen transliteriert", () => {
    assert.equal(
      translateCyManager("Γιαννάκης Ιωάννου (Βοηθός Διευθυντής Δίκτυα, ΓεωΔιαΣ), Σόλων Νικολάου (Β. Τοπογράφος Μηχανικός, ΓεωΔιαΣ)"),
      "Giannakis Ioannou (stellv. Direktor Netze, GeoDiaS), Solon Nikolaou (Vermessungsingenieur, GeoDiaS)",
    );
    assert.equal(translateCyManager("ΑΣΤΥΝΟΜΙΚΟΣ ΔΙΕΥΘΥΝΤΗΣ ΕΠΑΡΧΙΑΣ ΛΕΥΚΩΣΙΑΣ"), "Polizeidirektor des Bezirks Nikosia");
    assert.equal(translateCyManager("Λάζαρος Ελευθερίου - ΥΠΕΞ"), "Lazaros Eleftheriou – Außenministerium (MFA)");
    assert.equal(translateCyManager("Υπηρεσία ΣμηΕΑ - ΤΠΑ"), "UAS-Dienststelle – Abteilung Zivilluftfahrt (DCA)");
  });
});

describe("cypriotGeozones – PopupInfo", () => {
  it("HTML → Zeilen, Etiketten auch mitten in der Zeile", () => {
    const p = parseCyPopup(rawByOid(43).properties.PopupInfo);
    assert.equal(p.access, "AUTHORISATION");
    assert.equal(p.email, "info@drones.gov.cy");
    assert.equal(p.phone, "22 404 167 / 22 404 121");
    assert.equal(p.formUrl, "https://drones.gov.cy/wp-content/uploads/2024/02/Airport_UAS_Geo_Zone_-Request_Form_004.pdf");
    assert.equal(p.manager, "Υπηρεσία ΣμηΕΑ - ΤΠΑ");
    assert.equal(p.remarks.length, 1);
    assert.ok(!cyPopupText(rawByOid(43).properties.PopupInfo).includes("<br>"));
  });

  it("Zugangsbedingung: ΕΞΟΥΣΙΟΔΟΤΗΣΗ(.) / abgeschnitten / ΑΠΑΓΟΡΕΥΜΕΝΗ ΠΕΡΙΟΧΗ / leer", () => {
    assert.equal(normalizeCyAccess("ΕΞΟΥΣΙΟΔΟΤΗΣΗ."), "AUTHORISATION");
    assert.equal(normalizeCyAccess("ΕΞΟΥΣΙΟΔΟΤΗ"), "AUTHORISATION");
    assert.equal(normalizeCyAccess("ΑΠΑΓΟΡΕΥΜΕΝΗ ΠΕΡΙΟΧΗ"), "PROHIBITED");
    assert.equal(normalizeCyAccess(""), undefined);
    assert.equal(parseCyPopup(rawByOid(46).properties.PopupInfo).access, "AUTHORISATION");
    assert.equal(parseCyPopup(rawByOid(79).properties.PopupInfo).access, undefined);
    assert.equal(parseCyPopup(rawByOid(1).properties.PopupInfo).accessRaw, "ΕΞΟΥΣΙΟΔΟΤΗΣΗ");
    assert.equal(parseCyPopup(rawByOid(117).properties.PopupInfo).access, "PROHIBITED"); // Polizeipräsidium
  });

  it("alle Sätze des Auszugs werden übersetzt (nichts bleibt griechisch)", () => {
    for (const f of body.features) {
      const { untranslated } = translateCyRemarks(parseCyPopup(f.properties.PopupInfo).remarks);
      assert.deepEqual(untranslated, [], f.properties.Name);
    }
  });

  it("Satzregeln inkl. Tippfehler und Satzrest", () => {
    assert.equal(
      translateCySentence("Πτήσεις sσε αυτήν την περιοχή μπορούν να πραγματοποιηθούν κατόπιν ειδικής άδειας από την αρχή Λιμένων"),
      "Flüge in diesem Gebiet nur mit Sondergenehmigung – zuständig: Hafenbehörde Zyperns (CPA).",
    );
    assert.equal(translateCySentence("Απαγορεύονται οι πτήσεις ΣμηΕΑ σε αυτήν την περιοχήv"), "UAS-Flüge sind in diesem Gebiet verboten.");
    const s = splitCySentences("Για πτήσεις σε αυτήν την περιοχή, απαιτείται άδεια από τo ΟΚΥπΥ . Υποβολή αίτησης τουλάχιστον 1 βδομάδα πριν από την προγραμματισμένη ημερομηνία.");
    assert.equal(s.length, 2);
    assert.equal(translateCySentence(s[0]), "Für Flüge in diesem Gebiet ist eine Genehmigung erforderlich – zuständig: Staatliche Gesundheitsdienste-Organisation (OKYpY/SHSO).");
    assert.equal(translateCySentence(s[1]), "Antrag mindestens 1 Woche vor dem geplanten Flugdatum stellen.");
    assert.equal(
      translateCySentence("Υποβολή αίτησης τουλάχιστον 2 βδομάδες πριν από την προγραμματισμένη ημερομηνία."),
      "Antrag mindestens 2 Wochen vor dem geplanten Flugdatum stellen.",
    );
    assert.equal(translateCySentence("ΟΚΥπΥ"), "Genehmigungsstelle: Staatliche Gesundheitsdienste-Organisation (OKYpY/SHSO).");
    assert.equal(translateCySentence("Κάτι εντελώς άγνωστο"), null);
  });
});

describe("cypriotGeozones – Höhen (live keine; Parser für künftige Texte)", () => {
  it("liest ft/m, AGL/AMSL, SFC/GND und griechische Einheiten", () => {
    const a = parseCyHeights("Μέγιστο ύψος 400 ft AGL");
    assert.equal(a.upper?.meters, 121.9);
    assert.equal(a.upper?.reference, "AGL");
    assert.equal(a.lower, undefined);
    const b = parseCyHeights("SFC - 120 m AMSL");
    assert.equal(b.lower?.meters, 0);
    assert.equal(b.upper?.meters, 120);
    assert.equal(b.upper?.reference, "MSL");
    const c = parseCyHeights("έως 60 μέτρα από το έδαφος");
    assert.equal(c.upper?.meters, 60);
    assert.equal(c.upper?.reference, "AGL");
    const d = parseCyHeights("πάνω από 1.500 πόδια ΜΣΘ");
    assert.equal(d.lower?.feet, 1500);
    assert.equal(d.lower?.reference, "MSL");
    assert.equal(formatCyLimitDe(a.upper), "400 ft über Grund (≈ 122 m)");
    // Telefonnummern, Fristen und URLs sind keine Höhen.
    for (const f of body.features) assert.deepEqual(parseCyHeights(cyPopupText(f.properties.PopupInfo)), {}, f.properties.Name);
  });
});

describe("cypriotGeozones – Beschränkung", () => {
  it("FolderPath-Mapping inkl. Unterordner und vorsichtigem Default", () => {
    assert.equal(cyRestrictionFromFolder("CYPRUS GEO ZONES MAP ver09T2/PROHIBITED ZONES"), "PROHIBITED");
    assert.equal(cyRestrictionFromFolder("CYPRUS GEO ZONES MAP ver09T2/RESTRICTED ZONES"), "REQ_AUTHORISATION");
    assert.equal(cyRestrictionFromFolder("CYPRUS GEO ZONES MAP ver09T2/RESTRICTED ZONES/014 - ΑΗΚ - Η"), "REQ_AUTHORISATION");
    assert.equal(cyRestrictionFromFolder("CYPRUS GEO ZONES MAP ver10/DANGER ZONES"), "CONDITIONAL");
    assert.equal(cyRestrictionFromFolder("CYPRUS GEO ZONES MAP ver10/OTHER"), null);
    assert.equal(cyFolderCategory("CYPRUS GEO ZONES MAP ver09T2/RESTRICTED ZONES/014 - ΑΗΚ - Η"), "RESTRICTED ZONES");
    const unknown = decideCyRestriction("X/OTHER", { remarks: [], greekText: "" });
    assert.equal(unknown.restriction, "REQ_AUTHORISATION");
    assert.equal(unknown.escalated, true);
  });

  it("strengere Angabe gewinnt (098: Ordner RESTRICTED, Text verbietet UAS-Flüge)", () => {
    const feats = normalizeCyprusZones(body);
    const limnes = byId(feats, "CY-098");
    assert.equal(limnes.properties.restriction, "PROHIBITED");
    assert.equal(limnes.properties.cyFolderRestriction, "REQ_AUTHORISATION");
    assert.equal(limnes.properties.cyRestrictionEscalated, true);
    assert.match(limnes.properties.message, /Hinweis zur Einstufung: Ordner der Behörde „RESTRICTED ZONES“/);
    assert.equal(byId(feats, "CY-130").properties.restriction, "PROHIBITED"); // ΕΦ038 im Ordner PROHIBITED
    assert.equal(byId(feats, "CY-046").properties.restriction, "REQ_AUTHORISATION");
  });
});

describe("cypriotGeozones – Normalisierung des echten Auszugs", () => {
  const { features, dropped } = normalizeCyprusZonesWithStats(body);

  it("alle Zonen übernommen, Zählung je Beschränkung", () => {
    assert.equal(features.length, 21);
    assert.deepEqual(dropped, []);
    const counts: Record<string, number> = {};
    for (const f of features) counts[f.properties.restriction] = (counts[f.properties.restriction] ?? 0) + 1;
    assert.deepEqual(counts, { REQ_AUTHORISATION: 14, PROHIBITED: 7 });
  });

  it("Geometrie unverändert (volle Präzision)", () => {
    const raw = rawByOid(1);
    const f = byId(features, "CY-001");
    assert.deepEqual(f.geometry.coordinates, raw.geometry.coordinates);
    assert.equal(f.geometry.coordinates[0][0][0], 33.1661110000001);
  });

  it("Properties für parseEd269ToGeozoneInfo", () => {
    const f = byId(features, "CY-043");
    const p = f.properties;
    assert.equal(p.name, "043 – Internationaler Flughafen Paphos – B");
    assert.equal(p.nameOriginal, "043 - Διεθνής Αερολιμένας Πάφου - B");
    assert.equal(p.source, CY_GEOZONE_SOURCE_LABEL);
    assert.equal(p.country, "CYP");
    assert.equal(p.lowerMeters, 0);
    assert.equal(p.lowerReference, "AGL");
    assert.equal(p.upperMeters, undefined);
    assert.equal(p.contactEmail, "info@drones.gov.cy");
    assert.equal(p.applicationUrlLabel, "Antragsformular (PDF)");
    assert.equal(p.cyFolder, "RESTRICTED ZONES");
    const langs = p.extendedProperties.localizedMessages.map((m: any) => m.language);
    assert.deepEqual(langs, ["de", "el"]);
    assert.equal(byId(features, "CY-046").properties.applicationUrlLabel, "Antragsformular (DOCX)");
  });

  it("deutsche Meldung: strukturiert, ohne Griechisch vor dem Originaltext", () => {
    for (const f of features) {
      const [de, original] = String(f.properties.message).split("Originaltext der Behörde:");
      assert.ok(original && hasGreek(original), f.properties.identifier);
      const deLines = de.split("\n").filter((l) => !/^Zugangsbedingung:/.test(l));
      assert.ok(!deLines.some(hasGreek), `${f.properties.identifier}: ${deLines.find(hasGreek)}`);
      assert.ok(!hasGreek(f.properties.name), f.properties.name);
      assert.ok(original.includes(f.properties.nameOriginal));
    }
    const army = byId(features, "CY-046").properties.message;
    assert.match(army, /UAS-Flüge nur mit Zustimmung des Zonenverwalters\./);
    assert.match(army, /Drohnenabwehr/);
    assert.match(army, /Zonenverwalter: Generalstab der Nationalgarde – Direktion Militärischer Nachrichtendienst/);
    assert.match(army, /Höhe laut Behörde: keine Angabe/);
  });

  it("ed269.ts übernimmt die deutsche Meldung, hängt das Original nicht doppelt an", () => {
    const infos = parseEd269ToGeozoneInfo(features as any[], "cy");
    assert.equal(infos.length, 21);
    const info = infos.find((i) => i.featureId === "CY-089")!;
    assert.equal(info.restriction, "REQ_AUTHORISATION");
    assert.equal(info.name, "089 – Residenz des Parlamentspräsidenten");
    assert.equal(info.details.split("Originaltext der Behörde:").length, 2);
    assert.match(info.details, /Antrag mindestens 2 Wochen/);
    assert.ok(info.links?.some((l) => l.url === "mailto:president@parliament.cy"));
    assert.ok(info.links?.some((l) => l.url === "https://drones.gov.cy"));
    assert.equal(info.upperMeters, undefined);
    assert.equal(info.lowerReference, "AGL");
    assert.equal(infos.find((i) => i.featureId === "CY-136")!.restriction, "PROHIBITED");
  });

  it("Dedupe über OBJECTID (Seitenüberlappung)", () => {
    const twice = { features: [...body.features, body.features[0]] };
    const r = normalizeCyprusZonesWithStats(twice);
    assert.equal(r.features.length, 21);
    assert.deepEqual(r.dropped, [{ name: body.features[0].properties.Name, reason: "duplicate" }]);
  });
});

describe("cyprusSource – ArcGIS-Paging", () => {
  it("Query-URL: volle Präzision, Paging-Parameter", () => {
    const u = new URL(cyprusQueryUrl(1000, 1000));
    assert.equal(`${u.origin}${u.pathname}`, `${CY_ZONES_LAYER_URL}/query`);
    assert.equal(u.searchParams.get("resultOffset"), "1000");
    assert.equal(u.searchParams.get("outSR"), "4326");
    assert.equal(u.searchParams.get("f"), "geojson");
    assert.equal(u.searchParams.get("geometryPrecision"), null);
  });

  it("exceededTransferLimit (oben/properties) und Fehlerobjekt", () => {
    assert.equal(cyprusArcgisPage({ features: [], exceededTransferLimit: true }).exceeded, true);
    assert.equal(cyprusArcgisPage({ features: [], properties: { exceededTransferLimit: true } }).exceeded, true);
    assert.throws(() => cyprusArcgisPage({ error: { code: 400, message: "Invalid" } }), /ArcGIS-Fehler 400/);
  });

  it("lädt seitenweise, solange exceededTransferLimit gesetzt ist; taggt cy + bbox", async () => {
    const calls: string[] = [];
    const fake = async (url: string) => {
      calls.push(new URL(url).searchParams.get("resultOffset")!);
      const off = Number(new URL(url).searchParams.get("resultOffset"));
      if (off === 0) return { ...body, features: body.features.slice(0, 15), exceededTransferLimit: true };
      return { ...body, features: body.features.slice(15) };
    };
    const feats = await loadCyprus(fake);
    assert.deepEqual(calls, ["0", "15"]);
    assert.equal(feats.length, 21);
    assert.equal(feats[0].properties._country, "cy");
    assert.ok(Array.isArray(feats[0].bbox));
  });

  it("wirft bei leerer Antwort", async () => {
    await assert.rejects(loadCyprus(async () => ({ type: "FeatureCollection", features: [] })), /keine Zonen/);
  });
});
