import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiJson } from "../lib/queryClient";
import LicenseCard from "../components/LicenseCard";
import PhotoCropper from "../components/PhotoCropper";

type Details = {
  firstName: string;
  lastName: string;
  identificationNumber: string;
  expirationDate: string;
  country?: string;
};

type PilotProfile = {
  id?: string;
  name: string;
  pilotId: string;
  operatorId: string;
  licenseA1A3: boolean;
  licenseA2: boolean;
  licenseSTS: boolean;
  licenseA1A3Details: Details | null;
  licenseA2Details: Details | null;
  photoUrl: string | null;
  insuranceActive: boolean;
  operatorRegistered: boolean;
};

const EMPTY: PilotProfile = {
  name: "",
  pilotId: "",
  operatorId: "",
  licenseA1A3: false,
  licenseA2: false,
  licenseSTS: false,
  licenseA1A3Details: null,
  licenseA2Details: null,
  photoUrl: null,
  insuranceActive: false,
  operatorRegistered: false,
};

const EMPTY_DETAILS: Details = {
  firstName: "",
  lastName: "",
  identificationNumber: "",
  expirationDate: "",
  country: "DE",
};

export default function Profile() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<PilotProfile | null>({ queryKey: ["/api/profile"] });
  const [form, setForm] = useState<PilotProfile>(EMPTY);
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setForm({ ...EMPTY, ...data });
  }, [data]);

  const save = useMutation({
    mutationFn: (p: PilotProfile) => apiJson("POST", "/api/profile", p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/profile"] }),
  });

  const photoMutation = useMutation<Pick<PilotProfile, "photoUrl">, Error, string | null>({
    mutationFn: (photoUrl) =>
      apiJson<Pick<PilotProfile, "photoUrl">>("POST", "/api/profile/photo", { photoUrl }),
    onSuccess: (saved) => {
      setForm((f) => ({ ...f, photoUrl: saved?.photoUrl ?? null }));
      qc.invalidateQueries({ queryKey: ["/api/profile"] });
    },
    onError: (e) => setPhotoError(e.message),
  });

  function onPhotoChange(e: ChangeEvent<HTMLInputElement>) {
    setPhotoError(null);
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Bitte eine Bilddatei auswählen.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setPhotoError("Datei konnte nicht gelesen werden");
    reader.onload = () => {
      if (typeof reader.result === "string") setPendingPhoto(reader.result);
    };
    reader.readAsDataURL(file);
  }

  function removePhoto() {
    setPhotoError(null);
    photoMutation.mutate(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate(form);
  }

  function setDetails(field: "licenseA1A3Details" | "licenseA2Details", patch: Partial<Details>) {
    setForm((f) => ({
      ...f,
      [field]: { ...EMPTY_DETAILS, ...(f[field] || {}), ...patch },
    }));
  }

  if (isLoading) return <div className="text-center text-slate-500 py-10">Lädt …</div>;

  return (
    <div className="space-y-6">
      {pendingPhoto && (
        <PhotoCropper
          src={pendingPhoto}
          onCancel={() => setPendingPhoto(null)}
          onConfirm={(dataUrl) => {
            setPendingPhoto(null);
            photoMutation.mutate(dataUrl);
          }}
        />
      )}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="size-16 rounded-full overflow-hidden bg-slate-200 grid place-items-center border border-slate-300">
            {form.photoUrl ? (
              <img src={form.photoUrl} alt="Pilotenfoto" className="w-full h-full object-cover" />
            ) : (
              <span className="text-[10px] text-slate-500 text-center px-1">Kein Foto</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <LicenseCard
            pilotName={form.name}
            pilotId={form.pilotId}
            operatorId={form.operatorId}
            licenseA1A3={form.licenseA1A3}
            licenseA2={form.licenseA2}
            a1a3={form.licenseA1A3Details}
            a2={form.licenseA2Details}
            photoUrl={form.photoUrl}
          />
          <div className="mt-4 space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Pilotenfoto</h3>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onPhotoChange}
                className="hidden"
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={photoMutation.isPending}
              >
                {photoMutation.isPending
                  ? "Lädt …"
                  : form.photoUrl
                    ? "Foto ändern"
                    : "Foto hochladen"}
              </button>
              {form.photoUrl ? (
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  onClick={removePhoto}
                  disabled={photoMutation.isPending}
                >
                  Entfernen
                </button>
              ) : null}
            </div>
            <p className="text-[11px] text-slate-500">
              JPG, PNG oder WebP. Nach der Auswahl kannst du den 2:3-Bildausschnitt wählen.
            </p>
            {photoError ? <div className="text-sm text-red-600">{photoError}</div> : null}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <Status label="Versicherung aktiv" ok={form.insuranceActive} />
            <Status label="Betreiber registriert (e-ID)" ok={form.operatorRegistered} />
          </div>
        </div>

        <form onSubmit={submit} className="card space-y-4">
          <h2 className="font-semibold text-slate-900">Stammdaten</h2>
          <div>
            <label className="label">Pilotenname</label>
            <input className="input" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Max Mustermann" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Pilot-ID</label>
              <input className="input" value={form.pilotId}
                onChange={(e) => setForm({ ...form, pilotId: e.target.value })} placeholder="DEU-RP-..." />
            </div>
            <div>
              <label className="label">Betreiber-ID (e-ID)</label>
              <input className="input" value={form.operatorId}
                onChange={(e) => setForm({ ...form, operatorId: e.target.value })} placeholder="DEUxxxxxxxxxxxxx" />
            </div>
          </div>

          <h2 className="font-semibold text-slate-900 pt-2">Lizenzen</h2>
          <div className="space-y-2">
            <CheckRow label="A1/A3 Online-Test" checked={form.licenseA1A3}
              onChange={(v) => setForm({ ...form, licenseA1A3: v })} />
            {form.licenseA1A3 && (
              <DetailFields details={form.licenseA1A3Details}
                onChange={(p) => setDetails("licenseA1A3Details", p)} />
            )}
            <CheckRow label="A2 Fernpilotenzeugnis" checked={form.licenseA2}
              onChange={(v) => setForm({ ...form, licenseA2: v })} />
            {form.licenseA2 && (
              <DetailFields details={form.licenseA2Details}
                onChange={(p) => setDetails("licenseA2Details", p)} />
            )}
            <CheckRow label="STS / Specific" checked={form.licenseSTS}
              onChange={(v) => setForm({ ...form, licenseSTS: v })} />
          </div>

          <h2 className="font-semibold text-slate-900 pt-2">Status</h2>
          <CheckRow label="Haftpflichtversicherung aktiv" checked={form.insuranceActive}
            onChange={(v) => setForm({ ...form, insuranceActive: v })} />
          <CheckRow label="Betreiber beim LBA registriert" checked={form.operatorRegistered}
            onChange={(v) => setForm({ ...form, operatorRegistered: v })} />

          {save.error ? (
            <div className="text-sm text-red-600">{(save.error as Error).message}</div>
          ) : null}
          {save.isSuccess ? (
            <div className="text-sm text-green-700">Gespeichert.</div>
          ) : null}

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={save.isPending} className="btn-primary flex-1">
              {save.isPending ? "Speichert …" : "Speichern"}
            </button>
            <Link to="/drohnen" className="btn-secondary">Zu Drohnen</Link>
          </div>
        </form>
      </div>
    </div>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Status({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={`rounded-md px-2 py-1.5 ${ok ? "bg-green-50 text-green-700" : "bg-slate-50 text-slate-500"}`}>
      <div className="text-[10px] uppercase font-semibold">{label}</div>
      <div className="font-medium">{ok ? "Ja" : "Nein"}</div>
    </div>
  );
}

function DetailFields({ details, onChange }: { details: Details | null; onChange: (p: Partial<Details>) => void }) {
  const d = details || EMPTY_DETAILS;
  return (
    <div className="ml-6 grid grid-cols-2 gap-2 pb-2">
      <input className="input text-xs" placeholder="Vorname" value={d.firstName}
        onChange={(e) => onChange({ firstName: e.target.value })} />
      <input className="input text-xs" placeholder="Nachname" value={d.lastName}
        onChange={(e) => onChange({ lastName: e.target.value })} />
      <input className="input text-xs" placeholder="Nachweis-Nr." value={d.identificationNumber}
        onChange={(e) => onChange({ identificationNumber: e.target.value })} />
      <input className="input text-xs" placeholder="Gültig bis (TT.MM.JJJJ)" value={d.expirationDate}
        onChange={(e) => onChange({ expirationDate: e.target.value })} />
    </div>
  );
}
