// Geteilte, React-Native-freie Aufbereitung des belgischen Drohnen-Geozonen-
// Datensatzes (skeyes / BCAA "Droneguide") aus Droneguide-WFS, skeyes-Live-API
// und gebündeltem Archiv. Alle Quellen werden in das interne ED-269-ähnliche
// Modell normalisiert, sodass Mobile und Web dieselben Zonen nutzen.
//
// Besonderheiten des skeyes-Schemas (abweichend vom erwarteten ED-269-Schema):
//  - Höhen: `properties.lowerAltitude` / `properties.upperAltitude` als Objekt
//    `{ value, reference: "GND"|"MSL"|"STD", unit: "F" (Fuß) | "FL" (Flugfläche) }`.
//    Muss in Meter umgerechnet werden (nicht lowerLimit/upperLimit + uomDimensions).
//  - Beschränkung: `properties.restriction.type` mit PROHIBITED /
//    REQ_AUTHORISATION (nicht ein String REQ_AUTH/RESTRICTED).
//  - Zonentyp: `properties.type` (CIV_AF_UNCONTROLLED, CIV_HELISTRIP,
//    MIL_R, FANC, CIV_CTR_VLLx, TEMPORARY-NO-FLY-ZONE, …).
//  - Kontakt: `properties.contact` ({ name/firstName/lastName, phone/mobile,
//    email, url }).
//  - `uniqueIdentifier` dedupliziert Duplikate (Dateien mit Suffix " 2").
import { parseHeight } from "./geozoneKit/heights";

export interface BelgianGeoFeature {
  type?: string;
  id?: string;
  geometry: { type: string; coordinates: any } | null;
  properties?: Record<string, any>;
  bbox?: [number, number, number, number];
}

// Quell-/Layer-Bezeichnung der belgischen Vektorzonen. Wird auch in
// ED269_SOURCE_LABELS (client/lib/ed269.ts) referenziert, damit Gruppierung und
// Rendering dieselbe Beschriftung nutzen (keine Drift).
export const BELGIAN_GEOZONE_SOURCE_LABEL = "skeyes / Droneguide (ED-269)";

// Wandelt ein skeyes-Höhenobjekt in Meter um (Umrechnung: shared/heights.ts).
//  - unit "F"  -> Fuß           -> value × FT_M
//  - unit "FL" -> Flugfläche    -> value × 100 Fuß
//  - reference "GND"/"MSL"/"STD": für die reine Meter-Anzeige unerheblich
//    (wird separat als Höhenbezug ausgewiesen).
//  - sehr hohe Flugflächen (FL >= 600 = 60 000 ft) gelten als praktisch
//    unbegrenzt -> undefined.
export function belgianAltitudeMeters(alt: any): number | undefined {
  if (alt == null) return undefined;
  // Erlaube sowohl das Objekt als auch eine bereits aufbereitete Zahl.
  if (typeof alt === "number") return Number.isFinite(alt) ? alt : undefined;
  const value = Number(alt.value ?? alt.altitude);
  if (!Number.isFinite(value)) return undefined;
  const unit = String(alt.unit ?? "").toUpperCase();
  if (unit === "FL") {
    if (value >= 600) return undefined; // praktisch unbegrenzt
    return parseHeight(value, "FL")?.m ?? undefined;
  }
  // "F" (Fuß) bzw. Default.
  if (value <= 0) return 0;
  return parseHeight(value, "ft")?.m ?? undefined;
}

// reference -> deutscher Höhenbezug. Deckt sowohl das GeoJSON-Schema der
// hochgeladenen Archive (GND/MSL/STD) als auch das ED-269-Schema der öffentlichen
// skeyes-Live-API (AGL/AMSL) ab.
export function belgianAltitudeReference(ref: any): string | undefined {
  const r = String(ref ?? "").toUpperCase().trim();
  switch (r) {
    case "GND":
    case "AGL":
      return "über Grund (AGL)";
    case "MSL":
    case "AMSL":
      return "über MSL (AMSL)";
    case "STD":
      return "Flugfläche (STD)";
    default:
      return undefined;
  }
}

// restriction.type (PROHIBITED/REQ_AUTHORISATION) -> ED-269-Beschränkungs-
// schlüssel. Akzeptiert auch einen String (defensiv).
export function belgianRestriction(restriction: any): string {
  const raw =
    restriction && typeof restriction === "object"
      ? restriction.type
      : restriction;
  const v = String(raw ?? "").toUpperCase().trim().replace(/[\s-]+/g, "_");
  switch (v) {
    case "PROHIBITED":
    case "FORBIDDEN":
    case "NO_FLY":
      return "PROHIBITED";
    case "REQ_AUTHORISATION":
    case "REQ_AUTHORIZATION":
    case "REQ_AUTH":
    case "AUTHORISATION":
    case "AUTHORIZATION":
      return "REQ_AUTHORISATION";
    // Die skeyes-Live-API kennt zusätzlich CONDITIONAL (bedingte Freigabe).
    // Wird wie eine Genehmigungspflicht behandelt (gelb), der bedingte Charakter
    // wird separat in der Detailzeile ("Bedingte Freigabe") ausgewiesen.
    case "CONDITIONAL":
    case "CONDITIONS":
      return "REQ_AUTHORISATION";
    default:
      return v;
  }
}

// properties.type (skeyes) -> deutsche Bezeichnung. CTR-VLL- und EBKT-RMZ-
// Varianten werden über Präfixe abgedeckt.
const BE_TYPE_TRANSLATIONS: Record<string, string> = {
  CIV_AF_UNCONTROLLED: "Unkontrollierter ziviler Flugplatz",
  MIL_AF_UNCONTROLLED: "Unkontrollierter Militärflugplatz",
  CIV_HELISTRIP: "Ziviler Hubschrauberlandeplatz",
  MIL_HELISTRIP: "Militärischer Hubschrauberlandeplatz",
  CIV_MODEL_TERRAIN: "Modellfluggelände",
  CIV_PORT: "Hafengebiet",
  CIV_PRISON: "Justizvollzugsanstalt",
  CIV_TEST_FACILITY: "Testgelände",
  FANC: "Kerntechnische Anlage (FANC)",
  GEOFENCES: "Geofence-Zone",
  HTA: "Hubschrauber-Trainingsgebiet (HTA)",
  LFA_ABOVE_SEA: "Tieffluggebiet über See (LFA)",
  ROYAL_ESTATES: "Königliche Domäne",
  MIL_DOMAIN: "Militärisches Gebiet",
  MIL_R: "Militärisches Beschränkungsgebiet",
  MIL_R_AF_LT2NM: "Militärisches Beschränkungsgebiet (Flugplatz < 2 NM)",
  MIL_R_EXPLOSIVE: "Militärisches Sprenggebiet",
  NOTAM: "NOTAM-Gebiet",
  "TEMPORARY-NO-FLY-ZONE": "Temporäre Flugverbotszone",
  // Zusätzliche Typ-Schlüssel der öffentlichen skeyes-Live-API (otherReasonInfo).
  CIV_MODEL_TERRAIN_SPECIAL: "Modellfluggelände (Sonderregelung)",
  CIV_TMA: "Ziviler Nahkontrollbezirk (TMA)",
  MIL_TMA: "Militärischer Nahkontrollbezirk (TMA)",
  MIL_CONTROL_ZONE: "Militärische Kontrollzone",
  MIL_DANGER: "Militärisches Gefahrengebiet",
  MIL_TSA: "Militärisches Sondernutzungsgebiet (TSA)",
};

export function translateBelgianType(type: any): string | undefined {
  const raw = String(type ?? "").trim();
  if (!raw) return undefined;
  const key = raw.toUpperCase();
  if (BE_TYPE_TRANSLATIONS[key]) return BE_TYPE_TRANSLATIONS[key];
  if (key.startsWith("CIV_CTR_VLL")) {
    const lvl = key.replace("CIV_CTR_VLL", "");
    return `Kontrollzone CTR (VLL${lvl})`;
  }
  if (key.includes("RMZ")) {
    return "Funkpflichtzone (RMZ)";
  }
  // Nummerierte Beschränkungs-/Gefahrengebiete der skeyes-Live-API
  // (z. B. CIV_R01, MIL_R12, CIV_D03, MIL_D2).
  if (/^CIV_R\d+/.test(key)) return "Ziviles Beschränkungsgebiet";
  if (/^MIL_R\d+/.test(key)) return "Militärisches Beschränkungsgebiet";
  if (/^CIV_D\d+/.test(key)) return "Ziviles Gefahrengebiet";
  if (/^MIL_D\d+/.test(key)) return "Militärisches Gefahrengebiet";
  return undefined;
}

// Erklärtexte je VLL-/RMZ-Subzone aus der offiziellen skeyes-Anleitung
// "What is a VLL" (https://www.skeyes.be/media/2202/what-is-a-vll.pdf). Die
// Subzonen VLL0/VLL1/VLL2 rund um die belgischen Flughäfen (EBAW/EBBR/EBCI/
// EBLG/EBOS) sowie EBKT RMZ1/RMZ2 (Kortrijk, Funkpflichtzone) sagen einem
// Piloten allein nichts. Pro Stufe wird die erlaubte Kategorie (Open/Specific),
// die DSA-Vorlaufzeit und die maximale Flughöhe genannt. Flugfreigabe für alle
// skeyes-Zonen ausschließlich über das DSA-Tool. RMZ1/RMZ2 entsprechen
// sinngemäß VLL1/VLL2. Nur VLL-/RMZ-Zonen erhalten Text – andere Zonen (FANC,
// Gefängnisse, Militär usw.) liefern undefined.
const BE_DSA_HINT = "Flugfreigabe nur über das DSA-Tool.";

export function belgianSubzoneInfo(type: any, code?: any): string | undefined {
  const key = `${String(type ?? "")} ${String(code ?? "")}`.toUpperCase();
  if (key.includes("VLL0")) {
    return (
      "VLL0 – über und nahe den eigentlichen Start-/Landebahnen. " +
      "Open-Kategorie: nie erlaubt. Specific: möglich, Antrag per DSA " +
      "mindestens 15 Tage vorher. " +
      BE_DSA_HINT
    );
  }
  if (key.includes("VLL1")) {
    return (
      "VLL1 – über und in der Nähe des Flughafens. Open (nur nach DSA-Freigabe): " +
      "max. bis zum höchsten Hindernis im 100-m-Radius, Obergrenze 150 ft AGL; " +
      "übriger VLL1-Luftraum für Open gesperrt. Specific: überall in VLL1, " +
      "Antrag per DSA mindestens 8 Tage vorher. " +
      BE_DSA_HINT
    );
  }
  if (key.includes("VLL2")) {
    return (
      "VLL2 – weiter vom Flughafen entfernt, am zugänglichsten. Antrag per DSA " +
      "bis 3 Stunden vorher, unabhängig von der Kategorie. Open: bis 150 ft AGL. " +
      "Specific: bis 400 ft AGL bzw. 400 ft AAE (jeweils das Niedrigere). " +
      BE_DSA_HINT
    );
  }
  if (key.includes("RMZ1")) {
    return (
      "EBKT RMZ1 (Kortrijk, Funkpflichtzone) – über bzw. nahe dem Flughafen. " +
      "Regeln sinngemäß wie VLL1: Open nur nach DSA-Freigabe (max. bis zum " +
      "höchsten Hindernis im 100-m-Radius, Obergrenze 150 ft AGL), übriger " +
      "Luftraum für Open gesperrt; Specific Antrag per DSA mindestens 8 Tage " +
      "vorher. " +
      BE_DSA_HINT
    );
  }
  if (key.includes("RMZ2")) {
    return (
      "EBKT RMZ2 (Kortrijk, Funkpflichtzone) – weiter vom Flughafen entfernt. " +
      "Regeln sinngemäß wie VLL2: Antrag per DSA bis 3 Stunden vorher; Open bis " +
      "150 ft AGL, Specific bis 400 ft AGL bzw. 400 ft AAE (jeweils das " +
      "Niedrigere). " +
      BE_DSA_HINT
    );
  }
  return undefined;
}

function stripBeHtml(s: string): string {
  return s
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function belgianContactLine(contact: any): string | undefined {
  if (!contact || typeof contact !== "object") return undefined;
  const name = String(
    contact.name ||
      [contact.firstName, contact.lastName].filter(Boolean).join(" "),
  ).trim();
  const phone = String(contact.phone || contact.mobile || "").trim();
  const email = String(contact.email || "").trim();
  const parts = [name, phone, email].filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  return parts.join(" · ");
}

// Normalisiert ein einzelnes belgisches Feature in ein ED-269-ähnliches Feature:
//  - setzt `restriction` (aus restriction.type), `lowerMeters`/`upperMeters`
//    (aus lowerAltitude/upperAltitude, Fuß/FL -> Meter), `name` (aus name/code)
//    und eine deutsche Detailzeile in `message` (Typ, Code, Höhenbezug,
//    Beschreibung, Kontakt). Kontakt-Rohdaten bleiben für tap-to-call erhalten.
// Manche belgischen ED-269-Rohdaten kodieren mehrere Teil-Loops (z. B. mehrere
// Höhen-Volumina oder Polygon + Loch) als EINEN GeoJSON-Ring, der die Teilringe
// über Null-Breiten-„Brücken" verbindet. Beim Füllen als einfaches Polygon
// erscheinen diese Brücken als dünne Rechtecke/Zacken, die quer durch die Zone
// schießen. `deSpikeRing` entfernt NUR diese Brücken-Sporne.
//
// Eine Brücke ist ein dünner „Out-and-back"-Spornlauf: die Begrenzung läuft über
// einige Kanten weit hinaus und kehrt entlang nahezu derselben Linie wieder zum
// Ausgangspunkt zurück. Statt einzelne lange Kanten zu suchen (was Sporne aus
// mehreren mittel-langen Kanten verfehlt, z. B. B1089), wird ein kumulativer
// Lauf betrachtet. Eindeutige Merkmale eines Sporns:
//  - der Lauf ist anomal LANG (> RUNMED × Median-Schrittlänge UND
//    > RUNDIAG × Ring-Diagonale) – echte Ausdehnung, keine Mess-Schwankung,
//  - die wieder verbundene BASIS ist klein (Lücke < GAPLEN × Lauflänge UND
//    < GAPDIAG × Ring-Diagonale) – der Lauf kehrt fast zum Start zurück, und
//  - der Lauf ist DÜNN: die senkrechte Spannweite der Spornpunkte um die
//    Sporn-Achse ist klein (< WIDTHFRAC × Ring-Diagonale).
// Die letzte Bedingung trennt einen echten Null-Breiten-Sporn von einer breiten
// Ausstülpung/Tropfenspitze (große senkrechte Spannweite -> bleibt erhalten).
// Grobe Polygone (großer Median) und Stadion-/Korridorkanten werden von den
// Längen-/Lückenschwellen ausgeschlossen. Die Schwellen sind bewusst an den
// unabhängigen `thinSpurs`-Detektor des Regressionstests angelehnt, sodass nach
// der Bereinigung garantiert keine erkennbaren Sporne mehr verbleiben.
//
// `deSpikeRingOnce` ist EIN Durchlauf. Manche ED-269-Ringe (z. B. die belgische
// Militärdomäne B1054_2 "MIL AERODROME DE BERTRIX") enthalten MEHRERE direkt
// benachbarte Brücken-Sporne; ein einzelner Durchlauf entfernt nur den ersten,
// der Rest bleibt stehen. `deSpikeRing` ruft `deSpikeRingOnce` daher wiederholt
// bis zum Fixpunkt auf (kein Punkt mehr entfernt). Da die Schwellen unverändert
// bleiben, werden echte Tropfenspitzen/Schachtelungen in keinem Durchlauf
// angetastet – nur geclusterte Sporne werden vollständig abgetragen.
function deSpikeRing(ring: number[][]): number[][] {
  let prev = ring;
  for (let pass = 0; pass < 8; pass++) {
    const next = deSpikeRingOnce(prev);
    // `deSpikeRingOnce` gibt bei „nichts entfernt" die EINGABE-Referenz zurück;
    // sonst einen kürzeren Ring. Fixpunkt erreicht, sobald sich nichts ändert.
    if (next === prev || next.length >= prev.length) break;
    prev = next;
  }
  return prev;
}

function deSpikeRingOnce(ring: number[][]): number[][] {
  if (!Array.isArray(ring) || ring.length < 8) return ring;
  let r = ring;
  let closed = false;
  const n = r.length;
  const a0 = r[0];
  const aN = r[n - 1];
  if (a0 && aN && a0[0] === aN[0] && a0[1] === aN[1]) {
    r = r.slice(0, n - 1);
    closed = true;
  }
  const m = r.length;
  if (m < 8) return ring;
  const dist = (p: number[], q: number[]) =>
    Math.hypot(p[0] - q[0], p[1] - q[1]);
  const steps: number[] = [];
  for (let i = 0; i < m; i++) steps.push(dist(r[i], r[(i + 1) % m]));
  const med = [...steps].sort((x, y) => x - y)[Math.floor(m / 2)] || 0;
  if (med <= 0) return ring;

  // Bounding-Box-Diagonale des Rings (Maßstab für die Lücken-Heuristik).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of r) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  const diag = Math.hypot(maxX - minX, maxY - minY) || 1;

  const MAXRUN = 6; // maximale Spornlänge in Kanten
  const RUNMED = 16; // Lauf muss > RUNMED × Median-Schritt sein
  const RUNDIAG = 0.25; // Lauf muss > RUNDIAG × Ring-Diagonale sein
  const GAPLEN = 0.15; // Basislücke < GAPLEN × Lauflänge
  const GAPDIAG = 0.12; // Basislücke < GAPDIAG × Ring-Diagonale
  const FARFRAC = 0.03; // Punkt zählt als „hinausragend", wenn Abstand zur Sehne > FARFRAC × Diagonale
  const WIDTHFRAC = 0.12; // senkrechte Spornbreite < WIDTHFRAC × Ring-Diagonale

  // Abstand von Punkt P zur (unendlichen) Geraden durch die Sehne A–B. Bei
  // verschwindender Sehne (Basislücke ≈ 0) auf den Abstand zu A zurückfallen.
  const lineDist = (P: number[], A: number[], B: number[]) => {
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const l = Math.hypot(dx, dy);
    if (l < 1e-12) return dist(P, A);
    return Math.abs((P[0] - A[0]) * dy - (P[1] - A[1]) * dx) / l;
  };

  const remove = new Array<boolean>(m).fill(false);
  let i = 0;
  while (i < m) {
    let advanced = false;
    let len = 0;
    for (let k = 1; k <= MAXRUN; k++) {
      len += steps[(i + k - 1) % m];
      const A = r[i];
      const B = r[(i + k) % m];
      const base = dist(A, B);
      if (
        len > med * RUNMED &&
        len > diag * RUNDIAG &&
        base < GAPLEN * len &&
        base < GAPDIAG * diag
      ) {
        // Innerhalb des Laufs nur die tatsächlich HINAUSRAGENDEN Punkte (weit von
        // der Wiederverbindungs-Sehne A–B) entfernen; körpernahe Punkte bleiben,
        // damit reale Eckpunkte neben einem Sporn nicht mit gelöscht werden.
        const farIdx: number[] = [];
        let farPt = A;
        let fd = -1;
        for (let t = 1; t < k; t++) {
          const P = r[(i + t) % m];
          if (lineDist(P, A, B) > FARFRAC * diag) {
            farIdx.push((i + t) % m);
            const d = dist(A, P);
            if (d > fd) {
              fd = d;
              farPt = P;
            }
          }
        }
        if (farIdx.length > 0) {
          // Spornachse A->entferntester Punkt; senkrechte Spannweite der weit
          // herausragenden Punkte trennt einen dünnen Sporn von einer breiten
          // Ausstülpung/Tropfenspitze (große Spannweite -> erhalten).
          const ax = farPt[0] - A[0];
          const ay = farPt[1] - A[1];
          const al = Math.hypot(ax, ay) || 1;
          const ux = ax / al;
          const uy = ay / al;
          let pmin = Infinity;
          let pmax = -Infinity;
          for (const idx of farIdx) {
            const P = r[idx];
            const perp = (P[0] - A[0]) * -uy + (P[1] - A[1]) * ux;
            if (perp < pmin) pmin = perp;
            if (perp > pmax) pmax = perp;
          }
          const width = pmax >= pmin ? pmax - pmin : 0;
          if (width < WIDTHFRAC * diag) {
            for (const idx of farIdx) remove[idx] = true;
          }
        }
        i += k; // Lauf abgehandelt (entfernt oder als breit verworfen)
        advanced = true;
        break;
      }
    }
    if (!advanced) i++;
  }

  if (!remove.some(Boolean)) return ring;
  const out = r.filter((_, i) => !remove[i]);
  if (out.length < 3) return ring; // Sicherheit: Ring nicht degenerieren lassen
  if (closed) out.push(out[0].slice());
  return out;
}

function deSpikeCoordinates(type: string, coordinates: any): any {
  // Auch mehrringige Polygone (Donut: Außenring + Loch-Ringe) werden ent-spikt:
  // die konservativen Schwellen lassen saubere Loch-Ringe (z. B. die EBAW-
  // Flughafen-CTRs) unangetastet, entfernen aber dünne Brücken-Flügel, die in
  // einzelnen Ringen stecken (z. B. EBOS VLL2 Innenloch). Jeder Ring wird
  // unabhängig geprüft.
  if (type === "Polygon") {
    return (coordinates as number[][][]).map((ring) => deSpikeRing(ring));
  }
  if (type === "MultiPolygon") {
    return (coordinates as number[][][][]).map((poly) =>
      poly.map((ring) => deSpikeRing(ring)),
    );
  }
  return coordinates;
}

// Entfernt Brücken-Spitzen aus einer (Multi-)Polygon-Geometrie. Reine
// Durchreiche für alle anderen Geometrie-Typen.
export function cleanBelgianGeometry(
  geometry: { type: string; coordinates: any } | null,
): { type: string; coordinates: any } | null {
  if (!geometry || !geometry.coordinates) return geometry;
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    return geometry;
  }
  return {
    type: geometry.type,
    coordinates: deSpikeCoordinates(geometry.type, geometry.coordinates),
  };
}

// --- Selbstprüfung der Sporn-Bereinigung (Frühwarnung beim Daten-Refresh) ------
//
// `deSpikeRing` ist mit numerischen Schwellen gegen die AKTUELL gebündelte
// Fixture (server/data/belgian-geozones.json) kalibriert. Wird das Bundle aus
// dem Live-skeyes-Feed neu erzeugt oder kommen neue Zonen hinzu, können
// Spornformen mit Metriken nahe den Schwellen durchrutschen und wieder mit
// Zacken rendern – ohne dass der reine Fixture-Regressionstest das fängt.
//
// `auditBelgianSpurs` prüft eine bereits BEREINIGTE Geometrie UNABHÄNGIG von
// `deSpikeRing` nach (Länge-vs-Lücke statt Achsen-Heuristik, damit die Prüfung
// nicht tautologisch ist) und meldet zwei Klassen:
//   - `residual`: dünne „Out-and-back"-Sporne, die nach der Bereinigung NOCH
//     vorhanden sind -> echter Fehler (die Bereinigung hat sie verfehlt).
//   - `ambiguous`: Läufe, die die Längenkriterien eines Sporns erfüllen und
//     deren Wiederverbindungslücke nur knapp ÜBER der Sporn-Schwelle liegt
//     (bis SPUR_AMBIGUOUS_MARGIN ×). Das sind Grenzfälle (z. B. CTR-Tropfen mit
//     schmalem Hals): heute korrekt erhalten, aber ein kleiner Datendrift könnte
//     sie kippen lassen. Sie sind KEIN Fehler, sondern eine Frühwarnung, die der
//     Daten-Refresh sichtbar macht.

const SPUR_AUDIT = {
  MAXRUN: 6,
  RUNMED: 16,
  RUNDIAG: 0.25,
  GAPLEN: 0.15,
  GAPDIAG: 0.12,
  // Marge für die Grenzfall-Erkennung: ein Lauf gilt als mehrdeutig, wenn seine
  // Lücke kleiner als MARGIN × der eigentlichen Sporn-Schwelle ist.
  AMBIGUOUS_MARGIN: 1.5,
} as const;

function auditSpurRing(ring: number[][]): {
  residual: number;
  ambiguous: number;
} {
  if (!Array.isArray(ring) || ring.length < 8) {
    return { residual: 0, ambiguous: 0 };
  }
  let r = ring;
  const n = r.length;
  if (
    r[0] &&
    r[n - 1] &&
    r[0][0] === r[n - 1][0] &&
    r[0][1] === r[n - 1][1]
  ) {
    r = r.slice(0, n - 1);
  }
  const m = r.length;
  if (m < 8) return { residual: 0, ambiguous: 0 };

  const dist = (p: number[], q: number[]) =>
    Math.hypot(p[0] - q[0], p[1] - q[1]);
  const step = (i: number) => dist(r[i], r[(i + 1) % m]);
  const med =
    [...Array(m)].map((_, i) => step(i)).sort((x, y) => x - y)[
      Math.floor(m / 2)
    ] || 0;
  if (med <= 0) return { residual: 0, ambiguous: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of r) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  const diag = Math.hypot(maxX - minX, maxY - minY) || 1;

  const { MAXRUN, RUNMED, RUNDIAG, GAPLEN, GAPDIAG, AMBIGUOUS_MARGIN } =
    SPUR_AUDIT;
  let residual = 0;
  let ambiguous = 0;
  for (let i = 0; i < m; i++) {
    let len = 0;
    for (let k = 1; k <= MAXRUN; k++) {
      len += step((i + k - 1) % m);
      const gap = dist(r[i], r[(i + k) % m]);
      // Nur echte „Ausdehnungs"-Läufe (lang gegenüber Median UND Diagonale)
      // sind überhaupt spornverdächtig – grobe Polygone bleiben außen vor.
      if (!(len > med * RUNMED && len > diag * RUNDIAG)) continue;
      const isSpur = gap < GAPLEN * len && gap < GAPDIAG * diag;
      if (isSpur) {
        residual++;
        i += k;
        break;
      }
      const isAmbiguous =
        gap < GAPLEN * len * AMBIGUOUS_MARGIN &&
        gap < GAPDIAG * diag * AMBIGUOUS_MARGIN;
      if (isAmbiguous) {
        ambiguous++;
        i += k;
        break;
      }
    }
  }
  return { residual, ambiguous };
}

// Prüft eine (bereits bereinigte) Geometrie auf verbliebene / grenzwertige
// Sporne. Reine Durchreiche (0/0) für Nicht-Polygon-Geometrien.
export function auditBelgianSpurGeometry(
  geometry: { type: string; coordinates: any } | null,
): { residual: number; ambiguous: number } {
  if (!geometry || !geometry.coordinates) return { residual: 0, ambiguous: 0 };
  const polys =
    geometry.type === "Polygon"
      ? [geometry.coordinates as number[][][]]
      : geometry.type === "MultiPolygon"
        ? (geometry.coordinates as number[][][][])
        : [];
  let residual = 0;
  let ambiguous = 0;
  for (const poly of polys) {
    for (const ring of poly) {
      const s = auditSpurRing(ring);
      residual += s.residual;
      ambiguous += s.ambiguous;
    }
  }
  return { residual, ambiguous };
}

export interface BelgianSpurAuditEntry {
  code: string;
  residual: number;
  ambiguous: number;
}

export interface BelgianSpurAuditResult {
  residual: BelgianSpurAuditEntry[];
  ambiguous: BelgianSpurAuditEntry[];
}

// Prüft eine Liste BEREITS NORMALISIERTER (= bereinigter) belgischer Features.
// `normalizeBelgianFeature` / `normalizeSkeyesApiZone` rufen cleanBelgianGeometry
// selbst auf, daher wird hier die Feature-Geometrie direkt geprüft. Liefert die
// Codes mit verbliebenen (residual) bzw. grenzwertigen (ambiguous) Spornen.
export function auditBelgianSpurs(
  features: BelgianGeoFeature[],
): BelgianSpurAuditResult {
  const residual: BelgianSpurAuditEntry[] = [];
  const ambiguous: BelgianSpurAuditEntry[] = [];
  for (const f of features || []) {
    if (!f || !f.geometry) continue;
    const code = String(
      f.properties?.code ?? f.properties?.name ?? f.id ?? "?",
    ).trim();
    const s = auditBelgianSpurGeometry(f.geometry);
    if (s.residual > 0) residual.push({ code, residual: s.residual, ambiguous: s.ambiguous });
    else if (s.ambiguous > 0) ambiguous.push({ code, residual: 0, ambiguous: s.ambiguous });
  }
  return { residual, ambiguous };
}

// Liefert `null`, wenn keine renderbare Polygon-Geometrie vorliegt.
export function normalizeBelgianFeature(
  f: BelgianGeoFeature,
): BelgianGeoFeature | null {
  if (!f || !f.geometry) return null;
  const g = f.geometry;
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") return null;

  const p: Record<string, any> = f.properties || {};
  const restriction = belgianRestriction(p.restriction);
  const lowerMeters = belgianAltitudeMeters(p.lowerAltitude) ?? 0;
  const upperMeters = belgianAltitudeMeters(p.upperAltitude);

  const code = String(p.code ?? "").trim();
  const name = String(p.name ?? "").trim() || code || "Geozone";
  const typeDe = translateBelgianType(p.type);
  const upperRef = belgianAltitudeReference(
    (p.upperAltitude && p.upperAltitude.reference) ??
      (p.lowerAltitude && p.lowerAltitude.reference),
  );
  const description = stripBeHtml(String(p.description ?? ""));
  const contactLine = belgianContactLine(p.contact);

  const detailLines: string[] = [];
  if (typeDe) detailLines.push(`Typ: ${typeDe}`);
  if (code && code !== name) detailLines.push(`Code: ${code}`);
  if (upperRef) detailLines.push(`Höhenbezug: ${upperRef}`);
  if (description) detailLines.push(description);
  const subzoneInfo = belgianSubzoneInfo(p.type, code);
  if (subzoneInfo) detailLines.push(subzoneInfo);
  if (contactLine) detailLines.push(`Kontakt: ${contactLine}`);

  const properties: Record<string, any> = {
    ...p,
    restriction,
    name,
    lowerMeters,
  };
  if (upperMeters != null) properties.upperMeters = upperMeters;
  if (typeDe) properties.typeLabel = typeDe;
  if (detailLines.length > 0) properties.message = detailLines.join("\n");

  return {
    type: "Feature",
    geometry: cleanBelgianGeometry(g),
    properties,
    // bbox bewusst NICHT setzen – wird serverseitig nach der Normalisierung neu
    // berechnet (server/dataSync.ts).
  };
}

// Dedupliziert eine Feature-Liste über `properties.uniqueIdentifier` (bzw.
// feature.id). Behält das jeweils erste Vorkommen. Die hochgeladenen Archive
// enthalten Duplikate mit Suffix " 2" (gleiche uniqueIdentifier).
export function dedupeBelgianFeatures(
  features: BelgianGeoFeature[],
): BelgianGeoFeature[] {
  const seen = new Set<string>();
  const out: BelgianGeoFeature[] = [];
  for (const f of features || []) {
    const p = f?.properties || {};
    const key = String(p.uniqueIdentifier ?? f?.id ?? "").trim();
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(f);
  }
  return out;
}

// Normalisiert eine Feature-Liste (dedupliziert + normalisiert) und entfernt
// nicht darstellbare Features.
export function normalizeBelgianFeatures(
  features: BelgianGeoFeature[],
): BelgianGeoFeature[] {
  const out: BelgianGeoFeature[] = [];
  for (const f of dedupeBelgianFeatures(features || [])) {
    const n = normalizeBelgianFeature(f);
    if (n) out.push(n);
  }
  return out;
}

function localizedDroneguideValue(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "");
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      for (const lang of ["de", "nl", "fr", "en"]) {
        if (typeof parsed[lang] === "string" && parsed[lang].trim()) return parsed[lang].trim();
      }
    }
  } catch {}
  return value.trim();
}

/** Normalize Droneguide's public geo_zone_fast WFS schema into the app format. */
export function normalizeDroneguideWfsFeatures(features: BelgianGeoFeature[]): BelgianGeoFeature[] {
  const normalized: BelgianGeoFeature[] = [];
  for (const feature of features || []) {
    const p = feature?.properties || {};
    const type = String(p.type_code ?? "").toUpperCase();
    if (!feature.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type)) continue;
    // geo_zone_fast führt NOTAMs ohne Start/Ende (auch längst abgelaufene, z. B.
    // G2219/26 Tour de Luxembourg 16.–20.09.2026 als 25-NM-Kreis über ganz LU).
    // Ohne Gültigkeit nicht anzeigen – aktive NOTAMs liefert die skeyes-Live-API.
    if (type === "NOTAM") continue;
    const id = String(p.unique_identifier ?? feature.id ?? "").trim();
    if (!id) continue;
    const shaped: BelgianGeoFeature = {
      ...feature,
      properties: {
        ...p,
        uniqueIdentifier: id,
        identifier: id,
        code: String(p.code ?? p.name ?? id),
        name: localizedDroneguideValue(p.name),
        type,
        lowerAltitude: p.lower_limit_altitude == null ? undefined : {
          value: p.lower_limit_altitude,
          unit: p.lower_limit_unit,
          reference: p.lower_limit_reference,
        },
        upperAltitude: p.upper_limit_altitude == null ? undefined : {
          value: p.upper_limit_altitude,
          unit: p.upper_limit_unit,
          reference: p.upper_limit_reference,
        },
        description: localizedDroneguideValue(p.description),
        _notamEligible: type === "NOTAM" || type === "TEMPORARY-NO-FLY-ZONE",
        _source: "droneguide-wfs",
      },
    };
    // This verbose duplicate is not needed after the actual GeoJSON geometry has
    // been read, and can otherwise multiply the cached response size.
    delete shaped.properties!.original_geometry;
    const result = normalizeBelgianFeature(shaped);
    if (result) normalized.push(result);
  }
  return dedupeBelgianFeatures(normalized);
}

// --- Öffentliche skeyes-Live-API (api-cis.skeyes.be/public/uas-zones) ----------
//
// Der keylose öffentliche Endpoint liefert ein anderes Schema als die
// hochgeladenen GeoJSON-Archive: ein UASZoneVersion-Objekt nach ED-269 mit
//  - `identifier` (Zonen-Code), `name`, `restriction` (String:
//    PROHIBITED | REQ_AUTHORISATION | CONDITIONAL), `otherReasonInfo`
//    (aussagekräftiger Typ-Schlüssel, da `type` immer "COMMON" ist),
//  - `zoneAuthority[]` ({ name, contactName, service, siteURL, email, phone, … }),
//  - `applicability[]` ({ permanent, startDateTime, endDateTime, schedule }),
//  - `geometry[]` = ED-269 AirspaceVolumes ({ uomDimensions, lowerLimit,
//    lowerVerticalReference, upperLimit, upperVerticalReference,
//    horizontalProjection: GeoJSON Polygon/MultiPolygon }).
//
// Wichtig: Diese öffentliche API veröffentlicht NUR temporäre/wiederkehrende
// "COMMON"-Zonen (Modellflug, R-Gebiete, NOTAM). Die permanenten Infrastruktur-
// zonen (Gefängnisse, Militärdomänen, FANC, Flugplätze, Helistrips, CTR) sind
// hier NICHT enthalten – sie bleiben über die gebündelte FeatureCollection
// (server/data/belgian-geozones.json) erhalten und werden via
// mergeBelgianGeozones() ergänzt.

const FL_LIMIT_M = 18288; // ~FL600 (60 000 ft) -> praktisch unbegrenzt

// Höhe eines ED-269-Volumes (lowerLimit/upperLimit + uomDimensions) in Meter.
function skeyesVolumeAltitudeMeters(
  limit: any,
  uom: any,
): number | undefined {
  const value = Number(limit);
  if (!Number.isFinite(value)) return undefined;
  const u = String(uom ?? "").toUpperCase().trim();
  if (u === "FT" || u === "F") return parseHeight(value, "ft")?.m ?? undefined;
  if (u === "FL") return value >= 600 ? undefined : (parseHeight(value, "FL")?.m ?? undefined);
  // "M" bzw. Default: bereits Meter.
  if (value >= FL_LIMIT_M) return undefined;
  return value <= 0 ? 0 : value;
}

// ED-269 AirspaceVolumes -> eine einzige GeoJSON-Polygon/MultiPolygon-Geometrie.
function skeyesGeometryToGeoJson(
  volumes: any,
): { type: string; coordinates: any } | null {
  if (!Array.isArray(volumes) || volumes.length === 0) return null;
  const polys: any[] = [];
  for (const v of volumes) {
    const hp = v?.horizontalProjection;
    if (!hp || !hp.coordinates) continue;
    if (hp.type === "Polygon") {
      polys.push(hp.coordinates);
    } else if (hp.type === "MultiPolygon") {
      for (const p of hp.coordinates) polys.push(p);
    }
  }
  if (polys.length === 0) return null;
  if (polys.length === 1) return { type: "Polygon", coordinates: polys[0] };
  return { type: "MultiPolygon", coordinates: polys };
}

// zoneAuthority[] -> Kontakt im selben Schema wie die gebündelten Features
// ({ name, phone, email, url }), damit belgianContactLine() und das
// tap-to-call/email-Rendering downstream unverändert funktionieren.
function skeyesContact(zoneAuthority: any): Record<string, any> | undefined {
  if (!Array.isArray(zoneAuthority)) return undefined;
  const a = zoneAuthority.find(
    (x) => x && (x.email || x.phone || x.siteURL || x.name || x.contactName),
  );
  if (!a) return undefined;
  const name = String(a.name || a.contactName || a.service || "").trim();
  const phone = String(a.phone || "").trim();
  const email = String(a.email || "").trim();
  const url = String(a.siteURL || "").trim();
  if (!name && !phone && !email && !url) return undefined;
  const contact: Record<string, any> = {};
  if (name) contact.name = name;
  if (phone) contact.phone = phone;
  if (email) contact.email = email;
  if (url) contact.url = url;
  return contact;
}

function fmtDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(
    d.getUTCMonth() + 1,
  ).padStart(2, "0")}.${d.getUTCFullYear()}`;
}

// applicability[] -> deutsche Gültigkeitszeile. Permanente Zonen ->
// "Dauerhaft aktiv"; temporäre -> Spanne min(start)–max(end).
function skeyesValidity(applicability: any): string | undefined {
  if (!Array.isArray(applicability) || applicability.length === 0)
    return undefined;
  if (
    applicability.some(
      (a) => String(a?.permanent ?? "").toUpperCase() === "YES",
    )
  ) {
    return "Dauerhaft aktiv";
  }
  let min: Date | undefined;
  let max: Date | undefined;
  for (const a of applicability) {
    if (a?.startDateTime) {
      const s = new Date(a.startDateTime);
      if (!isNaN(s.getTime()) && (!min || s < min)) min = s;
    }
    if (a?.endDateTime) {
      const e = new Date(a.endDateTime);
      if (!isNaN(e.getTime()) && (!max || e > max)) max = e;
    }
  }
  if (min && max) return `Gültig: ${fmtDate(min)}–${fmtDate(max)}`;
  if (min) return `Gültig ab: ${fmtDate(min)}`;
  if (max) return `Gültig bis: ${fmtDate(max)}`;
  return undefined;
}

// applicability[] -> rohe Gültigkeits-Zeitstempel (ms) + permanent-Flag, damit
// nachgelagerte Konsumenten (z. B. die NOTAM-Liste) die Gültigkeitsdauer
// berechnen können (Zonen mit Gültigkeit < 30 Tagen werden zusätzlich als NOTAM
// gelistet). Permanente Zonen liefern start/end = null.
export function skeyesValidityTs(applicability: any): {
  validStartTs: number | null;
  validEndTs: number | null;
  permanent: boolean;
} {
  if (!Array.isArray(applicability) || applicability.length === 0)
    return { validStartTs: null, validEndTs: null, permanent: false };
  if (
    applicability.some((a) => String(a?.permanent ?? "").toUpperCase() === "YES")
  ) {
    return { validStartTs: null, validEndTs: null, permanent: true };
  }
  let min: number | null = null;
  let max: number | null = null;
  for (const a of applicability) {
    if (a?.startDateTime) {
      const s = new Date(a.startDateTime).getTime();
      if (!isNaN(s) && (min === null || s < min)) min = s;
    }
    if (a?.endDateTime) {
      const e = new Date(a.endDateTime).getTime();
      if (!isNaN(e) && (max === null || e > max)) max = e;
    }
  }
  return { validStartTs: min, validEndTs: max, permanent: false };
}

// Normalisiert eine einzelne skeyes-API-Zone (UASZoneVersion) in das interne
// ED-269-ähnliche Feature (gleiche Ausgabe-Form wie normalizeBelgianFeature).
// Liefert null, wenn keine darstellbare Geometrie vorliegt.
export function normalizeSkeyesApiZone(zone: any): BelgianGeoFeature | null {
  if (!zone) return null;
  const geometry = cleanBelgianGeometry(skeyesGeometryToGeoJson(zone.geometry));
  if (!geometry) return null;

  const rawRestriction = String(zone.restriction ?? "").toUpperCase().trim();
  const restriction = belgianRestriction(zone.restriction);
  const conditional = rawRestriction.includes("CONDITION");

  let lower: number | undefined;
  let upper: number | undefined;
  let lowerRefRaw: any;
  for (const v of zone.geometry as any[]) {
    const lo = skeyesVolumeAltitudeMeters(v?.lowerLimit, v?.uomDimensions);
    const up = skeyesVolumeAltitudeMeters(v?.upperLimit, v?.uomDimensions);
    if (lo != null && (lower == null || lo < lower)) {
      lower = lo;
      // Höhenbezug des Volumens mit der niedrigsten Untergrenze merken, damit
      // der Höhen-Filter MSL-Untergrenzen korrekt in AGL umrechnen kann.
      lowerRefRaw = v?.lowerVerticalReference;
    }
    if (up != null) upper = upper == null ? up : Math.max(upper, up);
  }
  const lowerMeters = lower ?? 0;

  const code = String(zone.identifier ?? "").trim();
  const name = String(zone.name ?? "").trim() || code || "Geozone";
  const typeKey = zone.otherReasonInfo || zone.type;
  const typeDe = translateBelgianType(typeKey);
  const vol0 = (Array.isArray(zone.geometry) ? zone.geometry[0] : null) || {};
  const upperRef = belgianAltitudeReference(
    vol0.upperVerticalReference ?? vol0.lowerVerticalReference,
  );
  const contact = skeyesContact(zone.zoneAuthority);
  const contactLine = belgianContactLine(contact);
  const validity = skeyesValidity(zone.applicability);

  const detailLines: string[] = [];
  if (typeDe) detailLines.push(`Typ: ${typeDe}`);
  if (code && code !== name) detailLines.push(`Code: ${code}`);
  if (conditional) detailLines.push("Bedingte Freigabe");
  if (upperRef) detailLines.push(`Höhenbezug: ${upperRef}`);
  if (validity) detailLines.push(validity);
  const subzoneInfo = belgianSubzoneInfo(typeKey, code);
  if (subzoneInfo) detailLines.push(subzoneInfo);
  if (contactLine) detailLines.push(`Kontakt: ${contactLine}`);

  const properties: Record<string, any> = {
    code,
    uniqueIdentifier: code,
    type: typeKey,
    restriction,
    name,
    lowerMeters,
    _live: true,
  };
  if (upper != null) properties.upperMeters = upper;
  if (lowerRefRaw != null && String(lowerRefRaw).trim() !== "") {
    properties.lowerReference = lowerRefRaw;
  }
  if (typeDe) properties.typeLabel = typeDe;
  if (contact) properties.contact = contact;
  const _validityTs = skeyesValidityTs(zone.applicability);
  if (_validityTs.validStartTs != null) properties.validStartTs = _validityTs.validStartTs;
  if (_validityTs.validEndTs != null) properties.validEndTs = _validityTs.validEndTs;
  if (_validityTs.permanent) properties.permanent = true;
  if (detailLines.length > 0) properties.message = detailLines.join("\n");

  return { type: "Feature", geometry, properties };
}

// Normalisiert die `items[]` der öffentlichen skeyes-API (jeweils { zone }) und
// dedupliziert über den Zonen-Code.
export function normalizeSkeyesApiZones(items: any[]): BelgianGeoFeature[] {
  const out: BelgianGeoFeature[] = [];
  const seen = new Set<string>();
  for (const it of items || []) {
    const zone = it && (it.zone ?? it);
    const n = normalizeSkeyesApiZone(zone);
    if (!n) continue;
    const code = String(n.properties?.code ?? "").trim();
    if (code) {
      if (seen.has(code)) continue;
      seen.add(code);
    }
    out.push(n);
  }
  return out;
}

// Führt zuerst übergebene Zonen mit weiteren Quellen zusammen. Stabile UUIDs
// und Codes verhindern Duplikate; die erste Quelle hat Vorrang.
export function mergeBelgianGeozones(
  apiFeatures: BelgianGeoFeature[],
  bundledFeatures: BelgianGeoFeature[],
): BelgianGeoFeature[] {
  const notamKeyOf = (f: BelgianGeoFeature): string | undefined => {
    const p = f?.properties || {};
    const isNotam =
      p._notamEligible === true || String(p.type ?? "").toUpperCase() === "NOTAM";
    if (!isNotam) return undefined;
    for (const candidate of [p.code, p.name]) {
      const match = String(candidate ?? "")
        .trim()
        .toUpperCase()
        .match(/^([A-Z])(\d{4})\/?(\d{2})$/);
      if (match) return `notam:${match[1]}${match[2]}/${match[3]}`;
    }
    return undefined;
  };
  const keysOf = (f: BelgianGeoFeature) => {
    const p = f?.properties || {};
    return [p.uniqueIdentifier, p.unique_identifier, p.code, notamKeyOf(f)]
      .map((key) => String(key ?? "").trim())
      .filter(Boolean);
  };
  const preferredKeys = new Set<string>();
  const preferredByNotamKey = new Map<string, number>();
  for (const [index, f] of (apiFeatures || []).entries()) {
    const keys = keysOf(f);
    for (const key of keys) {
      preferredKeys.add(key);
      if (key.startsWith("notam:")) preferredByNotamKey.set(key, index);
    }
  }
  const merged: BelgianGeoFeature[] = [...(apiFeatures || [])];
  for (const f of bundledFeatures || []) {
    const keys = keysOf(f);
    const notamKey = notamKeyOf(f);
    if (keys.some((key) => preferredKeys.has(key))) {
      // Die offizielle skeyes-Live-Zone und der Droneguide-WFS-Datensatz führen
      // dieselbe NOTAM-Nummer mit unterschiedlicher ID-Schreibweise
      // (z. B. F271026 vs. F2710/26). Verknüpfe die WFS-Referenz explizit mit
      // dem bevorzugten Live-Feature, das die belegten Gültigkeitszeiten trägt.
      const preferredIndex = notamKey ? preferredByNotamKey.get(notamKey) : undefined;
      const wfsId = String(f.properties?._source ?? "") === "droneguide-wfs"
        ? String(f.properties?.uniqueIdentifier ?? f.properties?.unique_identifier ?? "").trim()
        : "";
      if (preferredIndex != null && wfsId) {
        const preferred = merged[preferredIndex];
        merged[preferredIndex] = {
          ...preferred,
          properties: {
            ...(preferred.properties || {}),
            droneguideWfsUniqueIdentifier: wfsId,
            droneguideWfsCode: String(f.properties?.code ?? "").trim(),
          },
        };
      }
      continue; // zuerst übergebene Quelle hat Vorrang
    }
    for (const key of keys) preferredKeys.add(key);
    if (notamKey) preferredByNotamKey.set(notamKey, merged.length);
    merged.push(f);
  }
  return merged;
}
