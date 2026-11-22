import { flightDocScope } from "@/lib/flightDocScope";
import * as Print from "expo-print";
import { saveToDevice } from "./saveToDevice";
import * as Sharing from "expo-sharing";
import * as MailComposer from "expo-mail-composer";
import * as SMS from "expo-sms";
import { Alert, Platform } from "react-native";
import { LogbookEntry, TrafficLogData, SavedGeozoneFeature, SavedDipulRestriction, DjiLogMeta, DjiLogRecord, getEntryDjiLogs, getPilotProfile, getSettings } from "@/lib/storage";
import { getCheckItemLabel } from "@/lib/checklists";
import { groupDanishBufferRings } from "../../shared/danishGeozones";
import { resolveFlightTimeDocuments, type ResolvedPilotDocument } from "../../shared/archivedDocuments";
import { renderProtocolMap } from "@/lib/protocolMapClient";
import { formatPlannedTimeRange } from "../../shared/flightWindow";

/** Vorab clientseitig erzeugte Karten (OSM-Kacheln + Radius/Route als SVG). */
export interface ProtocolMaps {
  planned: string | null; // data:image/svg+xml;base64,...
  route: string | null;
}

async function fetchProtocolMap(body: Parameters<typeof renderProtocolMap>[0]): Promise<string | null> {
  try {
    return await renderProtocolMap(body);
  } catch {
    return null;
  }
}

/**
 * Erzeugt die Protokoll-Karten (geplantes Fluggebiet + tatsächliche Route)
 * direkt auf dem Gerät aus OSM-Kacheln (kein Server mehr). Schlägt das fehl
 * (z. B. offline), bleiben die Felder null und die HTML-Generatoren
 * fallen auf den Snapshot bzw. die schematische Darstellung zurück.
 */
export async function prefetchProtocolMaps(entry: LogbookEntry): Promise<ProtocolMaps> {
  const center = { lat: entry.latitude, lon: entry.longitude };
  const radiusKm = entry.planning?.radiusKm;
  const route = routeLatLon(entry);

  // Ein vorhandener Karten-Snapshot (mit Geozonen) ist aussagekräftiger als die
  // clientseitige OSM-Karte – dann keine Kacheln laden.
  const hasSnapshot = !!(entry.mapSnapshotBase64 || entry.mapSatelliteSnapshotBase64);
  const plannedReq = hasSnapshot
    ? Promise.resolve(null)
    : fetchProtocolMap({ kind: "planned", center, radiusKm });
  const routeReq =
    route.length >= 2
      ? fetchProtocolMap({ kind: "route", route, center })
      : Promise.resolve(null);

  const [planned, routeMap] = await Promise.all([plannedReq, routeReq]);
  return { planned, route: routeMap };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTime(dateStr?: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(minutes?: number): string {
  if (!minutes) return "-";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}min`;
}

function zoneLabel(zone: string): string {
  if (zone === "inner") return "Innerer Warnkreis";
  if (zone === "outer") return "Äußerer Warnkreis";
  return "Anflug erkannt";
}

function zoneBadgeColor(zone: string): string {
  if (zone === "inner") return "#C53030";
  if (zone === "outer") return "#D97706";
  return "#2563EB";
}

function humanizeChecklistId(id: string): string {
  // Fallback wenn keine Übersetzung vorhanden ist: Unterstriche durch Leerzeichen
  // ersetzen und ersten Buchstaben groß schreiben.
  const cleaned = id.replace(/_/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function generateChecklistHtml(title: string, completed: string[], presented?: string[]): string {
  if ((!completed || completed.length === 0) && (!presented || presented.length === 0)) return "";
  const completedSet = new Set(completed || []);
  const ids = (presented && presented.length > 0 ? presented : completed) || [];
  const items = ids.map((id) => {
    const isChecked = completedSet.has(id);
    const icon = isChecked ? "&#9745;" : "&#9744;";
    const color = isChecked ? "#2D8659" : "#C53030";
    const label = getCheckItemLabel(id) || humanizeChecklistId(id);
    return `<tr><td style="color:${color};width:20px;font-size:14px;">${icon}</td><td>${escapeHtml(label)}</td></tr>`;
  }).join("");
  const totalCompleted = completedSet.size;
  const totalPresented = ids.length;
  const summary = `<p class="small" style="margin:0 0 4px 0;color:#6B7280;">${totalCompleted}/${totalPresented} Punkte abgehakt</p>`;
  return `<h3>${escapeHtml(title)}</h3>${summary}<table>${items}</table>`;
}

function generateTrafficTableHtml(trafficLog: TrafficLogData): string {
  if (!trafficLog.aircraft || trafficLog.aircraft.length === 0) {
    return `
      <h2>Flugverkehr-Protokoll</h2>
      <div class="info-box">Keine Flugobjekte im Warnbereich während des Fluges erkannt.</div>
    `;
  }

  const sorted = [...trafficLog.aircraft].sort((a, b) => a.firstSeen - b.firstSeen);
  const rows = sorted.map((ac) => `
    <tr>
      <td><strong>${escapeHtml(ac.callsign)}</strong><br/><span class="small">${escapeHtml(ac.icao24)}</span></td>
      <td><span class="zone-badge" style="background:${zoneBadgeColor(ac.zone)}">${zoneLabel(ac.zone)}</span></td>
      <td>${Math.round(ac.minAltitudeM)}m${ac.minAltitudeM !== ac.maxAltitudeM ? ` - ${Math.round(ac.maxAltitudeM)}m` : ""}</td>
      <td>${ac.closestDistanceKm < 1 ? `${Math.round(ac.closestDistanceKm * 1000)}m` : `${ac.closestDistanceKm.toFixed(1)}km`}</td>
      <td>${formatTimestamp(ac.firstSeen)}</td>
      <td>${formatTimestamp(ac.lastSeen)}</td>
      <td>${ac.trail.length}</td>
    </tr>
  `).join("");

  const innerCount = sorted.filter((a) => a.zone === "inner").length;
  const outerCount = sorted.filter((a) => a.zone === "outer").length;
  const approachCount = sorted.filter((a) => a.zone === "approach").length;

  const recordingDuration = trafficLog.endTime
    ? Math.round((trafficLog.endTime - trafficLog.startTime) / 60000)
    : 0;

  return `
    <h2>Flugverkehr-Protokoll</h2>
    <div class="traffic-summary">
      <div class="stat-item">
        <div class="stat-value">${sorted.length}</div>
        <div class="stat-label">Flugobjekte gesamt</div>
      </div>
      <div class="stat-item">
        <div class="stat-value" style="color:#C53030">${innerCount}</div>
        <div class="stat-label">Innerer Warnkreis</div>
      </div>
      <div class="stat-item">
        <div class="stat-value" style="color:#D97706">${outerCount}</div>
        <div class="stat-label">Äußerer Warnkreis</div>
      </div>
      <div class="stat-item">
        <div class="stat-value" style="color:#2563EB">${approachCount}</div>
        <div class="stat-label">Anflug erkannt</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${recordingDuration} min</div>
        <div class="stat-label">Aufzeichnungsdauer</div>
      </div>
    </div>
    <table class="traffic-table">
      <thead>
        <tr>
          <th>Kennung / ICAO</th>
          <th>Zone</th>
          <th>Höhe</th>
          <th>Min. Abstand</th>
          <th>Erste Sichtung</th>
          <th>Letzte Sichtung</th>
          <th>Positionen</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function generateTrafficTrailsHtml(trafficLog: TrafficLogData): string {
  if (!trafficLog.aircraft || trafficLog.aircraft.length === 0) return "";

  const trailsWithPoints = trafficLog.aircraft.filter((ac) => ac.trail.length >= 2);
  if (trailsWithPoints.length === 0) return "";

  const trailRows = trailsWithPoints.map((ac) => {
    const posRows = ac.trail.map((pt, idx) =>
      `<tr><td>${idx + 1}</td><td>${pt.latitude.toFixed(5)}</td><td>${pt.longitude.toFixed(5)}</td><td>${Math.round(pt.altitudeM)}m</td><td>${Math.round(pt.speedKmh ?? 0)} km/h</td><td>${pt.heading != null ? `${Math.round(pt.heading)}°` : "-"}</td><td>${formatTimestamp(pt.timestamp)}</td></tr>`
    ).join("");
    return `
      <div class="trail-section">
        <h4>${escapeHtml(ac.callsign)} (${escapeHtml(ac.icao24)})</h4>
        <table class="trail-table">
          <thead><tr><th>#</th><th>Breitengrad</th><th>Längengrad</th><th>Höhe</th><th>Geschw.</th><th>Kurs</th><th>Zeit</th></tr></thead>
          <tbody>${posRows}</tbody>
        </table>
      </div>
    `;
  }).join("");

  return `
    <h2 class="page-break">Flugrouten-Details</h2>
    ${trailRows}
  `;
}

function generateMapSnapshotHtml(trafficLog: TrafficLogData): string {
  if (!trafficLog.mapSnapshotBase64) return "";
  return `
    <h2 class="page-break">Flugverkehr-Karte</h2>
    <div class="map-container">
      <img src="data:image/png;base64,${trafficLog.mapSnapshotBase64}" class="map-image" />
      <p class="map-caption">Aufzeichnungszeitraum: ${formatTimestamp(trafficLog.startTime)} - ${trafficLog.endTime ? formatTimestamp(trafficLog.endTime) : "-"}</p>
    </div>
  `;
}

function latLonToSvg(
  lat: number,
  lon: number,
  centerLat: number,
  centerLon: number,
  svgW: number,
  svgH: number,
  metersPerPixel: number,
): { x: number; y: number } {
  const latRad = (centerLat * Math.PI) / 180;
  const dx = (lon - centerLon) * (111320 * Math.cos(latRad));
  const dy = (centerLat - lat) * 110540;
  return {
    x: svgW / 2 + dx / metersPerPixel,
    y: svgH / 2 + dy / metersPerPixel,
  };
}

const TRAIL_COLORS = ["#E53E3E", "#DD6B20", "#D69E2E", "#38A169", "#3182CE", "#805AD5", "#D53F8C", "#319795"];

function generateMapWithTrailsHtml(entry: LogbookEntry): string {
  const tl = entry.trafficLog;
  if (!tl) return "";

  const hasSnapshot = !!tl.mapSnapshotBase64;
  const hasTrails = tl.aircraft?.some((ac) => ac.trail.length >= 2);
  if (!hasSnapshot && !hasTrails) return "";

  const svgW = 700;
  const svgH = 500;
  const outerR = tl.outerRadiusM;
  const innerR = tl.innerRadiusM;
  const spanMeters = outerR * 2.5;
  const metersPerPixel = spanMeters / Math.min(svgW, svgH);

  const center = latLonToSvg(tl.centerLatitude, tl.centerLongitude, tl.centerLatitude, tl.centerLongitude, svgW, svgH, metersPerPixel);
  const outerPx = outerR / metersPerPixel;
  const innerPx = innerR / metersPerPixel;

  let trailsSvg = "";
  if (hasTrails) {
    const trailsWithPoints = tl.aircraft.filter((ac) => ac.trail.length >= 2);
    trailsWithPoints.forEach((ac, idx) => {
      const color = TRAIL_COLORS[idx % TRAIL_COLORS.length];
      const points = ac.trail.map((pt) => {
        const p = latLonToSvg(pt.latitude, pt.longitude, tl.centerLatitude, tl.centerLongitude, svgW, svgH, metersPerPixel);
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      });
      trailsSvg += `<polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" />`;
      const startPt = latLonToSvg(ac.trail[0].latitude, ac.trail[0].longitude, tl.centerLatitude, tl.centerLongitude, svgW, svgH, metersPerPixel);
      const endPt = latLonToSvg(ac.trail[ac.trail.length - 1].latitude, ac.trail[ac.trail.length - 1].longitude, tl.centerLatitude, tl.centerLongitude, svgW, svgH, metersPerPixel);
      trailsSvg += `<circle cx="${startPt.x.toFixed(1)}" cy="${startPt.y.toFixed(1)}" r="4" fill="${color}" stroke="white" stroke-width="1"/>`;
      trailsSvg += `<circle cx="${endPt.x.toFixed(1)}" cy="${endPt.y.toFixed(1)}" r="5" fill="${color}" stroke="white" stroke-width="1.5"/>`;
      trailsSvg += `<text x="${endPt.x.toFixed(1)}" y="${(endPt.y - 8).toFixed(1)}" text-anchor="middle" font-size="8" fill="${color}" font-weight="600">${escapeHtml(ac.callsign || ac.icao24)}</text>`;
    });
  }

  const legendItems = hasTrails ? tl.aircraft.filter((ac) => ac.trail.length >= 2).map((ac, idx) =>
    `<span style="display:inline-block;margin-right:12px;"><span style="display:inline-block;width:12px;height:3px;background:${TRAIL_COLORS[idx % TRAIL_COLORS.length]};vertical-align:middle;margin-right:4px;"></span>${escapeHtml(ac.callsign || ac.icao24)}</span>`
  ).join("") : "";

  if (hasSnapshot) {
    return `
      <h2 class="page-break">Einsatzkarte mit Flugverkehr</h2>
      <div class="map-container" style="position:relative;">
        <div style="position:relative;display:inline-block;">
          <img src="data:image/png;base64,${tl.mapSnapshotBase64}" class="map-image" style="display:block;" />
          ${hasTrails ? `<svg viewBox="0 0 ${svgW} ${svgH}" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;">
            ${trailsSvg}
          </svg>` : ""}
        </div>
        ${legendItems ? `<div style="margin-top:4px;font-size:9px;color:#4B5563;">${legendItems}</div>` : ""}
        <p class="map-caption">Zentrum: ${tl.centerLatitude.toFixed(5)}, ${tl.centerLongitude.toFixed(5)} | Warnkreis: ${outerR >= 1000 ? `${(outerR / 1000).toFixed(1)}km` : `${outerR}m`} | ${formatTimestamp(tl.startTime)} - ${tl.endTime ? formatTimestamp(tl.endTime) : "-"}</p>
      </div>
    `;
  }

  return `
    <h2 class="page-break">Einsatzkarte mit Flugverkehr</h2>
    <div class="map-container">
      <svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%;max-width:${svgW}px;border:1px solid #E5E7EB;border-radius:8px;background:#F0F4F8;">
        <circle cx="${center.x}" cy="${center.y}" r="${outerPx.toFixed(1)}" fill="none" stroke="#D97706" stroke-width="1.5" stroke-dasharray="6,3" opacity="0.7"/>
        <circle cx="${center.x}" cy="${center.y}" r="${innerPx.toFixed(1)}" fill="none" stroke="#C53030" stroke-width="1.5" stroke-dasharray="4,2" opacity="0.7"/>
        <circle cx="${center.x}" cy="${center.y}" r="5" fill="#0A4D8C" stroke="white" stroke-width="2"/>
        <text x="${center.x + 8}" y="${center.y - 8}" font-size="8" fill="#D97706">Warnkreis ${outerR >= 1000 ? `${(outerR / 1000).toFixed(1)}km` : `${outerR}m`}</text>
        <text x="${center.x + 8}" y="${center.y + 16}" font-size="8" fill="#C53030">Kritisch ${innerR >= 1000 ? `${(innerR / 1000).toFixed(1)}km` : `${innerR}m`}</text>
        ${trailsSvg}
      </svg>
      ${legendItems ? `<div style="margin-top:4px;font-size:9px;color:#4B5563;">${legendItems}</div>` : ""}
      <p class="map-caption">Zentrum: ${tl.centerLatitude.toFixed(5)}, ${tl.centerLongitude.toFixed(5)} | ${formatTimestamp(tl.startTime)} - ${tl.endTime ? formatTimestamp(tl.endTime) : "-"}</p>
    </div>
  `;
}

function categoryLabel(cat: string): string {
  if (cat === "military") return "Militärisch / ED-R";
  if (cat === "notam") return "NOTAM / Temporär";
  if (cat === "nature") return "Naturschutz";
  return "Sonstige";
}

function categoryColor(cat: string): string {
  if (cat === "military") return "#C53030";
  if (cat === "notam") return "#D97706";
  if (cat === "nature") return "#2D8659";
  return "#4B5563";
}

function formatRestrictionDate(ts: string | null, indefinite?: boolean): string {
  if (!ts) return "-";
  if (indefinite) return "Unbefristet";
  const d = new Date(ts);
  const year = d.getFullYear();
  if (year >= 2099) return "Unbefristet";
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}

function generateGeozonesSectionHtml(features?: SavedGeozoneFeature[], restrictions?: SavedDipulRestriction[]): string {
  const hasFeatures = features && features.length > 0;
  const hasRestrictions = restrictions && restrictions.length > 0;
  if (!hasFeatures && !hasRestrictions) return "";

  let html = `<h2 class="page-break">Geozonen &amp; Beschränkungen</h2>`;

  if (hasFeatures) {
    // Konzentrische DK-Pufferringe derselben Anlage zu einer Tabellenzeile
    // zusammenfassen (gleiche Gruppierung wie in der Planungsübersicht).
    const dedupedFeatures = groupDanishBufferRings(features);
    const grouped: Record<string, SavedGeozoneFeature[]> = {};
    dedupedFeatures.forEach((f) => {
      if (!grouped[f.layerLabel]) grouped[f.layerLabel] = [];
      grouped[f.layerLabel].push(f);
    });
    Object.entries(grouped).forEach(([label, items]) => {
      html += `<div class="geozone-group">
        <h3 style="color:#0A4D8C;margin:8px 0 4px;">${escapeHtml(label)} (${items.length})</h3>
        <table class="geozone-table">
          <thead><tr><th>Bezeichnung</th><th>Details</th></tr></thead>
          <tbody>${items.map((f) => `<tr><td style="font-weight:600;white-space:nowrap;">${escapeHtml(f.name)}</td><td>${escapeHtml(f.details)}</td></tr>`).join("")}</tbody>
        </table>
      </div>`;
    });
  }

  if (hasRestrictions) {
    const catOrder: Array<"military" | "notam" | "nature" | "other"> = ["military", "notam", "nature", "other"];
    const grouped: Record<string, SavedDipulRestriction[]> = {};
    restrictions.forEach((r) => {
      if (!grouped[r.category]) grouped[r.category] = [];
      grouped[r.category].push(r);
    });

    html += `<h3 style="color:#0A4D8C;margin:12px 0 4px;">Temporäre Beschränkungen (dipul) - ${restrictions.length} gesamt</h3>`;

    catOrder.forEach((cat) => {
      const items = grouped[cat];
      if (!items || items.length === 0) return;
      const color = categoryColor(cat);
      html += `<div class="restriction-category" style="margin:8px 0;">
        <div style="font-weight:700;color:${color};font-size:11px;margin-bottom:4px;border-left:3px solid ${color};padding-left:6px;">${categoryLabel(cat)} (${items.length})</div>
        <table class="restriction-table">
          <thead><tr><th>Bezeichnung</th><th>Status</th><th>Gültig von</th><th>Gültig bis</th><th>Höhe</th><th>Rechtsgrundlage</th></tr></thead>
          <tbody>${items.map((r) => {
            const statusBadge = r.status === "active"
              ? `<span style="background:#2D8659;color:white;padding:1px 6px;border-radius:4px;font-size:8px;font-weight:600;">AKTIV</span>`
              : `<span style="background:#7C3AED;color:white;padding:1px 6px;border-radius:4px;font-size:8px;font-weight:600;">GEPLANT</span>`;
            const displayName = r.names && r.names.length > 0 ? r.names.join(", ") : r.name;
            return `<tr>
              <td style="font-weight:600;">${escapeHtml(displayName)}</td>
              <td>${statusBadge}</td>
              <td>${formatRestrictionDate(r.startTs)}</td>
              <td>${formatRestrictionDate(r.endTs, r.endTsIndefinite)}</td>
              <td>${r.lowerAlt}${r.lowerAltRef === "AGL" ? "m AGL" : "m " + r.lowerAltRef} - ${r.upperAlt}${r.upperAltRef === "AGL" ? "m AGL" : "m " + r.upperAltRef}</td>
              <td style="font-size:9px;">${escapeHtml(r.legalRef)}</td>
            </tr>`;
          }).join("")}</tbody>
        </table>
      </div>`;
    });
  }

  return html;
}

function generateWeatherSectionHtml(entry: LogbookEntry): string {
  const forecast = entry.planning?.forecastWeather;
  const actual = entry.preflight?.actualWeather;
  if (!forecast && !actual) return "";

  let html = `<h2>Wetterbedingungen</h2>`;

  if (forecast && actual) {
    html += `<table>
      <thead><tr><th></th><th>Vorhersage (Planung)</th><th>Aktuell (Pre-Flight)</th></tr></thead>
      <tbody>
        <tr><td class="label">Temperatur</td><td>${forecast.temperature.toFixed(1)}°C</td><td>${actual.temperature.toFixed(1)}°C</td></tr>
        <tr><td class="label">Wind</td><td>${forecast.windSpeed.toFixed(1)} m/s</td><td>${actual.windSpeed.toFixed(1)} m/s</td></tr>
        <tr><td class="label">Böen</td><td>${forecast.windGust ? `${forecast.windGust.toFixed(1)} m/s` : "-"}</td><td>${actual.windGust ? `${actual.windGust.toFixed(1)} m/s` : "-"}</td></tr>
        <tr><td class="label">Regen</td><td>${forecast.rain.toFixed(1)} mm</td><td>${actual.rain.toFixed(1)} mm</td></tr>
        <tr><td class="label">Bewölkung</td><td>${forecast.cloudCover.toFixed(0)}%</td><td>${actual.cloudCover.toFixed(0)}%</td></tr>
        <tr><td class="label">Luftfeuchtigkeit</td><td>${forecast.humidity.toFixed(0)}%</td><td>${actual.humidity.toFixed(0)}%</td></tr>
        ${forecast.kpIndex != null || actual.kpIndex != null ? `<tr><td class="label">KP-Index</td><td>${forecast.kpIndex != null ? forecast.kpIndex.toFixed(1) : "-"}</td><td>${actual.kpIndex != null ? actual.kpIndex.toFixed(1) : "-"}</td></tr>` : ""}
      </tbody>
    </table>`;
  } else {
    const w = actual || forecast;
    if (!w) return "";
    const label = actual ? "Aktuell (Pre-Flight)" : "Vorhersage (Planung)";
    html += `<table>
      <thead><tr><th></th><th>${label}</th></tr></thead>
      <tbody>
        <tr><td class="label">Temperatur</td><td>${w.temperature.toFixed(1)}°C</td></tr>
        <tr><td class="label">Wind</td><td>${w.windSpeed.toFixed(1)} m/s</td></tr>
        ${w.windGust ? `<tr><td class="label">Böen</td><td>${w.windGust.toFixed(1)} m/s</td></tr>` : ""}
        <tr><td class="label">Regen</td><td>${w.rain.toFixed(1)} mm</td></tr>
        <tr><td class="label">Bewölkung</td><td>${w.cloudCover.toFixed(0)}%</td></tr>
        <tr><td class="label">Luftfeuchtigkeit</td><td>${w.humidity.toFixed(0)}%</td></tr>
        ${w.kpIndex != null ? `<tr><td class="label">KP-Index</td><td>${w.kpIndex.toFixed(1)}</td></tr>` : ""}
      </tbody>
    </table>`;
  }
  return html;
}

function generateCtrWeatherSectionHtml(entry: LogbookEntry): string {
  const ctr = entry.preflight?.ctrWeather;
  if (!ctr) return "";

  const minVisText = ctr.minVisibilityKm < 1
    ? `${Math.round(ctr.minVisibilityKm * 1000)} m`
    : `${ctr.minVisibilityKm} km`;
  const actualVisText = ctr.visibilityM != null
    ? (ctr.visibilityM >= 1000 ? `${(ctr.visibilityM / 1000).toFixed(1)} km` : `${ctr.visibilityM} m`)
    : "—";

  const vmcColor = ctr.vmcCompliant === true ? "#2D8659" : ctr.vmcCompliant === false ? "#C53030" : "#D97706";
  const vmcText = ctr.vmcCompliant === true
    ? "VMC-Bedingungen erfüllt"
    : ctr.vmcCompliant === false
      ? "VMC-Bedingungen NICHT erfüllt"
      : "VMC nicht verifizierbar";

  if (!ctr.metarAvailable) {
    return `
    <h2>CTR-Wetternachweis</h2>
    <table>
      <tr><td class="label">Kontrollzone</td><td>${escapeHtml(ctr.airportName)} (${escapeHtml(ctr.icao)})</td></tr>
      <tr><td class="label">Distanz zur Flughafen-Referenz</td><td>${ctr.distanceKm.toFixed(1)} km</td></tr>
      <tr><td class="label">METAR</td><td style="color:#D97706">Keine METAR verfügbar — Sicht/Wolken vor dem Flug manuell beim Tower geprüft.</td></tr>
      ${ctr.avReference ? `<tr><td class="label">Allgemeinverfügung</td><td>${escapeHtml(ctr.avReference)}</td></tr>` : ""}
    </table>`;
  }

  const ceilingRows = ctr.minCeilingFt != null ? `
      <tr><td class="label">Mind. Wolkenuntergrenze (AV)</td><td>${ctr.minCeilingFt} ft</td></tr>
      <tr><td class="label">Gemeldete Wolkenuntergrenze</td><td>${ctr.ceilingFt != null ? `${ctr.ceilingFt} ft` : "keine (BKN/OVC) gemeldet"}</td></tr>` : "";

  const reasonsHtml = ctr.vmcReasons && ctr.vmcReasons.length > 0
    ? `<ul style="margin:4px 0;padding-left:20px;">${ctr.vmcReasons.map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`
    : "";

  return `
    <h2>CTR-Wetternachweis</h2>
    <p style="margin:4px 0;">Flug innerhalb der Kontrollzone <strong>${escapeHtml(ctr.airportName)} (${escapeHtml(ctr.icao)})</strong>. VMC-Prüfung gegen die Bedingungen der Allgemeinverfügung${ctr.avReference ? ` (${escapeHtml(ctr.avReference)})` : ""}.</p>
    <div style="display:inline-block;background:${vmcColor};color:#fff;padding:4px 10px;border-radius:6px;font-weight:600;margin:4px 0;">${vmcText}</div>
    <table>
      <tr><td class="label">Zuständiger Flughafen</td><td>${escapeHtml(ctr.airportName)} (${escapeHtml(ctr.icao)})</td></tr>
      <tr><td class="label">Distanz zur Flughafen-Referenz</td><td>${ctr.distanceKm.toFixed(1)} km</td></tr>
      ${ctr.observedAt ? `<tr><td class="label">METAR-Beobachtung</td><td>${escapeHtml(formatTime(ctr.observedAt))}</td></tr>` : ""}
      <tr><td class="label">Mindestsicht (AV)</td><td>${minVisText}</td></tr>
      <tr><td class="label">Gemeldete Sicht</td><td>${actualVisText}</td></tr>
      ${ceilingRows}
      ${ctr.phenomenaText ? `<tr><td class="label">Wettererscheinungen</td><td>${escapeHtml(ctr.phenomenaText)}</td></tr>` : ""}
      ${ctr.avProvider ? `<tr><td class="label">Flugsicherung</td><td>${escapeHtml(ctr.avProvider)}</td></tr>` : ""}
    </table>
    ${reasonsHtml}
    ${ctr.raw ? `<p style="font-family:monospace;font-size:10px;background:#F9FAFB;padding:6px 8px;border-radius:6px;margin-top:6px;">${escapeHtml(ctr.raw)}</p>` : ""}`;
}

function generateSingleEntryHtml(entry: LogbookEntry): string {
  const weather = entry.weatherConditions;
  const weatherHtml = weather
    ? `
    <tr><td>Temperatur</td><td>${weather.temperature.toFixed(1)}°C</td></tr>
    <tr><td>Wind</td><td>${weather.windSpeed.toFixed(1)} m/s</td></tr>
    ${weather.windGust ? `<tr><td>Böen</td><td>${weather.windGust.toFixed(1)} m/s</td></tr>` : ""}
    <tr><td>Regen</td><td>${weather.rain.toFixed(1)} mm</td></tr>
    <tr><td>Bewölkung</td><td>${weather.cloudCover.toFixed(0)}%</td></tr>
    ${weather.kpIndex != null ? `<tr><td>KP-Index</td><td>${weather.kpIndex.toFixed(1)}</td></tr>` : ""}
    `
    : "<tr><td colspan='2'>Keine Wetterdaten</td></tr>";

  return `
    <div class="entry">
      <h2>Flug am ${formatDate(entry.flightDate)}</h2>
      <table>
        <tr><td class="label">Pilot / Drohne</td><td>${escapeHtml(entry.droneName)} (${entry.droneClass})</td></tr>
        <tr><td class="label">Ort</td><td>${escapeHtml(entry.locationName || `${entry.latitude.toFixed(4)}, ${entry.longitude.toFixed(4)}`)}</td></tr>
        <tr><td class="label">Koordinaten</td><td>${entry.latitude.toFixed(6)}, ${entry.longitude.toFixed(6)}</td></tr>
        <tr><td class="label">Start</td><td>${formatTime(entry.takeoffTime)}</td></tr>
        <tr><td class="label">Landung</td><td>${formatTime(entry.landingTime)}</td></tr>
        <tr><td class="label">Flugdauer</td><td>${formatDuration(entry.flightDurationMinutes)}</td></tr>
        <tr><td class="label">Max. Höhe</td><td>${entry.maxAltitude ? `${entry.maxAltitude}m` : "-"}</td></tr>
        <tr><td class="label">Status</td><td style="color: ${entry.status === "go" ? "#2D8659" : entry.status === "caution" ? "#D97706" : "#C53030"}">${entry.status === "go" ? "Go" : entry.status === "caution" ? "Caution" : "No-Go"}</td></tr>
      </table>

      <h3>Wetterbedingungen</h3>
      <table>${weatherHtml}</table>

      ${entry.planning?.noGoOverride ? `
        <div class="incident" style="border-left:4px solid #C53030;background:#FFF5F5;padding:8px;margin:8px 0;">
          <strong style="color:#C53030">NO-GO bewusst übersteuert</strong>
          <p style="margin:4px 0;font-size:10px;">Pilot hat trotz NO-GO-Status (${escapeHtml(entry.planning.noGoOverride.originalStatus.toUpperCase())}) die Freigabe am ${escapeHtml(new Date(entry.planning.noGoOverride.acknowledgedAt).toLocaleString("de-DE"))} erteilt.</p>
          ${entry.planning.noGoOverride.reasons.length > 0 ? `<ul style="margin:4px 0;padding-left:18px;font-size:10px;color:#C53030;">${entry.planning.noGoOverride.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` : ""}
        </div>
      ` : ""}

      ${entry.planning?.officialMapCrossCheck ? `
        <div class="${entry.planning.officialMapCrossCheck.blocking ? "caution-box" : ""}" style="${entry.planning.officialMapCrossCheck.blocking ? "border-left:4px solid #D97706;background:#FFFBEB;" : "border-left:4px solid #2D8659;background:#F0FFF4;"}padding:8px;margin:8px 0;">
          <strong style="color:${entry.planning.officialMapCrossCheck.blocking ? "#D97706" : "#2D8659"}">Offizielle Karte gegengeprüft: ${entry.planning.officialMapCrossCheck.blocking ? "startverhindernde Geozonen" : "keine startverhindernden Geozonen"}</strong>
          ${entry.planning.officialMapCrossCheck.note ? `<p style="margin:4px 0;font-size:10px;">Notiz: ${escapeHtml(entry.planning.officialMapCrossCheck.note)}</p>` : ""}
        </div>
      ` : ""}

      ${entry.planning?.flightPurpose ? `<h3>Flugzweck</h3><p>${escapeHtml(entry.planning.flightPurpose)}</p>` : ""}

      ${entry.savedGeozoneFeatures && entry.savedGeozoneFeatures.length > 0 ? `
        <h3>Geozonen im Einsatzgebiet</h3>
        <ul style="margin:4px 0;padding-left:20px;font-size:10px;">
          ${groupDanishBufferRings(entry.savedGeozoneFeatures).map(f => `<li><strong>${escapeHtml(f.layerLabel)}:</strong> ${escapeHtml(f.name)}${f.details ? ` - ${escapeHtml(f.details)}` : ""}</li>`).join("")}
        </ul>
      ` : ""}

      ${entry.savedDipulRestrictions && entry.savedDipulRestrictions.length > 0 ? `
        <h3>Temporäre Beschränkungen</h3>
        <ul style="margin:4px 0;padding-left:20px;font-size:10px;">
          ${entry.savedDipulRestrictions.map(r => {
            const displayName = r.names && r.names.length > 0 ? r.names.join(", ") : r.name;
            const statusLabel = r.status === "active" ? "AKTIV" : "GEPLANT";
            return `<li><strong>${escapeHtml(displayName)}</strong> [${statusLabel}] - ${formatRestrictionDate(r.startTs)} bis ${formatRestrictionDate(r.endTs, r.endTsIndefinite)} - ${escapeHtml(r.legalRef)}</li>`;
          }).join("")}
        </ul>
      ` : ""}

      ${entry.incidentOccurred ? `
        <div class="incident">
          <strong>Vorfall aufgetreten</strong>
          ${entry.incidentDescription ? `<p>${escapeHtml(entry.incidentDescription)}</p>` : ""}
        </div>
      ` : ""}

      ${entry.maintenanceRequired ? `
        <div class="maintenance">
          <strong>Wartung erforderlich</strong>
          ${entry.maintenanceNotes ? `<p>${escapeHtml(entry.maintenanceNotes)}</p>` : ""}
        </div>
      ` : ""}

      ${entry.notes ? `<h3>Notizen</h3><p>${escapeHtml(entry.notes)}</p>` : ""}
    </div>
  `;
}

function formatRadiusKm(radiusKm?: number): string | null {
  if (typeof radiusKm !== "number" || radiusKm <= 0) return null;
  return radiusKm >= 1
    ? `${radiusKm.toFixed(radiusKm % 1 === 0 ? 0 : 1)} km`
    : `${Math.round(radiusKm * 1000)} m`;
}

/** Kompakte Chip-Legende der erfassten Geozonen (eindeutige Layer-Bezeichnungen). */
function geozoneLegendHtml(features?: SavedGeozoneFeature[]): string {
  if (!features || features.length === 0) return "";
  const labels = Array.from(new Set(features.map((f) => f.layerLabel))).slice(0, 14);
  const chips = labels
    .map(
      (l) =>
        `<span style="display:inline-block;margin:2px 6px 2px 0;padding:2px 8px;border-radius:10px;background:#FEE2E2;color:#991B1B;font-size:9px;font-weight:600;">${escapeHtml(l)}</span>`,
    )
    .join("");
  return `<div style="margin-top:6px;"><span style="font-size:9px;color:#6B7280;margin-right:6px;">Geozonen:</span>${chips}</div>`;
}

function generatePlanningMapHtml(entry: LogbookEntry, realMap?: string | null): string {
  const radiusKm = entry.planning?.radiusKm;
  const radiusText = formatRadiusKm(radiusKm);
  const locationText = entry.locationName || `${entry.latitude.toFixed(4)}, ${entry.longitude.toFixed(4)}`;
  const caption = radiusText
    ? `Geplantes Fluggebiet — ${escapeHtml(locationText)} · Radius ${radiusText}`
    : `Geplantes Fluggebiet — ${escapeHtml(locationText)}`;
  const legend = geozoneLegendHtml(entry.savedGeozoneFeatures);
  // Bevorzugt die clientseitig erzeugte OSM-Karte (Kacheln + Radius).
  if (realMap) {
    return `
      <h2>Geplantes Fluggebiet (Geozone + Radius)</h2>
      <div class="map-container" style="margin: 8px 0 16px 0;">
        <img src="${realMap}" class="map-image" style="display:block;width:100%;max-width:700px;border:1px solid #E5E7EB;border-radius:8px;" />
        ${legend}
        <p class="map-caption">${caption}</p>
      </div>
    `;
  }
  if (entry.mapSnapshotBase64 || entry.mapSatelliteSnapshotBase64) {
    const stdImg = entry.mapSnapshotBase64
      ? `<img src="data:image/jpeg;base64,${entry.mapSnapshotBase64}" class="map-image" style="display:block;width:100%;max-width:700px;border:1px solid #E5E7EB;border-radius:8px;" />
         <p class="map-caption">${caption} — Karte</p>`
      : "";
    const satImg = entry.mapSatelliteSnapshotBase64
      ? `<img src="data:image/jpeg;base64,${entry.mapSatelliteSnapshotBase64}" class="map-image" style="display:block;width:100%;max-width:700px;border:1px solid #E5E7EB;border-radius:8px;margin-top:8px;" />
         <p class="map-caption">${caption} — Satellit</p>`
      : "";
    return `
      <h2>Geplantes Fluggebiet (Geozone + Radius)</h2>
      <div class="map-container" style="margin: 8px 0 16px 0;">
        ${stdImg}
        ${satImg}
        ${legend}
      </div>
    `;
  }
  // Schematische SVG-Darstellung, wenn kein Karten-Snapshot vorhanden ist.
  const svgW = 700;
  const svgH = 420;
  const cx = svgW / 2;
  const cy = svgH / 2;
  const rPx = Math.min(svgW, svgH) * 0.36;
  const hasGeozones = !!(entry.savedGeozoneFeatures && entry.savedGeozoneFeatures.length > 0);
  return `
    <h2>Geplantes Fluggebiet (Geozone + Radius)</h2>
    <div class="map-container" style="margin: 8px 0 16px 0;">
      <svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%;max-width:${svgW}px;border:1px solid #E5E7EB;border-radius:8px;background:#EAF1F8;">
        ${hasGeozones ? `<circle cx="${cx}" cy="${cy}" r="${(rPx * 1.18).toFixed(1)}" fill="#FCA5A5" opacity="0.18"/>` : ""}
        <circle cx="${cx}" cy="${cy}" r="${rPx.toFixed(1)}" fill="#0A4D8C" fill-opacity="0.10" stroke="#0A4D8C" stroke-width="2" stroke-dasharray="6,4"/>
        <circle cx="${cx}" cy="${cy}" r="5" fill="#0A4D8C" stroke="white" stroke-width="2"/>
        ${radiusText ? `<text x="${cx}" y="${(cy - rPx - 8).toFixed(1)}" text-anchor="middle" font-size="11" fill="#0A4D8C" font-weight="700">Radius ${escapeHtml(radiusText)}</text>` : ""}
        <text x="${cx}" y="${(cy + 20).toFixed(1)}" text-anchor="middle" font-size="9" fill="#374151">${escapeHtml(locationText)}</text>
      </svg>
      ${legend}
      <p class="map-caption">${caption} — schematische Darstellung (kein Karten-Snapshot vorhanden).</p>
    </div>
  `;
}

function routeLatLon(entry: LogbookEntry): { lat: number; lon: number }[] {
  if (entry.gpsTrack && entry.gpsTrack.length >= 2) {
    return entry.gpsTrack.map((p) => ({ lat: p.lat, lon: p.lon }));
  }
  const pts: { lat: number; lon: number }[] = [];
  getEntryDjiLogs(entry).forEach((l) =>
    (l.track ?? []).forEach((p) => pts.push({ lat: p.lat, lon: p.lon })),
  );
  return pts;
}

function generateRouteMapHtml(entry: LogbookEntry, realMap?: string | null): string {
  const locationText = entry.locationName || `${entry.latitude.toFixed(4)}, ${entry.longitude.toFixed(4)}`;
  const legend = geozoneLegendHtml(entry.savedGeozoneFeatures);
  // Bevorzugt die clientseitig erzeugte OSM-Karte (Kacheln + Route).
  if (realMap) {
    const cap = `Tatsächliche Flugroute mit Geozonen-Overlay — ${escapeHtml(locationText)}`;
    return `
      <h2 class="page-break">Flugroute (Geozone + Route)</h2>
      <div class="map-container" style="margin: 8px 0 16px 0;">
        <img src="${realMap}" class="map-image" style="display:block;width:100%;max-width:700px;border:1px solid #E5E7EB;border-radius:8px;" />
        ${legend}
        <p class="map-caption">${cap}</p>
      </div>
    `;
  }
  if (entry.routeMapSnapshotBase64 || entry.routeMapSatelliteSnapshotBase64) {
    const cap = `Tatsächliche Flugroute mit Geozonen-Overlay — ${escapeHtml(locationText)}`;
    const stdImg = entry.routeMapSnapshotBase64
      ? `<img src="data:image/jpeg;base64,${entry.routeMapSnapshotBase64}" class="map-image" style="display:block;width:100%;max-width:700px;border:1px solid #E5E7EB;border-radius:8px;" />
         <p class="map-caption">${cap} — Karte</p>`
      : "";
    const satImg = entry.routeMapSatelliteSnapshotBase64
      ? `<img src="data:image/jpeg;base64,${entry.routeMapSatelliteSnapshotBase64}" class="map-image" style="display:block;width:100%;max-width:700px;border:1px solid #E5E7EB;border-radius:8px;margin-top:8px;" />
         <p class="map-caption">${cap} — Satellit</p>`
      : "";
    return `
      <h2 class="page-break">Flugroute (Geozone + Route)</h2>
      <div class="map-container" style="margin: 8px 0 16px 0;">
        ${stdImg}
        ${satImg}
        ${legend}
      </div>
    `;
  }
  const pts = routeLatLon(entry);
  if (pts.length < 2) return "";
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  pts.forEach((p) => {
    latMin = Math.min(latMin, p.lat);
    latMax = Math.max(latMax, p.lat);
    lonMin = Math.min(lonMin, p.lon);
    lonMax = Math.max(lonMax, p.lon);
  });
  const radiusKm = entry.planning?.radiusKm;
  const hasRadius = typeof radiusKm === "number" && radiusKm > 0;
  const svgW = 700;
  const svgH = 460;
  const centerLat = (latMin + latMax) / 2;
  const centerLon = (lonMin + lonMax) / 2;
  const latRad = (centerLat * Math.PI) / 180;
  const widthM = Math.max(1, (lonMax - lonMin) * 111320 * Math.cos(latRad));
  const heightM = Math.max(1, (latMax - latMin) * 110540);
  let spanM = Math.max(widthM, heightM);
  if (hasRadius) spanM = Math.max(spanM, radiusKm * 2000);
  spanM = Math.max(spanM, 200);
  const metersPerPixel = (spanM * 1.3) / Math.min(svgW, svgH);
  const proj = (lat: number, lon: number) =>
    latLonToSvg(lat, lon, centerLat, centerLon, svgW, svgH, metersPerPixel);
  const polyPts = pts.map((p) => {
    const q = proj(p.lat, p.lon);
    return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  }).join(" ");
  const s = proj(pts[0].lat, pts[0].lon);
  const e = proj(pts[pts.length - 1].lat, pts[pts.length - 1].lon);
  let radiusSvg = "";
  if (hasRadius) {
    const c = proj(entry.latitude, entry.longitude);
    const rPx = (radiusKm * 1000) / metersPerPixel;
    radiusSvg = `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${rPx.toFixed(1)}" fill="#0A4D8C" fill-opacity="0.06" stroke="#0A4D8C" stroke-width="1.5" stroke-dasharray="6,4"/>`;
  }
  const radiusCaption = hasRadius ? ` · geplanter Radius ${formatRadiusKm(radiusKm)}` : "";
  return `
    <h2 class="page-break">Flugroute (Geozone + Route)</h2>
    <div class="map-container" style="margin: 8px 0 16px 0;">
      <svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%;max-width:${svgW}px;border:1px solid #E5E7EB;border-radius:8px;background:#EAF1F8;">
        ${radiusSvg}
        <polyline points="${polyPts}" fill="none" stroke="#E53E3E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="5" fill="#34C759" stroke="white" stroke-width="1.5"/>
        <circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="5" fill="#FF3B30" stroke="white" stroke-width="1.5"/>
        <text x="${s.x.toFixed(1)}" y="${(s.y - 8).toFixed(1)}" text-anchor="middle" font-size="9" fill="#1F7A33" font-weight="700">Start</text>
        <text x="${e.x.toFixed(1)}" y="${(e.y - 8).toFixed(1)}" text-anchor="middle" font-size="9" fill="#B91C1C" font-weight="700">Ende</text>
      </svg>
      ${legend}
      <p class="map-caption">Flugroute (${pts.length} Punkte) — ${escapeHtml(locationText)}${radiusCaption} · schematische Darstellung</p>
    </div>
  `;
}

function formatLogSeconds(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function generateDjiRecordsTableHtml(records: DjiLogRecord[]): string {
  if (!records || records.length === 0) return "";
  const max = 120;
  const step = records.length > max ? Math.ceil(records.length / max) : 1;
  const sampled = records.filter((_, i) => i % step === 0);
  const cell = (v: string | number | null | undefined) =>
    `<td style="padding:3px 6px;border:1px solid #E5E7EB;font-size:10px;white-space:nowrap;">${
      v == null || v === "" ? "—" : escapeHtml(String(v))
    }</td>`;
  const head = [
    "Zeit",
    "Modus",
    "Sats",
    "Höhe (m)",
    "VPS (m)",
    "H-Speed (m/s)",
    "V-Speed (m/s)",
    "Distanz (m)",
    "Akku %",
    "V",
    "Zellen (V)",
  ]
    .map(
      (h) =>
        `<th style="padding:3px 6px;border:1px solid #E5E7EB;font-size:10px;background:#F3F4F6;text-align:left;white-space:nowrap;">${h}</th>`,
    )
    .join("");
  const body = sampled
    .map((r) => {
      const cells = [
        cell(formatLogSeconds(r.t)),
        cell(r.mode),
        cell(r.sats),
        cell(r.heightM != null ? r.heightM.toFixed(1) : null),
        cell(r.vpsM != null ? r.vpsM.toFixed(1) : null),
        cell(r.hSpeedMs != null ? r.hSpeedMs.toFixed(1) : null),
        cell(r.vSpeedMs != null ? r.vSpeedMs.toFixed(1) : null),
        cell(r.distM != null ? r.distM.toFixed(0) : null),
        cell(r.battPct),
        cell(r.battV != null ? r.battV.toFixed(2) : null),
        cell(r.cells && r.cells.length > 0 ? r.cells.map((c) => c.toFixed(2)).join(" / ") : null),
      ].join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  const note =
    step > 1
      ? `<p class="map-caption">Detailauswertung (gesampelt: jede ${step}. Zeile, ${sampled.length} von ${records.length}).</p>`
      : `<p class="map-caption">Detailauswertung (${records.length} Datensätze).</p>`;
  return `
    <div style="overflow-x:auto;margin-top:6px;">
      <table style="border-collapse:collapse;width:100%;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>
    ${note}
  `;
}

function generateSingleDjiLogHtml(d: DjiLogMeta, index: number, total: number): string {
  const battery =
    d.batteryStartPercent != null || d.batteryEndPercent != null || d.batteryMinPercent != null
      ? [
          d.batteryStartPercent != null ? `${d.batteryStartPercent}%` : "—",
          d.batteryEndPercent != null ? `${d.batteryEndPercent}%` : "—",
          d.batteryMinPercent != null ? `${d.batteryMinPercent}%` : "—",
        ].join(" / ")
      : null;
  const notice =
    d.status === "undecryptable"
      ? "Verschlüsseltes Protokoll (DJI v13+) — ohne DJI-API-Schlüssel nicht vollständig ausgewertet. Datei als Download verfügbar."
      : d.status === "error"
        ? "Protokoll konnte nicht ausgewertet werden. Datei als Download verfügbar."
        : null;
  const rows = [
    `<tr><td class="label">Datei</td><td>${escapeHtml(d.fileName)}</td></tr>`,
    d.batteryLabel ? `<tr><td class="label">Akku</td><td>${escapeHtml(d.batteryLabel)}</td></tr>` : "",
    d.droneName ? `<tr><td class="label">Drohne (Log)</td><td>${escapeHtml(d.droneName)}</td></tr>` : "",
    d.version != null ? `<tr><td class="label">Log-Version</td><td>v${d.version}</td></tr>` : "",
    d.maxAltitudeM != null ? `<tr><td class="label">Max. Höhe (Log)</td><td>${d.maxAltitudeM.toFixed(1)} m</td></tr>` : "",
    d.durationSec != null ? `<tr><td class="label">Flugdauer (Log)</td><td>${Math.round(d.durationSec)} s</td></tr>` : "",
    d.totalDistanceM != null ? `<tr><td class="label">Strecke (Log)</td><td>${(d.totalDistanceM / 1000).toFixed(2)} km</td></tr>` : "",
    battery ? `<tr><td class="label">Akku (Start/Ende/Min)</td><td>${battery}</td></tr>` : "",
  ].join("");
  const title = total > 1 ? `<h3>Log ${index + 1}${d.batteryLabel ? ` — ${escapeHtml(d.batteryLabel)}` : ""}</h3>` : "";
  return `
    ${title}
    ${notice ? `<div class="caution-box"><p>${escapeHtml(notice)}</p></div>` : ""}
    <table>${rows}</table>
    ${generateDjiRecordsTableHtml(d.records ?? [])}
  `;
}

function generateDjiLogHtml(entry: LogbookEntry): string {
  const logs = getEntryDjiLogs(entry);
  if (logs.length === 0) return "";

  let aggregateHtml = "";
  if (logs.length > 1) {
    const aggDuration = logs.reduce((s, l) => s + (l.durationSec ?? 0), 0);
    const aggDistance = logs.reduce((s, l) => s + (l.totalDistanceM ?? 0), 0);
    const aggMaxAlt = logs.reduce(
      (m, l) => (l.maxAltitudeM != null && l.maxAltitudeM > m ? l.maxAltitudeM : m),
      0,
    );
    aggregateHtml = `
      <table>
        <tr><td class="label">Anzahl Logs</td><td>${logs.length} (Akku-Tausch)</td></tr>
        <tr><td class="label">Gesamtdauer</td><td>${Math.round(aggDuration)} s</td></tr>
        <tr><td class="label">Gesamtstrecke</td><td>${(aggDistance / 1000).toFixed(2)} km</td></tr>
        ${aggMaxAlt > 0 ? `<tr><td class="label">Max. Höhe (alle Logs)</td><td>${aggMaxAlt.toFixed(1)} m</td></tr>` : ""}
      </table>
    `;
  }

  return `
    <h2>Fluglog${logs.length > 1 ? `s (${logs.length})` : ""}</h2>
    ${aggregateHtml}
    ${logs.map((l, i) => generateSingleDjiLogHtml(l, i, logs.length)).join("")}
  `;
}

/**
 * Rendert die zum Flugzeitpunkt gültigen Pilotendokumente (Allgemeinverfügung,
 * A2-Zeugnis, Versicherungsnachweis) als PDF-Abschnitt. Bild-Dokumente mit
 * eingebetteten Daten werden als Vorschau gerendert; sonst Metadaten + Hinweis.
 */
function generateDocumentsHtml(docs: ResolvedPilotDocument[]): string {
  if (!docs || docs.length === 0) return "";
  const blocks = docs
    .map((d) => {
      const matchNote = d.matchedExactly
        ? "Zum Flugzeitpunkt gültige Fassung"
        : "Bestmögliche Fassung (keine exakte Zuordnung zum Flugdatum)";
      const expRow = d.expirationDate
        ? `<tr><td class="label">Gültig bis</td><td>${escapeHtml(d.expirationDate)}</td></tr>`
        : "";
      const a2Row =
        d.type === "a2" && d.licenseDetails
          ? `<tr><td class="label">Lizenznummer</td><td>${escapeHtml(d.licenseDetails.identificationNumber || "-")}</td></tr>`
          : "";
      const doc = d.document;
      let fileRow = "";
      let preview = "";
      if (doc) {
        const isImage = (doc.mimeType || "").startsWith("image/");
        if (isImage && doc.dataBase64) {
          preview = `<div><img src="data:${doc.mimeType};base64,${doc.dataBase64}" style="max-width:100%;max-height:420px;border:1px solid #ddd;border-radius:6px;margin-top:8px"/></div>`;
        }
        fileRow = `<tr><td class="label">Datei</td><td>${escapeHtml(doc.fileName || "Dokument")}</td></tr>`;
      }
      return `
    <h3>${escapeHtml(d.label)}</h3>
    <table>
      <tr><td class="label">Fassung</td><td>${escapeHtml(matchNote)}</td></tr>
      ${expRow}
      ${a2Row}
      ${fileRow}
    </table>
    ${preview}`;
    })
    .join("");
  return `
    <h2>Hinterlegte Dokumente</h2>
    <p style="color:#555;font-size:12px;margin-top:-4px">Die folgenden Pilotendokumente waren zum Flugzeitpunkt gültig und werden zum Nachweis beigefügt.</p>
    ${blocks}`;
}

function generateProtocolHtml(entry: LogbookEntry, maps?: ProtocolMaps, attachedDocs?: ResolvedPilotDocument[]): string {
  const generatedDate = new Date().toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const weather = entry.weatherConditions;
  const weatherHtml = weather
    ? `
    <tr><td class="label">Temperatur</td><td>${weather.temperature.toFixed(1)}°C</td></tr>
    <tr><td class="label">Wind</td><td>${weather.windSpeed.toFixed(1)} m/s</td></tr>
    ${weather.windGust ? `<tr><td class="label">Böen</td><td>${weather.windGust.toFixed(1)} m/s</td></tr>` : ""}
    <tr><td class="label">Regen</td><td>${weather.rain.toFixed(1)} mm</td></tr>
    <tr><td class="label">Bewölkung</td><td>${weather.cloudCover.toFixed(0)}%</td></tr>
    ${weather.kpIndex != null ? `<tr><td class="label">KP-Index</td><td>${weather.kpIndex.toFixed(1)}</td></tr>` : ""}
    `
    : "";

  const statusColor = entry.status === "go" ? "#2D8659" : entry.status === "caution" ? "#D97706" : "#C53030";
  const statusText = entry.status === "go" ? "GO" : entry.status === "caution" ? "CAUTION" : "NO-GO";

  const planningHtml = entry.planning ? `
    <h2>1. Flugplanung</h2>
    <table>
      <tr><td class="label">Geplantes Datum</td><td>${escapeHtml(entry.planning.plannedDate)}</td></tr>
      <tr><td class="label">Geplante Uhrzeit</td><td>${escapeHtml(entry.planning.plannedEndTime ? formatPlannedTimeRange(entry.planning.plannedTime, entry.planning.plannedEndTime) : entry.planning.plannedTime)}</td></tr>
      ${entry.planning.flightPurpose ? `<tr><td class="label">Flugzweck</td><td>${escapeHtml(entry.planning.flightPurpose)}</td></tr>` : ""}
      ${entry.planning.maxAltitude ? `<tr><td class="label">Max. Höhe</td><td>${entry.planning.maxAltitude}m</td></tr>` : ""}
      ${entry.planning.maxDistance ? `<tr><td class="label">Max. Entfernung</td><td>${entry.planning.maxDistance}m</td></tr>` : ""}
      ${entry.planning.estimatedDuration ? `<tr><td class="label">Geplante Dauer</td><td>${entry.planning.estimatedDuration} min</td></tr>` : ""}
      ${entry.planning.radiusKm ? `<tr><td class="label">Geplanter Umkreis</td><td>${entry.planning.radiusKm >= 1 ? `${entry.planning.radiusKm.toFixed(entry.planning.radiusKm % 1 === 0 ? 0 : 1)} km` : `${Math.round(entry.planning.radiusKm * 1000)} m`}${entry.planning.vlosExceeded ? (entry.planning.vlosAltitudeCorrection ? ' <strong style="color:#C53030">⚠ über Höhenrichtwert</strong>' : ' <strong style="color:#C53030">⚠ außerhalb VLOS</strong>') : ''}</td></tr>` : ""}
      ${typeof entry.planning.recommendedVlosM === "number" && entry.planning.recommendedVlosM > 0 ? `<tr><td class="label">Empfohlene VLOS</td><td>${entry.planning.recommendedVlosM >= 1000 ? `${(entry.planning.recommendedVlosM / 1000).toFixed(1)} km` : `${entry.planning.recommendedVlosM} m`}</td></tr>` : ""}
      ${entry.planning.vlosAltitudeCorrection && typeof entry.planning.vlosHorizontalLimitM === "number" ? `<tr><td class="label">Horizontaler VLOS-Richtwert</td><td>${entry.planning.vlosHorizontalLimitM} m bei ${Math.round(entry.planning.maxAltitude ?? 0)} m AGL (geometrische Näherung)</td></tr>` : ""}
      ${entry.planning.vlosExceeded ? `<tr><td class="label">VLOS-Hinweis</td><td style="color:#C53030">${entry.planning.vlosAltitudeCorrection ? 'Geplanter Umkreis überschreitet den höhenkorrigierten horizontalen VLOS-Richtwert. Die Korrektur ist eine geometrische Näherung.' : 'Flug außerhalb der direkten Sichtweite (BVLOS) — Spotter erforderlich. Pilot hat den Override bewusst gesetzt.'}</td></tr>` : ""}
      ${entry.planning.routeDescription ? `<tr><td class="label">Routenbeschreibung</td><td>${escapeHtml(entry.planning.routeDescription)}</td></tr>` : ""}
      ${entry.planning.isFpvFlight ? `<tr><td class="label">FPV-Flug</td><td>Ja</td></tr>` : ""}
      ${entry.planning.noGoOverride ? `<tr><td class="label" style="color:#C53030">NO-GO Override</td><td style="color:#C53030"><strong>Pilot hat trotz NO-GO-Status bewusst Freigabe erteilt</strong><br/>Zeitpunkt: ${escapeHtml(new Date(entry.planning.noGoOverride.acknowledgedAt).toLocaleString("de-DE"))}<br/>Ursprünglicher Status: ${escapeHtml(entry.planning.noGoOverride.originalStatus.toUpperCase())}<br/>Gründe:<ul>${entry.planning.noGoOverride.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul></td></tr>` : ""}
      ${entry.planning.officialMapCrossCheck ? `<tr><td class="label"${entry.planning.officialMapCrossCheck.blocking ? ' style="color:#D97706"' : ''}>Offizielle Karte gegengeprüft</td><td${entry.planning.officialMapCrossCheck.blocking ? ' style="color:#D97706"' : ''}>${entry.planning.officialMapCrossCheck.blocking ? "<strong>Startverhindernde Geozonen</strong>" : "Keine startverhindernden Geozonen"}${entry.planning.officialMapCrossCheck.note ? `<br/>Notiz: ${escapeHtml(entry.planning.officialMapCrossCheck.note)}` : ""}</td></tr>` : ""}
    </table>
    ${generateChecklistHtml("Planungs-Checkliste", entry.planning.checklistCompleted, entry.planning.checklistPresented)}
  ` : "";

  const preflightHtml = entry.preflight ? `
    <h2>2. Pre-Flight Check</h2>
    <table>
      ${entry.preflight.completedAt ? `<tr><td class="label">Abgeschlossen um</td><td>${formatTime(entry.preflight.completedAt)}</td></tr>` : ""}
      ${entry.preflight.equipmentNotes ? `<tr><td class="label">Ausruestung</td><td>${escapeHtml(entry.preflight.equipmentNotes)}</td></tr>` : ""}
    </table>
    ${entry.preflight.actualWeather ? `
      <h3>Aktuelle Wetterbedingungen</h3>
      <table>
        <tr><td class="label">Temperatur</td><td>${entry.preflight.actualWeather.temperature.toFixed(1)}°C</td></tr>
        <tr><td class="label">Wind</td><td>${entry.preflight.actualWeather.windSpeed.toFixed(1)} m/s</td></tr>
        ${entry.preflight.actualWeather.windGust ? `<tr><td class="label">Böen</td><td>${entry.preflight.actualWeather.windGust.toFixed(1)} m/s</td></tr>` : ""}
        <tr><td class="label">Regen</td><td>${entry.preflight.actualWeather.rain.toFixed(1)} mm</td></tr>
        <tr><td class="label">Bewölkung</td><td>${entry.preflight.actualWeather.cloudCover.toFixed(0)}%</td></tr>
      </table>
    ` : ""}
    ${generateChecklistHtml("Pre-Flight Checkliste", entry.preflight.checklistCompleted, entry.preflight.checklistPresented)}
  ` : "";

  const hoverHtml = entry.hoverCheck ? `
    <h2>3. Hover-Check (5m)</h2>
    <table>
      ${entry.hoverCheck.controlsOk != null ? `<tr><td class="label">Steuerung OK</td><td>${entry.hoverCheck.controlsOk ? "Ja" : "Nein"}</td></tr>` : ""}
      ${entry.hoverCheck.signalOk != null ? `<tr><td class="label">GPS-Signal OK</td><td>${entry.hoverCheck.signalOk ? "Ja" : "Nein"}</td></tr>` : ""}
      ${entry.hoverCheck.hoverStable != null ? `<tr><td class="label">Hover stabil</td><td>${entry.hoverCheck.hoverStable ? "Ja" : "Nein"}</td></tr>` : ""}
      ${entry.hoverCheck.takeoffTime ? `<tr><td class="label">Start</td><td>${formatTime(entry.hoverCheck.takeoffTime)}</td></tr>` : ""}
      ${entry.hoverCheck.skippedFlightCheck ? `<tr><td class="label">Flight-Check</td><td style="color:#D97706">Übersprungen</td></tr>` : ""}
    </table>
    ${entry.hoverCheck.checklistCompleted ? generateChecklistHtml("Hover-Checkliste", entry.hoverCheck.checklistCompleted) : ""}
  ` : "";

  const postLandingHtml = entry.postLanding ? `
    <h2>4. Post-Landing Check</h2>
    <table>
      <tr><td class="label">UAS ausgeschaltet</td><td>${entry.postLanding.uasPoweredOff ? "Ja" : "Nein"}</td></tr>
      <tr><td class="label">Controller ausgeschaltet</td><td>${entry.postLanding.controllerPoweredOff ? "Ja" : "Nein"}</td></tr>
      <tr><td class="label">Schaden geprüft</td><td>${entry.postLanding.damageChecked ? "Ja" : "Nein"}</td></tr>
    </table>
    ${generateChecklistHtml("Post-Landing Checkliste", entry.postLanding.checklistCompleted)}
  ` : "";

  const debriefingHtml = entry.debriefing ? `
    <h2>5. Debriefing</h2>
    <table>
      ${entry.debriefing.flightDurationMinutes ? `<tr><td class="label">Flugdauer</td><td>${formatDuration(entry.debriefing.flightDurationMinutes)}</td></tr>` : ""}
      ${entry.debriefing.takeoffTime ? `<tr><td class="label">Start</td><td>${formatTime(entry.debriefing.takeoffTime)}</td></tr>` : ""}
      ${entry.debriefing.landingTime ? `<tr><td class="label">Landung</td><td>${formatTime(entry.debriefing.landingTime)}</td></tr>` : ""}
      ${entry.debriefing.batteryUsedPercent != null ? `<tr><td class="label">Batterie verbraucht</td><td>${entry.debriefing.batteryUsedPercent}%</td></tr>` : ""}
      <tr><td class="label">Vorfall</td><td style="color:${entry.debriefing.incidentOccurred ? "#C53030" : "#2D8659"}">${entry.debriefing.incidentOccurred ? "Ja" : "Nein"}</td></tr>
      ${entry.debriefing.incidentDescription ? `<tr><td class="label">Vorfallbeschreibung</td><td>${escapeHtml(entry.debriefing.incidentDescription)}</td></tr>` : ""}
      <tr><td class="label">Wartung nötig</td><td style="color:${entry.debriefing.maintenanceRequired ? "#D97706" : "#2D8659"}">${entry.debriefing.maintenanceRequired ? "Ja" : "Nein"}</td></tr>
      ${entry.debriefing.maintenanceNotes ? `<tr><td class="label">Wartungshinweise</td><td>${escapeHtml(entry.debriefing.maintenanceNotes)}</td></tr>` : ""}
      ${entry.debriefing.generalNotes ? `<tr><td class="label">Notizen</td><td>${escapeHtml(entry.debriefing.generalNotes)}</td></tr>` : ""}
    </table>
  ` : "";

  const trafficHtml = entry.trafficLog
    ? generateTrafficTableHtml(entry.trafficLog) + generateTrafficTrailsHtml(entry.trafficLog)
    : "";

  const mapWithTrailsHtml = generateMapWithTrailsHtml(entry);
  const mapFallbackHtml = !mapWithTrailsHtml && entry.trafficLog ? generateMapSnapshotHtml(entry.trafficLog) : "";

  const geozonesSectionHtml = generateGeozonesSectionHtml(entry.savedGeozoneFeatures, entry.savedDipulRestrictions);

  const geozoneListHtml = (!geozonesSectionHtml && entry.detectedGeozones && entry.detectedGeozones.length > 0) ? `
    <div class="section">
      <h3>Aktive Geozonen</h3>
      <ul style="margin:4px 0;padding-left:20px;">
        ${entry.detectedGeozones.map(g => `<li>${escapeHtml(g)}</li>`).join("")}
      </ul>
    </div>
  ` : "";

  const restrictionsHtml = entry.hasRestrictions ? `
    <div class="caution-box">
      <strong>Einschränkungen vorhanden</strong>
      ${entry.restrictionNotes ? `<p>${escapeHtml(entry.restrictionNotes)}</p>` : ""}
    </div>
    ${geozoneListHtml}
  ` : geozoneListHtml;

  const weatherSectionHtml = generateWeatherSectionHtml(entry);
  const ctrWeatherSectionHtml = generateCtrWeatherSectionHtml(entry);

  return `
  <!DOCTYPE html>
  <html lang="de">
  <head>
    <meta charset="UTF-8" />
    <style>
      body {
        font-family: Helvetica, Arial, sans-serif;
        font-size: 12px;
        color: #1A202C;
        padding: 20px;
        line-height: 1.5;
      }
      .header {
        text-align: center;
        margin-bottom: 24px;
        padding-bottom: 16px;
        border-bottom: 2px solid #0A4D8C;
      }
      .header h1 {
        font-size: 22px;
        color: #0A4D8C;
        margin: 0 0 4px 0;
      }
      .header p {
        color: #6B7280;
        font-size: 11px;
        margin: 2px 0;
      }
      .status-badge {
        display: inline-block;
        padding: 4px 16px;
        border-radius: 12px;
        color: white;
        font-weight: 700;
        font-size: 14px;
        margin-top: 8px;
      }
      h2 {
        font-size: 15px;
        color: #0A4D8C;
        margin: 20px 0 8px 0;
        border-bottom: 1px solid #E5E7EB;
        padding-bottom: 4px;
      }
      h3 {
        font-size: 12px;
        color: #374151;
        margin: 12px 0 4px 0;
      }
      h4 {
        font-size: 11px;
        color: #0A4D8C;
        margin: 8px 0 4px 0;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 8px;
      }
      td, th {
        padding: 4px 8px;
        border-bottom: 1px solid #F3F4F6;
        font-size: 11px;
        text-align: left;
      }
      th {
        background: #F9FAFB;
        font-weight: 600;
        color: #374151;
        border-bottom: 2px solid #E5E7EB;
      }
      td.label {
        font-weight: 600;
        color: #6B7280;
        width: 160px;
      }
      .small { font-size: 9px; color: #9CA3AF; }
      .zone-badge {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 4px;
        color: white;
        font-size: 9px;
        font-weight: 600;
      }
      .incident {
        background: #FEF2F2;
        border-left: 3px solid #C53030;
        padding: 8px 12px;
        margin: 8px 0;
        border-radius: 4px;
      }
      .incident strong { color: #C53030; }
      .maintenance {
        background: #FFFBEB;
        border-left: 3px solid #D97706;
        padding: 8px 12px;
        margin: 8px 0;
        border-radius: 4px;
      }
      .maintenance strong { color: #D97706; }
      .caution-box {
        background: #FFFBEB;
        border-left: 3px solid #D97706;
        padding: 8px 12px;
        margin: 8px 0;
        border-radius: 4px;
      }
      .caution-box strong { color: #D97706; }
      .info-box {
        background: #F0F9FF;
        border-left: 3px solid #2563EB;
        padding: 8px 12px;
        margin: 8px 0;
        border-radius: 4px;
        color: #1E40AF;
      }
      p { margin: 4px 0; color: #4B5563; }
      .traffic-summary {
        display: flex;
        justify-content: space-around;
        margin: 12px 0;
        padding: 12px;
        background: #F9FAFB;
        border-radius: 8px;
        border: 1px solid #E5E7EB;
      }
      .stat-item { text-align: center; }
      .stat-value {
        font-size: 18px;
        font-weight: 700;
        color: #0A4D8C;
      }
      .stat-label {
        font-size: 9px;
        color: #6B7280;
        text-transform: uppercase;
      }
      .traffic-table th { font-size: 10px; }
      .traffic-table td { font-size: 10px; }
      .trail-section {
        margin: 8px 0;
        page-break-inside: avoid;
      }
      .trail-table { font-size: 9px; }
      .trail-table th { font-size: 9px; }
      .trail-table td { font-size: 9px; padding: 2px 6px; }
      .map-container { text-align: center; margin: 12px 0; }
      .map-image {
        max-width: 100%;
        border: 1px solid #E5E7EB;
        border-radius: 8px;
      }
      .map-caption {
        font-size: 10px;
        color: #6B7280;
        margin-top: 4px;
      }
      .page-break { page-break-before: always; }
      .geozone-table th, .restriction-table th {
        font-size: 9px;
        background: #F9FAFB;
        font-weight: 600;
        color: #374151;
        border-bottom: 2px solid #E5E7EB;
      }
      .geozone-table td, .restriction-table td {
        font-size: 10px;
        padding: 3px 6px;
      }
      .restriction-category { page-break-inside: avoid; }
      .geozone-group { page-break-inside: avoid; }
      .footer {
        text-align: center;
        margin-top: 32px;
        padding-top: 12px;
        border-top: 1px solid #E5E7EB;
        font-size: 10px;
        color: #9CA3AF;
      }
      hr {
        border: none;
        border-top: 1px dashed #D1D5DB;
        margin: 20px 0;
      }
      .stats {
        display: flex;
        justify-content: space-around;
        margin: 16px 0;
        padding: 12px;
        background: #F9FAFB;
        border-radius: 8px;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <h1>Flugprotokoll</h1>
      <p>Erstellt am ${generatedDate}</p>
      <p>${escapeHtml(entry.droneName)} (${entry.droneClass}) - ${escapeHtml(entry.locationName || `${entry.latitude.toFixed(4)}, ${entry.longitude.toFixed(4)}`)}</p>
      <p>${formatDate(entry.flightDate)}</p>
      <div class="status-badge" style="background:${statusColor}">${statusText}</div>
    </div>

    <h2>Flugdaten</h2>
    <table>
      <tr><td class="label">Drohne</td><td>${escapeHtml(entry.droneName)} (${entry.droneClass})</td></tr>
      ${entry.planning?.droneSerialNumber ? `<tr><td class="label">Seriennummer</td><td>${escapeHtml(entry.planning.droneSerialNumber)}</td></tr>` : ""}
      ${entry.planning?.droneAlphaTangoId
        ? `<tr><td class="label">AlphaTango-ID (FR)</td><td>${escapeHtml(entry.planning.droneAlphaTangoId)}</td></tr>`
        : entry.planning?.alphaTangoMissingAcknowledged
          ? `<tr><td class="label">AlphaTango-ID (FR)</td><td style="color:#d33;font-weight:600">FEHLT – Pilot hat Flug trotz Hinweis fortgesetzt (Verstoß gegen DGAC-Pflicht ab MTOM 800 g)</td></tr>`
          : ""}
      <tr><td class="label">Ort</td><td>${escapeHtml(entry.locationName || "-")}</td></tr>
      <tr><td class="label">Koordinaten</td><td>${entry.latitude.toFixed(6)}, ${entry.longitude.toFixed(6)}</td></tr>
      <tr><td class="label">Start</td><td>${formatTime(entry.takeoffTime)}</td></tr>
      <tr><td class="label">Landung</td><td>${formatTime(entry.landingTime)}</td></tr>
      <tr><td class="label">Flugdauer</td><td>${formatDuration(entry.flightDurationMinutes)}</td></tr>
      <tr><td class="label">Max. Höhe</td><td>${entry.maxAltitude ? `${entry.maxAltitude}m` : "-"}</td></tr>
    </table>

    ${generatePlanningMapHtml(entry, maps?.planned)}
    ${weatherSectionHtml ? weatherSectionHtml : (weatherHtml ? `<h3>Wetter bei Flugbeginn</h3><table>${weatherHtml}</table>` : "")}
    ${ctrWeatherSectionHtml}
    ${restrictionsHtml}

    ${planningHtml}
    ${preflightHtml}
    ${hoverHtml}
    ${postLandingHtml}
    ${debriefingHtml}
    ${generateRouteMapHtml(entry, maps?.route)}
    ${generateDjiLogHtml(entry)}
    ${geozonesSectionHtml}
    ${mapWithTrailsHtml || mapFallbackHtml}
    ${trafficHtml}
    ${attachedDocs && attachedDocs.length > 0 ? generateDocumentsHtml(attachedDocs) : ""}

    <div class="footer">
      DrohnenPilot - Vollstaendiges Flugprotokoll
    </div>
  </body>
  </html>
  `;
}

function generateFullHtml(entries: LogbookEntry[]): string {
  const entriesHtml = entries.map(generateSingleEntryHtml).join("\n<hr/>\n");
  const generatedDate = new Date().toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return `
  <!DOCTYPE html>
  <html lang="de">
  <head>
    <meta charset="UTF-8" />
    <style>
      body {
        font-family: Helvetica, Arial, sans-serif;
        font-size: 12px;
        color: #1A202C;
        padding: 20px;
        line-height: 1.5;
      }
      .header {
        text-align: center;
        margin-bottom: 24px;
        padding-bottom: 16px;
        border-bottom: 2px solid #0A4D8C;
      }
      .header h1 {
        font-size: 20px;
        color: #0A4D8C;
        margin: 0 0 4px 0;
      }
      .header p {
        color: #6B7280;
        font-size: 11px;
        margin: 0;
      }
      .entry {
        margin-bottom: 24px;
        page-break-inside: avoid;
      }
      h2 {
        font-size: 15px;
        color: #0A4D8C;
        margin: 16px 0 8px 0;
        border-bottom: 1px solid #E5E7EB;
        padding-bottom: 4px;
      }
      h3 {
        font-size: 12px;
        color: #374151;
        margin: 12px 0 4px 0;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 8px;
      }
      td {
        padding: 4px 8px;
        border-bottom: 1px solid #F3F4F6;
        font-size: 11px;
      }
      td.label {
        font-weight: 600;
        color: #6B7280;
        width: 140px;
      }
      hr {
        border: none;
        border-top: 1px dashed #D1D5DB;
        margin: 20px 0;
      }
      .incident {
        background: #FEF2F2;
        border-left: 3px solid #C53030;
        padding: 8px 12px;
        margin: 8px 0;
        border-radius: 4px;
      }
      .incident strong { color: #C53030; }
      .maintenance {
        background: #FFFBEB;
        border-left: 3px solid #D97706;
        padding: 8px 12px;
        margin: 8px 0;
        border-radius: 4px;
      }
      .maintenance strong { color: #D97706; }
      p {
        margin: 4px 0;
        color: #4B5563;
      }
      .footer {
        text-align: center;
        margin-top: 32px;
        padding-top: 12px;
        border-top: 1px solid #E5E7EB;
        font-size: 10px;
        color: #9CA3AF;
      }
      .stats {
        display: flex;
        justify-content: space-around;
        margin: 16px 0;
        padding: 12px;
        background: #F9FAFB;
        border-radius: 8px;
      }
      .stat-item {
        text-align: center;
      }
      .stat-value {
        font-size: 18px;
        font-weight: 700;
        color: #0A4D8C;
      }
      .stat-label {
        font-size: 10px;
        color: #6B7280;
        text-transform: uppercase;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <h1>Flugprotokoll / Logbuch</h1>
      <p>Erstellt am ${generatedDate}</p>
    </div>

    <div class="stats">
      <div class="stat-item">
        <div class="stat-value">${entries.length}</div>
        <div class="stat-label">Fluege</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${entries.reduce((sum, e) => sum + (e.flightDurationMinutes || 0), 0)} min</div>
        <div class="stat-label">Gesamtflugzeit</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${entries.filter((e) => e.incidentOccurred).length}</div>
        <div class="stat-label">Vorfaelle</div>
      </div>
    </div>

    ${entriesHtml}

    <div class="footer">
      DrohnenPilot - Flugprotokoll-Export
    </div>
  </body>
  </html>
  `;
}

async function sharePdf(html: string, dialogTitle: string): Promise<void> {
  if (Platform.OS === "web") {
    const { uri } = await Print.printToFileAsync({ html });
    window.open(uri, "_blank");
    return;
  }

  const { uri } = await Print.printToFileAsync({
    html,
    base64: false,
  });

  if (Platform.OS === "android") {
    // Fernsteuerung: kein „Teilen“ möglich → PDF direkt in einen Ordner speichern
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const name = `${dialogTitle.replace(/[^\wäöüÄÖÜß -]+/g, "").trim().replace(/\s+/g, "-") || "export"}-${stamp}.pdf`;
    const r = await saveToDevice({ fileName: name, mimeType: "application/pdf", srcUri: uri });
    if (r.saved) Alert.alert("PDF gespeichert", `Gespeichert unter: ${r.location}`);
    return;
  }
  const isAvailable = await Sharing.isAvailableAsync();
  if (isAvailable) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      dialogTitle,
      UTI: "com.adobe.pdf",
    });
  }
}

export async function exportLogbookPdf(entries: LogbookEntry[]): Promise<void> {
  const html = generateFullHtml(entries);
  await sharePdf(html, "Flugprotokoll exportieren");
}

export async function exportSingleEntryPdf(entry: LogbookEntry): Promise<void> {
  return exportLogbookPdf([entry]);
}

/**
 * Löst die zum Flugzeitpunkt gültigen Pilotendokumente auf. `includeDocs`
 * überschreibt die globale Einstellung pro Export; ohne Angabe gilt die
 * Nutzereinstellung `attachPilotDocsToExports` (Default: an).
 */
export async function resolveAttachedDocsForEntry(
  entry: LogbookEntry,
  includeDocs?: boolean,
): Promise<ResolvedPilotDocument[]> {
  let include = includeDocs;
  if (include == null) {
    try {
      const settings = await getSettings();
      include = settings.attachPilotDocsToExports ?? true;
    } catch {
      include = true;
    }
  }
  if (!include) return [];
  try {
    const pilot = await getPilotProfile();
    return resolveFlightTimeDocuments(pilot, {
      flightDateISO: entry.flightDate,
      ...flightDocScope(entry),
    });
  } catch {
    return [];
  }
}

export interface ProtocolExportOptions {
  /** Pilotendokumente anhängen? Überschreibt die globale Einstellung. */
  includeDocs?: boolean;
}

export async function exportFlightProtocolPdf(
  entry: LogbookEntry,
  options?: ProtocolExportOptions,
): Promise<void> {
  const [maps, docs] = await Promise.all([
    prefetchProtocolMaps(entry),
    resolveAttachedDocsForEntry(entry, options?.includeDocs),
  ]);
  const html = generateProtocolHtml(entry, maps, docs);
  await sharePdf(html, "Vollstaendiges Flugprotokoll exportieren");
}

/** Erzeugt das Flugprotokoll-PDF und gibt die lokale Datei-URI zurueck. */
async function buildProtocolPdfUri(entry: LogbookEntry, options?: ProtocolExportOptions): Promise<string> {
  const [maps, docs] = await Promise.all([
    prefetchProtocolMaps(entry),
    resolveAttachedDocsForEntry(entry, options?.includeDocs),
  ]);
  const html = generateProtocolHtml(entry, maps, docs);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  return uri;
}

export interface EmailShareResult {
  status: "sent" | "saved" | "cancelled" | "unavailable" | "web";
}

/**
 * Versendet das Flugprotokoll als PDF-Anhang per E-Mail (expo-mail-composer).
 * Auf Web bzw. ohne konfiguriertes Mail-Konto: sauberer Fallback (PDF oeffnen).
 */
export async function sendFlightProtocolByEmail(
  entry: LogbookEntry,
  options?: { recipients?: string[]; shareUrl?: string | null },
): Promise<EmailShareResult> {
  if (Platform.OS === "web") {
    const [maps, docs] = await Promise.all([
      prefetchProtocolMaps(entry),
      resolveAttachedDocsForEntry(entry),
    ]);
    const html = generateProtocolHtml(entry, maps, docs);
    const { uri } = await Print.printToFileAsync({ html });
    window.open(uri, "_blank");
    return { status: "web" };
  }

  const isAvailable = await MailComposer.isAvailableAsync();
  if (!isAvailable) {
    return { status: "unavailable" };
  }

  const uri = await buildProtocolPdfUri(entry);
  const dateLabel = entry.flightDate || "";
  const droneLabel = entry.droneName || "Drohne";
  const linkLine = options?.shareUrl ? `\n\nFreigabe-Link: ${options.shareUrl}` : "";

  const result = await MailComposer.composeAsync({
    recipients: options?.recipients,
    subject: `Flugprotokoll ${droneLabel} ${dateLabel}`.trim(),
    body:
      `Anbei das Flugprotokoll vom ${dateLabel} (${droneLabel}).` +
      linkLine +
      `\n\nErstellt mit der Pre-Flight-Check-App.`,
    attachments: [uri],
  });

  if (result.status === MailComposer.MailComposerStatus.SENT) return { status: "sent" };
  if (result.status === MailComposer.MailComposerStatus.SAVED) return { status: "saved" };
  return { status: "cancelled" };
}

export interface SmsShareResult {
  status: "sent" | "cancelled" | "unknown" | "unavailable" | "web";
}

/**
 * Versendet den Freigabe-Link per SMS (expo-sms). Nur sinnvoll, wenn die
 * Freigabe aktiv ist (Link erreichbar). Web/ohne SMS: sauberer Fallback.
 */
export async function shareProtocolViaSms(
  entry: LogbookEntry,
  shareUrl: string,
  recipients?: string[],
): Promise<SmsShareResult> {
  if (Platform.OS === "web") {
    return { status: "web" };
  }

  const isAvailable = await SMS.isAvailableAsync();
  if (!isAvailable) {
    return { status: "unavailable" };
  }

  const dateLabel = entry.flightDate || "";
  const droneLabel = entry.droneName || "Drohne";
  const message =
    `Flugprotokoll ${droneLabel} vom ${dateLabel}: ${shareUrl}`.trim();

  const { result } = await SMS.sendSMSAsync(recipients || [], message);
  if (result === "sent") return { status: "sent" };
  if (result === "cancelled") return { status: "cancelled" };
  return { status: "unknown" };
}
