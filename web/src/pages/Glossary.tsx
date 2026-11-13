import { useState, useMemo, useRef, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { glossaryEntries, type GlossaryEntry } from "../lib/glossary";
import { apiJson, apiRequest } from "../lib/queryClient";

type UserGlossaryEntry = {
  id: string;
  term: string;
  definition: string;
};

export default function Glossary() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTerm, setFormTerm] = useState("");
  const [formDefinition, setFormDefinition] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: customEntries = [], isLoading } = useQuery<UserGlossaryEntry[]>({
    queryKey: ["/api/user-glossary"],
  });

  function resetForm() {
    setFormTerm("");
    setFormDefinition("");
    setEditingId(null);
    setShowForm(false);
    setFormError(null);
  }

  const createMut = useMutation({
    mutationFn: (body: { term: string; definition: string }) =>
      apiJson("POST", "/api/user-glossary", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/user-glossary"] });
      resetForm();
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { term: string; definition: string } }) =>
      apiJson("PUT", `/api/user-glossary/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/user-glossary"] });
      resetForm();
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/user-glossary/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/user-glossary"] }),
  });

  const importMut = useMutation({
    mutationFn: (payload: unknown) =>
      apiJson<{ imported: number; skipped: number; total: number }>(
        "POST",
        "/api/user-glossary/import",
        payload,
      ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["/api/user-glossary"] });
      setImportMsg(`Importiert: ${r.imported}, übersprungen: ${r.skipped} von ${r.total}.`);
    },
    onError: (e: Error) => setImportMsg(`Import fehlgeschlagen: ${e.message}`),
  });

  const merged = useMemo<(GlossaryEntry & { custom?: { id: string } })[]>(() => {
    const customAsEntries = customEntries.map((c) => ({
      term: c.term,
      definition: c.definition,
      custom: { id: c.id },
    }));
    const all = [...customAsEntries, ...glossaryEntries] as (GlossaryEntry & {
      custom?: { id: string };
    })[];
    const seen = new Set<string>();
    const unique = all.filter((e) => {
      const k = e.term.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    unique.sort((a, b) => a.term.localeCompare(b.term, "de"));
    return unique;
  }, [customEntries]);

  const filtered = useMemo(() => {
    if (!search.trim()) return merged;
    const q = search.toLowerCase();
    return merged.filter(
      (e) => e.term.toLowerCase().includes(q) || e.definition.toLowerCase().includes(q),
    );
  }, [merged, search]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!formTerm.trim() || !formDefinition.trim()) {
      setFormError("Begriff und Definition erforderlich");
      return;
    }
    const body = { term: formTerm.trim(), definition: formDefinition.trim() };
    if (editingId) {
      updateMut.mutate({ id: editingId, body });
    } else {
      createMut.mutate(body);
    }
  }

  function startEdit(entry: { id: string; term: string; definition: string }) {
    setEditingId(entry.id);
    setFormTerm(entry.term);
    setFormDefinition(entry.definition);
    setShowForm(true);
    setFormError(null);
  }

  async function handleExport() {
    try {
      const res = await fetch("/api/user-glossary/export", { credentials: "include" });
      if (!res.ok) throw new Error("Export fehlgeschlagen");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `glossar-${stamp}.json`;
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
                setFormTerm("");
                setFormDefinition("");
                setFormError(null);
              }
            }}
          >
            {showForm ? "Abbrechen" : "Eintrag hinzufügen"}
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Begriff</label>
            <input
              className="input"
              value={formTerm}
              onChange={(e) => setFormTerm(e.target.value)}
              placeholder="z. B. Kp-Index"
              maxLength={200}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Definition</label>
            <textarea
              className="input min-h-[100px]"
              value={formDefinition}
              onChange={(e) => setFormDefinition(e.target.value)}
              placeholder="Erklärung …"
              maxLength={5000}
            />
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

      <input
        className="input"
        placeholder="Begriff suchen …"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="text-xs text-slate-400 -mt-3">
        Quelle: dipul.de — Digitale Plattform Unbemannte Luftfahrt
        {customEntries.length > 0 ? ` · ${customEntries.length} eigene Einträge` : ""}
      </div>

      <div className="card p-0 overflow-hidden">
        {isLoading && merged.length === 0 ? (
          <div className="text-center text-slate-500 py-10">Wird geladen …</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-slate-500 py-10">Kein Begriff gefunden.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((e, idx) => {
              const letter = e.term.charAt(0).toUpperCase();
              const showLetter =
                idx === 0 || filtered[idx - 1].term.charAt(0).toUpperCase() !== letter;
              const key = e.custom ? `c-${e.custom.id}` : `b-${e.term}`;
              const isOpen = expanded === e.term;
              const isCustom = !!e.custom;
              return (
                <li key={key}>
                  {showLetter && (
                    <div className="bg-slate-50 px-4 py-1.5 text-sm font-bold text-brand-700">
                      {letter}
                    </div>
                  )}
                  <div className="hover:bg-slate-50">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : e.term)}
                      className="w-full text-left px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-900 flex items-center gap-2">
                          {e.term}
                          {isCustom && (
                            <span className="inline-block rounded-full bg-brand-100 text-brand-700 text-[10px] font-semibold px-2 py-0.5 align-middle">
                              EIGEN
                            </span>
                          )}
                        </span>
                        <span className="text-slate-400 text-xs">{isOpen ? "▲" : "▼"}</span>
                      </div>
                      {isOpen && (
                        <p className="mt-2 text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                          {e.definition}
                        </p>
                      )}
                    </button>
                    {isOpen && isCustom && e.custom && (
                      <div className="px-4 pb-3 flex gap-3">
                        <button
                          type="button"
                          className="text-xs text-brand-700 hover:underline"
                          onClick={() => {
                            startEdit({
                              id: e.custom!.id,
                              term: e.term,
                              definition: e.definition,
                            });
                          }}
                        >
                          Bearbeiten
                        </button>
                        <button
                          type="button"
                          className="text-xs text-red-600 hover:underline"
                          onClick={() => {
                            if (confirm(`Eintrag "${e.term}" löschen?`)) {
                              deleteMut.mutate(e.custom!.id);
                              setExpanded(null);
                            }
                          }}
                        >
                          Eintrag löschen
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
