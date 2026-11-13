import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { LogbookEntry, TrafficLogData, SavedGeozoneFeature, SavedDipulRestriction } from "@/lib/storage";

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

function generateChecklistHtml(title: string, completed: string[], presented?: string[]): string {
  if (!completed || completed.length === 0) return "";
  const items = (presented && presented.length > 0 ? presented : completed).map((item) => {
    const isChecked = completed.includes(item);
    const icon = isChecked ? "&#9745;" : "&#9744;";
    const color = isChecked ? "#2D8659" : "#C53030";
    return `<tr><td style="color:${color};width:20px;font-size:14px;">${icon}</td><td>${escapeHtml(item.replace(/_/g, " "))}</td></tr>`;
  }).join("");
  return `<h3>${escapeHtml(title)}</h3><table>${items}</table>`;
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
    const grouped: Record<string, SavedGeozoneFeature[]> = {};
    features.forEach((f) => {
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

      ${entry.planning?.flightPurpose ? `<h3>Flugzweck</h3><p>${escapeHtml(entry.planning.flightPurpose)}</p>` : ""}

      ${entry.savedGeozoneFeatures && entry.savedGeozoneFeatures.length > 0 ? `
        <h3>Geozonen im Einsatzgebiet</h3>
        <ul style="margin:4px 0;padding-left:20px;font-size:10px;">
          ${entry.savedGeozoneFeatures.map(f => `<li><strong>${escapeHtml(f.layerLabel)}:</strong> ${escapeHtml(f.name)}${f.details ? ` - ${escapeHtml(f.details)}` : ""}</li>`).join("")}
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

function generateProtocolHtml(entry: LogbookEntry): string {
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
      <tr><td class="label">Geplante Uhrzeit</td><td>${escapeHtml(entry.planning.plannedTime)}</td></tr>
      ${entry.planning.flightPurpose ? `<tr><td class="label">Flugzweck</td><td>${escapeHtml(entry.planning.flightPurpose)}</td></tr>` : ""}
      ${entry.planning.maxAltitude ? `<tr><td class="label">Max. Höhe</td><td>${entry.planning.maxAltitude}m</td></tr>` : ""}
      ${entry.planning.maxDistance ? `<tr><td class="label">Max. Entfernung</td><td>${entry.planning.maxDistance}m</td></tr>` : ""}
      ${entry.planning.estimatedDuration ? `<tr><td class="label">Geplante Dauer</td><td>${entry.planning.estimatedDuration} min</td></tr>` : ""}
      ${entry.planning.routeDescription ? `<tr><td class="label">Routenbeschreibung</td><td>${escapeHtml(entry.planning.routeDescription)}</td></tr>` : ""}
      ${entry.planning.isFpvFlight ? `<tr><td class="label">FPV-Flug</td><td>Ja</td></tr>` : ""}
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
      <tr><td class="label">Ort</td><td>${escapeHtml(entry.locationName || "-")}</td></tr>
      <tr><td class="label">Koordinaten</td><td>${entry.latitude.toFixed(6)}, ${entry.longitude.toFixed(6)}</td></tr>
      <tr><td class="label">Start</td><td>${formatTime(entry.takeoffTime)}</td></tr>
      <tr><td class="label">Landung</td><td>${formatTime(entry.landingTime)}</td></tr>
      <tr><td class="label">Flugdauer</td><td>${formatDuration(entry.flightDurationMinutes)}</td></tr>
      <tr><td class="label">Max. Höhe</td><td>${entry.maxAltitude ? `${entry.maxAltitude}m` : "-"}</td></tr>
    </table>

    ${weatherSectionHtml ? weatherSectionHtml : (weatherHtml ? `<h3>Wetter bei Flugbeginn</h3><table>${weatherHtml}</table>` : "")}
    ${restrictionsHtml}

    ${planningHtml}
    ${preflightHtml}
    ${hoverHtml}
    ${postLandingHtml}
    ${debriefingHtml}
    ${geozonesSectionHtml}
    ${mapWithTrailsHtml || mapFallbackHtml}
    ${trafficHtml}

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

export async function exportFlightProtocolPdf(entry: LogbookEntry): Promise<void> {
  const html = generateProtocolHtml(entry);
  await sharePdf(html, "Vollstaendiges Flugprotokoll exportieren");
}
