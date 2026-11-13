import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronRight, MapPin, Plane } from "lucide-react";
import type { FlightSession, Drone } from "../lib/planning/types";

const PHASE_LABEL: Record<string, string> = {
  planning: "Planung",
  preflight: "Pre-Check",
  hover: "Flight-Check",
  postlanding: "Post-Check",
  debriefing: "Debriefing",
  completed: "Abgeschlossen",
};

export default function Briefings() {
  const { data: sessions = [], isLoading } = useQuery<FlightSession[]>({ queryKey: ["/api/sessions"] });
  const { data: drones = [] } = useQuery<Drone[]>({ queryKey: ["/api/drones"] });

  const droneMap = Object.fromEntries(drones.map((d) => [d.id, d.name]));

  const completed = sessions
    .filter((s) => s.currentPhase !== "planning")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="text-center text-[var(--color-app-text-secondary)] py-12">Lädt …</div>
      ) : completed.length === 0 ? (
        <div className="card text-center py-10">
          <div className="brand-tile mb-4" style={{ width: 64, height: 64, fontSize: 20, borderRadius: 18 }}>
            <Plane size={28} />
          </div>
          <p className="text-[15px] text-[var(--color-app-text-secondary)]">
            Noch keine Briefings vorhanden.
          </p>
          <Link to="/flugplanung" className="btn-primary inline-flex mt-4">
            Neue Planung starten
          </Link>
        </div>
      ) : (
        <ul className="ios-list" data-testid="list-briefings">
          {completed.map((s) => (
            <li key={s.id}>
              <Link
                to={`/briefings/${s.id}`}
                className="ios-row"
                data-testid={`row-briefing-${s.id}`}
              >
                <span className="ios-row-icon">
                  <MapPin size={18} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-semibold text-[var(--color-app-text)] truncate">
                    {s.locationName || `${s.latitude.toFixed(3)}, ${s.longitude.toFixed(3)}`}
                  </span>
                  <span className="block text-[12.5px] text-[var(--color-app-text-secondary)] mt-0.5 truncate">
                    {droneMap[s.droneId] || s.droneId} · {new Date(s.createdAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} · {PHASE_LABEL[s.currentPhase] || s.currentPhase}
                  </span>
                </span>
                <StatusBadge status={s.status} />
                <ChevronRight size={18} className="text-[var(--color-app-text-tertiary)] flex-shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "go" ? "pill-go" : status === "caution" ? "pill-caution" : status === "nogo" ? "pill-nogo" : "ios-pill bg-[var(--color-app-bg-tertiary)] text-[var(--color-app-text-secondary)]";
  return <span className={cls}>{status}</span>;
}
