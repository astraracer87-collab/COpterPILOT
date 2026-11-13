type WeatherSnapshot = {
  temperature: number;
  windSpeed: number;
  windGust?: number;
  rain: number;
  cloudCover: number;
  humidity: number;
  kpIndex?: number;
};

type GpsTrackPoint = { lat: number; lon: number; alt?: number; ts?: number };

type TrafficLogAircraft = {
  icao24: string;
  callsign: string;
  firstSeen: number;
  lastSeen: number;
  minAltitudeM: number;
  maxAltitudeM: number;
  closestDistanceKm: number;
  zone: "inner" | "outer" | "approach";
};

type TrafficLog = {
  startTime: number;
  endTime: number | null;
  centerLatitude: number;
  centerLongitude: number;
  innerRadiusM: number;
  outerRadiusM: number;
  aircraft: TrafficLogAircraft[];
  mapSnapshotBase64?: string;
};

type LogbookEntryFull = {
  id: string;
  droneName: string;
  droneClass: string;
  flightDate: string;
  locationName: string | null;
  takeoffTime: string | null;
  landingTime: string | null;
  flightDurationMinutes: number | null;
  maxAltitude: number | null;
  incidentOccurred: boolean;
  notes: string | null;
  latitude?: number | null;
  longitude?: number | null;
  countryIso?: string | null;
  pilotName?: string | null;
  pilotId?: string | null;
  operatorId?: string | null;
  pilotPhotoUrl?: string | null;
  weatherConditions?: WeatherSnapshot | null;
  gpsTrack?: GpsTrackPoint[] | null;
  trafficLog?: TrafficLog | TrafficLogEntry[] | null | unknown;
};

type TrafficLogEntry = {
  ts: number;
  icao24: string;
  callsign: string;
  distanceKm: number;
  altitudeM: number | null;
  bearingDeg: number;
  direction: string;
  level: "warning" | "critical";
};

type FlightSessionFull = {
  id: string;
  droneId: string;
  droneName?: string;
  currentPhase: string;
  latitude: number;
  longitude: number;
  locationName: string | null;
  countryIso: string | null;
  hasRestrictions: boolean;
  restrictionNotes: string | null;
  status: string;
  reasons: { type: string; message: string }[] | null;
  planning: any;
  createdAt: string;
  pilotName?: string | null;
  pilotId?: string | null;
  operatorId?: string | null;
  pilotPhotoUrl?: string | null;
};

const baseStyle = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; padding: 24px; line-height: 1.4; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #ddd; color: #1d4ed8; }
  .meta { color: #555; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  td, th { padding: 6px 8px; border: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 600; }
  .label { font-weight: 600; width: 35%; background: #f9fafb; }
  .footer { margin-top: 24px; font-size: 10px; color: #888; text-align: center; border-top: 1px solid #ddd; padding-top: 8px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge-go { background: #dcfce7; color: #166534; }
  .badge-warn { background: #fef3c7; color: #92400e; }
  .badge-no { background: #fee2e2; color: #991b1b; }
  .row { display: flex; gap: 8px; }
  ul { margin: 4px 0; padding-left: 18px; font-size: 12px; }
`;

function openPdfWindow(title: string, html: string) {
  const w = window.open("", "_blank");
  if (!w) {
    alert("Bitte Pop-ups erlauben, um das PDF zu öffnen.");
    return;
  }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${baseStyle}</style></head><body>${html}<div class="footer">COpter Pilot · LBA-konform · ${new Date().toLocaleString("de-DE")}</div></body></html>`);
  w.document.close();
  setTimeout(() => {
    try { w.focus(); w.print(); } catch {}
  }, 400);
}

function esc(s: string | number | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("de-DE");
}

export function exportLogbookEntryPdf(entry: LogbookEntryFull) {
  const rows = (pairs: [string, string][]) =>
    pairs.map(([k, v]) => `<tr><td class="label">${k}</td><td>${v || "—"}</td></tr>`).join("");

  const html = `
    <h1>Logbuch — Flugbericht</h1>
    <div class="meta">Flug-ID: ${esc(entry.id)} · Datum: ${esc(entry.flightDate)}</div>

    <h2>Pilot &amp; Betreiber</h2>
    <div style="display:flex; gap:16px; align-items:flex-start;">
      ${entry.pilotPhotoUrl ? `<img src="${esc(entry.pilotPhotoUrl)}" alt="Pilotenfoto" style="width:90px;height:110px;object-fit:cover;border:1px solid #ddd;border-radius:4px;" />` : ""}
      <table style="flex:1;">${rows([
        ["Pilotenname", esc(entry.pilotName) || "—"],
        ["Pilot-ID", esc(entry.pilotId) || "—"],
        ["Betreiber-ID (e-ID)", esc(entry.operatorId) || "—"],
      ])}</table>
    </div>

    <h2>Drohne</h2>
    <table>${rows([
      ["Name", esc(entry.droneName)],
      ["Klasse", esc(entry.droneClass)],
    ])}</table>

    <h2>Flug</h2>
    <table>${rows([
      ["Datum", esc(entry.flightDate)],
      ["Ort", esc(entry.locationName) || "—"],
      ["Koordinaten", entry.latitude && entry.longitude ? `${entry.latitude.toFixed(5)}, ${entry.longitude.toFixed(5)}` : "—"],
      ["Land", esc(entry.countryIso) || "—"],
      ["Start", entry.takeoffTime ? fmtDate(entry.takeoffTime) : "—"],
      ["Landung", entry.landingTime ? fmtDate(entry.landingTime) : "—"],
      ["Dauer", entry.flightDurationMinutes ? `${entry.flightDurationMinutes} min` : "—"],
      ["Max. Höhe", entry.maxAltitude ? `${entry.maxAltitude} m AGL` : "—"],
      ["Vorfall", entry.incidentOccurred ? '<span class="badge badge-no">JA</span>' : '<span class="badge badge-go">Nein</span>'],
    ])}</table>

    ${weatherSnapshotHtml(entry.weatherConditions)}

    ${gpsTrackHtml(entry.gpsTrack)}

    ${trafficLogHtml(entry.trafficLog)}

    ${entry.notes ? `<h2>Notizen</h2><p>${esc(entry.notes).replace(/\n/g, "<br>")}</p>` : ""}
  `;
  openPdfWindow(`Logbuch-${entry.flightDate}`, html);
}

function weatherSnapshotHtml(w: WeatherSnapshot | null | undefined): string {
  if (!w) return "";
  const rows = (pairs: [string, string][]) =>
    pairs.map(([k, v]) => `<tr><td class="label">${k}</td><td>${v || "—"}</td></tr>`).join("");
  return `
    <h2>Wetter-Snapshot</h2>
    <table>${rows([
      ["Temperatur", `${w.temperature?.toFixed?.(1) ?? w.temperature} °C`],
      ["Wind", `${w.windSpeed?.toFixed?.(1) ?? w.windSpeed} m/s`],
      ["Böen", w.windGust != null ? `${w.windGust.toFixed?.(1) ?? w.windGust} m/s` : "—"],
      ["Niederschlag", `${w.rain ?? 0} mm/h`],
      ["Bewölkung", `${w.cloudCover ?? 0} %`],
      ["Luftfeuchte", `${w.humidity ?? 0} %`],
      ...(w.kpIndex != null ? [["Kp-Index", `${w.kpIndex}`] as [string, string]] : []),
    ])}</table>
  `;
}

function gpsTrackHtml(track: GpsTrackPoint[] | null | undefined): string {
  if (!track || track.length === 0) return "";
  const lats = track.map((p) => p.lat);
  const lons = track.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const dLat = Math.max(1e-6, maxLat - minLat);
  const dLon = Math.max(1e-6, maxLon - minLon);
  const W = 540;
  const H = 280;
  const pad = 10;
  const project = (lat: number, lon: number): [number, number] => {
    const x = pad + ((lon - minLon) / dLon) * (W - 2 * pad);
    const y = pad + (1 - (lat - minLat) / dLat) * (H - 2 * pad);
    return [x, y];
  };
  const points = track.map((p) => project(p.lat, p.lon));
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [sx, sy] = points[0];
  const [ex, ey] = points[points.length - 1];
  const altitudes = track.map((p) => p.alt).filter((a): a is number => typeof a === "number");
  const maxAlt = altitudes.length ? Math.max(...altitudes) : null;
  const distKm = trackDistanceKm(track);
  const summary = `${track.length} Punkte · ${distKm.toFixed(2)} km${maxAlt != null ? ` · max ${Math.round(maxAlt)} m` : ""}`;
  return `
    <h2>GPS-Track</h2>
    <div style="border:1px solid #e5e7eb; border-radius:6px; padding:8px; background:#f8fafc;">
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block; max-width:100%; height:auto; background:#eef2f7;">
        <path d="${path}" stroke="#0a4d8c" stroke-width="2.5" fill="none" stroke-linejoin="round" stroke-linecap="round" />
        <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="5" fill="#16a34a" stroke="white" stroke-width="2" />
        <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="5" fill="#dc2626" stroke="white" stroke-width="2" />
      </svg>
      <div style="font-size:10px; color:#555; margin-top:6px;">
        ${summary} · <span style="color:#16a34a">●</span> Start <span style="color:#dc2626; margin-left:8px">●</span> Landung
      </div>
    </div>
  `;
}

function trackDistanceKm(track: GpsTrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < track.length; i++) {
    total += haversineKm(track[i - 1].lat, track[i - 1].lon, track[i].lat, track[i].lon);
  }
  return total;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function trafficLogHtml(raw: unknown): string {
  if (!raw) return "";
  if (Array.isArray(raw)) return trafficLogEntriesHtml(raw as TrafficLogEntry[]);
  const t = raw as TrafficLog;
  if (!t.aircraft || !Array.isArray(t.aircraft)) return "";
  const zoneLabel: Record<TrafficLogAircraft["zone"], string> = {
    inner: "Inner",
    outer: "Outer",
    approach: "Annäherung",
  };
  const summary = `
    <table>
      <tr><td class="label">Aufzeichnung ab</td><td>${fmtDate(new Date(t.startTime).toISOString())}</td></tr>
      <tr><td class="label">Aufzeichnung bis</td><td>${t.endTime ? fmtDate(new Date(t.endTime).toISOString()) : "—"}</td></tr>
      <tr><td class="label">Inner Radius</td><td>${Math.round(t.innerRadiusM)} m</td></tr>
      <tr><td class="label">Outer Radius</td><td>${Math.round(t.outerRadiusM)} m</td></tr>
    </table>
  `;
  const rows = t.aircraft
    .map(
      (a) => `
      <tr>
        <td>${esc(a.callsign) || "—"}</td>
        <td style="font-family:monospace">${esc(a.icao24)}</td>
        <td>${zoneLabel[a.zone] || "—"}</td>
        <td>${a.closestDistanceKm.toFixed(2)} km</td>
        <td>${Math.round(a.minAltitudeM)} – ${Math.round(a.maxAltitudeM)} m</td>
        <td>${fmtDate(new Date(a.firstSeen).toISOString())}</td>
        <td>${fmtDate(new Date(a.lastSeen).toISOString())}</td>
      </tr>`,
    )
    .join("");
  const table = t.aircraft.length
    ? `
    <table>
      <thead>
        <tr>
          <th>Callsign</th><th>ICAO</th><th>Zone</th><th>Min Distanz</th>
          <th>Höhe (min/max)</th><th>Erstmals</th><th>Zuletzt</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `
    : `<p style="color:#555; font-size:11px;">Keine Luftfahrzeuge während des Fluges erfasst.</p>`;
  const map = t.mapSnapshotBase64
    ? `<div style="margin-top:8px;"><img src="data:image/png;base64,${t.mapSnapshotBase64}" style="max-width:100%; border:1px solid #e5e7eb; border-radius:4px;" /></div>`
    : "";
  return `<h2>Verkehrslog (ADS-B / OGN)</h2>${summary}${table}${map}`;
}

function trafficLogEntriesHtml(entries: TrafficLogEntry[]): string {
  if (!entries.length) return "";
  const sorted = [...entries].sort((a, b) => a.ts - b.ts);
  const critical = entries.filter((e) => e.level === "critical").length;
  const warn = entries.filter((e) => e.level === "warning").length;
  const rows = sorted
    .map(
      (e) => `
      <tr>
        <td>${fmtDate(new Date(e.ts).toISOString())}</td>
        <td>${esc(e.callsign) || "—"}</td>
        <td style="font-family:monospace">${esc(e.icao24)}</td>
        <td>${e.level === "critical" ? "Kritisch" : "Warnung"}</td>
        <td>${e.distanceKm.toFixed(2)} km</td>
        <td>${e.altitudeM != null ? Math.round(e.altitudeM) + " m" : "—"}</td>
        <td>${esc(e.direction)} (${Math.round(e.bearingDeg)}°)</td>
      </tr>`,
    )
    .join("");
  return `
    <h2>Verkehrslog (ADS-B / OGN)</h2>
    <p style="font-size:11px; color:#555; margin:4px 0;">${entries.length} Einträge · ${critical} kritisch · ${warn} Warnung</p>
    <table>
      <thead>
        <tr>
          <th>Zeit</th><th>Callsign</th><th>ICAO</th><th>Stufe</th>
          <th>Distanz</th><th>Höhe</th><th>Richtung</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function exportBriefingPdf(s: FlightSessionFull) {
  const p = s.planning || {};
  const reasons = s.reasons || [];
  const checklist = Array.isArray(p.checklistCompleted) ? p.checklistCompleted : [];
  const w = p.forecastWeather || null;

  const statusBadge =
    s.status === "go" ? '<span class="badge badge-go">GO</span>' :
    s.status === "caution" ? '<span class="badge badge-warn">CAUTION</span>' :
    s.status === "nogo" ? '<span class="badge badge-no">NO-GO</span>' :
    `<span class="badge">${s.status}</span>`;

  const rows = (pairs: [string, string][]) =>
    pairs.map(([k, v]) => `<tr><td class="label">${k}</td><td>${v || "—"}</td></tr>`).join("");

  const pilotBlock = (s.pilotName || s.pilotId || s.operatorId || s.pilotPhotoUrl) ? `
    <h2>Pilot &amp; Betreiber</h2>
    <div style="display:flex; gap:16px; align-items:flex-start;">
      ${s.pilotPhotoUrl ? `<img src="${s.pilotPhotoUrl}" alt="Pilotenfoto" style="width:90px;height:110px;object-fit:cover;border:1px solid #ddd;border-radius:4px;" />` : ""}
      <table style="flex:1;">${rows([
        ["Pilotenname", s.pilotName || "—"],
        ["Pilot-ID", s.pilotId || "—"],
        ["Betreiber-ID (e-ID)", s.operatorId || "—"],
      ])}</table>
    </div>
  ` : "";

  const html = `
    <h1>Briefing — Pre-Flight Check</h1>
    <div class="meta">Briefing-ID: ${s.id} · Erstellt: ${fmtDate(s.createdAt)} · Status: ${statusBadge}</div>

    ${pilotBlock}

    <h2>Drohne &amp; Phase</h2>
    <table>${rows([
      ["Drohne", s.droneName || s.droneId],
      ["Aktuelle Phase", s.currentPhase],
    ])}</table>

    <h2>Ort &amp; Zeit</h2>
    <table>${rows([
      ["Ort", s.locationName || "—"],
      ["Koordinaten", `${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}`],
      ["Land", s.countryIso || "—"],
      ["Geplant am", p.plannedDate ? `${p.plannedDate} ${p.plannedTime || ""}` : "—"],
      ["Geplante Dauer", p.durationMinutes ? `${p.durationMinutes} min` : "—"],
      ["Max. Höhe", p.maxAltitude ? `${p.maxAltitude} m AGL` : "—"],
      ["FPV-Flug", p.isFpvFlight ? "Ja" : "Nein"],
    ])}</table>

    <h2>Restriktionen / Geozonen</h2>
    <table>${rows([
      ["Restriktionen", s.hasRestrictions ? "Ja" : "Nein"],
      ["Status", p.restrictionStatus || "—"],
      ["Notizen", s.restrictionNotes || p.restrictionNotes || "—"],
    ])}</table>

    ${w ? `
      <h2>Wetter-Snapshot</h2>
      <table>${rows([
        ["Temperatur", `${w.temperature?.toFixed?.(1) ?? w.temperature} °C`],
        ["Wind", `${w.windSpeed?.toFixed?.(1) ?? w.windSpeed} m/s`],
        ["Böen", w.windGust != null ? `${w.windGust.toFixed?.(1) ?? w.windGust} m/s` : "—"],
        ["Niederschlag", `${w.rain ?? 0} mm/h`],
        ["Bewölkung", `${w.cloudCover ?? 0} %`],
        ["Luftfeuchte", `${w.humidity ?? 0} %`],
      ])}</table>
    ` : ""}

    ${checklist.length ? `
      <h2>Checkliste (abgehakt)</h2>
      <ul>${checklist.map((c: string) => `<li>${c}</li>`).join("")}</ul>
    ` : ""}

    ${reasons.length ? `
      <h2>Bewertung</h2>
      <ul>${reasons.map(r => `<li><b>[${r.type.toUpperCase()}]</b> ${r.message}</li>`).join("")}</ul>
    ` : ""}
  `;
  openPdfWindow(`Briefing-${s.id.slice(0, 8)}`, html);
}
