// Reine Rechenlogik für das scroll-synchrone Sonnenstand-Diagramm
// (SunArcChart mit `scrollSync`): Tabellen-Scroll-Offset ↔ Zeit und die
// Stützpunkte, aus denen Animated.interpolate (nativer Treiber) die Position
// der Sonnen-Markierung berechnet. Dadurch folgt die Markierung dem Scrollen
// ohne JS-Arbeit/Re-Render pro Bild. RN-frei, unter tsx testbar.

/** Feinheit der Stützpunkte zwischen zwei Spalten (damit der Punkt dem Bogen folgt). */
export const SUN_TRACK_STEP_MS = 15 * 60_000;

/**
 * Spaltenzeiten aufbereiten: Spalte 0 („Jetzt“) = aktuelle Zeit, danach streng
 * monoton steigend (für Interpolation).
 */
export function normalizeSlotTimes(slotTimes: readonly number[], nowMs: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < slotTimes.length; i++) {
    let t = i === 0 ? nowMs : slotTimes[i];
    if (!Number.isFinite(t)) t = out.length > 0 ? out[out.length - 1] + 3_600_000 : nowMs;
    if (out.length > 0 && t <= out[out.length - 1]) t = out[out.length - 1] + 1;
    out.push(t);
  }
  return out;
}

/** Zeit (ms) zum horizontalen Scroll-Offset: Offset i*colWidth ↔ times[i], dazwischen linear, außerhalb begrenzt. */
export function timeAtScrollOffset(offsetX: number, times: readonly number[], colWidth: number): number {
  if (times.length === 0) return Date.now();
  if (times.length === 1 || !(colWidth > 0)) return times[0];
  const maxIdx = times.length - 1;
  const colF = Math.max(0, Math.min(maxIdx, (Number.isFinite(offsetX) ? offsetX : 0) / colWidth));
  const i0 = Math.floor(colF);
  const i1 = Math.min(maxIdx, i0 + 1);
  const f = colF - i0;
  return times[i0] + (times[i1] - times[i0]) * f;
}

/** Lokaler Tagesbeginn (Mitternacht) eines Zeitpunkts. */
export function localDayStart(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

export interface SunMarkerPoint {
  x: number;
  y: number;
  /** Sonnenhöhe in Grad (für Tag/Dämmerung/Nacht-Einfärbung). */
  elevationDeg: number;
}

export interface SunMarkerTrack {
  inputRange: number[];
  x: number[];
  y: number[];
  /** Deckkraft je Phase (1/0), wird zwischen den Stützpunkten überblendet. */
  dayOpacity: number[];
  twilightOpacity: number[];
  nightOpacity: number[];
}

/**
 * Stützpunkte Scroll-Offset → Markierungsposition. Zwischen zwei Spalten wird
 * in Schritten von höchstens SUN_TRACK_STEP_MS unterteilt. Liefert mindestens
 * zwei streng steigende Offsets (Anforderung von Animated.interpolate).
 */
export function buildSunMarkerTrack(
  times: readonly number[],
  colWidth: number,
  pointAt: (t: number) => SunMarkerPoint,
  stepMs: number = SUN_TRACK_STEP_MS,
): SunMarkerTrack {
  const track: SunMarkerTrack = { inputRange: [], x: [], y: [], dayOpacity: [], twilightOpacity: [], nightOpacity: [] };
  const push = (offset: number, t: number) => {
    const p = pointAt(t);
    track.inputRange.push(offset);
    track.x.push(p.x);
    track.y.push(p.y);
    track.dayOpacity.push(p.elevationDeg >= 0 ? 1 : 0);
    track.twilightOpacity.push(p.elevationDeg < 0 && p.elevationDeg >= -6 ? 1 : 0);
    track.nightOpacity.push(p.elevationDeg < -6 ? 1 : 0);
  };
  if (times.length === 0) return track;
  const w = colWidth > 0 ? colWidth : 1;
  for (let i = 0; i < times.length - 1; i++) {
    const t0 = times[i];
    const t1 = times[i + 1];
    const n = Math.max(1, Math.ceil((t1 - t0) / stepMs));
    for (let k = 0; k < n; k++) {
      push(i * w + (k / n) * w, t0 + ((t1 - t0) * k) / n);
    }
  }
  push((times.length - 1) * w, times[times.length - 1]);
  if (track.inputRange.length === 1) {
    // Eine Spalte: zweiten Punkt anhängen (Interpolation braucht ≥ 2)
    track.inputRange.push(track.inputRange[0] + 1);
    track.x.push(track.x[0]);
    track.y.push(track.y[0]);
    track.dayOpacity.push(track.dayOpacity[0]);
    track.twilightOpacity.push(track.twilightOpacity[0]);
    track.nightOpacity.push(track.nightOpacity[0]);
  }
  return track;
}
