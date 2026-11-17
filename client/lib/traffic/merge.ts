// Zusammenführen der Roh-Meldungen aller Quellen (ICAO-Hex, Registrierung,
// Fuzzy-Pass für anonymisierte PIA-Dubletten). Aus dem früheren
// Server-Aggregator (server/aggregator.ts) übernommen.
import type { RawState } from "./types";
import { angleDiff, bearingDeg, quickDistanceM } from "./geo";
import { aircraftMslM } from "./altitude";

export function mergeReports(reports: RawState[]): RawState {
  const base: RawState = { ...reports[0] };
  base.sources = Array.from(new Set(reports.flatMap((r) => r.sources)));
  for (const r of reports.slice(1)) {
    if (!base.callsign && r.callsign) base.callsign = r.callsign;
    if (!base.originCountry && r.originCountry) base.originCountry = r.originCountry;
    if (base.category === "unknown" && r.category !== "unknown") base.category = r.category;
    if (base.baroAltitude == null && r.baroAltitude != null) base.baroAltitude = r.baroAltitude;
    if (base.geoAltitude == null && r.geoAltitude != null) base.geoAltitude = r.geoAltitude;
    if (base.mslAltitude == null && r.mslAltitude != null) base.mslAltitude = r.mslAltitude;
    if (base.velocity == null && r.velocity != null) base.velocity = r.velocity;
    if (base.trueTrack == null && r.trueTrack != null) base.trueTrack = r.trueTrack;
    if (base.verticalRate == null && r.verticalRate != null) base.verticalRate = r.verticalRate;
    if (!base.registration && r.registration) base.registration = r.registration;
    if (!base.aircraftType && r.aircraftType) base.aircraftType = r.aircraftType;
    if (!base.aircraftDesc && r.aircraftDesc) base.aircraftDesc = r.aircraftDesc;
    if (!base.operator && r.operator) base.operator = r.operator;
    if (!base.cn && r.cn) base.cn = r.cn;
    if (!base.military && r.military) base.military = true;
    if (!base.interesting && r.interesting) base.interesting = true;
    if (!base.pia && r.pia) base.pia = true;
    if (!base.ladd && r.ladd) base.ladd = true;
    if (!base.originIata && r.originIata) base.originIata = r.originIata;
    if (!base.destIata && r.destIata) base.destIata = r.destIata;
    if (!base.flightNumber && r.flightNumber) base.flightNumber = r.flightNumber;
    // Frischeste Meldung bestimmt das Alter des zusammengeführten Eintrags.
    if (r.reportAgeMs == null || base.reportAgeMs == null) base.reportAgeMs = undefined;
    else base.reportAgeMs = Math.min(base.reportAgeMs, r.reportAgeMs);
  }
  return base;
}

function normReg(r?: string): string | null {
  if (!r) return null;
  const norm = r.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return norm.length >= 4 ? norm : null;
}

// Fuzzy-Merge für anonymisierte (PIA-)Dubletten: Quellen vergeben bei Privacy-
// ICAO-Adressen rotierende/unterschiedliche Hex-IDs, sodass weder der ICAO-Hex-
// noch der Registrierungs-Pass greift. Hier werden Einträge anhand eines
// gemeinsamen Muster-/Callsign-Kürzels in Kombination mit sehr enger Positions-,
// Höhen-, Kurs- und Geschwindigkeitstoleranz zusammengeführt. Die Schwellwerte
// sind bewusst konservativ, damit echte, dicht beieinander fliegende Maschinen
// desselben Musters (z. B. Formationsflüge) NICHT verschmolzen werden.
const FUZZY_POS_TOLERANCE_M = 500;
const FUZZY_ALT_TOLERANCE_M = 150;
const FUZZY_TRACK_TOLERANCE_DEG = 30;
const FUZZY_VELOCITY_TOLERANCE_MS = 30;
// Zwei Quellen sampeln denselben PIA-Track zu leicht verschiedenen Zeitpunkten:
// OpenSky/FR24 laufen dem schnellen ADS-B-Feed (adsb.fi/airplanes.live) oft
// sekundenweise hinterher. Bei ~52 m/s (187 km/h) driften die gemeldeten
// Positionen dadurch mehrere hundert Meter auseinander und sprengen die feste
// 500-m-Toleranz — dasselbe Flugzeug erscheint doppelt (z. B. "OO-MSA/DA-62"
// vs. reines Callsign "DA62"). Die Positionstoleranz wächst deshalb mit der
// Geschwindigkeit (gedeckelt). Eine so vergrößerte Lücke wird aber nur
// akzeptiert, wenn sie IN Flugrichtung liegt (Zeitversatz desselben Flugzeugs)
// und NICHT quer dazu (echte Formation zweier Maschinen desselben Musters).
const FUZZY_SKEW_SECONDS = 20;
const FUZZY_POS_TOLERANCE_MAX_M = 2000;
const FUZZY_ALONG_TRACK_TOLERANCE_DEG = 45;

function normCode(s?: string): string | null {
  if (!s) return null;
  const n = s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return n.length >= 3 ? n : null;
}

function fuzzyAltitude(a: RawState): number | null {
  return aircraftMslM(a);
}

// Teilen sich zwei Einträge ein Muster-/Callsign-Kürzel? Das Kürzel muss auf
// mindestens einer Seite aus dem Callsign stammen (klassisches PIA-Muster:
// Quelle zeigt den Typ-Designator "DA62" als Callsign), damit ein reiner
// Typ==Typ-Treffer (Formationsflug) NICHT als gemeinsames Kürzel zählt.
function fuzzyShareCode(a: RawState, b: RawState): boolean {
  const ca = normCode(a.callsign);
  const cb = normCode(b.callsign);
  const ta = normCode(a.aircraftType);
  const tb = normCode(b.aircraftType);
  if (ca && (ca === tb || ca === cb)) return true;
  if (cb && (cb === ta || cb === ca)) return true;
  // Fallback: Callsign-Kürzel taucht in der Typbeschreibung der Gegenseite auf
  // (z. B. Callsign "DA62" in aircraftDesc "DIAMOND DA-62").
  const da = normCode(a.aircraftDesc);
  const db = normCode(b.aircraftDesc);
  if (ca && ca.length >= 4 && db && db.includes(ca)) return true;
  if (cb && cb.length >= 4 && da && da.includes(cb)) return true;
  return false;
}

function fuzzyDuplicate(a: RawState, b: RawState): boolean {
  if (a.onGround || b.onGround) return false;
  // Schwerpunkt auf anonymisierte Ziele: mindestens eine Seite PIA.
  if (!a.pia && !b.pia) return false;
  // Harte, widersprüchliche Identitätsmerkmale → verschiedene Luftfahrzeuge.
  const ra = normReg(a.registration);
  const rb = normReg(b.registration);
  if (ra && rb && ra !== rb) return false;
  const ta = normCode(a.aircraftType);
  const tb = normCode(b.aircraftType);
  if (ta && tb && ta !== tb) return false;
  if (!fuzzyShareCode(a, b)) return false;
  const altA = fuzzyAltitude(a);
  const altB = fuzzyAltitude(b);
  if (altA == null || altB == null) return false;
  if (Math.abs(altA - altB) > FUZZY_ALT_TOLERANCE_M) return false;
  if (a.velocity != null && b.velocity != null && Math.abs(a.velocity - b.velocity) > FUZZY_VELOCITY_TOLERANCE_MS) {
    return false;
  }
  // Geschwindigkeitsabhängige Positionstoleranz: gleicht den Zeitversatz
  // zwischen Quellen aus (schnelles Flugzeug + langsamere Quelle = größere Lücke).
  const maxV = Math.max(a.velocity ?? 0, b.velocity ?? 0, 0);
  const posTol = Math.min(FUZZY_POS_TOLERANCE_MAX_M, FUZZY_POS_TOLERANCE_M + maxV * FUZZY_SKEW_SECONDS);
  const dist = quickDistanceM(a.latitude, a.longitude, b.latitude, b.longitude);
  if (dist > posTol) return false;
  if (dist <= FUZZY_POS_TOLERANCE_M) {
    // Eng beieinander: der momentane Kurs muss übereinstimmen (falls beide bekannt).
    if (a.trueTrack != null && b.trueTrack != null && angleDiff(a.trueTrack, b.trueTrack) > FUZZY_TRACK_TOLERANCE_DEG) {
      return false;
    }
  } else {
    // Weiter getrennt: nur mit Richtungsbestätigung akzeptieren. Ohne beidseitigen
    // Kurs fehlt die Zeitversatz-Signatur (Lücke IN Flugrichtung) → konservativ
    // ablehnen, damit die vergrößerte Toleranz keine echten Ziele verschmilzt.
    if (a.trueTrack == null || b.trueTrack == null) return false;
    const brng = bearingDeg(a.latitude, a.longitude, b.latitude, b.longitude);
    const alignA = Math.min(angleDiff(brng, a.trueTrack), angleDiff(brng, (a.trueTrack + 180) % 360));
    const alignB = Math.min(angleDiff(brng, b.trueTrack), angleDiff(brng, (b.trueTrack + 180) % 360));
    if (Math.min(alignA, alignB) > FUZZY_ALONG_TRACK_TOLERANCE_DEG) return false;
  }
  return true;
}

// Reihenfolge innerhalb einer Dubletten-Gruppe: aussagekräftigster Eintrag zuerst,
// damit mergeReports ihn als Basis nimmt und seine icao24 erhalten bleibt.
function fuzzyBaseScore(x: RawState): number {
  return (
    (x.registration ? 8 : 0) +
    (x.aircraftDesc ? 4 : 0) +
    (x.aircraftType ? 2 : 0) +
    (x.sources?.length ?? 0)
  );
}

export function fuzzyMergePass(states: RawState[]): { merged: RawState[]; droppedIds: string[] } {
  const n = states.length;
  const parent = states.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(i: number, j: number): void {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (fuzzyDuplicate(states[i], states[j])) union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const g = groups.get(root) || [];
    g.push(i);
    groups.set(root, g);
  }
  const merged: RawState[] = [];
  const droppedIds: string[] = [];
  for (const idxs of groups.values()) {
    if (idxs.length === 1) {
      merged.push(states[idxs[0]]);
      continue;
    }
    const reports = idxs.map((i) => states[i]).sort((a, b) => fuzzyBaseScore(b) - fuzzyBaseScore(a));
    const winner = mergeReports(reports);
    winner.icao24 = reports[0].icao24;
    merged.push(winner);
    for (let k = 1; k < reports.length; k++) droppedIds.push(reports[k].icao24);
  }
  return { merged, droppedIds };
}

export function mergeByIcao(perSource: { states: RawState[] }[]): { merged: RawState[]; droppedIds: string[] } {
  const byIcao = new Map<string, RawState[]>();
  const ognFlarmToIcao = new Map<string, string>();
  for (const src of perSource) {
    for (const ac of src.states) {
      if (!ac.icao24 || ac.icao24.length < 3) continue;
      if (ac.icao24.startsWith("ogn_flr") || ac.icao24.startsWith("ogn_ica")) {
        const hex = ac.icao24.substring(7);
        if (hex.length === 6) ognFlarmToIcao.set(ac.icao24, hex);
      }
      const list = byIcao.get(ac.icao24) || [];
      list.push(ac);
      byIcao.set(ac.icao24, list);
    }
  }
  for (const [ognKey, hex] of ognFlarmToIcao) {
    const adsb = byIcao.get(hex);
    if (adsb && byIcao.has(ognKey)) {
      const ognReports = byIcao.get(ognKey)!;
      byIcao.set(hex, [...ognReports, ...adsb]);
      byIcao.delete(ognKey);
    }
  }
  const merged: RawState[] = [];
  for (const [key, reports] of byIcao) {
    const m = reports.length === 1 ? { ...reports[0] } : mergeReports(reports);
    // Schlüssel der Gruppe als ID übernehmen: nach dem OGN→ICAO-Umhängen steht
    // die OGN-Meldung vorn, mergeReports würde sonst deren "ogn_flr…"-ID
    // behalten (Fehler im früheren Server-Code → Geister-/Doppel-Einträge).
    m.icao24 = key;
    merged.push(m);
  }
  // Zweiter Pass: gleiche Registrierung → zusammenführen. Notwendig, weil
  // OGN/FLARM-Meldungen oft eine FLARM-Device-ID statt des ICAO-Hex tragen
  // (typisch bei ADS-B+FLARM-Mehrfachbestückung wie ADAC-BK117). DDB liefert
  // die Registrierung, ADS-B-Quellen meist auch — daran lässt sich sicher
  // matchen. Nicht-ADS-B-Eintrag (ogn_*) wird zugunsten des ICAO-Hex-Eintrags
  // verworfen, sein Inhalt aber per mergeReports übernommen.
  const byReg = new Map<string, RawState[]>();
  for (const ac of merged) {
    const key = normReg(ac.registration);
    if (!key) continue;
    const list = byReg.get(key) || [];
    list.push(ac);
    byReg.set(key, list);
  }
  const dropIds = new Set<string>();
  const replacements = new Map<string, RawState>();
  for (const [, dups] of byReg) {
    if (dups.length < 2) continue;
    // Bevorzuge den Eintrag mit echtem ICAO-Hex (keine synthetische ID).
    // Sowohl OGN-Device-IDs (ogn_*) als auch FR24-Radar-/Schätz-Targets ohne Hex
    // (fr24-*) ans Ende, damit die zusammengeführte Maschine den stabilen
    // ICAO-Hex-Marker behält und das Synthetik-Duplikat verworfen wird.
    dups.sort((a, b) => {
      const aSyn = a.icao24.startsWith("ogn_") || a.icao24.startsWith("fr24-") ? 1 : 0;
      const bSyn = b.icao24.startsWith("ogn_") || b.icao24.startsWith("fr24-") ? 1 : 0;
      return aSyn - bSyn;
    });
    const winner = mergeReports(dups);
    winner.icao24 = dups[0].icao24;
    replacements.set(winner.icao24, winner);
    for (let i = 1; i < dups.length; i++) dropIds.add(dups[i].icao24);
  }
  const out: RawState[] = [];
  for (const ac of merged) {
    if (dropIds.has(ac.icao24)) continue;
    out.push(replacements.get(ac.icao24) ?? ac);
  }
  // ognFlarmToIcao-Mapping liefert eine zweite Quelle von Drops (ogn_ica/ogn_flr → hex).
  const allDrops = new Set<string>(dropIds);
  for (const ognKey of ognFlarmToIcao.keys()) {
    // Nur wirklich gemergte: hex muss in byIcao gelandet sein (siehe oben).
    if (!byIcao.has(ognKey)) allDrops.add(ognKey);
  }
  // Dritter Pass: anonymisierte (PIA-)Dubletten ohne gemeinsamen Hex/Reg per
  // Muster-/Callsign-Kürzel + räumlicher Nähe zusammenführen.
  const fuzzy = fuzzyMergePass(out);
  for (const id of fuzzy.droppedIds) allDrops.add(id);
  return { merged: fuzzy.merged, droppedIds: Array.from(allDrops) };
}
