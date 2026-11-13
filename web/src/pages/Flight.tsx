import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import LiveTrafficRadar from "../components/LiveTrafficRadar";
import { apiJson } from "../lib/queryClient";
import {
  PHASE_LABELS,
  type DroneSummary,
  type FlightSession,
  type HoverCheckData,
  type PostLandingData,
  type PreflightData,
  type SessionPhase,
  type WeatherSnapshot,
} from "../lib/flightTypes";
import {
  HOVER_CHECK_ITEMS,
  POSTLANDING_CHECK_ITEMS,
  PREFLIGHT_CHECKLIST,
  type CheckItem,
} from "../lib/checklists";
import {
  EXECUTION_PHASE_ORDER,
  completeFlightSession,
  computeFlightDurationMinutes,
} from "../lib/flightPhases";
import {
  classifyValue,
  estimateCloudCeiling,
  fetchBrightSky,
  type AssessmentLevel,
} from "../lib/external";

const PHASE_ORDER = EXECUTION_PHASE_ORDER;

const COLORS: Record<AssessmentLevel, string> = {
  go: "bg-emerald-100 text-emerald-800",
  caution: "bg-amber-100 text-amber-800",
  nogo: "bg-red-100 text-red-800",
};

export default function Flight() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const sessionQuery = useQuery<FlightSession>({
    queryKey: [`/api/sessions/${id}`],
    enabled: !!id,
  });
  const session = sessionQuery.data;

  const { data: drones = [] } = useQuery<DroneSummary[]>({ queryKey: ["/api/drones"] });
  const drone = drones.find((d) => d.id === session?.droneId);

  const updateMutation = useMutation({
    mutationFn: async (patch: Partial<FlightSession>) =>
      apiJson<FlightSession>("PUT", `/api/sessions/${id}`, patch),
    onSuccess: (s) => {
      queryClient.setQueryData([`/api/sessions/${id}`], s);
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (input: { session: FlightSession; debriefing: NonNullable<FlightSession["debriefing"]> }) => {
      const { session: s, debriefing } = input;
      const drn = drones.find((d) => d.id === s.droneId);
      if (!drn) throw new Error("Drohne nicht gefunden");
      await completeFlightSession(s, drn, debriefing, apiJson);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/logbook"] });
      navigate("/logbuch");
    },
  });

  if (sessionQuery.isLoading) {
    return <div className="text-center text-slate-500 py-10">Lädt Session …</div>;
  }
  if (sessionQuery.isError || !session) {
    return (
      <div className="card text-center space-y-3">
        <div className="text-slate-700">Session nicht gefunden.</div>
        <button className="btn-primary" onClick={() => navigate("/fluege")}>
          Zurück zur Übersicht
        </button>
      </div>
    );
  }

  const phase = session.currentPhase as SessionPhase;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-base font-semibold text-slate-700">
            {drone?.name || "Drohne"}{" "}
            {drone?.classMark && (
              <span className="text-sm font-medium text-slate-500">({drone.classMark})</span>
            )}
          </p>
          <p className="text-slate-500 text-sm mt-1">
            {session.locationName ||
              `${session.latitude.toFixed(5)}, ${session.longitude.toFixed(5)}`}
          </p>
        </div>
        <button className="btn-secondary text-xs" onClick={() => navigate("/fluege")}>
          Pause / Zurück
        </button>
      </div>

      <PhaseStepper current={phase} />

      {phase === "preflight" && (
        <PreFlightPhase
          session={session}
          drone={drone}
          onContinue={(data) =>
            updateMutation.mutate({
              currentPhase: "hover",
              preflight: data,
              hoverCheck: {
                ...session.hoverCheck,
                takeoffTime: session.hoverCheck?.takeoffTime || new Date().toISOString(),
              },
            })
          }
          saving={updateMutation.isPending}
        />
      )}
      {phase === "hover" && (
        <HoverPhase
          session={session}
          onContinue={(data, skipped, reason) =>
            updateMutation.mutate({
              currentPhase: "monitoring",
              hoverCheck: {
                ...session.hoverCheck,
                ...data,
                skippedFlightCheck: skipped,
                skipReason: reason,
              },
            })
          }
          saving={updateMutation.isPending}
        />
      )}
      {phase === "monitoring" && (
        <MonitoringPhase
          session={session}
          onLand={() =>
            updateMutation.mutate({
              currentPhase: "postlanding",
              hoverCheck: {
                ...session.hoverCheck,
                landingTime: new Date().toISOString(),
              },
            })
          }
          saving={updateMutation.isPending}
        />
      )}
      {phase === "postlanding" && (
        <PostLandingPhase
          session={session}
          onContinue={(data) =>
            updateMutation.mutate({
              currentPhase: "debriefing",
              postLanding: data,
            })
          }
          saving={updateMutation.isPending}
        />
      )}
      {phase === "debriefing" && (
        <DebriefingPhase
          session={session}
          onComplete={(debriefing) => completeMutation.mutate({ session, debriefing })}
          saving={completeMutation.isPending}
          error={(completeMutation.error as Error | null)?.message || null}
        />
      )}
      {phase === "completed" && (
        <div className="card text-center space-y-3">
          <div className="text-emerald-700 font-semibold">Flug abgeschlossen.</div>
          <p className="text-sm text-slate-600">
            Der Logbucheintrag wurde erstellt.
          </p>
          <button className="btn-primary" onClick={() => navigate("/logbuch")}>
            Zum Logbuch
          </button>
        </div>
      )}
      {phase === "planning" && (
        <div className="card space-y-3">
          <div className="text-sm text-slate-700">
            Diese Session ist noch in der Planungsphase.
          </div>
          <button
            className="btn-primary"
            onClick={() => updateMutation.mutate({ currentPhase: "preflight" })}
            disabled={updateMutation.isPending}
          >
            Pre-Flight starten
          </button>
        </div>
      )}
    </div>
  );
}

function PhaseStepper({ current }: { current: SessionPhase }) {
  const idx = PHASE_ORDER.indexOf(current);
  return (
    <ol className="card flex flex-wrap gap-2 text-xs">
      {PHASE_ORDER.map((p, i) => {
        const state = i < idx ? "done" : i === idx ? "active" : "pending";
        return (
          <li
            key={p}
            className={`px-3 py-1.5 rounded-md font-semibold ${
              state === "done"
                ? "bg-emerald-100 text-emerald-700"
                : state === "active"
                ? "bg-brand-500 text-white"
                : "bg-slate-100 text-slate-500"
            }`}
            data-testid={`phase-step-${p}`}
          >
            {i + 1}. {PHASE_LABELS[p]}
          </li>
        );
      })}
    </ol>
  );
}

/* ============================ PRE-FLIGHT ============================ */

function PreFlightPhase({
  session,
  drone,
  onContinue,
  saving,
}: {
  session: FlightSession;
  drone?: DroneSummary;
  onContinue: (data: PreflightData) => void;
  saving: boolean;
}) {
  const initialChecked = new Set(session.preflight?.checklistCompleted || []);
  const [checked, setChecked] = useState<Set<string>>(initialChecked);
  const [notes, setNotes] = useState(session.preflight?.equipmentNotes || "");

  const allItems = useMemo(() => PREFLIGHT_CHECKLIST.flatMap((s) => s.items), []);
  const requiredItems = allItems.filter((i) => i.required);
  const allRequired = requiredItems.every((i) => checked.has(i.id));

  const limits = drone?.limits;
  const weatherQuery = useQuery({
    queryKey: ["brightsky", session.latitude, session.longitude],
    queryFn: () => fetchBrightSky(session.latitude, session.longitude),
    staleTime: 5 * 60_000,
  });

  const current = useMemo(() => {
    const w = weatherQuery.data?.weather || [];
    const now = Date.now();
    return (
      w.find((h) => {
        const t = Date.parse(h.timestamp);
        return !isNaN(t) && t <= now && t > now - 3600_000;
      }) || w[0]
    );
  }, [weatherQuery.data]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleContinue() {
    if (!allRequired) return;
    let actualWeather: WeatherSnapshot | undefined;
    if (current) {
      actualWeather = {
        temperature: current.temperature ?? 0,
        windSpeed: current.wind_speed ?? 0,
        windGust: current.wind_gust_speed ?? undefined,
        rain: current.precipitation ?? 0,
        cloudCover: current.cloud_cover ?? 0,
        humidity: 0,
      };
    }
    onContinue({
      actualWeather,
      checklistCompleted: Array.from(checked),
      checklistPresented: allItems.map((i) => i.id),
      equipmentNotes: notes || undefined,
      completedAt: new Date().toISOString(),
    });
  }

  const forecast = session.planning?.forecastWeather;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="font-semibold mb-3">Wetter-Vergleich</div>
        {weatherQuery.isLoading && <div className="text-sm text-slate-500">Lade aktuelles Wetter …</div>}
        {weatherQuery.isError && (
          <div className="text-sm text-red-700">Wetterdaten konnten nicht geladen werden.</div>
        )}
        {current && (
          <div className="overflow-x-auto">
            <table className="text-sm w-full min-w-[480px]">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="text-left py-1.5 pr-2">Wert</th>
                  <th className="text-right px-2">Vorhersage</th>
                  <th className="text-right px-2">Aktuell (DWD)</th>
                  <th className="text-right pl-2">Bewertung</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <ComparisonRow
                  label="Wind"
                  unit="m/s"
                  forecast={forecast?.windSpeed}
                  actual={current.wind_speed}
                  level={limits ? classifyValue(current.wind_speed ?? undefined, limits.maxWind, "max") : "caution"}
                />
                <ComparisonRow
                  label="Böen"
                  unit="m/s"
                  forecast={forecast?.windGust}
                  actual={current.wind_gust_speed}
                  level={limits ? classifyValue(current.wind_gust_speed ?? undefined, limits.maxGusts, "max") : "caution"}
                />
                <ComparisonRow
                  label="Regen"
                  unit="mm/h"
                  forecast={forecast?.rain}
                  actual={current.precipitation}
                  level={limits ? classifyValue(current.precipitation ?? undefined, limits.maxRain, "max") : "caution"}
                />
                <ComparisonRow
                  label="Temperatur"
                  unit="°C"
                  forecast={forecast?.temperature}
                  actual={current.temperature}
                  level={limits ? classifyValue(current.temperature ?? undefined, limits.minTemp, "min") : "caution"}
                />
                <ComparisonRow
                  label="Sicht"
                  unit="km"
                  forecast={undefined}
                  actual={current.visibility != null ? current.visibility / 1000 : null}
                  level={limits ? classifyValue(current.visibility ?? undefined, limits.minVisibility, "min") : "caution"}
                />
                {(() => {
                  const ceil = estimateCloudCeiling(current.temperature, current.dew_point);
                  return (
                    <ComparisonRow
                      label="Wolkenbasis"
                      unit="m"
                      forecast={undefined}
                      actual={ceil}
                      level={limits ? classifyValue(ceil ?? undefined, limits.minCloudCeiling, "min") : "caution"}
                    />
                  );
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ChecklistSections
        sections={PREFLIGHT_CHECKLIST}
        checked={checked}
        onToggle={toggle}
      />

      <div className="card">
        <label className="label">Notizen (optional)</label>
        <textarea
          className="input min-h-[80px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Besonderheiten, abweichende Ausrüstung …"
          data-testid="textarea-preflight-notes"
        />
      </div>

      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div className="text-xs text-slate-500">
          Pflichtpunkte: {requiredItems.filter((i) => checked.has(i.id)).length} / {requiredItems.length}
        </div>
        <button
          className="btn-primary"
          disabled={!allRequired || saving}
          onClick={handleContinue}
          data-testid="button-preflight-continue"
        >
          {saving ? "Speichere …" : "Weiter zum Hover-Check (Start)"}
        </button>
      </div>
    </div>
  );
}

function ComparisonRow({
  label,
  unit,
  forecast,
  actual,
  level,
}: {
  label: string;
  unit: string;
  forecast: number | null | undefined;
  actual: number | null | undefined;
  level: AssessmentLevel;
}) {
  const fmt = (v: number | null | undefined) =>
    v == null ? "—" : `${v.toFixed(unit === "m" ? 0 : 1)} ${unit}`;
  return (
    <tr>
      <td className="py-1.5 pr-2 font-medium">{label}</td>
      <td className="text-right px-2 text-slate-600">{fmt(forecast)}</td>
      <td className="text-right px-2 font-semibold">{fmt(actual)}</td>
      <td className="text-right pl-2">
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${COLORS[level]}`}>
          {level === "go" ? "GO" : level === "caution" ? "ACHTUNG" : "NO-GO"}
        </span>
      </td>
    </tr>
  );
}

function ChecklistSections({
  sections,
  checked,
  onToggle,
}: {
  sections: { title: string; items: CheckItem[] }[];
  checked: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <div key={section.title} className="card">
          <div className="font-semibold mb-3">{section.title}</div>
          <ul className="space-y-2">
            {section.items.map((item) => (
              <ChecklistItem
                key={item.id}
                item={item}
                checked={checked.has(item.id)}
                onToggle={() => onToggle(item.id)}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ChecklistItem({
  item,
  checked,
  onToggle,
}: {
  item: CheckItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1 size-4"
        data-testid={`checkbox-${item.id}`}
      />
      <button
        type="button"
        onClick={onToggle}
        className="text-left flex-1"
      >
        <div className="text-sm font-medium text-slate-900">
          {item.label}
          {item.required && (
            <span className="ml-2 text-[10px] uppercase font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
              Pflicht
            </span>
          )}
        </div>
        {item.tip && <div className="text-xs text-slate-500 mt-0.5">{item.tip}</div>}
      </button>
    </li>
  );
}

/* ============================ HOVER ============================ */

function HoverPhase({
  session,
  onContinue,
  saving,
}: {
  session: FlightSession;
  onContinue: (data: HoverCheckData, skipped: boolean, reason?: string) => void;
  saving: boolean;
}) {
  const [checked, setChecked] = useState<Set<string>>(
    new Set(session.hoverCheck?.checklistCompleted || [])
  );
  const [showSkip, setShowSkip] = useState(false);
  const [skipReason, setSkipReason] = useState(session.hoverCheck?.skipReason || "");

  const requiredItems = HOVER_CHECK_ITEMS.filter((i) => i.required);
  const allRequired = requiredItems.every((i) => checked.has(i.id));

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="card bg-brand-50 border-brand-200">
        <div className="font-semibold text-brand-900">Drohne auf 2-3 m schweben lassen</div>
        <p className="text-sm text-brand-700 mt-1">
          Start-Zeitpunkt: {session.hoverCheck?.takeoffTime
            ? new Date(session.hoverCheck.takeoffTime).toLocaleTimeString("de-DE")
            : "—"}
        </p>
      </div>

      <ChecklistSections
        sections={[{ title: "Hover-Check (5 m)", items: HOVER_CHECK_ITEMS }]}
        checked={checked}
        onToggle={toggle}
      />

      {showSkip && (
        <div className="card border-amber-200 bg-amber-50 space-y-2">
          <label className="label text-amber-900">Begründung für das Überspringen</label>
          <textarea
            className="input min-h-[70px]"
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            placeholder="z.B. Indoor-Flug, Tethered, Sondergenehmigung …"
            data-testid="textarea-skip-reason"
          />
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" onClick={() => setShowSkip(false)}>
              Abbrechen
            </button>
            <button
              className="btn-primary text-xs"
              disabled={!skipReason.trim() || saving}
              onClick={() =>
                onContinue(
                  {
                    checklistCompleted: Array.from(checked),
                    hoverStable: false,
                  },
                  true,
                  skipReason.trim()
                )
              }
              data-testid="button-skip-hover-confirm"
            >
              Hover-Check überspringen
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center gap-3 flex-wrap">
        <button
          className="text-xs text-amber-700 underline"
          onClick={() => setShowSkip((v) => !v)}
          data-testid="button-skip-hover"
        >
          Hover-Check überspringen
        </button>
        <button
          className="btn-primary"
          disabled={!allRequired || saving}
          onClick={() =>
            onContinue(
              {
                checklistCompleted: Array.from(checked),
                hoverStable: true,
                controlsOk: true,
                signalOk: true,
              },
              false
            )
          }
          data-testid="button-hover-continue"
        >
          {saving ? "Speichere …" : "Hover ok – weiter zum Flug"}
        </button>
      </div>
    </div>
  );
}

/* ============================ MONITORING ============================ */

function MonitoringPhase({
  session,
  onLand,
  saving,
}: {
  session: FlightSession;
  onLand: () => void;
  saving: boolean;
}) {
  const weatherQuery = useQuery({
    queryKey: ["brightsky", session.latitude, session.longitude],
    queryFn: () => fetchBrightSky(session.latitude, session.longitude),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  const w = weatherQuery.data?.weather?.[0];

  const takeoff = session.hoverCheck?.takeoffTime
    ? new Date(session.hoverCheck.takeoffTime)
    : null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsedMin = takeoff ? Math.floor((now - takeoff.getTime()) / 60000) : 0;
  const elapsedSec = takeoff ? Math.floor(((now - takeoff.getTime()) / 1000) % 60) : 0;

  return (
    <div className="space-y-4">
      <div className="card grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <div className="text-xs uppercase text-slate-500 font-semibold">Flugzeit</div>
          <div className="text-3xl font-bold text-brand-500" data-testid="text-elapsed">
            {String(elapsedMin).padStart(2, "0")}:{String(elapsedSec).padStart(2, "0")}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Start: {takeoff ? takeoff.toLocaleTimeString("de-DE") : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-slate-500 font-semibold">Wind aktuell</div>
          <div className="text-2xl font-bold">
            {w?.wind_speed != null ? `${w.wind_speed.toFixed(1)} m/s` : "—"}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Böen: {w?.wind_gust_speed != null ? `${w.wind_gust_speed.toFixed(1)} m/s` : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-slate-500 font-semibold">Niederschlag</div>
          <div className="text-2xl font-bold">
            {w?.precipitation != null ? `${w.precipitation.toFixed(1)} mm/h` : "—"}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Sicht: {w?.visibility != null ? `${(w.visibility / 1000).toFixed(1)} km` : "—"}
          </div>
        </div>
      </div>

      <div data-testid="monitoring-map">
        <LiveTrafficRadar
          latitude={session.latitude}
          longitude={session.longitude}
          locationName={session.locationName ?? undefined}
          fetchRadiusKm={25}
          compact
        />
      </div>

      <div className="flex justify-end">
        <button
          className="btn-danger"
          onClick={onLand}
          disabled={saving}
          data-testid="button-landed"
        >
          {saving ? "Speichere …" : "Gelandet"}
        </button>
      </div>
    </div>
  );
}

/* ============================ POST-LANDING ============================ */

function PostLandingPhase({
  session,
  onContinue,
  saving,
}: {
  session: FlightSession;
  onContinue: (data: PostLandingData) => void;
  saving: boolean;
}) {
  const [checked, setChecked] = useState<Set<string>>(
    new Set(session.postLanding?.checklistCompleted || [])
  );
  const [uasOff, setUasOff] = useState(session.postLanding?.uasPoweredOff ?? false);
  const [ctlOff, setCtlOff] = useState(session.postLanding?.controllerPoweredOff ?? false);
  const [damageOk, setDamageOk] = useState(session.postLanding?.damageChecked ?? false);

  const required = POSTLANDING_CHECK_ITEMS.filter((i) => i.required);
  const allRequired = required.every((i) => checked.has(i.id)) && uasOff && ctlOff && damageOk;

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="font-semibold mb-1">Lande-Zeitpunkt</div>
        <div className="text-sm text-slate-700">
          {session.hoverCheck?.landingTime
            ? new Date(session.hoverCheck.landingTime).toLocaleString("de-DE")
            : "—"}
        </div>
      </div>

      <ChecklistSections
        sections={[{ title: "Nach der Landung", items: POSTLANDING_CHECK_ITEMS }]}
        checked={checked}
        onToggle={toggle}
      />

      <div className="card space-y-3">
        <div className="font-semibold">Bestätigungen</div>
        <BoolRow
          id="uas-off"
          label="Drohne ausgeschaltet"
          checked={uasOff}
          onChange={setUasOff}
        />
        <BoolRow
          id="ctl-off"
          label="Fernsteuerung ausgeschaltet"
          checked={ctlOff}
          onChange={setCtlOff}
        />
        <BoolRow
          id="damage-ok"
          label="Sichtprüfung auf Schäden durchgeführt"
          checked={damageOk}
          onChange={setDamageOk}
        />
      </div>

      <div className="flex justify-end">
        <button
          className="btn-primary"
          disabled={!allRequired || saving}
          onClick={() =>
            onContinue({
              checklistCompleted: Array.from(checked),
              uasPoweredOff: uasOff,
              controllerPoweredOff: ctlOff,
              damageChecked: damageOk,
            })
          }
          data-testid="button-postlanding-continue"
        >
          {saving ? "Speichere …" : "Weiter zum Debriefing"}
        </button>
      </div>
    </div>
  );
}

function BoolRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4"
        data-testid={`checkbox-${id}`}
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

/* ============================ DEBRIEFING ============================ */

function DebriefingPhase({
  session,
  onComplete,
  saving,
  error,
}: {
  session: FlightSession;
  onComplete: (data: NonNullable<FlightSession["debriefing"]>) => void;
  saving: boolean;
  error: string | null;
}) {
  const [incidentOccurred, setIncidentOccurred] = useState(
    session.debriefing?.incidentOccurred ?? false
  );
  const [incidentDescription, setIncidentDescription] = useState(
    session.debriefing?.incidentDescription || ""
  );
  const [maintenanceRequired, setMaintenanceRequired] = useState(
    session.debriefing?.maintenanceRequired ?? false
  );
  const [maintenanceNotes, setMaintenanceNotes] = useState(
    session.debriefing?.maintenanceNotes || ""
  );
  const [generalNotes, setGeneralNotes] = useState(session.debriefing?.generalNotes || "");
  const [batteryEnd, setBatteryEnd] = useState(
    session.debriefing?.batteryUsedPercent != null
      ? String(session.debriefing.batteryUsedPercent)
      : ""
  );

  const takeoff = session.hoverCheck?.takeoffTime ? new Date(session.hoverCheck.takeoffTime) : null;
  const landing = session.hoverCheck?.landingTime ? new Date(session.hoverCheck.landingTime) : null;
  const durationMin = computeFlightDurationMinutes(
    session.hoverCheck?.takeoffTime,
    session.hoverCheck?.landingTime,
  );

  const incidentInvalid = incidentOccurred && !incidentDescription.trim();
  const maintenanceInvalid = maintenanceRequired && !maintenanceNotes.trim();
  const blocked = incidentInvalid || maintenanceInvalid;

  function handleComplete() {
    if (blocked) return;
    onComplete({
      flightDurationMinutes: durationMin,
      takeoffTime: session.hoverCheck?.takeoffTime,
      landingTime: session.hoverCheck?.landingTime,
      incidentOccurred,
      incidentDescription: incidentOccurred ? incidentDescription.trim() : undefined,
      maintenanceRequired,
      maintenanceNotes: maintenanceRequired ? maintenanceNotes.trim() : undefined,
      generalNotes: generalNotes.trim() || undefined,
      batteryUsedPercent: batteryEnd ? parseInt(batteryEnd, 10) : undefined,
      checklistCompleted: session.postLanding?.checklistCompleted,
    });
  }

  return (
    <div className="space-y-4">
      <div className="card grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Start" value={takeoff ? takeoff.toLocaleTimeString("de-DE") : "—"} />
        <Stat label="Landung" value={landing ? landing.toLocaleTimeString("de-DE") : "—"} />
        <Stat
          label="Flugdauer"
          value={durationMin != null ? `${durationMin} min` : "—"}
          highlight
        />
      </div>

      <div className="card space-y-3">
        <div className="font-semibold">Akku</div>
        <div className="flex items-center gap-2">
          <input
            className="input max-w-[120px]"
            type="number"
            min={0}
            max={100}
            value={batteryEnd}
            onChange={(e) => setBatteryEnd(e.target.value)}
            placeholder="z.B. 18"
            data-testid="input-battery-end"
          />
          <span className="text-sm text-slate-600">% Restkapazität</span>
        </div>
      </div>

      <div className="card space-y-3">
        <BoolRow
          id="incident"
          label="Vorfall während des Flugs"
          checked={incidentOccurred}
          onChange={setIncidentOccurred}
        />
        {incidentOccurred && (
          <textarea
            className="input min-h-[70px]"
            value={incidentDescription}
            onChange={(e) => setIncidentDescription(e.target.value)}
            placeholder="Beschreibung des Vorfalls (Pflicht)"
            data-testid="textarea-incident"
          />
        )}
      </div>

      <div className="card space-y-3">
        <BoolRow
          id="maintenance"
          label="Wartung erforderlich"
          checked={maintenanceRequired}
          onChange={setMaintenanceRequired}
        />
        {maintenanceRequired && (
          <textarea
            className="input min-h-[70px]"
            value={maintenanceNotes}
            onChange={(e) => setMaintenanceNotes(e.target.value)}
            placeholder="Was muss gewartet werden? (Pflicht)"
            data-testid="textarea-maintenance"
          />
        )}
      </div>

      <div className="card space-y-2">
        <label className="label">Notizen</label>
        <textarea
          className="input min-h-[100px]"
          value={generalNotes}
          onChange={(e) => setGeneralNotes(e.target.value)}
          placeholder="Beobachtungen, was lief gut, was beim nächsten Mal anders …"
          data-testid="textarea-general-notes"
        />
      </div>

      {error && <div className="card text-sm text-red-700">Fehler: {error}</div>}

      <div className="flex justify-end">
        <button
          className="btn-primary"
          onClick={handleComplete}
          disabled={blocked || saving}
          data-testid="button-complete"
        >
          {saving ? "Schließe ab …" : "Flug abschließen → Logbuch"}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase text-slate-500 font-semibold">{label}</div>
      <div className={`text-2xl font-bold ${highlight ? "text-brand-500" : "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}
