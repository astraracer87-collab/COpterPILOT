type Details = {
  firstName: string;
  lastName: string;
  identificationNumber: string;
  expirationDate: string;
  country?: string;
};

type Props = {
  pilotName: string;
  pilotId: string;
  operatorId: string;
  licenseA1A3: boolean;
  licenseA2: boolean;
  a1a3?: Details | null;
  a2?: Details | null;
  photoUrl?: string | null;
};

export default function LicenseCard({ pilotName, pilotId, operatorId, licenseA1A3, licenseA2, a1a3, a2, photoUrl }: Props) {
  return (
    <div className="w-full max-w-md mx-auto">
      <div
        className="aspect-[1.586/1] rounded-2xl text-white shadow-xl relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, #1e3a8a 0%, #1e40af 50%, #2563eb 100%)",
        }}
      >
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -right-12 -top-12 w-48 h-48 rounded-full bg-white" />
          <div className="absolute -left-8 -bottom-8 w-32 h-32 rounded-full bg-white" />
        </div>

        <div className="relative h-full flex flex-col p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/70">
                Europäische Union
              </div>
              <div className="text-sm font-bold leading-tight">
                EU-Drohnenführerschein
              </div>
              <div className="text-[10px] text-white/70 mt-0.5">
                EASA / LBA
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              {/* EU stars */}
              <svg width="32" height="32" viewBox="0 0 32 32">
                <circle cx="16" cy="16" r="15" fill="#003399" />
                {Array.from({ length: 12 }).map((_, i) => {
                  const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
                  const x = 16 + Math.cos(a) * 10;
                  const y = 16 + Math.sin(a) * 10;
                  return (
                    <text
                      key={i}
                      x={x}
                      y={y + 1}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#FFCC00"
                      fontSize="6"
                    >
                      ★
                    </text>
                  );
                })}
              </svg>
            </div>
          </div>

          <div className="mt-3 flex-1 flex gap-3">
            <div className="shrink-0">
              <div className="w-16 h-20 rounded-md overflow-hidden bg-white/15 border border-white/30 grid place-items-center">
                {photoUrl ? (
                  <img src={photoUrl} alt="Pilotenfoto" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[9px] text-white/60 text-center px-1">Kein Foto</span>
                )}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-white/60 uppercase tracking-wider">
                Pilot
              </div>
              <div className="text-base font-semibold leading-tight truncate">
                {pilotName || "—"}
              </div>

              <div className="grid grid-cols-1 gap-y-1.5 mt-2 text-[11px]">
                <div>
                  <div className="text-white/60 uppercase text-[9px]">Pilot-ID</div>
                  <div className="font-mono truncate">{pilotId || "—"}</div>
                </div>
                <div>
                  <div className="text-white/60 uppercase text-[9px]">Betreiber-ID</div>
                  <div className="font-mono truncate">{operatorId || "—"}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-end justify-between gap-2">
            <div className="flex gap-1.5 flex-wrap">
              {licenseA1A3 && (
                <div className="bg-white/20 backdrop-blur rounded-md px-2 py-1">
                  <div className="text-[8px] uppercase text-white/70">Kategorie</div>
                  <div className="text-xs font-bold">A1 / A3</div>
                  {a1a3?.expirationDate && (
                    <div className="text-[9px] text-white/70">
                      bis {a1a3.expirationDate}
                    </div>
                  )}
                </div>
              )}
              {licenseA2 && (
                <div className="bg-white/20 backdrop-blur rounded-md px-2 py-1">
                  <div className="text-[8px] uppercase text-white/70">Kategorie</div>
                  <div className="text-xs font-bold">A2</div>
                  {a2?.expirationDate && (
                    <div className="text-[9px] text-white/70">
                      bis {a2.expirationDate}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* QR-like decoration */}
            <div className="bg-white p-1 rounded">
              <div
                className="grid grid-cols-7 gap-px w-12 h-12"
                style={{ gridTemplateRows: "repeat(7, 1fr)" }}
              >
                {Array.from({ length: 49 }).map((_, i) => {
                  const seed = (i * 9301 + 49297) % 233280;
                  const on = seed % 2 === 0 || (i < 7 || i > 41 || i % 7 === 0 || i % 7 === 6);
                  return (
                    <div
                      key={i}
                      className={on ? "bg-slate-900" : "bg-white"}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center text-xs text-slate-500 mt-3">
        Digitale Repräsentation des EU-Kompetenznachweises (kein offizielles Dokument).
      </div>
    </div>
  );
}
