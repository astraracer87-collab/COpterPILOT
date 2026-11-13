import { useEffect, useMemo, useRef, useState } from "react";
import TrafficMap from "./TrafficMap";
import {
  fetchNearbyAircraft,
  type AircraftState,
  type DataSource,
  type SourceStatus,
  altitudeDisplay,
  speedDisplay,
  headingDisplay,
  categoryLabel,
  compassDir,
} from "../lib/opensky";
import {
  detectAlerts,
  speakAlert,
  speechSupported,
  stopSpeaking,
  loadRadarSettings,
  saveRadarSettings,
  appendTrafficLog,
  getTrafficLog,
  clearTrafficLog,
  shouldLogAlert,
  type ProximityAlert,
  type RadarSettings,
  type TrafficLogEntry,
} from "../lib/proximityAlarm";

export interface LiveTrafficRadarProps {
  latitude: number;
  longitude: number;
  locationName?: string;
  fetchRadiusKm?: number;
  /** When embedded (in pre-flight/hover), render compact + skip log/settings panels */
  compact?: boolean;
  /** Notify parent of new alerts so they can persist into a flight session */
  onTrafficLogEntry?: (entry: TrafficLogEntry) => void;
  /** Wenn gesetzt, kann der Pilot den Standort durch Klick auf die Karte verschieben. */
  onLocationChange?: (lat: number, lon: number) => void;
}

const SOURCE_LABELS: Record<DataSource, string> = {
  opensky: "OpenSky",
  adsbfi: "adsb.fi",
  adsbone: "adsb.one",
  airplaneslive: "apl.live",
  adsblol: "adsb.lol",
  ogn: "OGN",
};

function statusColor(s: SourceStatus): string {
  if (s === "ok") return "bg-green-500";
  if (s === "timeout") return "bg-amber-500";
  return "bg-red-500";
}

export default function LiveTrafficRadar(props: LiveTrafficRadarProps) {
  const { latitude, longitude, locationName, fetchRadiusKm = 25, compact = false, onTrafficLogEntry, onLocationChange } = props;

  const [aircraft, setAircraft] = useState<AircraftState[]>([]);
  const [sourceStatus, setSourceStatus] = useState<Record<DataSource, SourceStatus> | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<RadarSettings>(() => loadRadarSettings());
  const [trafficLog, setTrafficLog] = useState<TrafficLogEntry[]>(() => getTrafficLog());
  const [view, setView] = useState<"map" | "radar">("map");

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const logRef = useRef(trafficLog);
  logRef.current = trafficLog;

  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const r = await fetchNearbyAircraft(latitude, longitude, fetchRadiusKm);
        if (cancelled) return;
        setAircraft(r.states);
        setSourceStatus(r.sourceStatus);
        setLastUpdate(r.fetchedAt);
        setError(null);

        const alerts = detectAlerts(r.states, latitude, longitude, settingsRef.current);
        const newEntries: TrafficLogEntry[] = [];
        for (const a of alerts) {
          if (shouldLogAlert(a, logRef.current)) {
            const entry = appendTrafficLog(a);
            newEntries.unshift(entry);
            speakAlert(a, settingsRef.current);
            onTrafficLogEntry?.(entry);
          }
        }
        if (newEntries.length) {
          const combined = [...newEntries.reverse(), ...logRef.current].slice(0, 200);
          setTrafficLog(combined);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Fehler beim Laden");
      } finally {
        if (!cancelled) setLoading(false);
        inFlight.current = false;
      }
    }
    load();
    const iv = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(iv);
      stopSpeaking();
    };
  }, [latitude, longitude, fetchRadiusKm, onTrafficLogEntry]);

  // Pre-load voice list (some browsers need an event)
  useEffect(() => {
    if (!speechSupported()) return;
    const handler = () => {};
    window.speechSynthesis.onvoiceschanged = handler;
    window.speechSynthesis.getVoices();
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const alerts: ProximityAlert[] = useMemo(
    () => detectAlerts(aircraft, latitude, longitude, settings),
    [aircraft, latitude, longitude, settings],
  );

  const updateSettings = (patch: Partial<RadarSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveRadarSettings(next);
      if (patch.muted) stopSpeaking();
      return next;
    });
  };

  const radarSize = compact ? 220 : 320;
  const visibleRadiusKm = settings.warnRadiusKm * 2.5;

  return (
    <div className="space-y-4">
      {/* Alert banner */}
      {alerts.length > 0 && (
        <div
          className={`rounded-lg p-3 border-l-4 ${
            alerts[0].level === "critical"
              ? "bg-red-50 border-red-500 text-red-900"
              : "bg-amber-50 border-amber-500 text-amber-900"
          }`}
          role="alert"
        >
          <div className="font-semibold">
            {alerts[0].level === "critical" ? "Achtung — Verkehr nah!" : "Verkehrswarnung"}
          </div>
          <div className="text-sm mt-1">
            {alerts.length} Luftfahrzeug{alerts.length !== 1 ? "e" : ""} im Warnradius. Nächstes:{" "}
            {alerts[0].aircraft.callsign || alerts[0].aircraft.icao24} —{" "}
            {Math.round(alerts[0].distanceKm * 1000)} m, {compassDir(alerts[0].bearingDeg)}
            {alerts[0].altitudeM != null ? `, Höhe ${Math.round(alerts[0].altitudeM)} m` : ""}.
          </div>
        </div>
      )}

      {/* Header / controls */}
      <div className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm text-slate-500">Standort</div>
            <div className="font-semibold text-slate-900">
              {locationName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Suchradius: {fetchRadiusKm} km · {aircraft.length} Luftfahrzeuge
              {lastUpdate ? ` · Aktualisiert ${new Date(lastUpdate).toLocaleTimeString("de-DE")}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => updateSettings({ muted: !settings.muted })}
              className={`px-3 py-1.5 text-sm rounded-md font-medium ${
                settings.muted
                  ? "bg-slate-200 text-slate-700"
                  : "bg-brand-500 text-white hover:bg-brand-600"
              }`}
              aria-pressed={!settings.muted}
            >
              {settings.muted ? "Audio aus" : "Audio an"}
            </button>
          </div>
        </div>

        {!speechSupported() && !settings.muted && (
          <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
            Audio-Warnungen werden in diesem Browser nicht unterstützt.
          </p>
        )}
      </div>

      {/* Map / Radar + nearest list */}
      <div className={`grid gap-4 ${compact ? "" : "md:grid-cols-2"}`}>
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-slate-700 text-sm">
              {view === "map" ? "Karte" : "Radar (oben = Norden)"}
            </div>
            <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setView("map")}
                className={`px-2.5 py-1 ${view === "map" ? "bg-brand-500 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                aria-pressed={view === "map"}
              >
                Karte
              </button>
              <button
                type="button"
                onClick={() => setView("radar")}
                className={`px-2.5 py-1 ${view === "radar" ? "bg-brand-500 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                aria-pressed={view === "radar"}
              >
                Radar
              </button>
            </div>
          </div>
          {view === "map" ? (
            <>
              <TrafficMap
                latitude={latitude}
                longitude={longitude}
                aircraft={aircraft}
                warnRadiusKm={settings.warnRadiusKm}
                criticalRadiusKm={settings.criticalRadiusKm}
                height={compact ? 240 : 360}
                alertIcaos={new Set(alerts.map((a) => a.aircraft.icao24))}
                criticalIcaos={new Set(alerts.filter((a) => a.level === "critical").map((a) => a.aircraft.icao24))}
                onMapClick={onLocationChange}
              />
              {onLocationChange ? (
                <p className="mt-2 text-[11px] text-slate-500 text-center">
                  Tipp: Klick auf die Karte verschiebt deinen Standort.
                </p>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col items-center">
              <RadarSvg
                size={radarSize}
                visibleRadiusKm={visibleRadiusKm}
                warnRadiusKm={settings.warnRadiusKm}
                criticalRadiusKm={settings.criticalRadiusKm}
                aircraft={aircraft}
                alertIcaos={new Set(alerts.map((a) => a.aircraft.icao24))}
                criticalIcaos={new Set(alerts.filter((a) => a.level === "critical").map((a) => a.aircraft.icao24))}
              />
              <div className="text-xs text-slate-500 mt-2">
                Innerer Ring: {settings.criticalRadiusKm} km (kritisch) · äußerer Ring:{" "}
                {settings.warnRadiusKm} km (Warnung) · Anzeige bis {visibleRadiusKm.toFixed(1)} km
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="font-semibold text-slate-700 mb-2 text-sm">Nächste Luftfahrzeuge</div>
          {loading ? (
            <div className="py-6 text-center text-sm text-slate-500">Lade Verkehrsdaten …</div>
          ) : error ? (
            <div className="py-6 text-center text-sm text-red-600">{error}</div>
          ) : aircraft.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">
              Aktuell kein Verkehr im Umkreis.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-96 overflow-auto">
              {aircraft.slice(0, 20).map((ac) => {
                const dist = ac.distanceKm ?? 0;
                const altCol =
                  (ac.geoAltitude ?? ac.baroAltitude ?? 9999) < 150
                    ? "text-red-600"
                    : (ac.geoAltitude ?? ac.baroAltitude ?? 9999) < 500
                      ? "text-amber-600"
                      : "text-slate-700";
                const inWarn = dist <= settings.warnRadiusKm;
                return (
                  <li
                    key={ac.icao24}
                    className={`py-2 text-sm ${inWarn ? "bg-amber-50 -mx-2 px-2 rounded" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-slate-900">
                        {ac.callsign || ac.icao24}{" "}
                        <span className="text-xs text-slate-400">
                          {categoryLabel(ac.category)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`} ·{" "}
                        {compassDir(ac.bearingDeg ?? 0)}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 flex gap-3 mt-0.5">
                      <span className={altCol}>Höhe {altitudeDisplay(ac)}</span>
                      <span>{speedDisplay(ac)}</span>
                      <span>Kurs {headingDisplay(ac.trueTrack)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {!compact && (
        <>
          {/* Settings */}
          <div className="card">
            <div className="font-semibold text-slate-700 mb-3 text-sm">Warneinstellungen</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <NumberField
                label="Warnradius (km)"
                value={settings.warnRadiusKm}
                min={0.5}
                max={10}
                step={0.5}
                onChange={(v) =>
                  updateSettings({
                    warnRadiusKm: v,
                    criticalRadiusKm: Math.min(settings.criticalRadiusKm, v),
                  })
                }
              />
              <NumberField
                label="Kritischer Radius (km)"
                value={settings.criticalRadiusKm}
                min={0.2}
                max={settings.warnRadiusKm}
                step={0.1}
                onChange={(v) => updateSettings({ criticalRadiusKm: v })}
              />
              <NumberField
                label="Maximale Höhe (m)"
                value={settings.maxAltitudeM}
                min={50}
                max={5000}
                step={50}
                onChange={(v) => updateSettings({ maxAltitudeM: v })}
              />
            </div>
          </div>

          {/* Source status */}
          {sourceStatus && (
            <div className="card">
              <div className="font-semibold text-slate-700 mb-2 text-sm">Datenquellen</div>
              <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                {(Object.keys(SOURCE_LABELS) as DataSource[]).map((s) => (
                  <div key={s} className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${statusColor(sourceStatus[s])}`} />
                    <span>{SOURCE_LABELS[s]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Traffic log */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-slate-700 text-sm">
                Verkehrs-Log ({trafficLog.length})
              </div>
              {trafficLog.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    clearTrafficLog();
                    setTrafficLog([]);
                  }}
                  className="text-xs text-slate-500 hover:text-slate-700 underline"
                >
                  Löschen
                </button>
              )}
            </div>
            {trafficLog.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">
                Noch keine Annäherungen erfasst.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 max-h-72 overflow-auto text-sm">
                {trafficLog.slice(0, 50).map((e, i) => (
                  <li key={`${e.ts}-${e.icao24}-${i}`} className="py-2 flex items-start gap-3">
                    <span
                      className={`mt-0.5 size-2 rounded-full ${
                        e.level === "critical" ? "bg-red-500" : "bg-amber-500"
                      }`}
                    />
                    <div className="flex-1">
                      <div className="text-slate-900">
                        {e.callsign}{" "}
                        <span className="text-xs text-slate-500">
                          ({e.distanceKm < 1 ? `${Math.round(e.distanceKm * 1000)} m` : `${e.distanceKm.toFixed(1)} km`}, {e.direction}
                          {e.altitudeM != null ? `, ${Math.round(e.altitudeM)} m` : ""})
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {new Date(e.ts).toLocaleString("de-DE")}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-700">{label}</span>
      <input
        type="number"
        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
      />
    </label>
  );
}

function RadarSvg({
  size,
  visibleRadiusKm,
  warnRadiusKm,
  criticalRadiusKm,
  aircraft,
  alertIcaos,
  criticalIcaos,
}: {
  size: number;
  visibleRadiusKm: number;
  warnRadiusKm: number;
  criticalRadiusKm: number;
  aircraft: AircraftState[];
  alertIcaos: Set<string>;
  criticalIcaos: Set<string>;
}) {
  const c = size / 2;
  const radius = c - 8;
  const kmToPx = (km: number) => (km / visibleRadiusKm) * radius;
  const visible = aircraft.filter((a) => (a.distanceKm ?? 0) <= visibleRadiusKm);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Verkehrsradar">
      <circle cx={c} cy={c} r={radius} fill="#f1f5f9" stroke="#cbd5e1" />
      {/* warn ring */}
      <circle
        cx={c}
        cy={c}
        r={kmToPx(warnRadiusKm)}
        fill="none"
        stroke="#f59e0b"
        strokeDasharray="4 3"
      />
      {/* critical ring */}
      <circle
        cx={c}
        cy={c}
        r={kmToPx(criticalRadiusKm)}
        fill="none"
        stroke="#dc2626"
      />
      {/* cross-hair */}
      <line x1={c} y1={8} x2={c} y2={size - 8} stroke="#cbd5e1" />
      <line x1={8} y1={c} x2={size - 8} y2={c} stroke="#cbd5e1" />
      {/* compass labels */}
      <text x={c} y={14} textAnchor="middle" fontSize="10" fill="#64748b">N</text>
      <text x={size - 6} y={c + 3} textAnchor="end" fontSize="10" fill="#64748b">O</text>
      <text x={c} y={size - 4} textAnchor="middle" fontSize="10" fill="#64748b">S</text>
      <text x={6} y={c + 3} textAnchor="start" fontSize="10" fill="#64748b">W</text>
      {/* user position */}
      <circle cx={c} cy={c} r={4} fill="#0a4d8c" />
      {/* aircraft markers */}
      {visible.map((ac) => {
        const dist = ac.distanceKm ?? 0;
        const bearing = ac.bearingDeg ?? 0;
        const angleRad = ((bearing - 90) * Math.PI) / 180;
        const r = kmToPx(dist);
        const x = c + r * Math.cos(angleRad);
        const y = c + r * Math.sin(angleRad);
        const isCrit = criticalIcaos.has(ac.icao24);
        const isWarn = !isCrit && alertIcaos.has(ac.icao24);
        const fill = isCrit ? "#dc2626" : isWarn ? "#f59e0b" : "#0a4d8c";
        const heading = ac.trueTrack ?? 0;
        return (
          <g key={ac.icao24} transform={`translate(${x} ${y}) rotate(${heading})`}>
            <polygon points="0,-6 4,5 0,2 -4,5" fill={fill} stroke="white" strokeWidth="0.5" />
          </g>
        );
      })}
    </svg>
  );
}
