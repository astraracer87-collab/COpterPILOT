import { useState, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "../lib/queryClient";

type Entry = {
  id: string;
  droneId: string;
  eventType: string;
  description: string;
  date: string;
  createdAt: string;
};

type Drone = { id: string; name: string };
type LogbookEntry = { id: string; droneName: string; flightDurationMinutes: number | null };

const EVENT_LABELS: Record<string, string> = {
  repair: "Reparatur",
  inspection: "Inspektion",
  cleaning: "Reinigung",
  rotor_change: "Rotorwechsel",
  damage: "Beschädigung",
  replacement: "Austausch",
  other: "Sonstiges",
};

export default function DroneHistory() {
  const { droneId } = useParams<{ droneId: string }>();
  const qc = useQueryClient();

  const { data: drones = [] } = useQuery<Drone[]>({ queryKey: ["/api/drones"] });
  const { data: entries = [], isLoading } = useQuery<Entry[]>({
    queryKey: [`/api/drones/${droneId}/history`],
    enabled: !!droneId,
  });
  const { data: logbook = [] } = useQuery<LogbookEntry[]>({ queryKey: ["/api/logbook"] });

  const drone = drones.find((d) => d.id === droneId);
  const droneFlights = logbook.filter((l) => l.droneName === drone?.name);
  const totalMinutes = droneFlights.reduce((sum, l) => sum + (l.flightDurationMinutes || 0), 0);

  const [eventType, setEventType] = useState("repair");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: (data: { eventType: string; description: string }) =>
      apiJson("POST", `/api/drones/${droneId}/history`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/drones/${droneId}/history`] });
      setDescription("");
      setEventType("repair");
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => apiJson("DELETE", `/api/drones/${droneId}/history/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`/api/drones/${droneId}/history`] }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    create.mutate({ eventType, description: description.trim() });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/drohnen" className="text-sm text-brand-600 hover:underline">← Zurück zu Drohnen</Link>
        <p className="text-base font-semibold text-slate-700 mt-2">{drone?.name || "Drohne"}</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Flüge" value={String(droneFlights.length)} />
        <Stat label="Gesamt-Flugzeit" value={`${totalMinutes} min`} />
        <Stat label="Einträge" value={String(entries.length)} />
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">Neuer Eintrag</h2>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <select className="input col-span-1" value={eventType} onChange={(e) => setEventType(e.target.value)}>
              {Object.entries(EVENT_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <input
              className="input col-span-2"
              placeholder="Beschreibung"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <button type="submit" disabled={create.isPending} className="btn-primary">
            {create.isPending ? "Speichert …" : "Eintrag hinzufügen"}
          </button>
        </form>
      </div>

      <div className="card p-0 overflow-hidden">
        <h2 className="font-semibold p-4 pb-2">Historie</h2>
        {isLoading ? (
          <div className="text-center text-slate-500 py-6">Lädt …</div>
        ) : entries.length === 0 ? (
          <div className="text-center text-slate-500 py-6">Noch keine Einträge.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {entries.map((e) => (
              <li key={e.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="text-xs text-slate-500">
                    {new Date(e.date).toLocaleDateString("de-DE")} ·{" "}
                    <span className="font-semibold text-brand-700">{EVENT_LABELS[e.eventType] || e.eventType}</span>
                  </div>
                  <div className="text-sm text-slate-900 mt-0.5">{e.description}</div>
                </div>
                <button
                  onClick={() => { if (confirm("Eintrag löschen?")) del.mutate(e.id); }}
                  className="text-xs text-red-600 hover:underline"
                >
                  Löschen
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card text-center">
      <div className="text-xs uppercase text-slate-500 font-medium">{label}</div>
      <div className="text-xl font-bold text-slate-900 mt-1">{value}</div>
    </div>
  );
}
