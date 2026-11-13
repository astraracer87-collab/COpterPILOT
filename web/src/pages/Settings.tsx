import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "../lib/queryClient";
import { useAuth } from "../lib/auth";

type Settings = {
  id: string;
  windUnit: string;
  tempUnit: string;
  preferGermany: boolean;
  limits: {
    maxWind: number;
    maxGusts: number;
    maxRain: number;
    minTemp: number;
    minCloudCeiling: number;
    minVisibility: number;
  };
};

const DEFAULT: Omit<Settings, "id"> = {
  windUnit: "m/s",
  tempUnit: "C",
  preferGermany: true,
  limits: {
    maxWind: 10,
    maxGusts: 12,
    maxRain: 0.5,
    minTemp: 0,
    minCloudCeiling: 50,
    minVisibility: 5000,
  },
};

export default function Settings() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery<Settings | null>({ queryKey: ["/api/settings"] });
  const [form, setForm] = useState<Omit<Settings, "id">>(DEFAULT);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setForm({
        windUnit: data.windUnit,
        tempUnit: data.tempUnit,
        preferGermany: data.preferGermany,
        limits: { ...DEFAULT.limits, ...data.limits },
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => apiJson("POST", "/api/settings", form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  function setLimit<K extends keyof Settings["limits"]>(key: K, value: number) {
    setForm({ ...form, limits: { ...form.limits, [key]: value } });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="card">
        <h2 className="font-semibold mb-3">Konto</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">E-Mail</span><span className="font-medium">{user?.email}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Name</span><span className="font-medium">{user?.name || "—"}</span></div>
        </div>
        <button onClick={logout} className="btn-secondary mt-4">Abmelden</button>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <h2 className="font-semibold">Wetter-Limits</h2>
        <p className="text-xs text-slate-500 -mt-2">
          Diese Limits werden für die Go/Caution/No-Go Bewertung verwendet
        </p>

        <div className="grid grid-cols-2 gap-3">
          <NumField label="Max. Wind (m/s)" value={form.limits.maxWind} onChange={(v) => setLimit("maxWind", v)} />
          <NumField label="Max. Böen (m/s)" value={form.limits.maxGusts} onChange={(v) => setLimit("maxGusts", v)} />
          <NumField label="Max. Regen (mm/h)" value={form.limits.maxRain} step={0.1} onChange={(v) => setLimit("maxRain", v)} />
          <NumField label="Min. Temperatur (°C)" value={form.limits.minTemp} onChange={(v) => setLimit("minTemp", v)} />
          <NumField label="Min. Wolkenbasis (m)" value={form.limits.minCloudCeiling} onChange={(v) => setLimit("minCloudCeiling", v)} />
          <NumField label="Min. Sichtweite (m)" value={form.limits.minVisibility} onChange={(v) => setLimit("minVisibility", v)} />
        </div>

        <div className="flex items-center gap-4 pt-2">
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            {save.isPending ? "Speichert …" : "Speichern"}
          </button>
          {saved && <span className="text-sm text-green-600">✓ Gespeichert</span>}
        </div>
      </form>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        step={step}
        className="input"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  );
}
