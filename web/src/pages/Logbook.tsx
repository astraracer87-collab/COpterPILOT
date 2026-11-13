import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { TrafficLogEntry } from "../lib/proximityAlarm";
import { exportLogbookEntryPdf } from "../lib/pdfExport";

type Profile = { name: string; pilotId: string; operatorId: string; photoUrl?: string | null };

type LogbookEntry = {
  id: string;
  droneName: string;
  droneClass: string;
  flightDate: string;
  locationName: string | null;
  takeoffTime: string | null;
  landingTime: string | null;
  flightDurationMinutes: number | null;
  maxAltitude: number | null;
  incidentOccurred: boolean;
  notes: string | null;
  trafficLog: TrafficLogEntry[] | null;
};

type TrafficFilter = "all" | "warning" | "critical";

export default function Logbook() {
  const { data: entries = [], isLoading } = useQuery<LogbookEntry[]>({ queryKey: ["/api/logbook"] });
  const { data: profile } = useQuery<Profile | null>({ queryKey: ["/api/profile"] });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="text-center text-slate-500 py-10">Lädt …</div>
      ) : entries.length === 0 ? (
        <div className="card text-center py-12 space-y-3">
          <p className="text-slate-500">Noch keine Logbucheinträge.</p>
          <p className="text-xs text-slate-400">
            Beim Abschluss eines Fluges wird automatisch ein Eintrag erstellt.
          </p>
          <Link to="/fluege" className="btn-primary inline-flex">
            Flug starten
          </Link>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 w-10"></th>
                <th className="px-4 py-3">Datum</th>
                <th className="px-4 py-3">Drohne</th>
                <th className="px-4 py-3">Ort</th>
                <th className="px-4 py-3">Dauer</th>
                <th className="px-4 py-3">Max. Höhe</th>
                <th className="px-4 py-3">Verkehr</th>
                <th className="px-4 py-3">Vorfall</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => {
                const log = Array.isArray(e.trafficLog) ? e.trafficLog : [];
                const isOpen = expandedId === e.id;
                const hasLog = log.length > 0;
                return (
                  <Fragment key={e.id}>
                    <tr className="hover:bg-slate-50">
                      <td
                        className={`px-4 py-3 text-slate-400 ${hasLog ? "cursor-pointer" : ""}`}
                        onClick={() => hasLog && setExpandedId(isOpen ? null : e.id)}
                      >
                        {hasLog ? (isOpen ? "▾" : "▸") : ""}
                      </td>
                      <td className="px-4 py-3">{e.flightDate}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{e.droneName}</div>
                        <div className="text-xs text-slate-500">{e.droneClass}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{e.locationName || "—"}</td>
                      <td className="px-4 py-3">
                        {e.flightDurationMinutes ? `${e.flightDurationMinutes} min` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {e.maxAltitude ? `${e.maxAltitude} m` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {hasLog ? (
                          <span className="text-xs px-2 py-1 bg-slate-100 text-slate-700 rounded-md font-medium">
                            {log.length}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {e.incidentOccurred ? (
                          <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-md font-semibold">
                            Ja
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Link
                          to={`/logbuch/${e.id}`}
                          className="text-xs text-brand-600 hover:underline mr-3"
                        >
                          Detail
                        </Link>
                        <button
                          type="button"
                          onClick={() =>
                            exportLogbookEntryPdf({
                              ...e,
                              pilotName: profile?.name || null,
                              pilotId: profile?.pilotId || null,
                              operatorId: profile?.operatorId || null,
                              pilotPhotoUrl: profile?.photoUrl || null,
                            })
                          }
                          className="text-xs text-brand-600 hover:underline"
                        >
                          PDF
                        </button>
                      </td>
                    </tr>
                    {isOpen && hasLog ? (
                      <tr className="bg-slate-50/60">
                        <td></td>
                        <td colSpan={8} className="px-4 py-4">
                          <TrafficLogDetail log={log} notes={e.notes} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TrafficLogDetail({ log, notes }: { log: TrafficLogEntry[]; notes: string | null }) {
  const [filter, setFilter] = useState<TrafficFilter>("all");
  const filtered = log.filter((e) => filter === "all" || e.level === filter);
  const sorted = [...filtered].sort((a, b) => a.ts - b.ts);
  const criticalCount = log.filter((e) => e.level === "critical").length;
  const warnCount = log.filter((e) => e.level === "warning").length;

  return (
    <div className="space-y-3">
      {notes ? (
        <div className="text-sm text-slate-700">
          <span className="font-medium text-slate-500">Notizen: </span>
          {notes}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm font-semibold text-slate-700">
          Verkehrs-Annäherungen ({log.length})
          <span className="ml-2 text-xs font-normal text-slate-500">
            {criticalCount} kritisch · {warnCount} Warnung
          </span>
        </div>
        <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-xs">
          {(["all", "critical", "warning"] as TrafficFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 ${
                filter === f
                  ? "bg-brand-500 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
              aria-pressed={filter === f}
            >
              {f === "all" ? "Alle" : f === "critical" ? "Kritisch" : "Warnung"}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-slate-500 py-3 text-center">
          Keine Annäherungen für diesen Filter.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Zeit</th>
                <th className="px-3 py-2">Stufe</th>
                <th className="px-3 py-2">Kennung</th>
                <th className="px-3 py-2">Distanz</th>
                <th className="px-3 py-2">Höhe</th>
                <th className="px-3 py-2">Richtung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((t, i) => (
                <tr key={`${t.ts}-${t.icao24}-${i}`}>
                  <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                    {new Date(t.ts).toLocaleString("de-DE")}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium ${
                        t.level === "critical"
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          t.level === "critical" ? "bg-red-500" : "bg-amber-500"
                        }`}
                      />
                      {t.level === "critical" ? "Kritisch" : "Warnung"}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-900">{t.callsign}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {t.distanceKm < 1
                      ? `${Math.round(t.distanceKm * 1000)} m`
                      : `${t.distanceKm.toFixed(1)} km`}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {t.altitudeM != null ? `${Math.round(t.altitudeM)} m` : "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {t.direction} ({Math.round(t.bearingDeg)}°)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
