import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import type { FlightSession, Drone } from "../lib/planning/types";
import { exportBriefingPdf } from "../lib/pdfExport";

export default function BriefingDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: session, isLoading } = useQuery<FlightSession>({
    queryKey: [`/api/sessions/${id}`],
    enabled: !!id,
  });
  const { data: drones = [] } = useQuery<Drone[]>({ queryKey: ["/api/drones"] });
  const { data: profile } = useQuery<{ name: string; pilotId: string; operatorId: string; photoUrl?: string | null } | null>({
    queryKey: ["/api/profile"],
  });

  if (isLoading) return <div className="text-center text-slate-500 py-10">Lädt …</div>;
  if (!session) return <div className="card text-center py-12 text-slate-500">Briefing nicht gefunden.</div>;

  const drone = drones.find((d) => d.id === session.droneId);
  const p = session.planning || {};
  const w = p.forecastWeather;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/briefings" className="text-sm text-brand-600 hover:underline">← Zurück zu Briefings</Link>
        <div className="flex items-start justify-between mt-2 gap-3">
          <div>
            <p className="text-slate-500 text-sm">
              {new Date(session.createdAt).toLocaleString("de-DE")}
            </p>
          </div>
          <button
            className="btn-primary"
            onClick={() => exportBriefingPdf({
              ...session,
              droneName: drone?.name,
              pilotName: profile?.name || null,
              pilotId: profile?.pilotId || null,
              operatorId: profile?.operatorId || null,
              pilotPhotoUrl: profile?.photoUrl || null,
            } as any)}
          >
            PDF Export
          </button>
        </div>
      </div>

      <Section title="Drohne & Phase">
        <Row label="Drohne" value={drone?.name || session.droneId} />
        <Row label="Aktuelle Phase" value={session.currentPhase} />
        <Row label="Status" value={session.status} />
      </Section>

      <Section title="Ort & Zeit">
        <Row label="Ort" value={session.locationName || "—"} />
        <Row label="Koordinaten" value={`${session.latitude.toFixed(5)}, ${session.longitude.toFixed(5)}`} />
        <Row label="Land" value={session.countryIso || "—"} />
        <Row label="Geplant am" value={p.plannedDate ? `${p.plannedDate} ${p.plannedTime || ""}` : "—"} />
        <Row label="Geplante Dauer" value={p.durationMinutes ? `${p.durationMinutes} min` : "—"} />
        <Row label="Max. Höhe" value={p.maxAltitude ? `${p.maxAltitude} m AGL` : "—"} />
        <Row label="FPV-Flug" value={p.isFpvFlight ? "Ja" : "Nein"} />
      </Section>

      <Section title="Restriktionen / Geozonen">
        <Row label="Restriktionen" value={session.hasRestrictions ? "Ja" : "Nein"} />
        <Row label="Status" value={p.restrictionStatus || "—"} />
        <Row label="Notizen" value={session.restrictionNotes || p.restrictionNotes || "—"} />
      </Section>

      {w && (
        <Section title="Wetter-Snapshot">
          <Row label="Temperatur" value={`${num(w.temperature)} °C`} />
          <Row label="Wind" value={`${num(w.windSpeed)} m/s`} />
          <Row label="Böen" value={w.windGust != null ? `${num(w.windGust)} m/s` : "—"} />
          <Row label="Niederschlag" value={`${w.rain ?? 0} mm/h`} />
          <Row label="Bewölkung" value={`${w.cloudCover ?? 0} %`} />
          <Row label="Luftfeuchte" value={`${w.humidity ?? 0} %`} />
        </Section>
      )}

      {Array.isArray(p.checklistCompleted) && p.checklistCompleted.length > 0 && (
        <Section title="Checkliste (abgehakt)">
          <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
            {p.checklistCompleted.map((c: string, i: number) => <li key={i}>{c}</li>)}
          </ul>
        </Section>
      )}

      {Array.isArray(session.reasons) && session.reasons.length > 0 && (
        <Section title="Bewertung">
          <ul className="space-y-1 text-sm">
            {session.reasons.map((r, i) => (
              <li key={i}>
                <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold mr-2 ${
                  r.type === "go" ? "bg-green-100 text-green-700" :
                  r.type === "caution" ? "bg-amber-100 text-amber-700" :
                  "bg-red-100 text-red-700"
                }`}>{r.type.toUpperCase()}</span>
                {r.message}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function num(v: any) {
  if (typeof v === "number") return v.toFixed(1);
  return v ?? "—";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2 className="font-semibold text-slate-900 mb-3 pb-2 border-b border-slate-100">{title}</h2>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <div className="text-slate-500">{label}</div>
      <div className="col-span-2 text-slate-900">{value}</div>
    </div>
  );
}
