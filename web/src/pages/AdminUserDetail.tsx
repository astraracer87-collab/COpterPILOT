import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";

type AdminUserDetail = {
  user: {
    id: string;
    email: string;
    name: string | null;
    isAdmin: boolean;
    authProvider: string;
    createdAt: string;
    updatedAt: string;
  };
  profile: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  drones: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  logbook: Array<Record<string, unknown>>;
  glossary: Array<Record<string, unknown>>;
  resources: Array<Record<string, unknown>>;
  droneHistory: Array<Record<string, unknown>>;
};

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <header className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">{title}</h2>
        <span className="text-xs text-slate-500">{count} Einträge</span>
      </header>
      <div className="p-3 max-h-96 overflow-auto">{children}</div>
    </section>
  );
}

function JsonList({ items }: { items: Array<Record<string, unknown>> }) {
  if (items.length === 0)
    return <div className="text-slate-400 text-sm italic">Keine Einträge.</div>;
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={(it.id as string) || i} className="text-xs">
          <pre className="bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto">
            {JSON.stringify(it, null, 2)}
          </pre>
        </li>
      ))}
    </ul>
  );
}

export default function AdminUserDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !user?.isAdmin) return;
    let cancelled = false;
    fetch(`/api/admin/users/${id}`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || "Fehler");
        return r.json();
      })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!user?.isAdmin) {
    return (
      <div className="p-6 bg-rose-50 border border-rose-200 text-rose-800 rounded-md">
        Nur Admins.
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
  if (!data) return <div className="text-slate-500">Lädt …</div>;

  return (
    <div className="space-y-4">
      <Link to="/admin" className="text-sm text-brand-600 hover:underline">
        ← Zurück zur Nutzerliste
      </Link>
      <header className="bg-white border border-slate-200 rounded-lg p-4">
        <h1 className="text-xl font-semibold text-slate-900">
          {data.user.name || "(ohne Name)"}{" "}
          {data.user.isAdmin && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-semibold uppercase align-middle">
              Admin
            </span>
          )}
        </h1>
        <div className="text-sm text-slate-600 font-mono">{data.user.email}</div>
        <div className="text-xs text-slate-500 mt-1">
          ID: {data.user.id} · Provider: {data.user.authProvider} · Registriert:{" "}
          {new Date(data.user.createdAt).toLocaleString("de-DE")}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Profil" count={data.profile ? 1 : 0}>
          {data.profile ? (
            <pre className="bg-slate-50 border border-slate-200 rounded p-2 text-xs overflow-x-auto">
              {JSON.stringify(data.profile, null, 2)}
            </pre>
          ) : (
            <div className="text-slate-400 text-sm italic">Kein Profil.</div>
          )}
        </Section>
        <Section title="Einstellungen" count={data.settings ? 1 : 0}>
          {data.settings ? (
            <pre className="bg-slate-50 border border-slate-200 rounded p-2 text-xs overflow-x-auto">
              {JSON.stringify(data.settings, null, 2)}
            </pre>
          ) : (
            <div className="text-slate-400 text-sm italic">Keine Einstellungen.</div>
          )}
        </Section>
        <Section title="Drohnen" count={data.drones.length}>
          <JsonList items={data.drones} />
        </Section>
        <Section title="Drohnen-Historie" count={data.droneHistory.length}>
          <JsonList items={data.droneHistory} />
        </Section>
        <Section title="Flug-Sessions (PreCheck)" count={data.sessions.length}>
          <JsonList items={data.sessions} />
        </Section>
        <Section title="Logbuch" count={data.logbook.length}>
          <JsonList items={data.logbook} />
        </Section>
        <Section title="Glossar" count={data.glossary.length}>
          <JsonList items={data.glossary} />
        </Section>
        <Section title="Ressourcen / Links" count={data.resources.length}>
          <JsonList items={data.resources} />
        </Section>
      </div>
    </div>
  );
}
