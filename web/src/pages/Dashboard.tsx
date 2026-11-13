import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import LiveTrafficRadar from "../components/LiveTrafficRadar";
import {
  PHASE_LABELS,
  type FlightSession,
  type SessionPhase,
} from "../lib/flightTypes";
import { isResumableSession } from "../lib/flightPhases";

const LAST_LOC_KEY = "copterpilot.web.radar.lastLocation";

function loadSavedLocation(): { latitude: number; longitude: number; name?: string } | null {
  try {
    const raw = localStorage.getItem(LAST_LOC_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.latitude === "number" && typeof v?.longitude === "number") return v;
    return null;
  } catch {
    return null;
  }
}

type Drone = { id: string; name: string; classMark: string };
type LogbookEntry = {
  id: string;
  droneName: string;
  flightDate: string;
  locationName: string | null;
  flightDurationMinutes: number | null;
};

export default function Dashboard() {
  const { user } = useAuth();
  const { data: drones = [] } = useQuery<Drone[]>({ queryKey: ["/api/drones"] });
  const { data: logbook = [] } = useQuery<LogbookEntry[]>({ queryKey: ["/api/logbook"] });
  const { data: sessions = [] } = useQuery<FlightSession[]>({ queryKey: ["/api/sessions"] });
  const activeSessions = sessions
    .filter((s) => isResumableSession(s))
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  const [savedLoc, setSavedLoc] = useState(() => loadSavedLocation());

  useEffect(() => {
    const onStorage = () => setSavedLoc(loadSavedLocation());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const totalMinutes = logbook.reduce((sum, e) => sum + (e.flightDurationMinutes || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-slate-500">
          Hallo {user?.name || user?.email?.split("@")[0]} — willkommen zurück bei COpter Pilot
        </p>
      </div>

      {activeSessions.length > 0 && (
        <div className="card border-2 border-amber-300 bg-amber-50">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold text-amber-900">
                {activeSessions.length === 1
                  ? "Laufende Session – fortsetzen?"
                  : `${activeSessions.length} laufende Sessions`}
              </h2>
              <ul className="text-sm text-amber-800 mt-2 space-y-1">
                {activeSessions.slice(0, 3).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3">
                    <span className="truncate">
                      {s.locationName || `${s.latitude.toFixed(3)}, ${s.longitude.toFixed(3)}`}
                      {" · "}
                      <strong>{PHASE_LABELS[s.currentPhase as SessionPhase]}</strong>
                    </span>
                    <Link
                      to={`/flug/${s.id}`}
                      className="btn-primary text-xs"
                      data-testid={`button-resume-${s.id}`}
                    >
                      Fortsetzen
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Drohnen" value={drones.length} link="/drohnen" />
        <StatCard label="Flüge gesamt" value={logbook.length} link="/logbuch" />
        <StatCard
          label="Flugzeit gesamt"
          value={`${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`}
        />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Letzte Flüge</h2>
          <Link to="/logbuch" className="text-sm text-brand-500 hover:underline">
            Alle anzeigen
          </Link>
        </div>
        {logbook.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            Noch keine Flüge im Logbuch.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {logbook.slice(0, 5).map((e) => (
              <li key={e.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium text-slate-900">{e.droneName}</div>
                  <div className="text-slate-500 text-xs">
                    {e.locationName || "Unbekannter Ort"} · {e.flightDate}
                  </div>
                </div>
                <div className="text-slate-600">
                  {e.flightDurationMinutes ? `${e.flightDurationMinutes} min` : "–"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {savedLoc && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Live-Verkehr in der Nähe</h2>
            <Link to="/verkehrsradar" className="text-sm text-brand-500 hover:underline">
              Vollansicht
            </Link>
          </div>
          <LiveTrafficRadar
            latitude={savedLoc.latitude}
            longitude={savedLoc.longitude}
            locationName={savedLoc.name}
            fetchRadiusKm={25}
            compact
          />
        </div>
      )}

      {drones.length === 0 && (
        <div className="card border-2 border-dashed border-brand-200 bg-brand-50">
          <h3 className="font-semibold text-brand-900">Erste Drohne anlegen</h3>
          <p className="text-sm text-brand-700 mt-1 mb-4">
            Lege deine Drohne an, um mit der Flugplanung loszulegen.
          </p>
          <Link to="/drohnen" className="btn-primary inline-flex">
            Drohne anlegen
          </Link>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, link }: { label: string; value: number | string; link?: string }) {
  const inner = (
    <div className="card hover:shadow-md transition-shadow">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-3xl font-bold text-brand-500 mt-1">{value}</div>
    </div>
  );
  return link ? <Link to={link}>{inner}</Link> : inner;
}
