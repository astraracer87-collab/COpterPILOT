import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";

type AdminUserSummary = {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  authProvider: string;
  createdAt: string;
  counts: {
    drones: number;
    sessions: number;
    logbook: number;
    glossary: number;
    resources: number;
  };
};

export default function Admin() {
  const { user } = useAuth();
  const [items, setItems] = useState<AdminUserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.isAdmin) return;
    let cancelled = false;
    fetch("/api/admin/users", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || "Fehler");
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setItems(data.users);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user?.isAdmin) {
    return (
      <div className="p-6 bg-rose-50 border border-rose-200 text-rose-800 rounded-md">
        Diese Seite ist nur für Admins.
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-rose-50 border border-rose-200 text-rose-800 rounded-md">
        {error}
      </div>
    );
  }

  if (!items) return <div className="text-slate-500">Lädt …</div>;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Admin · Nutzerverwaltung</h1>
        <p className="text-sm text-slate-500">
          Vollzugriff auf alle Konten, Flüge, Drohnen, Logbuch-Einträge, Glossar und Ressourcen.
        </p>
      </header>

      <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2">Nutzer</th>
              <th className="px-3 py-2">E-Mail</th>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2 text-center">Drohnen</th>
              <th className="px-3 py-2 text-center">Flüge</th>
              <th className="px-3 py-2 text-center">Logbuch</th>
              <th className="px-3 py-2 text-center">Glossar</th>
              <th className="px-3 py-2 text-center">Ressourcen</th>
              <th className="px-3 py-2">Registriert</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  {u.name || <span className="text-slate-400">—</span>}
                  {u.isAdmin && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold uppercase">
                      Admin
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{u.email}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{u.authProvider}</td>
                <td className="px-3 py-2 text-center">{u.counts.drones}</td>
                <td className="px-3 py-2 text-center">{u.counts.sessions}</td>
                <td className="px-3 py-2 text-center">{u.counts.logbook}</td>
                <td className="px-3 py-2 text-center">{u.counts.glossary}</td>
                <td className="px-3 py-2 text-center">{u.counts.resources}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {new Date(u.createdAt).toLocaleDateString("de-DE")}
                </td>
                <td className="px-3 py-2">
                  <Link
                    to={`/admin/users/${u.id}`}
                    className="text-brand-600 hover:underline text-xs font-medium"
                  >
                    Details →
                  </Link>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-slate-400">
                  Noch keine Nutzer registriert.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
