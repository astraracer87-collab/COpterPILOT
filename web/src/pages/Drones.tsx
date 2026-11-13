import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiJson } from "../lib/queryClient";
import {
  ALL_PRESETS,
  searchPresets,
  getDefaultCategoryForPreset,
  type DronePreset,
} from "@client/lib/dronePresets";

type Drone = {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  classMark: string;
  mtomGrams: number;
  openCategory: string;
  droneType: string;
};

type FormState = {
  id?: string;
  name: string;
  manufacturer: string;
  model: string;
  classMark: string;
  mtomGrams: string;
  openCategory: string;
  droneType: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  manufacturer: "",
  model: "",
  classMark: "C0",
  mtomGrams: "249",
  openCategory: "A1",
  droneType: "standard",
};

const DEFAULT_LIMITS = {
  maxWind: 10,
  maxGusts: 12,
  maxRain: 0.5,
  minTemp: 0,
  minCloudCeiling: 50,
  minVisibility: 5000,
};

const DEFAULT_COMPLIANCE = {
  operatorRegistered: false,
  eIdLabeledOnDrone: false,
  insuranceActive: false,
  competencyA1A3: false,
  certificateA2: false,
  remoteIdConfigured: false,
};

export default function Drones() {
  const qc = useQueryClient();
  const { data: drones = [], isLoading } = useQuery<Drone[]>({ queryKey: ["/api/drones"] });

  const [editing, setEditing] = useState<FormState | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (form: FormState) => {
      const payload = {
        name: form.name.trim(),
        manufacturer: form.manufacturer.trim() || null,
        model: form.model.trim() || null,
        classMark: form.classMark,
        mtomGrams: parseInt(form.mtomGrams, 10) || 0,
        openCategory: form.openCategory,
        droneType: form.droneType,
        hasCameraOrSensor: true,
        compliance: DEFAULT_COMPLIANCE,
        limits: DEFAULT_LIMITS,
      };
      if (form.id) {
        return apiJson("PUT", `/api/drones/${form.id}`, payload);
      }
      return apiJson("POST", "/api/drones", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/drones"] });
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiJson("DELETE", `/api/drones/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/drones"] }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    saveMutation.mutate(editing);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          className="btn-primary"
          onClick={() => setEditing({ ...EMPTY_FORM })}
        >
          + Neue Drohne
        </button>
      </div>

      {isLoading ? (
        <div className="text-center text-slate-500 py-10">Lädt …</div>
      ) : drones.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-slate-500">Noch keine Drohnen angelegt.</p>
          <button
            className="btn-primary mt-4"
            onClick={() => setEditing({ ...EMPTY_FORM })}
          >
            Erste Drohne anlegen
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {drones.map((d) => (
            <div key={d.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-slate-900">{d.name}</div>
                  <div className="text-sm text-slate-500">
                    {[d.manufacturer, d.model].filter(Boolean).join(" ") || "—"}
                  </div>
                </div>
                <span className="text-xs px-2 py-1 bg-brand-100 text-brand-700 rounded-md font-semibold">
                  {d.classMark}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <Info label="MTOM" value={`${d.mtomGrams} g`} />
                <Info label="Kategorie" value={d.openCategory} />
                <Info label="Typ" value={typeLabel(d.droneType)} />
              </div>
              <div className="mt-4 flex gap-2">
                <Link
                  to={`/drohnen/${d.id}/historie`}
                  className="btn-secondary text-xs px-3 py-1.5 text-center"
                >
                  Historie
                </Link>
                <button
                  className="btn-secondary text-xs px-3 py-1.5 flex-1"
                  onClick={() =>
                    setEditing({
                      id: d.id,
                      name: d.name,
                      manufacturer: d.manufacturer || "",
                      model: d.model || "",
                      classMark: d.classMark,
                      mtomGrams: String(d.mtomGrams),
                      openCategory: d.openCategory,
                      droneType: d.droneType,
                    })
                  }
                >
                  Bearbeiten
                </button>
                <button
                  className="btn-danger text-xs px-3 py-1.5"
                  onClick={() => {
                    if (confirm(`"${d.name}" wirklich löschen?`)) deleteMutation.mutate(d.id);
                  }}
                >
                  Löschen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <h2 className="text-lg font-semibold">
              {editing.id ? "Drohne bearbeiten" : "Neue Drohne"}
            </h2>

            {!editing.id && (
              <PresetPicker
                onPick={(p) =>
                  setEditing({
                    ...editing,
                    name: editing.name.trim() || `${p.manufacturer} ${p.model}`,
                    manufacturer: p.manufacturer,
                    model: p.model,
                    classMark: p.classMark,
                    mtomGrams: String(p.mtomGrams),
                    openCategory: getDefaultCategoryForPreset(p),
                    droneType: p.droneType,
                  })
                }
              />
            )}

            <div>
              <label className="label">Name</label>
              <input
                className="input"
                required
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="z.B. Mavic 3 Pro"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Hersteller</label>
                <input
                  className="input"
                  value={editing.manufacturer}
                  onChange={(e) => setEditing({ ...editing, manufacturer: e.target.value })}
                  placeholder="DJI"
                />
              </div>
              <div>
                <label className="label">Modell</label>
                <input
                  className="input"
                  value={editing.model}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                  placeholder="Mavic 3 Pro"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Klasse</label>
                <select
                  className="input"
                  value={editing.classMark}
                  onChange={(e) => setEditing({ ...editing, classMark: e.target.value })}
                >
                  {["C0", "C1", "C2", "C3", "C4", "C5", "C6", "legacy"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">MTOM (g)</label>
                <input
                  type="number"
                  className="input"
                  required
                  min={0}
                  value={editing.mtomGrams}
                  onChange={(e) => setEditing({ ...editing, mtomGrams: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Kategorie</label>
                <select
                  className="input"
                  value={editing.openCategory}
                  onChange={(e) => setEditing({ ...editing, openCategory: e.target.value })}
                >
                  {["A1", "A2", "A3"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="label">Typ</label>
              <select
                className="input"
                value={editing.droneType}
                onChange={(e) => setEditing({ ...editing, droneType: e.target.value })}
              >
                <option value="selfie">Selfie / Mini</option>
                <option value="standard">Standard</option>
                <option value="fpv_only">FPV only</option>
                <option value="hybrid_fpv">Hybrid FPV</option>
              </select>
            </div>

            {saveMutation.error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {(saveMutation.error as Error).message}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                className="btn-secondary flex-1"
                onClick={() => setEditing(null)}
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="btn-primary flex-1"
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "Speichert …" : "Speichern"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-md px-2 py-1.5">
      <div className="text-[10px] uppercase text-slate-500 font-medium">{label}</div>
      <div className="text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}

function typeLabel(t: string) {
  switch (t) {
    case "selfie": return "Selfie";
    case "fpv_only": return "FPV";
    case "hybrid_fpv": return "Hybrid";
    default: return "Standard";
  }
}

function PresetPicker({ onPick }: { onPick: (p: DronePreset) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const results = useMemo<DronePreset[]>(() => {
    const q = query.trim();
    const list = q ? searchPresets(q) : ALL_PRESETS;
    return list.slice(0, 30);
  }, [query]);

  return (
    <div className="bg-brand-50 border border-brand-100 rounded-md p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-brand-700 uppercase tracking-wide">
          DJI Drohnen-Datenbank
        </div>
        <button
          type="button"
          className="text-xs text-brand-600 hover:underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Verbergen" : "Drohne auswählen"}
        </button>
      </div>
      {open && (
        <>
          <input
            className="input mb-2"
            placeholder="z.B. Mini 4 Pro, Mavic 3, Air 3 …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="max-h-56 overflow-y-auto rounded-md bg-white border border-slate-200 divide-y divide-slate-100">
            {results.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-500">Keine Treffer.</div>
            ) : (
              results.map((p) => (
                <button
                  key={`${p.manufacturer}-${p.model}`}
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-3"
                  onClick={() => {
                    onPick(p);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      {p.manufacturer} {p.model}
                    </div>
                    <div className="text-xs text-slate-500">
                      {p.year} · {p.mtomGrams} g · max {p.maxWindMs} m/s · {p.notes || "—"}
                    </div>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-brand-100 text-brand-700 font-semibold shrink-0">
                    {p.classMark}
                  </span>
                </button>
              ))
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Übernimmt Klasse, MTOM, Kategorie und Typ. Du kannst die Werte danach
            anpassen.
          </p>
        </>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/50 grid place-items-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
