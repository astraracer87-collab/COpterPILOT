// Kroatische Geozonen (Croatia Control / HKZP – Airspace Management Cell, AMC)
// – Normalisierung der SignalR-Pushes des öffentlichen AMC-Hubs in die
// ED-269-nahe Feature-Form, die client/lib/ed269.ts (parseEd269ToGeozoneInfo)
// liest: restriction, name, lowerMeters/upperMeters, lowerReference/
// upperReference, message, applicability, validStartTs …
//
// Quelle: docs/croatia-amc-api-integration.md (Hub „aMCHub“ unter
// https://amc.crocontrol.hr/amc/signalr, anonym). Live geprüft 2026-11-15.
// Verwendete Pushes:
//  - SRVC_Areas            – statischer Katalog der AUP-gesteuerten Gebiete
//                            (live 565: D 147, TSA 183, TRA 230, MTA 4, R 1),
//                            WKT-Polygone, KEINE Zeiten.
//  - SRVC_Reservations     – Aktivierungen dieser Gebiete laut NUP/AUP (live
//                            126 Fenster, ca. 9 Tage voraus, Zeiten in UTC);
//                            enthält auch Gebiete, die nicht in SRVC_Areas
//                            stehen (z. B. LDP1, LDD22, LDATR…), mit Polygon.
//  - SRVC_DroneReservations – drohnenspezifische Zonen: dauerhafte UAS-Zonen
//                            (CTR, ATZ, URG, ULG; Platzhalter-Gültigkeit
//                            2001–2030) und zeitlich begrenzte Reservierungen
//                            (UTR, NO FLY, TRA/TSA/D für UAS-/Ballon-Betrieb).
//  - SRVC_ClientSettings   – Typ-Legende (FilterZona), nur für Texte.
//
// Zeiten: StartDate/EndDate kommen ohne Zeitzone; das AMC-Portal hängt selbst
// „Z“ an (ZoneActivationsCalculation.js) und die NUP-Tabelle (SRVC_aUPUUPs)
// nennt dieselben Zeiten in UTC → UTC.
//
// Höhen: Einheiten „FL“ (Wert = Flugfläche; 0 = GND), „ft AMSL“, „ft AGL“,
// „m AGL“ (Rohwerte). In SRVC_Reservations zusätzlich „FEET“ = HUNDERTE Fuß
// AMSL (z. B. 40 FEET = 4000 ft, abgeglichen mit der NUP-Tabelle „GND - 4000
// FEET“).
//
// Datenschutz: Benutzer-/Organisationsfelder der Reservierungen (UserName –
// teils E-Mail-Adressen –, UserId, OrganizationId, Callsigns …) werden NICHT
// übernommen.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import { wktToAreaGeometry } from "./wktParse";

export const HR_GEOZONE_SOURCE_LABEL = "Croatia Control (AMC)";
export const HR_GEOZONE_ATTRIBUTION = "Quelle: © Hrvatska kontrola zračne plovidbe (Croatia Control) – AMC-Portal";
export const HR_AMC_PORTAL_URL = "https://amc.crocontrol.hr/amc/maps/";

const FT = 0.3048;

// ---------------------------------------------------------------------------
// Höhenfilter
// ---------------------------------------------------------------------------

/** Untergrenze AGL: über 500 ft AGL (152 m) für Drohnen (max. 120 m) irrelevant. */
export const HR_MAX_RELEVANT_LOWER_AGL_M = 500 * FT;
/**
 * Untergrenze AMSL/FL: höchster Punkt Kroatiens (Dinara, 1831 m) + 120 m
 * Flughöhe + Reserve ≈ 6500 ft AMSL (1981 m). Höher beginnende Gebiete (live:
 * z. B. D FL125/FL280, TRA ab FL120) erreicht eine Drohne nirgends. Gebiete mit
 * Untergrenze bis 6500 ft bleiben – die App blendet sie per Geländehöhe
 * (shared/geozoneAltitudeFilter.ts) ggf. selbst aus.
 */
export const HR_MAX_RELEVANT_LOWER_MSL_M = 6500 * FT;

/**
 * AUP-gesteuerte Gebiete (D/TRA/TSA/R/MTA/…) ohne jede Aktivierung in
 * SRVC_Reservations: true = vorsichtshalber dauerhaft aktiv anzeigen (keine
 * applicability), false = inaktiv bis zum Ende des bekannten Datenhorizonts.
 * Gewählt: false. Laut AMC schränken TRA/TSA/D nur aktiviert ein, und der
 * Aktivierungsplan (AUP/NUP) reicht ~9 Tage voraus. Nach dem Horizont (oder
 * bei alten Offline-Daten) gelten die Gebiete wieder als aktiv.
 */
export const HR_UNRESERVED_AREAS_ALWAYS_ACTIVE = false;

/** Dauer des „nach dem Datenhorizont wieder aktiv“-Fensters (Tage). */
export const HR_POST_HORIZON_DAYS = 365;

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export type HrFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: any };
  properties: Record<string, any>;
};

export type HrAltitudeReference = "AGL" | "MSL";

export type HrAltitude = {
  meters: number;
  reference: HrAltitudeReference;
  /** Anzeige-Text (Originaleinheit). */
  text: string;
};

/** Quelle eines Features (sourceLayer). */
export type HrSourceLayer = "AREA" | "AUP" | "DRONE_ZONE" | "DRONE_RESERVATION";

/** Gesammelte Hub-Pushes (Methodenname → Argumentliste). */
export type HrHubPushes = Record<string, any[] | undefined>;

// ---------------------------------------------------------------------------
// Typ-Mapping
// ---------------------------------------------------------------------------

/**
 * AreaType → restriction. Grundlage: AMC-Portal „General Information“
 * (amc-en.crocontrol.hr/Information, abgerufen 2026-11-15), Legende aus
 * SRVC_ClientSettings.FilterZona und docs/croatia-amc-api-integration.md §3.1.
 *  - UAS-Flüge außerhalb der CTR bis 120 m AGL werden automatisch genehmigt,
 *    wenn KEIN aktives P, R, TRA, TSA oder URG betroffen ist → diese Typen
 *    (aktiv) = Flug nur mit Ausnahmegenehmigung bzw. verboten.
 *  - URG: „conditionally prohibited for UAS operations“, Ausnahmen über
 *    ASM-Verfahren → PROHIBITED (wie Doku-Vorschlag).
 *  - ULG: für UAS eingeschränkt, Genehmigung je nach UAS/Betriebsart →
 *    REQ_AUTHORISATION.
 *  - CTR: 0–50 m AGL (außerhalb URG) automatische Genehmigung per AMC-Mobile-
 *    App, darüber Buchung 7 Tage vorher → REQ_AUTHORISATION (Genehmigung
 *    nötig, wenn auch automatisiert).
 *  - ATZ: Flugplatzverkehrszone; „AERO.“-Regel des Portals (3 km um die Bahn,
 *    bis 1000 ft nur mit Zustimmung des Flugplatzbetreibers) → REQ_AUTHORISATION.
 *  - UAG: verkürztes Genehmigungsverfahren → CONDITIONAL (live nicht vorhanden).
 *  - UTR: zeitweise exklusiv für einen (fremden) UAS-Betrieb reserviert; andere
 *    UAS können jederzeit ausgeschlossen werden → CONDITIONAL (Hinweis).
 *  - D/MTA: in der Liste der genehmigungsrelevanten Typen nicht genannt;
 *    Gefahr/Militärkorridor → CONDITIONAL (Risiko selbst bewerten).
 *  - P/NO FLY → PROHIBITED; R/TRA/TSA/CBA → RESTRICTED.
 * Unbekannte Typen → REQ_AUTHORISATION (vorsichtig). FACHLICH PRÜFEN.
 */
export const HR_AREA_TYPE_RESTRICTION: Record<string, string> = {
  P: "PROHIBITED",
  "NO FLY": "PROHIBITED",
  URG: "PROHIBITED",
  R: "RESTRICTED",
  TRA: "RESTRICTED",
  TSA: "RESTRICTED",
  CBA: "RESTRICTED",
  ULG: "REQ_AUTHORISATION",
  CTR: "REQ_AUTHORISATION",
  ATZ: "REQ_AUTHORISATION",
  D: "CONDITIONAL",
  MTA: "CONDITIONAL",
  UTR: "CONDITIONAL",
  UAG: "CONDITIONAL",
};

/** Deutsche Typbezeichnungen (Legende FilterZona.Opis übersetzt). */
export const HR_AREA_TYPE_LABEL_DE: Record<string, string> = {
  CTR: "Kontrollzone (CTR)",
  ATZ: "Flugplatzverkehrszone (ATZ)",
  UTR: "UAS-Reservierung (UTR)",
  UAG: "Geografische UAS-Zone mit vereinfachter Genehmigung (UAG)",
  ULG: "Eingeschränkte geografische UAS-Zone (ULG)",
  URG: "Geografische UAS-Verbotszone (URG)",
  D: "Gefahrengebiet (D)",
  R: "Flugbeschränkungsgebiet (R)",
  P: "Luftsperrgebiet (P)",
  TRA: "Zeitweilig reserviertes Gebiet (TRA)",
  TSA: "Zeitweilig abgetrenntes Gebiet (TSA)",
  CBA: "Grenzüberschreitendes Gebiet (CBA)",
  MTA: "Militärischer Flugkorridor (MTA)",
  "NO FLY": "Flugverbotszone (NO FLY)",
};

/** Deutsche Kurzregel je Typ. */
const HR_TYPE_RULE_DE: Record<string, string> = {
  CTR: "Bis 50 m über Grund (außerhalb von URG-Zonen) automatische Genehmigung über die App „AMC Portal Mobile“ am Flugtag; über 50 m bis 120 m Buchung im AMC-Webportal mindestens 7 Tage vorher.",
  ATZ: "Flugplatzverkehrszone: Drohnenflug nur nach Abstimmung/Genehmigung (AMC-Portal bzw. Flugplatzbetreiber).",
  URG: "Drohnenflug grundsätzlich verboten (für andere Luftfahrzeuge nicht); Ausnahmen nur nach den ASM-Verfahren über das AMC-Portal.",
  ULG: "Drohnenflug eingeschränkt – abhängig von UAS und Betriebsart nur mit Genehmigung über das AMC-Portal.",
  UAG: "Drohnenflug im verkürzten Genehmigungsverfahren (AMC Portal Mobile) möglich.",
  UTR: "Luftraum zeitweise exklusiv für einen anderen Drohnenbetrieb reserviert; andere Drohnen können ausgeschlossen werden – Abstand halten bzw. vorher abstimmen.",
  D: "Gefahrengebiet: während der Aktivierung Risiko selbst bewerten; Registrierung im AMC-Portal und dessen Regeln beachten.",
  R: "Während der Aktivierung keine automatische Drohnengenehmigung – Flug nur mit Ausnahmegenehmigung.",
  P: "Luftsperrgebiet: Flug verboten.",
  TRA: "Während der Aktivierung keine automatische Drohnengenehmigung – Flug nur mit Ausnahmegenehmigung.",
  TSA: "Während der Aktivierung keine automatische Drohnengenehmigung – Flug nur mit Ausnahmegenehmigung.",
  CBA: "Grenzüberschreitendes Gebiet: während der Aktivierung Flug nur mit Genehmigung.",
  MTA: "Militärischer Flugkorridor: während der Nutzung mit tief fliegenden Militärluftfahrzeugen rechnen.",
  "NO FLY": "Flugverbotszone: Drohnenflug verboten.",
};

/** AUP-/NUP-gesteuerte Gebietstypen (nur aktiv, wenn aktiviert). */
const AUP_MANAGED_TYPES = new Set(["D", "R", "TRA", "TSA", "MTA", "CBA"]);

export function normalizeHrAreaType(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function hrRestrictionForType(type: unknown): string {
  return HR_AREA_TYPE_RESTRICTION[normalizeHrAreaType(type)] ?? "REQ_AUTHORISATION";
}

// ---------------------------------------------------------------------------
// Höhen
// ---------------------------------------------------------------------------

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Höhenwert + Einheit → Meter/Bezug.
 * `hundredsFeet`: Einheit „FEET“/„FT“ zählt in Hundert Fuß (SRVC_Reservations).
 */
export function parseHrAltitude(value: unknown, unit: unknown, opts: { hundredsFeet?: boolean } = {}): HrAltitude | null {
  const n = Number(value);
  if (value == null || value === "" || !Number.isFinite(n)) return null;
  const u = String(unit ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (n <= 0) return { meters: 0, reference: "AGL", text: "GND" };
  if (u === "FL") return { meters: round1(n * 100 * FT), reference: "MSL", text: `FL ${n}` };
  const agl = /\b(AGL|SFC|GND)\b/.test(u);
  const reference: HrAltitudeReference = agl ? "AGL" : "MSL";
  const refText = agl ? "AGL" : "AMSL";
  if (/^(FEET|FT)$/.test(u) && opts.hundredsFeet) {
    const ft = n * 100;
    return { meters: round1(ft * FT), reference: "MSL", text: `${ft} ft AMSL` };
  }
  if (/^M\b/.test(u)) return { meters: round1(n), reference, text: `${n} m ${refText}` };
  // „ft AMSL“, „ft AGL“, „FEET“ (ohne Hunderter-Flag), Einheit leer → Fuß.
  return { meters: round1(n * FT), reference, text: `${Math.round(n)} ft ${refText}` };
}

export function hrLowerIsRelevant(lower: HrAltitude | null): boolean {
  if (!lower) return true;
  if (lower.meters <= 0) return true;
  const max = lower.reference === "AGL" ? HR_MAX_RELEVANT_LOWER_AGL_M : HR_MAX_RELEVANT_LOWER_MSL_M;
  return lower.meters <= max + 0.5;
}

function applyAltitudes(out: Record<string, any>, lower: HrAltitude | null, upper: HrAltitude | null): void {
  out.lowerMeters = lower ? lower.meters : 0;
  out.lowerReference = lower ? lower.reference : "AGL";
  if (upper) {
    out.upperMeters = upper.meters;
    out.upperReference = upper.reference;
  }
  out.altitudeText = `${lower?.text ?? "GND"} – ${upper?.text ?? "UNL"}`;
}

// ---------------------------------------------------------------------------
// Zeiten
// ---------------------------------------------------------------------------

/** „2026-11-16T07:00:00“ (UTC ohne Zone) → ms. */
export function hrParseUtc(value: unknown): number | null {
  if (value == null || value === "") return null;
  let s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += "Z";
  const ts = Date.parse(s);
  return Number.isFinite(ts) ? ts : null;
}

/** Platzhalter-Gültigkeit der dauerhaften Drohnenzonen (2001-01-01 … 2030-01-01). */
export function hrIsPlaceholderValidity(start: unknown, end: unknown): boolean {
  const s = hrParseUtc(start);
  const e = hrParseUtc(end);
  return s != null && e != null && new Date(s).getUTCFullYear() <= 2001 && new Date(e).getUTCFullYear() >= 2030;
}

type Window = { start: number; end: number };

function mergeWindows(windows: Window[]): Window[] {
  const sorted = windows.filter((w) => w.end > w.start).sort((a, b) => a.start - b.start);
  const out: Window[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else out.push({ ...w });
  }
  return out;
}

function windowsToApplicability(windows: Window[]): any[] {
  return windows.map((w) => ({
    permanent: "NO",
    startDateTime: new Date(w.start).toISOString(),
    endDateTime: new Date(w.end).toISOString(),
  }));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function fmtUtc(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function fmtWindowDe(w: Window): string {
  const a = new Date(w.start);
  const b = new Date(w.end);
  const sameDay = a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
  return sameDay
    ? `${fmtUtc(w.start)}–${pad2(b.getUTCHours())}:${pad2(b.getUTCMinutes())} UTC`
    : `${fmtUtc(w.start)} – ${fmtUtc(w.end)} UTC`;
}

const MAX_WINDOWS_IN_TEXT = 12;

function windowLines(windows: Window[]): string[] {
  const lines = windows.slice(0, MAX_WINDOWS_IN_TEXT).map((w) => `– ${fmtWindowDe(w)}`);
  if (windows.length > MAX_WINDOWS_IN_TEXT) lines.push(`– … und ${windows.length - MAX_WINDOWS_IN_TEXT} weitere`);
  return lines;
}

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

function cleanText(s: unknown): string {
  return String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Koordinatenzusatz „( 45° 19' 29" N, 14° 25' 45" E )“ am Namensende abtrennen. */
export function splitHrNameCoords(name: unknown): { name: string; coords?: string } {
  const s = cleanText(name);
  const m = s.match(/^(.*?)\s*\(\s*(\d{1,2}°[^()]*[NS][^()]*[EW])\s*\)\s*$/);
  if (m && m[1].trim()) return { name: m[1].trim(), coords: m[2].replace(/\s+/g, " ").trim() };
  return { name: s };
}

/** Typ-Legende aus SRVC_ClientSettings (Naziv → englische Beschreibung). */
export function hrTypeLegend(pushes: HrHubPushes): Record<string, string> {
  const fz = pushes.SRVC_ClientSettings?.[0]?.FilterZona;
  const out: Record<string, string> = {};
  if (Array.isArray(fz)) {
    for (const z of fz) {
      const k = normalizeHrAreaType(z?.Naziv);
      if (k) out[k] = cleanText(z?.Opis);
    }
  }
  return out;
}

type MessageInput = {
  type: string;
  restriction: string;
  altitudeText: string;
  legendEn?: string;
  /** Aktivierungs-/Reservierungsfenster (bereits gefiltert). */
  windows?: Window[];
  windowsTitle?: string;
  extraDe?: string[];
  originalLines?: string[];
};

function buildMessageDe(m: MessageInput): string {
  const label = HR_AREA_TYPE_LABEL_DE[m.type] ?? `Gebiet (${m.type})`;
  const lines: string[] = [`Typ: ${label}`];
  const rule = HR_TYPE_RULE_DE[m.type];
  if (rule) lines.push(`Regel: ${rule}`);
  lines.push(`Höhe laut Quelle: ${m.altitudeText}`);
  if (m.windows && m.windows.length > 0) {
    lines.push(`${m.windowsTitle ?? "Aktivierungszeiten"} (UTC):`, ...windowLines(m.windows));
  }
  if (m.extraDe) lines.push(...m.extraDe.filter(Boolean));
  lines.push(
    `Quelle: ${HR_GEOZONE_SOURCE_LABEL} – nur zur Information, nicht zur Navigation. Vor dem Flug Genehmigungen und aktuelle Aktivierungen im AMC-Portal prüfen.`,
  );
  const original = [m.legendEn ? `${m.type}: ${m.legendEn}` : "", ...(m.originalLines ?? [])].filter(Boolean);
  if (original.length > 0) lines.push("", "Originaltext der Behörde:", ...original);
  return lines.join("\n");
}

function localized(message: string, en: string[]): Record<string, any> {
  const enText = en.filter(Boolean).join("\n");
  return {
    localizedMessages: [{ language: "de", message }, ...(enText ? [{ language: "en", message: enText }] : [])],
  };
}

function stripUndefined(o: Record<string, any>): Record<string, any> {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

// ---------------------------------------------------------------------------
// Aktivierungen (SRVC_Reservations)
// ---------------------------------------------------------------------------

type Activation = {
  name: string;
  type: string;
  window: Window;
  lower: HrAltitude | null;
  upper: HrAltitude | null;
  status: string;
  poligon: string;
};

function parseActivations(list: any[]): Activation[] {
  const out: Activation[] = [];
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || typeof r !== "object") continue;
    const start = hrParseUtc(r.StartDate);
    const end = hrParseUtc(r.EndDate);
    if (start == null || end == null || end <= start) continue;
    out.push({
      name: cleanText(r.Name),
      type: normalizeHrAreaType(r.AreaType),
      window: { start, end },
      lower: parseHrAltitude(r.LowerreservedFL, r.LowerUnit, { hundredsFeet: true }),
      upper: parseHrAltitude(r.UpperreservedFL, r.UpperUnit, { hundredsFeet: true }),
      status: cleanText(r.ReservationStatus).toUpperCase(),
      poligon: String(r.Poligon ?? ""),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Normalisierung
// ---------------------------------------------------------------------------

export type HrDropReason =
  | "no_geometry"
  | "lower_too_high"
  | "expired"
  | "retired"
  | "no_relevant_activation"
  | "duplicate"
  | "merged_into_area";

export type HrNormalizeResult = {
  features: HrFeature[];
  dropped: Partial<Record<HrDropReason, number>>;
  /** Ende des bekannten Aktivierungshorizonts (ms) oder null. */
  horizonTs: number | null;
};

export type HrNormalizeOptions = {
  unreservedAlwaysActive?: boolean;
};

// Taktische Status der Drohnenreservierungen, die nicht mehr gelten
// (TAReq_Retired = zurückgezogen, TAReq_Finished = beendet).
const DRONE_STATUS_INACTIVE = new Set([5, 8]);
const DRONE_STATUS_TEXT_INACTIVE = /RETIRED|FINISHED|CANCEL|REJECT/i;

/**
 * Normalisiert alle relevanten Pushes. `now` steuert das Verwerfen
 * abgelaufener Fenster (Ende < now).
 */
export function normalizeCroatiaHub(pushes: HrHubPushes, now: Date = new Date(), opts: HrNormalizeOptions = {}): HrNormalizeResult {
  const nowTs = now.getTime();
  const unreservedAlwaysActive = opts.unreservedAlwaysActive ?? HR_UNRESERVED_AREAS_ALWAYS_ACTIVE;
  const legend = hrTypeLegend(pushes);
  const dropped: Partial<Record<HrDropReason, number>> = {};
  const drop = (r: HrDropReason) => {
    dropped[r] = (dropped[r] ?? 0) + 1;
  };
  const features: HrFeature[] = [];

  const areas: any[] = Array.isArray(pushes.SRVC_Areas?.[0]) ? pushes.SRVC_Areas![0] : [];
  const activations = parseActivations(Array.isArray(pushes.SRVC_Reservations?.[0]) ? pushes.SRVC_Reservations![0] : []);
  const drones: any[] = Array.isArray(pushes.SRVC_DroneReservations?.[0]) ? pushes.SRVC_DroneReservations![0] : [];

  // Datenhorizont: spätestes Ende aller Aktivierungen. Danach ist nichts
  // bekannt → vorsichtshalber wieder als aktiv werten.
  let horizonTs: number | null = null;
  for (const a of activations) if (horizonTs == null || a.window.end > horizonTs) horizonTs = a.window.end;

  const actByName = new Map<string, Activation[]>();
  for (const a of activations) {
    const k = a.name.toUpperCase();
    const list = actByName.get(k);
    if (list) list.push(a);
    else actByName.set(k, [a]);
  }

  // Temporäre Drohnenreservierungen, die ein vorhandenes AUP-Gebiet betreffen
  // (ZoneNames = Gebietsname, z. B. Ballonfahrten in LDD185): deren Aktivität
  // wird beim Gebiet vermerkt statt als eigenes Feature dupliziert.
  const areaNames = new Set<string>([
    ...areas.map((a) => cleanText(a?.Name).toUpperCase()),
    ...activations.map((a) => a.name.toUpperCase()),
  ]);
  const activityByArea = new Map<string, Set<string>>();

  /** Aktivierungsfenster eines Gebiets (nur relevante Höhe, nicht abgelaufen). */
  const relevantWindows = (acts: Activation[]): { windows: Window[]; lower: HrAltitude | null; upper: HrAltitude | null } => {
    const ws: Window[] = [];
    let lower: HrAltitude | null = null;
    let upper: HrAltitude | null = null;
    for (const a of acts) {
      if (!hrLowerIsRelevant(a.lower)) continue;
      if (a.window.end < nowTs) continue;
      ws.push(a.window);
      if (a.lower && (!lower || a.lower.meters < lower.meters)) lower = a.lower;
      if (a.upper && (!upper || a.upper.meters > upper.meters)) upper = a.upper;
    }
    return { windows: mergeWindows(ws), lower, upper };
  };

  /**
   * applicability für ein AUP-Gebiet. Nach dem Datenhorizont gilt das Gebiet
   * vorsichtshalber wieder als aktiv: Fenster ab Horizont bis Horizont +
   * HR_POST_HORIZON_DAYS. Bewusst mit Ende (statt offen), weil die App ein
   * Gültigkeitsfenster nur mit Start UND Ende zeichnet (TrafficMapView) und
   * sonst aus dem letzten Fenster ein Ablaufdatum ableiten würde.
   */
  const postHorizon = (): any | null =>
    horizonTs == null
      ? null
      : {
          permanent: "NO",
          startDateTime: new Date(horizonTs).toISOString(),
          endDateTime: new Date(horizonTs + HR_POST_HORIZON_DAYS * 86_400_000).toISOString(),
        };
  const aupTiming = (windows: Window[], hadAnyActivation: boolean): Record<string, any> => {
    const tail = postHorizon();
    if (!hadAnyActivation) {
      if (unreservedAlwaysActive || !tail) return {};
      return { applicability: [tail] };
    }
    const app = windowsToApplicability(windows);
    if (tail) app.push(tail);
    return app.length > 0 ? { applicability: app } : {};
  };

  // --- 1) Temporäre Drohnenreservierungen vorab: Aktivitäten für Gebiete merken
  for (const r of drones) {
    if (!r || typeof r !== "object") continue;
    if (hrIsPlaceholderValidity(r.StartDate, r.EndDate)) continue;
    const zn = cleanText(r.ZoneNames).toUpperCase();
    if (zn && areaNames.has(zn)) {
      const act = cleanText(r.ActivityEN) || cleanText(r.ActivityHR);
      const set = activityByArea.get(zn) ?? new Set<string>();
      if (act) set.add(act);
      activityByArea.set(zn, set);
    }
  }

  // --- 2) Statische AUP-Gebiete (SRVC_Areas)
  const seenAreaNames = new Set<string>();
  for (const a of areas) {
    if (!a || typeof a !== "object") continue;
    const name = cleanText(a.Name);
    const key = name.toUpperCase();
    if (!name || seenAreaNames.has(key)) {
      drop("duplicate");
      continue;
    }
    seenAreaNames.add(key);
    const type = normalizeHrAreaType(a.AreaType);
    const lower = parseHrAltitude(a.Lowerflightlevel, a.LowerUnit);
    const upper = parseHrAltitude(a.Upperflightlevel, a.UpperUnit);
    if (!hrLowerIsRelevant(lower)) {
      drop("lower_too_high");
      continue;
    }
    const geometry = wktToAreaGeometry(a.Poligon);
    if (!geometry) {
      drop("no_geometry");
      continue;
    }
    const restriction = hrRestrictionForType(type);
    const acts = actByName.get(key) ?? [];
    const rel = relevantWindows(acts);
    const aupManaged = AUP_MANAGED_TYPES.has(type);
    const timing = aupManaged ? aupTiming(rel.windows, acts.length > 0) : {};
    const props: Record<string, any> = {
      identifier: name,
      zoneId: `HR-AREA-${name}`,
      name: `${name} (${type})`,
      restriction,
      zoneType: HR_AREA_TYPE_LABEL_DE[type] ?? type,
      originalType: type,
      source: HR_GEOZONE_SOURCE_LABEL,
      sourceLayer: "AREA" as HrSourceLayer,
      ...timing,
    };
    applyAltitudes(props, lower, upper);
    const extra: string[] = [];
    if (aupManaged) {
      if (acts.length === 0) {
        extra.push(
          unreservedAlwaysActive
            ? "Aktivierung über den nationalen Luftraumnutzungsplan (NUP/AUP/UUP). Für die nächsten Tage ist keine Aktivierung bekannt – vorsichtshalber als dauerhaft aktiv dargestellt; kurzfristige Aktivierung im AMC-Portal prüfen."
            : "Aktivierung über den nationalen Luftraumnutzungsplan (NUP/AUP/UUP). Für die nächsten Tage ist keine Aktivierung bekannt.",
        );
      } else if (rel.windows.length === 0) {
        extra.push("Aktivierung über NUP/AUP: bekannte Aktivierungen betreffen nur Höhen weit über Drohnenflughöhe oder sind abgelaufen.");
      } else {
        extra.push("Nur während der Aktivierungszeiten aktiv (NUP/AUP); nach dem bekannten Datenhorizont vorsichtshalber wieder als aktiv gewertet.");
        if (rel.lower || rel.upper) extra.push(`Reservierte Höhe laut AUP: ${rel.lower?.text ?? "GND"} – ${rel.upper?.text ?? "UNL"}`);
      }
    }
    const activities = [...(activityByArea.get(key) ?? [])];
    if (activities.length > 0) extra.push(`Aktivität: ${activities.join("; ")} (englischer Originaltext)`);
    const message = buildMessageDe({
      type,
      restriction,
      altitudeText: props.altitudeText,
      legendEn: legend[type],
      windows: rel.windows,
      extraDe: extra,
      originalLines: activities,
    });
    props.message = message;
    props.extendedProperties = localized(message, [legend[type] ? `${type}: ${legend[type]}` : "", ...activities]);
    if (activities.length > 0) props.activities = activities;
    features.push({ type: "Feature", geometry, properties: stripUndefined(props) });
  }

  // --- 3) Aktivierungen ohne Katalogeintrag (z. B. LDP1, LDD22, LDATR…)
  for (const [key, acts] of actByName) {
    if (seenAreaNames.has(key)) continue;
    const rel = relevantWindows(acts);
    if (rel.windows.length === 0) {
      drop(acts.every((a) => !hrLowerIsRelevant(a.lower)) ? "lower_too_high" : "no_relevant_activation");
      continue;
    }
    // Geometrie der ersten relevanten Aktivierung (je Name identisch).
    const src = acts.find((a) => hrLowerIsRelevant(a.lower) && a.window.end >= nowTs) ?? acts[0];
    const geometry = wktToAreaGeometry(src.poligon);
    if (!geometry) {
      drop("no_geometry");
      continue;
    }
    const type = src.type;
    const restriction = hrRestrictionForType(type);
    const props: Record<string, any> = {
      identifier: src.name,
      zoneId: `HR-AUP-${src.name}`,
      name: `${src.name} (${type})`,
      restriction,
      zoneType: HR_AREA_TYPE_LABEL_DE[type] ?? type,
      originalType: type,
      source: HR_GEOZONE_SOURCE_LABEL,
      sourceLayer: "AUP" as HrSourceLayer,
      ...aupTiming(rel.windows, true),
    };
    applyAltitudes(props, rel.lower, rel.upper);
    const activities = [...(activityByArea.get(key) ?? [])];
    const extra = ["Nur während der Aktivierungszeiten aktiv (NUP/AUP); nach dem bekannten Datenhorizont vorsichtshalber wieder als aktiv gewertet."];
    if (activities.length > 0) extra.push(`Aktivität: ${activities.join("; ")} (englischer Originaltext)`);
    const message = buildMessageDe({
      type,
      restriction,
      altitudeText: props.altitudeText,
      legendEn: legend[type],
      windows: rel.windows,
      extraDe: extra,
      originalLines: activities,
    });
    props.message = message;
    props.extendedProperties = localized(message, [legend[type] ? `${type}: ${legend[type]}` : "", ...activities]);
    features.push({ type: "Feature", geometry, properties: stripUndefined(props) });
  }

  // --- 4) Drohnenzonen und -reservierungen (SRVC_DroneReservations)
  type DroneGroup = { first: any; type: string; windows: Window[]; permanent: boolean; geometry: any; lower: HrAltitude | null; upper: HrAltitude | null };
  const groups = new Map<string, DroneGroup>();
  for (const r of drones) {
    if (!r || typeof r !== "object") continue;
    const type = normalizeHrAreaType(r.AreaType);
    const permanent = hrIsPlaceholderValidity(r.StartDate, r.EndDate);
    if (!permanent) {
      const zn = cleanText(r.ZoneNames).toUpperCase();
      if (zn && areaNames.has(zn)) {
        drop("merged_into_area");
        continue;
      }
      if (DRONE_STATUS_INACTIVE.has(Number(r.TacticalStatusId)) || DRONE_STATUS_TEXT_INACTIVE.test(String(r.TacticalStatus ?? ""))) {
        drop("retired");
        continue;
      }
    }
    const lower = parseHrAltitude(r.LowerreservedFL, r.LowerUnit);
    const upper = parseHrAltitude(r.UpperreservedFL, r.UpperUnit);
    if (!hrLowerIsRelevant(lower)) {
      drop("lower_too_high");
      continue;
    }
    let window: Window | null = null;
    if (!permanent) {
      const s = hrParseUtc(r.StartDate);
      const e = hrParseUtc(r.EndDate);
      if (s == null || e == null || e <= s) {
        drop("no_geometry");
        continue;
      }
      if (e < nowTs) {
        drop("expired");
        continue;
      }
      window = { start: s, end: e };
    }
    const wkt = r.Poligon || r.Poligons;
    const key = permanent
      ? `P|${type}|${cleanText(r.Name).toUpperCase()}`
      : `T|${r.ParentId ?? r.Id}|${type}|${String(wkt).replace(/\s+/g, "")}|${lower?.text}|${upper?.text}`;
    const g = groups.get(key);
    if (g) {
      if (window) g.windows.push(window);
      else drop("duplicate");
      continue;
    }
    const geometry = wktToAreaGeometry(wkt);
    if (!geometry) {
      drop("no_geometry");
      continue;
    }
    groups.set(key, { first: r, type, windows: window ? [window] : [], permanent, geometry, lower, upper });
  }

  for (const g of groups.values()) {
    const r = g.first;
    const type = g.type;
    const restriction = hrRestrictionForType(type);
    const { name: baseName, coords } = splitHrNameCoords(r.Name);
    // ZoneNames ist meist ein Ortsname; technische Werte („UTR“, „UTR414305“,
    // „D - RezID: 235531“) nicht anzeigen.
    const zoneNames = cleanText(r.ZoneNames);
    const place = zoneNames && !/RezID/i.test(zoneNames) && !new RegExp(`^${type.replace(/\s+/g, "\\s*")}\\s*\\d*$`, "i").test(zoneNames) ? zoneNames : "";
    const windows = mergeWindows(g.windows);
    const activityEn = cleanText(r.ActivityEN);
    const activityHr = cleanText(r.ActivityHR);
    let name: string;
    if (g.permanent) name = baseName;
    else {
      name = `${type}: ${baseName}`;
      if (place && place.toUpperCase() !== baseName.toUpperCase()) name += ` (${place})`;
    }
    const props: Record<string, any> = {
      identifier: g.permanent ? baseName : String(r.ParentId ?? r.Id),
      zoneId: g.permanent ? `HR-UAS-${baseName}` : `HR-RES-${r.ParentId ?? r.Id}`,
      name,
      restriction,
      zoneType: HR_AREA_TYPE_LABEL_DE[type] ?? type,
      originalType: type,
      source: HR_GEOZONE_SOURCE_LABEL,
      sourceLayer: (g.permanent ? "DRONE_ZONE" : "DRONE_RESERVATION") as HrSourceLayer,
    };
    if (!g.permanent) props.applicability = windowsToApplicability(windows);
    applyAltitudes(props, g.lower, g.upper);
    if (type === "CTR") props.openCategoryMaxAglMeters = 50;
    const extra: string[] = [];
    if (!g.permanent) {
      extra.push("Zeitlich begrenzte Reservierung im AMC-Portal – nur während der genannten Zeiten aktiv.");
      if (activityEn) extra.push(`Aktivität: ${activityEn} (englischer Originaltext)`);
      if (Number(r.TacticalStatusId) === 2) extra.push("Taktische Aktivierung durch die Flugsicherung bestätigt.");
    }
    if (coords) extra.push(`Position laut Antrag: ${coords}`);
    const original = [g.permanent ? "" : cleanText(r.Name), activityEn, activityHr].filter(Boolean);
    const message = buildMessageDe({
      type,
      restriction,
      altitudeText: props.altitudeText,
      legendEn: legend[type],
      windows,
      windowsTitle: "Reservierungszeiten",
      extraDe: extra,
      originalLines: [...new Set(original)],
    });
    props.message = message;
    props.extendedProperties = localized(message, [legend[type] ? `${type}: ${legend[type]}` : "", activityEn]);
    if (!g.permanent) {
      if (activityEn) props.activityEn = activityEn;
      if (activityHr) props.activityHr = activityHr;
      if (place) props.place = place;
      props._notamEligible = true;
    }
    features.push({ type: "Feature", geometry: g.geometry, properties: stripUndefined(props) });
  }

  // zoneId eindeutig machen (z. B. mehrere Gruppen einer ParentId).
  const ids = new Map<string, number>();
  for (const f of features) {
    const id = String(f.properties.zoneId);
    const n = (ids.get(id) ?? 0) + 1;
    ids.set(id, n);
    if (n > 1) f.properties.zoneId = `${id}-${n}`;
  }

  return { features, dropped, horizonTs };
}

/** Bequemer Wrapper: nur die Features. */
export function normalizeCroatiaFeatures(pushes: HrHubPushes, now: Date = new Date(), opts: HrNormalizeOptions = {}): HrFeature[] {
  return normalizeCroatiaHub(pushes, now, opts).features;
}

/** Hub-Methoden, die für einen vollständigen Abzug abgewartet werden. */
export const HR_REQUIRED_PUSHES = ["SRVC_Areas", "SRVC_Reservations", "SRVC_DroneReservations"] as const;
export const HR_OPTIONAL_PUSHES = ["SRVC_ClientSettings"] as const;
