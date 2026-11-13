import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { apiJson } from "../lib/queryClient";
import {
  ACTIVE_PHASES,
  PHASE_LABELS,
  type DroneSummary,
  type FlightSession,
  type SessionPhase,
} from "../lib/flightTypes";

export default function Flights() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: sessions = [], isLoading } = useQuery<FlightSession[]>({
    queryKey: ["/api/sessions"],
  });
  const { data: drones = [] } = useQuery<DroneSummary[]>({ queryKey: ["/api/drones"] });

  const [showQuickStart, setShowQuickStart] = useState(false);
  const [qsDroneId, setQsDroneId] = useState("");
  const [qsLocationName, setQsLocationName] = useState("");
  const [qsLat, setQsLat] = useState("");
  const [qsLon, setQsLon] = useState("");
  const [qsError, setQsError] = useState<string | null>(null);

  const active = useMemo(
    () =>
      sessions
        .filter((s) => ACTIVE_PHASES.includes(s.currentPhase as SessionPhase))
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [sessions]
  );
  const planning = useMemo(
    () =>
      sessions
        .filter((s) => s.currentPhase === "planning")
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [sessions]
  );
  const completed = useMemo(
    () =>
      sessions
        .filter((s) => s.currentPhase === "completed")
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
        .slice(0, 10),
    [sessions]
  );

  const startMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      return apiJson<FlightSession>("PUT", `/api/sessions/${sessionId}`, {
        currentPhase: "preflight",
      });
    },
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      navigate(`/flug/${s.id}`);
    },
  });

  const quickStartMutation = useMutation({
    mutationFn: async () => {
      const lat = parseFloat(qsLat);
      const lon = parseFloat(qsLon);
      if (!qsDroneId) throw new Error("Bitte eine Drohne wählen");
      if (isNaN(lat) || isNaN(lon)) throw new Error("Bitte gültige Koordinaten eingeben");
      const now = new Date();
      return apiJson<FlightSession>("POST", "/api/sessions", {
        droneId: qsDroneId,
        currentPhase: "preflight",
        latitude: lat,
        longitude: lon,
        locationName: qsLocationName || null,
        hasRestrictions: false,
        status: "go",
        planning: {
          plannedDate: now.toISOString().slice(0, 10),
          plannedTime: now.toTimeString().slice(0, 5),
          checklistCompleted: [],
        },
      });
    },
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      setShowQuickStart(false);
      setQsError(null);
      navigate(`/flug/${s.id}`);
    },
    onError: (err: Error) => setQsError(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <button
          className="btn-primary"
          onClick={() => setShowQuickStart((v) => !v)}
          data-testid="button-quickstart-toggle"
        >
          {showQuickStart ? "Schnellstart schließen" : "Schnellstart"}
        </button>
      </div>

      {showQuickStart && (
        <form
          className="card space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            quickStartMutation.mutate();
          }}
        >
          <div className="font-semibold">Schnellstart-Flug</div>
          <p className="text-xs text-slate-500">
            Erstellt eine Session direkt im Pre-Flight, ohne den Planungs-Assistenten zu durchlaufen.
          </p>
          {drones.length === 0 ? (
            <div className="text-sm text-slate-600">
              Lege zuerst eine{" "}
              <Link to="/drohnen" className="text-brand-500 underline">
                Drohne
              </Link>{" "}
              an.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Drohne</label>
                  <select
                    className="input"
                    value={qsDroneId}
                    onChange={(e) => setQsDroneId(e.target.value)}
                    data-testid="select-quickstart-drone"
                  >
                    <option value="">— wählen —</option>
                    {drones.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.classMark})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Ort (optional)</label>
                  <input
                    className="input"
                    value={qsLocationName}
                    onChange={(e) => setQsLocationName(e.target.value)}
                    placeholder="z.B. Modellflugplatz Nord"
                    data-testid="input-quickstart-location"
                  />
                </div>
                <div>
                  <label className="label">Breitengrad</label>
                  <input
                    className="input"
                    value={qsLat}
                    onChange={(e) => setQsLat(e.target.value)}
                    placeholder="50.5"
                    data-testid="input-quickstart-lat"
                  />
                </div>
                <div>
                  <label className="label">Längengrad</label>
                  <input
                    className="input"
                    value={qsLon}
                    onChange={(e) => setQsLon(e.target.value)}
                    placeholder="9.0"
                    data-testid="input-quickstart-lon"
                  />
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => {
                  if (!navigator.geolocation) return;
                  navigator.geolocation.getCurrentPosition(
                    (p) => {
                      setQsLat(p.coords.latitude.toFixed(6));
                      setQsLon(p.coords.longitude.toFixed(6));
                    },
                    () => {},
                    { enableHighAccuracy: true, timeout: 8000 }
                  );
                }}
              >
                Mein Standort übernehmen
              </button>
              {qsError && <div className="text-sm text-red-700">{qsError}</div>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={quickStartMutation.isPending}
                  data-testid="button-quickstart-submit"
                >
                  {quickStartMutation.isPending ? "Starte …" : "Pre-Flight starten"}
                </button>
              </div>
            </>
          )}
        </form>
      )}

      {isLoading ? (
        <div className="card text-center text-slate-500 py-10">Lädt …</div>
      ) : (
        <>
          <Section
            title="Laufende Sessions"
            empty="Keine laufenden Sessions."
            sessions={active}
            drones={drones}
            actionLabel="Fortsetzen"
            onAction={(s) => navigate(`/flug/${s.id}`)}
          />
          <Section
            title="Geplante Flüge"
            empty="Keine geplanten Flüge — starte einen Schnellstart oder plane einen Flug."
            sessions={planning}
            drones={drones}
            actionLabel="Ausführung starten"
            actionDisabled={startMutation.isPending}
            onAction={(s) => startMutation.mutate(s.id)}
          />
          {completed.length > 0 && (
            <Section
              title="Zuletzt abgeschlossen"
              empty=""
              sessions={completed}
              drones={drones}
              actionLabel="Im Logbuch"
              onAction={() => navigate("/logbuch")}
            />
          )}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  empty,
  sessions,
  drones,
  actionLabel,
  actionDisabled,
  onAction,
}: {
  title: string;
  empty: string;
  sessions: FlightSession[];
  drones: DroneSummary[];
  actionLabel: string;
  actionDisabled?: boolean;
  onAction: (s: FlightSession) => void;
}) {
  const droneById = useMemo(() => {
    const m = new Map<string, DroneSummary>();
    for (const d of drones) m.set(d.id, d);
    return m;
  }, [drones]);
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">{title}</h2>
      {sessions.length === 0 ? (
        empty ? <div className="card text-sm text-slate-500">{empty}</div> : null
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => {
            const drone = droneById.get(s.droneId);
            return (
              <li
                key={s.id}
                className="card flex items-center justify-between gap-3 flex-wrap"
                data-testid={`session-${s.id}`}
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">
                    {drone?.name || "Drohne unbekannt"}
                    <span className="ml-2 text-xs text-slate-500">{drone?.classMark || ""}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {s.locationName || `${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)}`}
                    {" · "}
                    Phase: <span className="font-semibold">{PHASE_LABELS[s.currentPhase as SessionPhase] || s.currentPhase}</span>
                    {" · "}
                    {new Date(s.updatedAt).toLocaleString("de-DE")}
                  </div>
                </div>
                <button
                  className="btn-primary text-xs"
                  disabled={actionDisabled}
                  onClick={() => onAction(s)}
                  data-testid={`button-session-action-${s.id}`}
                >
                  {actionLabel}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
