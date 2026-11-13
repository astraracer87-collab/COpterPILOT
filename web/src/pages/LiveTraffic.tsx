import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import LiveTrafficRadar from "../components/LiveTrafficRadar";
import { apiRequest } from "../lib/queryClient";
import { getTrafficLog, clearTrafficLog } from "../lib/proximityAlarm";

type Drone = { id: string; name: string; classMark: string };

type LocSource = "gps" | "manual";

const LAST_LOC_KEY = "copterpilot.web.radar.lastLocation";

interface SavedLocation {
  latitude: number;
  longitude: number;
  name?: string;
  source: LocSource;
}

function loadSavedLocation(): SavedLocation | null {
  try {
    const raw = localStorage.getItem(LAST_LOC_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.latitude === "number" && typeof v?.longitude === "number") return v;
    return null;
  } catch {
    return null;
  }
}

function saveLocation(loc: SavedLocation) {
  try {
    localStorage.setItem(LAST_LOC_KEY, JSON.stringify(loc));
  } catch {}
}

export default function LiveTraffic() {
  const saved = loadSavedLocation();
  const [latitude, setLatitude] = useState<number | null>(saved?.latitude ?? null);
  const [longitude, setLongitude] = useState<number | null>(saved?.longitude ?? null);
  const [locationName, setLocationName] = useState<string | undefined>(saved?.name);
  const [locSource, setLocSource] = useState<LocSource>(saved?.source ?? "gps");
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [latInput, setLatInput] = useState(saved?.latitude?.toString() ?? "");
  const [lonInput, setLonInput] = useState(saved?.longitude?.toString() ?? "");
  const [nameInput, setNameInput] = useState(saved?.name ?? "");

  const requestGps = () => {
    if (!("geolocation" in navigator)) {
      setGpsError("Geolokalisierung wird vom Browser nicht unterstützt.");
      return;
    }
    setGpsBusy(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        setLatitude(lat);
        setLongitude(lon);
        setLocationName(undefined);
        setLocSource("gps");
        setGpsBusy(false);
        saveLocation({ latitude: lat, longitude: lon, source: "gps" });
      },
      (err) => {
        setGpsBusy(false);
        setGpsError(err.message || "Standort konnte nicht ermittelt werden.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };

  useEffect(() => {
    if (latitude == null || longitude == null) {
      requestGps();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      setGpsError("Bitte gültige Koordinaten eingeben.");
      return;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setGpsError("Koordinaten außerhalb des gültigen Bereichs.");
      return;
    }
    setGpsError(null);
    setLatitude(lat);
    setLongitude(lon);
    setLocationName(nameInput.trim() || undefined);
    setLocSource("manual");
    saveLocation({ latitude: lat, longitude: lon, name: nameInput.trim() || undefined, source: "manual" });
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center gap-2 mb-3 text-sm">
          <button
            type="button"
            onClick={requestGps}
            disabled={gpsBusy}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {gpsBusy ? "Suche Standort …" : "Aktueller Standort (GPS)"}
          </button>
          <span className="text-slate-400 text-xs">oder manuell eingeben:</span>
        </div>

        <form className="grid grid-cols-1 sm:grid-cols-4 gap-2" onSubmit={submitManual}>
          <input
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="Breite (z.B. 51.16)"
            value={latInput}
            onChange={(e) => setLatInput(e.target.value)}
          />
          <input
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="Länge (z.B. 10.45)"
            value={lonInput}
            onChange={(e) => setLonInput(e.target.value)}
          />
          <input
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="Bezeichnung (optional)"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <button
            type="submit"
            className="rounded-md bg-slate-200 hover:bg-slate-300 text-sm font-medium px-3 py-1.5 text-slate-700"
          >
            Position übernehmen
          </button>
        </form>

        {gpsError && (
          <p className="mt-2 text-xs text-red-600 bg-red-50 rounded px-2 py-1">{gpsError}</p>
        )}

        {latitude != null && longitude != null && (
          <p className="mt-2 text-xs text-slate-500">
            Quelle: {locSource === "gps" ? "GPS" : "Manuell"} · {latitude.toFixed(4)},{" "}
            {longitude.toFixed(4)}
          </p>
        )}
      </div>

      {latitude != null && longitude != null ? (
        <>
          <LiveTrafficRadar
            latitude={latitude}
            longitude={longitude}
            locationName={locationName}
            fetchRadiusKm={25}
            onLocationChange={(lat, lon) => {
              setLatitude(lat);
              setLongitude(lon);
              setLocationName(undefined);
              setLocSource("manual");
              setLatInput(lat.toFixed(5));
              setLonInput(lon.toFixed(5));
              setNameInput("");
              saveLocation({ latitude: lat, longitude: lon, source: "manual" });
            }}
          />
          <SaveAsLogbookEntry latitude={latitude} longitude={longitude} locationName={locationName} />
        </>
      ) : (
        <div className="card text-center py-8 text-sm text-slate-500">
          Bitte Standort freigeben oder manuell eingeben, um den Verkehrsradar zu starten.
        </div>
      )}
    </div>
  );
}

function SaveAsLogbookEntry({
  latitude,
  longitude,
  locationName,
}: {
  latitude: number;
  longitude: number;
  locationName?: string;
}) {
  const queryClient = useQueryClient();
  const { data: drones = [] } = useQuery<Drone[]>({ queryKey: ["/api/drones"] });
  const [droneId, setDroneId] = useState<string>("");
  const [flightDate, setFlightDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState<string>("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [logCount, setLogCount] = useState<number>(() => getTrafficLog().length);

  useEffect(() => {
    const id = setInterval(() => setLogCount(getTrafficLog().length), 2000);
    return () => clearInterval(id);
  }, []);

  const mutation = useMutation({
    mutationFn: async () => {
      const drone = drones.find((d) => d.id === droneId);
      if (!drone) throw new Error("Bitte eine Drohne auswählen.");
      const trafficLog = getTrafficLog();
      const sessionId = `radar-${Date.now()}`;
      const body = {
        sessionId,
        droneId: drone.id,
        droneName: drone.name,
        droneClass: drone.classMark,
        flightDate,
        locationName: locationName ?? null,
        latitude,
        longitude,
        notes: notes.trim() || null,
        trafficLog,
        status: "completed",
      };
      return apiRequest("POST", "/api/logbook", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/logbook"] });
      setFeedback(`Logbucheintrag mit ${logCount} Verkehrs-Annäherung${logCount === 1 ? "" : "en"} gespeichert.`);
      clearTrafficLog();
      setLogCount(0);
      setNotes("");
    },
    onError: (e: any) => setFeedback(e?.message || "Speichern fehlgeschlagen."),
  });

  return (
    <div className="card">
      <div className="font-semibold text-slate-700 text-sm mb-2">
        Verkehrs-Log als Logbucheintrag speichern
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Übernimmt die {logCount} aktuell erfasste{logCount === 1 ? "" : "n"} Annäherung
        {logCount === 1 ? "" : "en"} in einen neuen Logbucheintrag und leert anschließend das Log.
      </p>
      <form
        className="grid grid-cols-1 sm:grid-cols-3 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <select
          value={droneId}
          onChange={(e) => setDroneId(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          required
        >
          <option value="">Drohne wählen …</option>
          {drones.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.classMark})
            </option>
          ))}
        </select>
        <input
          type="date"
          value={flightDate}
          onChange={(e) => setFlightDate(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          required
        />
        <input
          type="text"
          placeholder="Notizen (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={mutation.isPending || !droneId || drones.length === 0 || logCount === 0}
          className="sm:col-span-3 mt-1 rounded-md bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-3 py-2 disabled:opacity-50"
        >
          {mutation.isPending ? "Speichere …" : "Als Logbucheintrag speichern"}
        </button>
      </form>
      {drones.length === 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-2">
          Lege zuerst eine Drohne an, um Logbucheinträge zu speichern.
        </p>
      )}
      {feedback && (
        <p className={`text-xs mt-2 rounded px-2 py-1 ${
          mutation.isError ? "text-red-700 bg-red-50" : "text-green-700 bg-green-50"
        }`}>
          {feedback}
        </p>
      )}
    </div>
  );
}
