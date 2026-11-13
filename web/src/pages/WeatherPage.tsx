import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchBrightSky,
  fetchDipulWeather,
  fetchKpIndex,
  geocodeSearch,
  reverseGeocode,
  classifyValue,
  estimateCloudCeiling,
  DEFAULT_LIMITS,
  type AssessmentLevel,
  type WeatherLimits,
  type GeocodeResult,
  type DipulResponse,
  type DipulForecast,
  type DipulWindAtHeight,
} from "../lib/external";

type SettingsResponse = { limits?: Partial<WeatherLimits>; weatherLimits?: Partial<WeatherLimits> } | null;

const COLORS: Record<AssessmentLevel, { bg: string; text: string; label: string }> = {
  go: { bg: "bg-emerald-100", text: "text-emerald-800", label: "GO" },
  caution: { bg: "bg-amber-100", text: "text-amber-800", label: "ACHTUNG" },
  nogo: { bg: "bg-red-100", text: "text-red-800", label: "NO-GO" },
};

const STORAGE_KEY = "copter.weather.point.v1";

function loadPoint(): { lat: number; lon: number; label?: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export default function WeatherPage() {
  const [point, setPoint] = useState<{ lat: number; lon: number; label?: string } | null>(() => loadPoint());
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (point) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(point));
      } catch {}
    }
  }, [point]);

  const { data: settings } = useQuery<SettingsResponse>({ queryKey: ["/api/settings"] });
  const limits: WeatherLimits = useMemo(
    () => ({ ...DEFAULT_LIMITS, ...(settings?.limits || settings?.weatherLimits || {}) }),
    [settings]
  );

  const brightsky = useQuery({
    queryKey: ["brightsky", point?.lat, point?.lon],
    queryFn: () => fetchBrightSky(point!.lat, point!.lon),
    enabled: !!point,
    staleTime: 10 * 60_000,
  });

  const dipul = useQuery({
    queryKey: ["dipul", point?.lat, point?.lon],
    queryFn: () => fetchDipulWeather(point!.lat, point!.lon),
    enabled: !!point,
    staleTime: 10 * 60_000,
  });

  const kp = useQuery({ queryKey: ["kp"], queryFn: () => fetchKpIndex(), staleTime: 10 * 60_000 });

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;
    setSearching(true);
    try {
      const r = await geocodeSearch(search.trim());
      setResults(r);
      if (r[0]) {
        const lat = parseFloat(r[0].lat);
        const lon = parseFloat(r[0].lon);
        setPoint({ lat, lon, label: r[0].display_name });
      }
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function locateMe() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        try {
          const r = await reverseGeocode(lat, lon);
          setPoint({ lat, lon, label: r.display_name });
        } catch {
          setPoint({ lat, lon });
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  const current = brightsky.data?.weather?.find((w) => {
    const t = new Date(w.timestamp).getTime();
    const now = Date.now();
    return t <= now && t > now - 3600_000;
  }) || brightsky.data?.weather?.[0];

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="card flex flex-col sm:flex-row gap-2">
        <input
          className="input"
          placeholder="Standort suchen …"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-weather-search"
        />
        <button type="submit" className="btn-primary" disabled={searching} data-testid="button-weather-search">
          {searching ? "Suche …" : "Suchen"}
        </button>
        <button type="button" className="btn-secondary" onClick={locateMe} data-testid="button-weather-locate">
          Mein Standort
        </button>
      </form>

      {results.length > 1 && (
        <div className="card">
          <div className="text-sm font-semibold mb-2">Treffer</div>
          <ul className="divide-y divide-slate-100">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  className="w-full text-left py-2 text-sm hover:bg-slate-50"
                  onClick={() => {
                    setPoint({ lat: parseFloat(r.lat), lon: parseFloat(r.lon), label: r.display_name });
                    setResults([]);
                    setSearch(r.display_name);
                  }}
                >
                  {r.display_name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!point ? (
        <div className="card text-center text-slate-500 py-10">
          Wähle einen Standort, um Wetterdaten anzuzeigen.
        </div>
      ) : (
        <>
          <div className="card">
            <div className="text-xs uppercase text-slate-500 font-semibold tracking-wide">Standort</div>
            <div className="font-medium text-slate-900" data-testid="text-weather-location">
              {point.label || `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card">
              <div className="font-semibold mb-3">Aktuelles Wetter (DWD)</div>
              {brightsky.isLoading && <div className="text-sm text-slate-500">Lade Wetterdaten …</div>}
              {brightsky.isError && (
                <div className="text-sm text-red-700">{(brightsky.error as Error).message}</div>
              )}
              {current && (
                <div className="grid grid-cols-2 gap-3">
                  <Metric
                    label="Wind"
                    value={current.wind_speed != null ? `${current.wind_speed.toFixed(1)} m/s` : "–"}
                    level={classifyValue(current.wind_speed ?? undefined, limits.maxWind, "max")}
                  />
                  <Metric
                    label="Böen"
                    value={current.wind_gust_speed != null ? `${current.wind_gust_speed.toFixed(1)} m/s` : "–"}
                    level={classifyValue(current.wind_gust_speed ?? undefined, limits.maxGusts, "max")}
                  />
                  <Metric
                    label="Niederschlag"
                    value={current.precipitation != null ? `${current.precipitation.toFixed(1)} mm/h` : "–"}
                    level={classifyValue(current.precipitation ?? undefined, limits.maxRain, "max")}
                  />
                  <Metric
                    label="Temperatur"
                    value={current.temperature != null ? `${current.temperature.toFixed(1)} °C` : "–"}
                    level={classifyValue(current.temperature ?? undefined, limits.minTemp, "min")}
                  />
                  <Metric
                    label="Sicht"
                    value={current.visibility != null ? `${(current.visibility / 1000).toFixed(1)} km` : "–"}
                    level={classifyValue(current.visibility ?? undefined, limits.minVisibility, "min")}
                  />
                  <Metric
                    label="Bewölkung"
                    value={current.cloud_cover != null ? `${current.cloud_cover.toFixed(0)} %` : "–"}
                    level="go"
                  />
                  {(() => {
                    const ceiling = estimateCloudCeiling(current.temperature, current.dew_point);
                    return (
                      <Metric
                        label="Wolkenbasis (geschätzt)"
                        value={ceiling != null ? `${ceiling.toFixed(0)} m` : "–"}
                        level={classifyValue(ceiling ?? undefined, limits.minCloudCeiling, "min")}
                      />
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="card">
              <div className="font-semibold mb-3">KP-Index (NOAA)</div>
              {kp.isLoading && <div className="text-sm text-slate-500">Lade …</div>}
              {kp.isError && <div className="text-sm text-red-700">KP-Index nicht verfügbar</div>}
              {kp.data && (
                <div className="space-y-2">
                  <div>
                    <div className="text-xs text-slate-500">Aktuell</div>
                    <div
                      className={`text-3xl font-bold ${
                        (kp.data.current ?? 0) >= 5
                          ? "text-red-600"
                          : (kp.data.current ?? 0) >= 4
                          ? "text-amber-600"
                          : "text-emerald-600"
                      }`}
                      data-testid="text-kp-current"
                    >
                      {kp.data.current?.toFixed(2) ?? "–"}
                    </div>
                  </div>
                  <div className="text-xs text-slate-600">
                    {(kp.data.current ?? 0) >= 5
                      ? "Geomagnetischer Sturm — GPS- und Kompass-Einschränkungen möglich."
                      : (kp.data.current ?? 0) >= 4
                      ? "Erhöhte Aktivität — Drohnen-Sensorik beobachten."
                      : "Ruhig — keine Auswirkungen erwartet."}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="font-semibold mb-3">Höhenwind (DFS Dipul)</div>
            {dipul.isLoading && <div className="text-sm text-slate-500">Lade Höhenwind …</div>}
            {dipul.isError && (
              <div className="text-sm text-red-700">{(dipul.error as Error).message}</div>
            )}
            {dipul.data && (
              <div className="overflow-x-auto">
                <DipulTable data={dipul.data} limits={limits} />
              </div>
            )}
          </div>

          <div className="card">
            <div className="font-semibold mb-3">Stundenprognose (24 h)</div>
            {brightsky.data && (
              <div className="overflow-x-auto">
                <table className="text-sm w-full min-w-[700px]">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="text-left py-2 pr-2">Zeit</th>
                      <th className="text-right px-2">Wind m/s</th>
                      <th className="text-right px-2">Böen m/s</th>
                      <th className="text-right px-2">Regen mm</th>
                      <th className="text-right px-2">Temp °C</th>
                      <th className="text-right px-2">Sicht km</th>
                      <th className="text-right px-2">Bewölkung %</th>
                      <th className="text-right pl-2">Wolkenbasis m</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const nowTs = Date.now();
                      return brightsky.data.weather
                        .filter((h) => {
                          const t = Date.parse(h.timestamp);
                          return !isNaN(t) && t >= nowTs - 60 * 60 * 1000;
                        })
                        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
                        .slice(0, 24);
                    })().map((h) => {
                      const ceiling = estimateCloudCeiling(h.temperature, h.dew_point);
                      return (
                        <tr key={h.timestamp} className="border-t border-slate-100">
                          <td className="py-1.5 pr-2">
                            {new Date(h.timestamp).toLocaleString("de-DE", {
                              hour: "2-digit",
                              minute: "2-digit",
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </td>
                          <Cell value={h.wind_speed} unit="" decimals={1} level={classifyValue(h.wind_speed ?? undefined, limits.maxWind, "max")} />
                          <Cell value={h.wind_gust_speed} unit="" decimals={1} level={classifyValue(h.wind_gust_speed ?? undefined, limits.maxGusts, "max")} />
                          <Cell value={h.precipitation} unit="" decimals={1} level={classifyValue(h.precipitation ?? undefined, limits.maxRain, "max")} />
                          <Cell value={h.temperature} unit="" decimals={1} level={classifyValue(h.temperature ?? undefined, limits.minTemp, "min")} />
                          <Cell value={h.visibility != null ? h.visibility / 1000 : null} unit="" decimals={1} level={classifyValue(h.visibility ?? undefined, limits.minVisibility, "min")} />
                          <Cell value={h.cloud_cover} unit="" decimals={0} level="go" />
                          <Cell value={ceiling} unit="" decimals={0} level={classifyValue(ceiling ?? undefined, limits.minCloudCeiling, "min")} />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, level }: { label: string; value: string; level: AssessmentLevel }) {
  const c = COLORS[level];
  return (
    <div className={`rounded-lg ${c.bg} ${c.text} p-3`}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="font-semibold text-base mt-1">{value}</div>
      <div className="text-[10px] uppercase font-bold tracking-wider opacity-80 mt-1">{c.label}</div>
    </div>
  );
}

function Cell({
  value,
  unit,
  decimals,
  level,
}: {
  value: number | null | undefined;
  unit: string;
  decimals: number;
  level: AssessmentLevel;
}) {
  const c = COLORS[level];
  return (
    <td className={`text-right px-2 py-1.5 font-medium ${c.text}`}>
      {value == null ? "–" : `${value.toFixed(decimals)}${unit}`}
    </td>
  );
}

function windSpeed(w: DipulWindAtHeight): number | null {
  if (typeof w.value === "number") return w.value;
  if (typeof w.uComponent === "number" && typeof w.vComponent === "number") {
    return Math.sqrt(w.uComponent ** 2 + w.vComponent ** 2);
  }
  return null;
}

function DipulTable({ data, limits }: { data: DipulResponse; limits: WeatherLimits }) {
  const pos = data?.positions?.[0];
  const allForecasts: DipulForecast[] = pos?.forecasts || [];
  const now = Date.now();
  const forecasts = allForecasts
    .filter((f) => {
      const t = Date.parse(f.timestamp);
      return !isNaN(t) && t >= now - 60 * 60 * 1000;
    })
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(0, 24);
  if (forecasts.length === 0) return <div className="text-sm text-slate-500">Keine Daten</div>;
  const HEIGHTS = [10, 50, 80, 100, 150];
  return (
    <table className="text-sm w-full min-w-[600px]">
      <thead className="text-xs text-slate-500">
        <tr>
          <th className="text-left py-2 pr-2">Zeit</th>
          {HEIGHTS.map((h) => (
            <th key={h} className="text-right px-2">
              Wind {h} m
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {forecasts.map((f) => (
          <tr key={f.timestamp} className="border-t border-slate-100">
            <td className="py-1.5 pr-2">
              {new Date(f.timestamp).toLocaleString("de-DE", {
                hour: "2-digit",
                minute: "2-digit",
                day: "2-digit",
                month: "2-digit",
              })}
            </td>
            {HEIGHTS.map((h) => {
              const w = (f.wind || []).find((x) => x.height?.value === h);
              const speed = w ? windSpeed(w) : null;
              return (
                <Cell
                  key={h}
                  value={speed}
                  unit=" m/s"
                  decimals={1}
                  level={classifyValue(speed ?? undefined, limits.maxWind, "max")}
                />
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
