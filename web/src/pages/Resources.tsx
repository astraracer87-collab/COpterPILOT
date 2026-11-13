import { useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resourceLinks, type ResourceCategory } from "../lib/resourceLinks";
import { apiJson, apiRequest } from "../lib/queryClient";

type UserResourceLink = {
  id: string;
  title: string;
  url: string;
  description: string;
  category: string;
};

type DisplayLink = {
  title: string;
  url: string;
  description: string;
  category: string;
  custom?: { id: string };
};

const CUSTOM_CATEGORY_FALLBACK = "Eigene Links";

export default function Resources() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", url: "", description: "", category: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: customLinks = [] } = useQuery<UserResourceLink[]>({
    queryKey: ["/api/user-resources"],
  });

  function resetForm() {
    setForm({ title: "", url: "", description: "", category: "" });
    setEditingId(null);
    setShowForm(false);
    setFormError(null);
  }

  const createMut = useMutation({
    mutationFn: (body: typeof form) => apiJson("POST", "/api/user-resources", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/user-resources"] });
      resetForm();
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: typeof form }) =>
      apiJson("PUT", `/api/user-resources/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/user-resources"] });
      resetForm();
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/user-resources/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/user-resources"] }),
  });

  const importMut = useMutation({
    mutationFn: (payload: unknown) =>
      apiJson<{ imported: number; skipped: number; total: number }>(
        "POST",
        "/api/user-resources/import",
        payload,
      ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["/api/user-resources"] });
      setImportMsg(`Importiert: ${r.imported}, übersprungen: ${r.skipped} von ${r.total}.`);
    },
    onError: (e: Error) => setImportMsg(`Import fehlgeschlagen: ${e.message}`),
  });

  const grouped = useMemo(() => {
    const all: DisplayLink[] = [
      ...resourceLinks.map((l) => ({
        title: l.title,
        url: l.url,
        description: l.description,
        category: l.category as string,
      })),
      ...customLinks.map((l) => ({
        title: l.title,
        url: l.url,
        description: l.description,
        category: l.category?.trim() || CUSTOM_CATEGORY_FALLBACK,
        custom: { id: l.id },
      })),
    ];
    const out: Record<string, DisplayLink[]> = {};
    for (const link of all) {
      (out[link.category] = out[link.category] || []).push(link);
    }
    return out;
  }, [customLinks]);

  const categories = Object.keys(grouped);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.title.trim() || !form.url.trim()) {
      setFormError("Titel und URL erforderlich");
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(form.url.trim());
    } catch {
      setFormError("Ungültige URL");
      return;
    }
    const body = {
      title: form.title.trim(),
      url: form.url.trim(),
      description: form.description.trim(),
      category: form.category.trim(),
    };
    if (editingId) {
      updateMut.mutate({ id: editingId, body });
    } else {
      createMut.mutate(body);
    }
  }

  function startEdit(link: UserResourceLink) {
    setEditingId(link.id);
    setForm({
      title: link.title,
      url: link.url,
      description: link.description ?? "",
      category: link.category ?? "",
    });
    setShowForm(true);
    setFormError(null);
  }

  async function handleExport() {
    try {
      const res = await fetch("/api/user-resources/export", { credentials: "include" });
      if (!res.ok) throw new Error("Export fehlgeschlagen");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `ressourcen-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setImportMsg((err as Error).message);
    }
  }

  function handleImportClick() {
    setImportMsg(null);
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      importMut.mutate(payload);
    } catch {
      setImportMsg("Datei ist kein gültiges JSON");
    }
  }

  const presetCategories: ResourceCategory[] = [
    "Luftraum & NOTAMs",
    "Naturschutz",
    "Wetter",
    "Karten",
    "Drohnenrecht",
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (showForm) {
                resetForm();
              } else {
                setShowForm(true);
                setEditingId(null);
                setForm({ title: "", url: "", description: "", category: "" });
                setFormError(null);
              }
            }}
          >
            {showForm ? "Abbrechen" : "Link hinzufügen"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleExport}>
            Exportieren
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleImportClick}
            disabled={importMut.isPending}
          >
            {importMut.isPending ? "Importiere …" : "Importieren"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {importMsg && (
        <div className="card bg-brand-50 border-brand-200 text-sm text-brand-800">{importMsg}</div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="card space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Titel</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="z. B. Meine Wetterquelle"
              maxLength={200}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">URL</label>
            <input
              className="input"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://…"
              maxLength={2000}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Beschreibung (optional)
            </label>
            <input
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={1000}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Kategorie (optional)
            </label>
            <input
              className="input"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder={CUSTOM_CATEGORY_FALLBACK}
              list="resource-categories"
              maxLength={100}
            />
            <datalist id="resource-categories">
              {presetCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          {formError && <div className="text-sm text-red-600">{formError}</div>}
          <div className="flex gap-2">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={createMut.isPending || updateMut.isPending}
            >
              {editingId
                ? updateMut.isPending
                  ? "Speichere …"
                  : "Aktualisieren"
                : createMut.isPending
                  ? "Speichere …"
                  : "Speichern"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={resetForm}>
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {categories.map((cat) => (
        <div key={cat} className="card">
          <h2 className="font-semibold text-slate-900 mb-3">{cat}</h2>
          <ul className="space-y-2">
            {grouped[cat].map((l) => (
              <li key={l.url + (l.custom?.id ?? "")} className="relative">
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block rounded-md border border-slate-200 hover:border-brand-300 hover:bg-brand-50 px-3 py-2 transition"
                >
                  <div className="font-medium text-brand-700 flex items-center gap-2">
                    <span>{l.title}</span>
                    {l.custom && (
                      <span className="inline-block rounded-full bg-brand-100 text-brand-700 text-[10px] font-semibold px-2 py-0.5">
                        EIGEN
                      </span>
                    )}
                  </div>
                  {l.description && (
                    <div className="text-xs text-slate-500 mt-0.5">{l.description}</div>
                  )}
                  <div className="text-[10px] text-slate-400 mt-1 truncate">{l.url}</div>
                </a>
                {l.custom && (
                  <div className="absolute top-2 right-2 flex gap-1">
                    <button
                      type="button"
                      className="text-xs text-brand-700 hover:underline bg-white/80 px-2 py-0.5 rounded"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const original = customLinks.find((c) => c.id === l.custom!.id);
                        if (original) startEdit(original);
                      }}
                    >
                      Bearbeiten
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline bg-white/80 px-2 py-0.5 rounded"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (confirm(`Link "${l.title}" löschen?`)) {
                          deleteMut.mutate(l.custom!.id);
                        }
                      }}
                    >
                      Löschen
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
