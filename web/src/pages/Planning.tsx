import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiJson } from "../lib/queryClient";
import type { FlightSession, Drone } from "../lib/planning/types";
import { STATUS_COLORS, STATUS_LABELS } from "../lib/planning/assessment";

export default function Planning() {
  const qc = useQueryClient();
  const { data: sessions = [], isLoading } = useQuery<FlightSession[]>({
    queryKey: ["/api/sessions"],
  });
  const { data: drones = [] } = useQuery<Drone[]>({ queryKey: ["/api/drones"] });

  const draftSessions = sessions.filter((s) => s.currentPhase === "planning");

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiJson("DELETE", `/api/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/sessions"] }),
  });

  const droneName = (id: string) => drones.find((d) => d.id === id)?.name || "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {drones.length === 0 ? (
          <Link to="/drohnen" className="btn-secondary">
            Erst Drohne anlegen
          </Link>
        ) : (
          <Link to="/flugplanung/neu" className="btn-primary">
            + Neue Flugplanung
          </Link>
        )}
      </div>

      {drones.length === 0 && (
        <div className="card border-2 border-dashed border-brand-200 bg-brand-50">
          <p className="text-sm text-brand-800">
            Bevor du planen kannst, lege bitte mindestens eine Drohne an.
          </p>
        </div>
      )}

      <section>
        <h2 className="font-semibold text-slate-900 mb-3">Offene Planungen</h2>
        {isLoading ? (
          <div className="text-center text-slate-500 py-10">Lädt …</div>
        ) : draftSessions.length === 0 ? (
          <div className="card text-center py-8 text-sm text-slate-500">
            Aktuell keine offenen Planungen.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {draftSessions.map((s) => (
              <div key={s.id} className="card flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">
                      {droneName(s.droneId)}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {s.locationName || "Ohne Ortsname"} · {s.countryIso || "—"}
                    </div>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-1 rounded-md text-white font-semibold ${
                      STATUS_COLORS[s.status as "go" | "caution" | "nogo"] ||
                      "bg-slate-400"
                    }`}
                  >
                    {STATUS_LABELS[s.status as "go" | "caution" | "nogo"] || "ENTWURF"}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  Zuletzt: {new Date(s.updatedAt).toLocaleString("de-DE")}
                </div>
                <div className="flex gap-2 mt-1">
                  <Link
                    to={`/flugplanung/${s.id}`}
                    className="btn-primary text-xs px-3 py-1.5 flex-1 text-center"
                  >
                    Fortsetzen
                  </Link>
                  <button
                    className="btn-danger text-xs px-3 py-1.5"
                    onClick={() => {
                      if (confirm("Diese Planung wirklich löschen?")) {
                        deleteMutation.mutate(s.id);
                      }
                    }}
                  >
                    Löschen
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-3">Letzte abgeschlossene Sessions</h2>
        {sessions.filter((s) => s.currentPhase !== "planning").slice(0, 5).length === 0 ? (
          <div className="card text-center py-6 text-sm text-slate-500">
            Noch keine abgeschlossenen Sessions.
          </div>
        ) : (
          <div className="card divide-y divide-slate-100 p-0">
            {sessions
              .filter((s) => s.currentPhase !== "planning")
              .slice(0, 5)
              .map((s) => (
                <div
                  key={s.id}
                  className="px-4 py-3 flex items-center justify-between text-sm"
                >
                  <div>
                    <div className="font-medium text-slate-900">
                      {droneName(s.droneId)}
                    </div>
                    <div className="text-xs text-slate-500">
                      {s.locationName || "—"} · {s.currentPhase}
                    </div>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-1 rounded-md text-white font-semibold ${
                      STATUS_COLORS[s.status as "go" | "caution" | "nogo"] ||
                      "bg-slate-400"
                    }`}
                  >
                    {STATUS_LABELS[s.status as "go" | "caution" | "nogo"] || s.status}
                  </span>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
