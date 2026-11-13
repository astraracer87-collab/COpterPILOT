import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "../lib/queryClient";
import type { Drone, FlightSession, WizardData } from "../lib/planning/types";
import {
  COUNTRY_MAPS,
  buildMapUrl,
  detectCountryFromCoordinates,
  getCountryMapConfig,
} from "../lib/planning/countryMaps";
import { PLANNING_CHECKLIST, FPV_PLANNING_ITEMS } from "../lib/planning/checklists";
import { fetchForecast, describeWind, type ForecastResult } from "../lib/planning/weather";
import { fetchNotams, type NotamRow } from "../lib/external";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  assessPlanning,
} from "../lib/planning/assessment";

const DEFAULT_LIMITS = {
  maxWind: 10,
  maxGusts: 12,
  maxRain: 0.5,
  minTemp: 0,
  minCloudCeiling: 50,
  minVisibility: 5000,
};

const STEPS = [
  "Drohne",
  "Land",
  "Standort",
  "Karte",
  "Datum/Zeit",
  "Restriktionen",
  "NOTAMs",
  "Wetter",
  "FPV",
  "Checkliste",
  "Ergebnis",
] as const;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const EMPTY: WizardData = {
  droneId: null,
  countryIso: "DE",
  latitude: null,
  longitude: null,
  locationName: "",
  plannedDate: todayStr(),
  plannedTime: nowTimeStr(),
  durationMinutes: 30,
  maxAltitude: 100,
  hasRestrictions: false,
  restrictionStatus: "none",
  restrictionNotes: "",
  isFpvFlight: false,
  flightPurpose: "",
  checklistCompleted: [],
};

export default function PlanningWizard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isResume = id && id !== "neu";

  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(EMPTY);
  const [sessionId, setSessionId] = useState<string | null>(isResume ? id! : null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: drones = [] } = useQuery<Drone[]>({ queryKey: ["/api/drones"] });
  const drone = drones.find((d) => d.id === data.droneId) || null;
  const limits = drone?.limits || DEFAULT_LIMITS;

  // Resume: load session
  const { data: existing } = useQuery<FlightSession>({
    queryKey: ["/api/sessions", id ?? ""],
    enabled: !!isResume,
  });

  useEffect(() => {
    if (!isResume || !existing) return;
    const p: Partial<WizardData> = existing.planning || {};
    setData({
      ...EMPTY,
      droneId: existing.droneId,
      countryIso: existing.countryIso || "DE",
      latitude: existing.latitude,
      longitude: existing.longitude,
      locationName: existing.locationName || "",
      hasRestrictions: existing.hasRestrictions || false,
      restrictionNotes: existing.restrictionNotes || "",
      restrictionStatus: existing.hasRestrictions
        ? (existing.restrictionNotes ? "limited" : "none")
        : "none",
      plannedDate: p.plannedDate || todayStr(),
      plannedTime: p.plannedTime || nowTimeStr(),
      durationMinutes: p.durationMinutes || 30,
      maxAltitude: p.maxAltitude || 100,
      isFpvFlight: p.isFpvFlight || false,
      flightPurpose: p.flightPurpose || "",
      checklistCompleted: p.checklistCompleted || [],
      forecastWeather: p.forecastWeather,
      notamCount: p.notamCount,
      notamCheckedAt: p.notamCheckedAt,
    });
  }, [existing, isResume]);

  const update = (patch: Partial<WizardData>) =>
    setData((prev) => ({ ...prev, ...patch }));

  // Persist session (create or update)
  async function persist(extra?: Partial<FlightSession>) {
    if (!data.droneId || data.latitude == null || data.longitude == null) return;
    setSaving(true);
    try {
      const mapConfig = getCountryMapConfig(data.countryIso);
      const mapUrl = mapConfig
        ? buildMapUrl(mapConfig, data.latitude, data.longitude)
        : null;
      const payload = {
        droneId: data.droneId,
        currentPhase: "planning",
        latitude: data.latitude,
        longitude: data.longitude,
        locationName: data.locationName || null,
        countryIso: data.countryIso,
        mapUrl,
        hasRestrictions: data.hasRestrictions,
        restrictionNotes: data.restrictionNotes || null,
        status: extra?.status || "caution",
        reasons: extra?.reasons ?? null,
        planning: {
          plannedDate: data.plannedDate,
          plannedTime: data.plannedTime,
          maxAltitude: data.maxAltitude,
          durationMinutes: data.durationMinutes,
          isFpvFlight: data.isFpvFlight,
          flightPurpose: data.flightPurpose || undefined,
          checklistCompleted: data.checklistCompleted,
          forecastWeather: data.forecastWeather,
          notamCount: data.notamCount,
          notamCheckedAt: data.notamCheckedAt,
        },
        ...extra,
      };
      let saved: FlightSession;
      if (sessionId) {
        saved = await apiJson<FlightSession>("PUT", `/api/sessions/${sessionId}`, payload);
      } else {
        saved = await apiJson<FlightSession>("POST", "/api/sessions", payload);
        setSessionId(saved.id);
      }
      qc.invalidateQueries({ queryKey: ["/api/sessions"] });
      return saved;
    } finally {
      setSaving(false);
    }
  }

  function validateCurrent(): string | null {
    switch (step) {
      case 0:
        return data.droneId ? null : "Bitte eine Drohne auswählen.";
      case 1:
        return data.countryIso ? null : "Bitte ein Land auswählen.";
      case 2:
        if (data.latitude == null || data.longitude == null)
          return "Bitte Koordinaten angeben.";
        if (Math.abs(data.latitude) > 90 || Math.abs(data.longitude) > 180)
          return "Koordinaten ungültig.";
        return null;
      case 4:
        if (!data.plannedDate || !data.plannedTime)
          return "Bitte Datum und Uhrzeit angeben.";
        return null;
      default:
        return null;
    }
  }

  async function next() {
    setError(null);
    const err = validateCurrent();
    if (err) {
      setError(err);
      return;
    }
    // Persist as soon as we have enough data (after location step)
    if (step >= 2 && data.droneId && data.latitude != null && data.longitude != null) {
      try {
        await persist();
      } catch (e) {
        setError((e as Error).message || "Speichern fehlgeschlagen");
        return;
      }
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  async function saveAndExit() {
    setError(null);
    if (step >= 2 && data.droneId && data.latitude != null && data.longitude != null) {
      try {
        await persist();
      } catch (e) {
        setError((e as Error).message || "Speichern fehlgeschlagen");
        return;
      }
    }
    navigate("/flugplanung");
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-base font-semibold text-slate-700">
            Schritt {step + 1} von {STEPS.length}
          </p>
          <p className="text-slate-500 text-sm mt-1">{STEPS[step]}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate("/flugplanung")}
            className="btn-secondary text-sm"
          >
            Abbrechen
          </button>
          {step >= 2 && (
            <button
              type="button"
              onClick={saveAndExit}
              className="btn-secondary text-sm"
              disabled={saving}
            >
              {saving ? "Speichert …" : "Speichern & beenden"}
            </button>
          )}
        </div>
      </div>

      <Stepper step={step} />

      <div className="card space-y-5">
        {step === 0 && <StepDrone data={data} update={update} drones={drones} />}
        {step === 1 && <StepCountry data={data} update={update} />}
        {step === 2 && <StepLocation data={data} update={update} />}
        {step === 3 && <StepMap data={data} />}
        {step === 4 && <StepDateTime data={data} update={update} />}
        {step === 5 && <StepRestrictions data={data} update={update} />}
        {step === 6 && <StepNotams data={data} update={update} />}
        {step === 7 && <StepWeather data={data} update={update} />}
        {step === 8 && <StepFpv data={data} update={update} />}
        {step === 9 && (
          <StepChecklist data={data} update={update} drone={drone || undefined} />
        )}
        {step === 10 && (
          <StepResult
            data={data}
            drone={drone || undefined}
            limits={limits}
            sessionId={sessionId}
            persist={persist}
            navigate={navigate}
            qc={qc}
          />
        )}

        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {step < 10 && (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={back}
            disabled={step === 0}
            className="btn-secondary disabled:opacity-50"
          >
            ← Zurück
          </button>
          <button type="button" onClick={next} className="btn-primary" disabled={saving}>
            {saving ? "Speichert …" : "Weiter →"}
          </button>
        </div>
      )}
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-1 shrink-0">
          <div
            className={`size-7 rounded-full grid place-items-center text-xs font-semibold ${
              i < step
                ? "bg-emerald-500 text-white"
                : i === step
                ? "bg-brand-500 text-white"
                : "bg-slate-200 text-slate-500"
            }`}
          >
            {i + 1}
          </div>
          <div
            className={`text-xs whitespace-nowrap ${
              i === step ? "text-slate-900 font-medium" : "text-slate-400"
            }`}
          >
            {label}
          </div>
          {i < STEPS.length - 1 && (
            <div className="w-4 h-px bg-slate-200 mx-1" />
          )}
        </div>
      ))}
    </div>
  );
}

/* --------------------------- Step components --------------------------- */

function StepDrone({
  data,
  update,
  drones,
}: {
  data: WizardData;
  update: (p: Partial<WizardData>) => void;
  drones: Drone[];
}) {
  if (drones.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        Du hast noch keine Drohnen angelegt. Bitte zuerst unter „Drohnen“ eine
        anlegen.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Wähle die Drohne für diesen Flug.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {drones.map((d) => {
          const selected = d.id === data.droneId;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => update({ droneId: d.id })}
              className={`text-left rounded-lg border-2 px-4 py-3 transition ${
                selected
                  ? "border-brand-500 bg-brand-50"
                  : "border-slate-200 hover:border-brand-300"
              }`}
            >
              <div className="font-semibold text-slate-900">{d.name}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {[d.manufacturer, d.model].filter(Boolean).join(" ") || "—"}
              </div>
              <div className="text-xs text-slate-600 mt-2">
                {d.classMark} · {d.openCategory} · {d.mtomGrams} g
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepCountry({
  data,
  update,
}: {
  data: WizardData;
  update: (p: Partial<WizardData>) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Wähle das Land, in dem geflogen wird. Daraus ergibt sich später die
        Geozonen-Karte.
      </p>
      <div>
        <label className="label">Land</label>
        <select
          className="input"
          value={data.countryIso}
          onChange={(e) => update({ countryIso: e.target.value })}
        >
          {COUNTRY_MAPS.map((c) => (
            <option key={c.iso} value={c.iso}>
              {c.nameDE} ({c.iso})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function StepLocation({
  data,
  update,
}: {
  data: WizardData;
  update: (p: Partial<WizardData>) => void;
}) {
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);

  function detect() {
    if (!navigator.geolocation) {
      setGeoErr("Browser unterstützt keine Standortbestimmung.");
      return;
    }
    setGeoBusy(true);
    setGeoErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const country = detectCountryFromCoordinates(lat, lon);
        update({
          latitude: lat,
          longitude: lon,
          countryIso: country || data.countryIso,
        });
        setGeoBusy(false);
      },
      (err) => {
        setGeoErr(err.message || "Standort konnte nicht ermittelt werden.");
        setGeoBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Gib den Start-/Landeplatz ein. Du kannst Koordinaten manuell eintragen
        oder den aktuellen Standort verwenden.
      </p>
      <div>
        <label className="label">Ortsbezeichnung</label>
        <input
          className="input"
          placeholder="z.B. Wiese am Sportplatz"
          value={data.locationName}
          onChange={(e) => update({ locationName: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Breitengrad</label>
          <input
            className="input"
            type="number"
            step="0.000001"
            value={data.latitude ?? ""}
            onChange={(e) =>
              update({
                latitude: e.target.value ? parseFloat(e.target.value) : null,
              })
            }
            placeholder="51.1657"
          />
        </div>
        <div>
          <label className="label">Längengrad</label>
          <input
            className="input"
            type="number"
            step="0.000001"
            value={data.longitude ?? ""}
            onChange={(e) =>
              update({
                longitude: e.target.value ? parseFloat(e.target.value) : null,
              })
            }
            placeholder="10.4515"
          />
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <button
          type="button"
          onClick={detect}
          className="btn-secondary text-sm"
          disabled={geoBusy}
        >
          {geoBusy ? "Ermittelt …" : "Aktuellen Standort verwenden"}
        </button>
        {geoErr && <span className="text-xs text-red-600">{geoErr}</span>}
      </div>
      {data.latitude != null && data.longitude != null && (
        <div className="text-xs text-slate-500">
          Erkanntes Land:{" "}
          {detectCountryFromCoordinates(data.latitude, data.longitude) || "—"}
        </div>
      )}
    </div>
  );
}

function StepMap({ data }: { data: WizardData }) {
  const config = getCountryMapConfig(data.countryIso);
  if (!config) {
    return (
      <p className="text-sm text-slate-600">
        Für das gewählte Land ist keine Geozonen-Karte hinterlegt.
      </p>
    );
  }
  if (data.latitude == null || data.longitude == null) {
    return <p className="text-sm text-slate-600">Bitte zuerst Standort eingeben.</p>;
  }
  const url = buildMapUrl(config, data.latitude, data.longitude);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Geozonen-Karte für {config.nameDE}. Prüfe Restriktionen, CTRs und
        Verbotszonen rund um deinen Standort.
      </p>
      {config.iframeable ? (
        <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
          <iframe
            src={url}
            title={`Geozonen ${config.nameDE}`}
            className="w-full h-[60vh] min-h-[420px]"
          />
        </div>
      ) : (
        <div className="card bg-slate-50">
          <p className="text-sm text-slate-700">
            Die offizielle Karte für {config.nameDE} kann nicht eingebettet
            werden. Bitte in einem neuen Tab öffnen:
          </p>
        </div>
      )}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-brand-600 hover:underline break-all"
      >
        Karte in neuem Tab öffnen →
      </a>
    </div>
  );
}

function StepDateTime({
  data,
  update,
}: {
  data: WizardData;
  update: (p: Partial<WizardData>) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Wann ist der Flug geplant und wie lange soll er dauern?
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Datum</label>
          <input
            className="input"
            type="date"
            value={data.plannedDate}
            onChange={(e) => update({ plannedDate: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Uhrzeit</label>
          <input
            className="input"
            type="time"
            value={data.plannedTime}
            onChange={(e) => update({ plannedTime: e.target.value })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Geplante Dauer (Minuten)</label>
          <input
            className="input"
            type="number"
            min={1}
            value={data.durationMinutes}
            onChange={(e) =>
              update({ durationMinutes: parseInt(e.target.value, 10) || 0 })
            }
          />
        </div>
        <div>
          <label className="label">Max. Flughöhe (m AGL)</label>
          <input
            className="input"
            type="number"
            min={0}
            value={data.maxAltitude}
            onChange={(e) =>
              update({ maxAltitude: parseInt(e.target.value, 10) || 0 })
            }
          />
          {data.maxAltitude > 120 && (
            <div className="text-xs text-amber-700 mt-1">
              Über 120 m: Sondergenehmigung erforderlich.
            </div>
          )}
        </div>
      </div>
      <div>
        <label className="label">Zweck des Fluges</label>
        <textarea
          className="input min-h-[70px]"
          value={data.flightPurpose}
          onChange={(e) => update({ flightPurpose: e.target.value })}
          placeholder="z.B. Foto-/Videoaufnahmen, Inspektion, Training, Kartierung …"
          data-testid="input-flight-purpose"
        />
      </div>
    </div>
  );
}

function StepRestrictions({
  data,
  update,
}: {
  data: WizardData;
  update: (p: Partial<WizardData>) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Gibt es Geozonen-Einschränkungen, CTR/EDR oder NOTAMs am Standort?
      </p>
      <div className="space-y-2">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="size-4 accent-brand-500"
            checked={data.hasRestrictions}
            onChange={(e) =>
              update({
                hasRestrictions: e.target.checked,
                restrictionStatus: e.target.checked ? "limited" : "none",
              })
            }
          />
          <span className="text-sm">Einschränkungen am Standort vorhanden</span>
        </label>
      </div>

      {data.hasRestrictions && (
        <>
          <div>
            <label className="label">Status</label>
            <div className="flex flex-col sm:flex-row gap-2">
              {[
                { v: "approved", l: "Genehmigung liegt vor" },
                { v: "limited", l: "Mit Auflagen fliegbar" },
                { v: "none", l: "Keine Genehmigung" },
              ].map((opt) => (
                <label
                  key={opt.v}
                  className={`flex-1 cursor-pointer rounded-md border-2 px-3 py-2 text-sm ${
                    data.restrictionStatus === opt.v
                      ? "border-brand-500 bg-brand-50"
                      : "border-slate-200"
                  }`}
                >
                  <input
                    type="radio"
                    name="restrictionStatus"
                    className="mr-2 accent-brand-500"
                    checked={data.restrictionStatus === opt.v}
                    onChange={() =>
                      update({ restrictionStatus: opt.v as WizardData["restrictionStatus"] })
                    }
                  />
                  {opt.l}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Notizen / Auflagen</label>
            <textarea
              className="input min-h-[90px]"
              value={data.restrictionNotes}
              onChange={(e) => update({ restrictionNotes: e.target.value })}
              placeholder="z.B. CTR EDDF: nur unter 50m AGL, nach Rücksprache Tower …"
            />
          </div>
        </>
      )}
    </div>
  );
}

function StepNotams({
  data,
  update,
}: {
  data: WizardData;
  update: (p: Partial<WizardData>) => void;
}) {
  const [rows, setRows] = useState<NotamRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (data.latitude == null || data.longitude == null) {
      setErr("Bitte zuerst Standort eingeben.");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchNotams(data.latitude, data.longitude);
      setRows(res.rows || []);
      update({
        notamCount: res.rows?.length || 0,
        notamCheckedAt: new Date().toISOString(),
      });
    } catch (e) {
      setErr((e as Error).message || "NOTAMs konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (rows == null) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.latitude, data.longitude]);

  function fmtTs(t?: number) {
    if (!t) return "—";
    return new Date(t * 1000).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-slate-600">
          NOTAMs im Umkreis deines Startpunkts (autorouter).
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="btn-secondary text-xs"
          data-testid="button-notam-refresh"
        >
          {loading ? "Lädt …" : "Neu laden"}
        </button>
      </div>

      {err && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {err}
        </div>
      )}

      {!loading && rows && rows.length === 0 && (
        <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
          Keine aktiven NOTAMs in Reichweite gefunden.
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            {rows.length} NOTAM(s) in der Nähe — bitte prüfen, ob dein Flug betroffen ist.
          </div>
          <ul className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {rows.slice(0, 25).map((n, i) => (
              <li
                key={i}
                className="rounded-md border border-slate-200 px-3 py-2 text-xs"
                data-testid={`notam-row-${i}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    {n.ItemA || `NOTAM ${i + 1}`}
                  </span>
                  <span className="text-slate-500">
                    {fmtTs(n.StartValidity)} – {fmtTs(n.EndValidity)}
                  </span>
                </div>
                {n.ItemE && (
                  <div className="mt-1 text-slate-700 whitespace-pre-wrap">
                    {n.ItemE}
                  </div>
                )}
              </li>
            ))}
            {rows.length > 25 && (
              <li className="text-xs text-slate-500 px-1">
                … {rows.length - 25} weitere
              </li>
            )}
          </ul>
        </>
      )}

      {data.notamCheckedAt && (
        <div className="text-xs text-slate-500">
          Zuletzt geprüft: {new Date(data.notamCheckedAt).toLocaleString("de-DE")}
        </div>
      )}
    </div>
  );
}

function StepWeather({
  data,
  update,
}: {
  data: WizardData;
  update: (p: Partial<WizardData>) => void;
}) {
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const targetIso = useMemo(() => {
    return new Date(`${data.plannedDate}T${data.plannedTime}:00`).toISOString();
  }, [data.plannedDate, data.plannedTime]);

  async function load() {
    if (data.latitude == null || data.longitude == null) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchForecast(data.latitude, data.longitude, targetIso);
      setForecast(res);
      update({ forecastWeather: res.current });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.latitude, data.longitude, targetIso]);

  const w = forecast?.current;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Vorhersage für {data.plannedDate} {data.plannedTime} (Open-Meteo)
        </p>
        <button onClick={load} disabled={loading} className="btn-secondary text-xs">
          {loading ? "Lädt …" : "Aktualisieren"}
        </button>
      </div>

      {err && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {err}
        </div>
      )}

      {w && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Metric label="Temperatur" value={`${w.temperature.toFixed(1)} °C`} />
            <Metric
              label="Wind"
              value={`${w.windSpeed.toFixed(1)} m/s`}
              hint={describeWind(w.windSpeed)}
            />
            <Metric
              label="Böen"
              value={w.windGust ? `${w.windGust.toFixed(1)} m/s` : "—"}
            />
            <Metric label="Niederschlag" value={`${w.rain.toFixed(2)} mm/h`} />
            <Metric label="Bewölkung" value={`${w.cloudCover.toFixed(0)} %`} />
            <Metric label="Luftfeuchte" value={`${w.humidity.toFixed(0)} %`} />
          </div>

          {forecast && (
            <div>
              <div className="text-xs uppercase text-slate-500 font-semibold mb-2">
                Verlauf nächste Stunden
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-500">
                    <tr className="text-left">
                      <th className="py-1 pr-3">Zeit</th>
                      <th className="py-1 pr-3">°C</th>
                      <th className="py-1 pr-3">Wind</th>
                      <th className="py-1 pr-3">Böen</th>
                      <th className="py-1 pr-3">Regen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.hours.slice(0, 8).map((h) => (
                      <tr key={h.time} className="border-t border-slate-100">
                        <td className="py-1 pr-3">
                          {new Date(h.time).toLocaleTimeString("de-DE", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-1 pr-3">{h.temperature.toFixed(1)}</td>
                        <td className="py-1 pr-3">{h.windSpeed.toFixed(1)}</td>
                        <td className="py-1 pr-3">{h.windGust.toFixed(1)}</td>
                        <td className="py-1 pr-3">{h.rain.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!w && !loading && !err && (
        <p className="text-sm text-slate-500">Keine Wetterdaten geladen.</p>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-slate-50 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase text-slate-500 font-medium">{label}</div>
      <div className="text-base font-semibold text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function StepFpv({
  data,
  update,
}: {
  data: WizardData;
  update: (p: Partial<WizardData>) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Fliegst du diesen Flug im FPV-Modus (mit Brille)? Im FPV-Modus ist ein
        Spotter (Beobachter mit VLOS) zwingend erforderlich.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {[
          { v: false, l: "Standard / VLOS", d: "Ich sehe die Drohne mit den eigenen Augen." },
          { v: true, l: "FPV-Flug", d: "Mit Brille — Spotter erforderlich." },
        ].map((opt) => (
          <button
            key={String(opt.v)}
            type="button"
            onClick={() => update({ isFpvFlight: opt.v })}
            className={`text-left rounded-lg border-2 px-4 py-3 ${
              data.isFpvFlight === opt.v
                ? "border-brand-500 bg-brand-50"
                : "border-slate-200"
            }`}
          >
            <div className="font-semibold text-slate-900">{opt.l}</div>
            <div className="text-xs text-slate-500 mt-1">{opt.d}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepChecklist({
  data,
  update,
  drone,
}: {
  data: WizardData;
  update: (p: Partial<WizardData>) => void;
  drone?: Drone;
}) {
  const sections = useMemo(() => {
    const base = [...PLANNING_CHECKLIST];
    if (data.isFpvFlight) {
      base.push({ title: "FPV-Vorbereitung", items: FPV_PLANNING_ITEMS });
    }
    return base;
  }, [data.isFpvFlight]);

  function toggle(id: string) {
    const set = new Set(data.checklistCompleted);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    update({ checklistCompleted: Array.from(set) });
  }

  const allRequired = sections.flatMap((s) => s.items.filter((i) => i.required));
  const missing = allRequired.filter((i) => !data.checklistCompleted.includes(i.id));

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">
        Bitte alle Pflichtpunkte für die Drohne {drone?.name || ""} bestätigen.
      </p>
      {sections.map((section) => (
        <div key={section.title}>
          <div className="text-xs uppercase text-slate-500 font-semibold mb-2">
            {section.title}
          </div>
          <div className="space-y-2">
            {section.items.map((item) => {
              const done = data.checklistCompleted.includes(item.id);
              return (
                <label
                  key={item.id}
                  className={`flex items-start gap-3 rounded-md border px-3 py-2 cursor-pointer ${
                    done
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-emerald-500"
                    checked={done}
                    onChange={() => toggle(item.id)}
                  />
                  <div className="flex-1">
                    <div className="text-sm text-slate-900">
                      {item.label}
                      {item.required && (
                        <span className="ml-2 text-[10px] uppercase text-red-600 font-semibold">
                          Pflicht
                        </span>
                      )}
                    </div>
                    {item.tip && (
                      <div className="text-xs text-slate-500 mt-0.5">{item.tip}</div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {missing.length > 0 ? (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Noch offen: {missing.map((i) => i.label).join(", ")}
        </div>
      ) : (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
          Alle Pflichtpunkte abgehakt.
        </div>
      )}
    </div>
  );
}

function StepResult({
  data,
  drone,
  limits,
  sessionId,
  persist,
  navigate,
  qc,
}: {
  data: WizardData;
  drone?: Drone;
  limits: typeof DEFAULT_LIMITS;
  sessionId: string | null;
  persist: (extra?: Partial<FlightSession>) => Promise<FlightSession | undefined>;
  navigate: ReturnType<typeof useNavigate>;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const checklistMissing = useMemo(() => {
    const required = [
      ...PLANNING_CHECKLIST.flatMap((s) => s.items.filter((i) => i.required)),
      ...(data.isFpvFlight ? FPV_PLANNING_ITEMS.filter((i) => i.required) : []),
    ];
    return required.filter((i) => !data.checklistCompleted.includes(i.id));
  }, [data.checklistCompleted, data.isFpvFlight]);

  const assessment = useMemo(() => {
    if (!data.forecastWeather) {
      return {
        status: "caution" as const,
        warnings: [
          { message: "Keine Wetterdaten — Bewertung unvollständig", severity: "caution" as const },
        ],
        reasons: [{ type: "caution" as const, message: "Wetterdaten fehlen" }],
      };
    }
    return assessPlanning(data.forecastWeather, limits, {
      hasRestrictions: data.hasRestrictions,
      restrictionStatus: data.restrictionStatus,
      maxAltitude: data.maxAltitude,
      upcomingHours: [],
    });
  }, [data, limits]);

  // If required checklist items missing → downgrade
  let finalStatus = assessment.status;
  if (checklistMissing.length > 0 && finalStatus === "go") finalStatus = "caution";

  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setErr(null);
    try {
      const saved = await persist({
        status: finalStatus,
        reasons: assessment.reasons,
      });
      if (saved) setSavedId(saved.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLaunch() {
    setLaunching(true);
    setErr(null);
    try {
      const saved = await persist({
        currentPhase: "preflight",
        status: finalStatus,
        reasons: assessment.reasons,
      });
      if (saved) {
        setSavedId(saved.id);
        qc.invalidateQueries({ queryKey: ["/api/sessions"] });
        navigate(`/flug/${saved.id}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        className={`rounded-lg p-5 text-white ${STATUS_COLORS[finalStatus]}`}
      >
        <div className="text-xs uppercase tracking-wide opacity-80">
          Empfehlung
        </div>
        <div className="text-3xl font-bold mt-1">
          {STATUS_LABELS[finalStatus]}
        </div>
        <div className="text-sm mt-2 opacity-90">
          {finalStatus === "go" && "Alle geprüften Bedingungen liegen innerhalb der Limits."}
          {finalStatus === "caution" &&
            "Flug grundsätzlich möglich, aber bitte Hinweise beachten."}
          {finalStatus === "nogo" &&
            "Flug wird nicht empfohlen — kritische Einschränkungen erkannt."}
        </div>
      </div>

      <Section title="Eckdaten">
        <ul className="text-sm text-slate-700 space-y-1">
          <li>
            <span className="text-slate-500">Drohne:</span> {drone?.name || "—"} (
            {drone?.classMark || "—"} · {drone?.openCategory || "—"})
          </li>
          <li>
            <span className="text-slate-500">Standort:</span>{" "}
            {data.locationName || "—"} ({data.latitude?.toFixed(4)},{" "}
            {data.longitude?.toFixed(4)}) · {data.countryIso}
          </li>
          <li>
            <span className="text-slate-500">Zeit:</span> {data.plannedDate}{" "}
            {data.plannedTime} · {data.durationMinutes} min
          </li>
          <li>
            <span className="text-slate-500">Max. Höhe:</span> {data.maxAltitude} m
            AGL
          </li>
          <li>
            <span className="text-slate-500">Modus:</span>{" "}
            {data.isFpvFlight ? "FPV (mit Spotter)" : "VLOS / Standard"}
          </li>
          {data.flightPurpose && (
            <li>
              <span className="text-slate-500">Zweck:</span>{" "}
              <span className="whitespace-pre-wrap">{data.flightPurpose}</span>
            </li>
          )}
          {data.notamCheckedAt != null && (
            <li>
              <span className="text-slate-500">NOTAMs:</span>{" "}
              {data.notamCount === 0
                ? "keine in der Nähe"
                : `${data.notamCount ?? "?"} in der Nähe — bitte vor Start prüfen`}
            </li>
          )}
        </ul>
      </Section>

      {data.forecastWeather && (
        <Section title="Wetter zum geplanten Zeitpunkt">
          <ul className="text-sm text-slate-700 space-y-1">
            <li>
              {data.forecastWeather.temperature.toFixed(1)} °C ·{" "}
              {data.forecastWeather.windSpeed.toFixed(1)} m/s Wind
              {data.forecastWeather.windGust
                ? ` · ${data.forecastWeather.windGust.toFixed(1)} m/s Böen`
                : ""}
            </li>
            <li>
              {data.forecastWeather.rain.toFixed(2)} mm/h Regen ·{" "}
              {data.forecastWeather.cloudCover.toFixed(0)} % Bewölkung ·{" "}
              {data.forecastWeather.humidity.toFixed(0)} % rH
            </li>
          </ul>
        </Section>
      )}

      {data.hasRestrictions && (
        <Section title="Restriktionen">
          <p className="text-sm">
            Status:{" "}
            <span className="font-medium">
              {data.restrictionStatus === "approved"
                ? "Genehmigung liegt vor"
                : data.restrictionStatus === "limited"
                ? "Mit Auflagen"
                : "Keine Genehmigung"}
            </span>
          </p>
          {data.restrictionNotes && (
            <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">
              {data.restrictionNotes}
            </p>
          )}
        </Section>
      )}

      <Section title="Bewertungs-Begründung">
        <ul className="text-sm space-y-1">
          {assessment.reasons.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span
                className={`inline-block size-2 rounded-full mt-1.5 ${
                  r.type === "go"
                    ? "bg-emerald-500"
                    : r.type === "caution"
                    ? "bg-amber-500"
                    : "bg-red-600"
                }`}
              />
              <span className="text-slate-700">{r.message}</span>
            </li>
          ))}
        </ul>
        {assessment.warnings.length > 0 && (
          <div className="mt-3 space-y-1">
            {assessment.warnings.map((w, i) => (
              <div
                key={i}
                className={`text-xs rounded-md px-3 py-2 border ${
                  w.severity === "warning"
                    ? "bg-red-50 border-red-200 text-red-800"
                    : "bg-amber-50 border-amber-200 text-amber-800"
                }`}
              >
                {w.message}
              </div>
            ))}
          </div>
        )}
      </Section>

      {checklistMissing.length > 0 && (
        <Section title="Offene Pflichtpunkte">
          <ul className="text-sm text-amber-800 list-disc pl-5 space-y-0.5">
            {checklistMissing.map((i) => (
              <li key={i.id}>{i.label}</li>
            ))}
          </ul>
        </Section>
      )}

      {err && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {err}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigate("/flugplanung")}
        >
          Zurück zur Übersicht
        </button>
        <button
          type="button"
          className="btn-secondary flex-1"
          disabled={saving || launching}
          onClick={handleSave}
          data-testid="button-save-planning"
        >
          {saving
            ? "Speichert …"
            : savedId
            ? "Gespeichert ✓"
            : sessionId
            ? "Planung aktualisieren"
            : "Planung speichern"}
        </button>
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={saving || launching || finalStatus === "nogo"}
          onClick={handleLaunch}
          data-testid="button-launch-preflight"
          title={
            finalStatus === "nogo"
              ? "Bewertung ist NO-GO — Flug nicht empfohlen."
              : undefined
          }
        >
          {launching ? "Startet …" : "Pre-Flight starten →"}
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="text-xs uppercase text-slate-500 font-semibold mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}
