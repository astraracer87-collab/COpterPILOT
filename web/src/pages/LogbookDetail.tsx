import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { exportLogbookEntryPdf } from "../lib/pdfExport";
import TrackMap, { type TrackPoint } from "../components/TrackMap";

type WeatherSnapshot = {
  temperature: number;
  windSpeed: number;
  windGust?: number;
  rain: number;
  cloudCover: number;
  humidity: number;
  kpIndex?: number;
};

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
  weatherConditions?: WeatherSnapshot | null;
  gpsTrack?: TrackPoint[] | null;
  trafficLog?: TrafficLog | TrafficLogEntryWeb[] | null | unknown;
};

type TrafficLogEntryWeb = {
  ts: number;
  icao24: string;
  callsign: string;
  distanceKm: number;
  altitudeM: number | null;
  bearingDeg: number;
  direction: string;
  level: "warning" | "critical";
};

type Profile = { name: string; pilotId: string; operatorId: string; photoUrl?: string | null };

const ZONE_LABEL: Record<TrafficLogAircraft["zone"], string> = {
  inner: "Inner",
  outer: "Outer",
  approach: "Annäherung",
};
const ZONE_COLOR: Record<TrafficLogAircraft["zone"], string> = {
  inner: "text-red-700",
  outer: "text-amber-700",
  approach: "text-slate-700",
};

function fmtTs(ts: number) {
  return new Date(ts).toLocaleString("de-DE");
}

export default function LogbookDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: entries = [], isLoading } = useQuery<LogbookEntryFull[]>({ queryKey: ["/api/logbook"] });
  const { data: profile } = useQuery<Profile | null>({ queryKey: ["/api/profile"] });

  const entry = entries.find((e) => e.id === id);

  if (isLoading) return <div className="text-center text-slate-500 py-10">Lädt …</div>;
  if (!entry) return <div className="card text-center py-12 text-slate-500">Eintrag nicht gefunden.</div>;

  function handlePdf() {
    exportLogbookEntryPdf({
      ...entry!,
      pilotName: profile?.name || null,
      pilotId: profile?.pilotId || null,
      operatorId: profile?.operatorId || null,
      pilotPhotoUrl: profile?.photoUrl || null,
    });
  }

  const weather = entry.weatherConditions || null;
  const track: TrackPoint[] = Array.isArray(entry.gpsTrack) ? entry.gpsTrack : [];
  const trafficRaw: unknown = entry.trafficLog || null;
  const trafficEntries: TrafficLogEntryWeb[] | null =
    Array.isArray(trafficRaw) ? (trafficRaw as TrafficLogEntryWeb[]) : null;
  const trafficSession: TrafficLog | null =
    trafficRaw && !Array.isArray(trafficRaw) && typeof trafficRaw === "object" && "aircraft" in (trafficRaw as object)
      ? (trafficRaw as TrafficLog)
      : null;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/logbuch" className="text-sm text-brand-600 hover:underline">← Zurück zum Logbuch</Link>
        <div className="flex items-start justify-between mt-2 gap-3">
          <div>
            <p className="text-slate-500 text-sm">{entry.flightDate} · {entry.droneName}</p>
          </div>
          <button onClick={handlePdf} className="btn-primary" data-testid="button-export-pdf">PDF Export</button>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3 pb-2 border-b border-slate-100">Drohne</h2>
        <Row label="Name" value={entry.droneName} />
        <Row label="Klasse" value={entry.droneClass} />
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3 pb-2 border-b border-slate-100">Flug</h2>
        <Row label="Datum" value={entry.flightDate} />
        <Row label="Ort" value={entry.locationName || "—"} />
        {entry.latitude && entry.longitude ? (
          <Row label="Koordinaten" value={`${entry.latitude.toFixed(5)}, ${entry.longitude.toFixed(5)}`} />
        ) : null}
        <Row label="Land" value={entry.countryIso || "—"} />
        <Row label="Start" value={entry.takeoffTime ? new Date(entry.takeoffTime).toLocaleString("de-DE") : "—"} />
        <Row label="Landung" value={entry.landingTime ? new Date(entry.landingTime).toLocaleString("de-DE") : "—"} />
        <Row label="Dauer" value={entry.flightDurationMinutes ? `${entry.flightDurationMinutes} min` : "—"} />
        <Row label="Max. Höhe" value={entry.maxAltitude ? `${entry.maxAltitude} m AGL` : "—"} />
        <Row
          label="Vorfall"
          value={entry.incidentOccurred ? "Ja" : "Nein"}
          highlight={entry.incidentOccurred}
        />
      </div>

      <div className="card" data-testid="section-weather">
        <h2 className="font-semibold mb-3 pb-2 border-b border-slate-100">Wetter-Snapshot</h2>
        {weather ? (
          <>
            <Row label="Temperatur" value={`${weather.temperature.toFixed(1)} °C`} />
            <Row label="Wind" value={`${weather.windSpeed.toFixed(1)} m/s`} />
            <Row label="Böen" value={weather.windGust != null ? `${weather.windGust.toFixed(1)} m/s` : "—"} />
            <Row label="Niederschlag" value={`${weather.rain ?? 0} mm/h`} />
            <Row label="Bewölkung" value={`${weather.cloudCover ?? 0} %`} />
            <Row label="Luftfeuchte" value={`${weather.humidity ?? 0} %`} />
            {weather.kpIndex != null ? <Row label="Kp-Index" value={`${weather.kpIndex}`} /> : null}
          </>
        ) : (
          <p className="text-sm text-slate-500">Kein Wetter-Snapshot für diesen Flug gespeichert.</p>
        )}
      </div>

      <div className="card" data-testid="section-track">
        <h2 className="font-semibold mb-3 pb-2 border-b border-slate-100">GPS-Track</h2>
        {track.length >= 2 ? (
          <>
            <p className="text-xs text-slate-500 mb-2">{track.length} Punkte aufgezeichnet</p>
            <TrackMap key={`track-${entry.id}-${track.length}`} track={track} fallbackLat={entry.latitude} fallbackLon={entry.longitude} />
          </>
        ) : entry.latitude != null && entry.longitude != null ? (
          <>
            <p className="text-xs text-slate-500 mb-2">Kein detaillierter Track verfügbar — Startposition wird angezeigt.</p>
            <TrackMap key={`fallback-${entry.id}`} track={[]} fallbackLat={entry.latitude} fallbackLon={entry.longitude} />
          </>
        ) : (
          <p className="text-sm text-slate-500">Keine GPS-Daten für diesen Flug gespeichert.</p>
        )}
      </div>

      <div className="card" data-testid="section-traffic">
        <h2 className="font-semibold mb-3 pb-2 border-b border-slate-100">Verkehrslog (ADS-B / OGN)</h2>
        {trafficSession ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm mb-3">
              <Row label="Aufzeichnung ab" value={fmtTs(trafficSession.startTime)} />
              <Row label="Aufzeichnung bis" value={trafficSession.endTime ? fmtTs(trafficSession.endTime) : "—"} />
              <Row label="Inner Radius" value={`${Math.round(trafficSession.innerRadiusM)} m`} />
              <Row label="Outer Radius" value={`${Math.round(trafficSession.outerRadiusM)} m`} />
            </div>
            {trafficSession.aircraft.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-100">
                      <th className="py-1.5 pr-2">Callsign</th>
                      <th className="py-1.5 pr-2">ICAO</th>
                      <th className="py-1.5 pr-2">Zone</th>
                      <th className="py-1.5 pr-2">Min Distanz</th>
                      <th className="py-1.5 pr-2">Höhe (min/max)</th>
                      <th className="py-1.5 pr-2">Erstmals</th>
                      <th className="py-1.5">Zuletzt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trafficSession.aircraft.map((a) => (
                      <tr key={a.icao24} className="border-b border-slate-50" data-testid={`row-traffic-${a.icao24}`}>
                        <td className="py-1.5 pr-2 font-medium text-slate-900">{a.callsign || "—"}</td>
                        <td className="py-1.5 pr-2 font-mono text-slate-600">{a.icao24}</td>
                        <td className={`py-1.5 pr-2 font-semibold ${ZONE_COLOR[a.zone]}`}>{ZONE_LABEL[a.zone]}</td>
                        <td className="py-1.5 pr-2">{a.closestDistanceKm.toFixed(2)} km</td>
                        <td className="py-1.5 pr-2">{Math.round(a.minAltitudeM)} – {Math.round(a.maxAltitudeM)} m</td>
                        <td className="py-1.5 pr-2 text-slate-500">{fmtTs(a.firstSeen)}</td>
                        <td className="py-1.5 text-slate-500">{fmtTs(a.lastSeen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Keine Luftfahrzeuge während des Fluges erfasst.</p>
            )}
          </>
        ) : trafficEntries && trafficEntries.length > 0 ? (
          <>
            <p className="text-xs text-slate-500 mb-2">
              {trafficEntries.length} Annäherungen ·{" "}
              {trafficEntries.filter((e) => e.level === "critical").length} kritisch ·{" "}
              {trafficEntries.filter((e) => e.level === "warning").length} Warnung
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-100">
                    <th className="py-1.5 pr-2">Zeit</th>
                    <th className="py-1.5 pr-2">Callsign</th>
                    <th className="py-1.5 pr-2">ICAO</th>
                    <th className="py-1.5 pr-2">Stufe</th>
                    <th className="py-1.5 pr-2">Distanz</th>
                    <th className="py-1.5 pr-2">Höhe</th>
                    <th className="py-1.5">Richtung</th>
                  </tr>
                </thead>
                <tbody>
                  {[...trafficEntries].sort((a, b) => a.ts - b.ts).map((e, idx) => (
                    <tr key={`${e.icao24}-${e.ts}-${idx}`} className="border-b border-slate-50" data-testid={`row-traffic-${e.icao24}-${idx}`}>
                      <td className="py-1.5 pr-2 text-slate-500">{fmtTs(e.ts)}</td>
                      <td className="py-1.5 pr-2 font-medium text-slate-900">{e.callsign || "—"}</td>
                      <td className="py-1.5 pr-2 font-mono text-slate-600">{e.icao24}</td>
                      <td className={`py-1.5 pr-2 font-semibold ${e.level === "critical" ? "text-red-700" : "text-amber-700"}`}>
                        {e.level === "critical" ? "Kritisch" : "Warnung"}
                      </td>
                      <td className="py-1.5 pr-2">{e.distanceKm.toFixed(2)} km</td>
                      <td className="py-1.5 pr-2">{e.altitudeM != null ? Math.round(e.altitudeM) + " m" : "—"}</td>
                      <td className="py-1.5">{e.direction} ({Math.round(e.bearingDeg)}°)</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">Kein Verkehrslog für diesen Flug gespeichert.</p>
        )}
      </div>

      {entry.notes ? (
        <div className="card">
          <h2 className="font-semibold mb-3 pb-2 border-b border-slate-100">Notizen</h2>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{entry.notes}</p>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm py-1">
      <div className="text-slate-500">{label}</div>
      <div className={`col-span-2 ${highlight ? "text-red-700 font-semibold" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}
