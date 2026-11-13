import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LAYER_GROUPS, type WmsLayer } from "../lib/geozoneLayers";
import { fetchNotams, geocodeSearch, reverseGeocode, type GeocodeResult } from "../lib/external";

const EXTERNAL_MAPS = [
  { id: "dipul", label: "DFS Dipul (DE)", url: "https://maptool-dipul.dfs.de/" },
  { id: "geoportail-lu", label: "Geoportail (LU)", url: "https://drones.geoportail.lu/" },
  { id: "swissdrones", label: "BAZL Karte (CH)", url: "https://map.geo.admin.ch/?topic=aviation&layers=ch.bazl.einschraenkungen-drohnen" },
] as const;
type TabId = "interactive" | (typeof EXTERNAL_MAPS)[number]["id"];

// Fix default marker icons (Leaflet expects asset URLs from a CDN by default)
const ICON_URL = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png";
const ICON_RETINA = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png";
const SHADOW_URL = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png";
const DefaultIcon = L.icon({
  iconRetinaUrl: ICON_RETINA,
  iconUrl: ICON_URL,
  shadowUrl: SHADOW_URL,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

const DEFAULT_CENTER: [number, number] = [50.5, 9.0];
const DEFAULT_ZOOM = 6;
const STORAGE_KEY = "copter.map.layers.v1";

// Geozonen-Overlays werden erst ab dieser Zoomstufe geladen — verhindert
// dass auf Übersichtsebenen tausende Tiles gleichzeitig vom WMS angefordert
// werden (Browser-OOM / Crash beim Heraus- und Hineinzoomen).
const WMS_MIN_ZOOM = 9;
const WMS_MAX_ZOOM = 18;

// Begrenzt das Pan-Gebiet grob auf D-A-CH + Benelux, damit beim Wegscrollen
// nicht endlos Tiles nachgeladen werden.
const MAP_BOUNDS: L.LatLngBoundsExpression = [
  [45.5, 4.0],
  [55.5, 16.5],
];

const EXTRA_DEFAULTS: Record<string, boolean> = { de_lfa: true };

function loadEnabled(): Record<string, boolean> {
  const defaults: Record<string, boolean> = { ...EXTRA_DEFAULTS };
  for (const g of LAYER_GROUPS) for (const l of g.layers) if (l.defaultEnabled) defaults[l.id] = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, boolean>;
      // Defaults nur ergänzen, falls der Layer-Schlüssel noch nie gespeichert
      // wurde (Bestandsuser bekommen so neue Default-ON-Layer wie LFA dazu).
      for (const [k, v] of Object.entries(defaults)) {
        if (!(k in saved)) saved[k] = v;
      }
      return saved;
    }
  } catch {}
  return defaults;
}

export default function MapPage() {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wmsLayersRef = useRef<Record<string, L.TileLayer.WMS>>({});
  const markerRef = useRef<L.Marker | null>(null);
  const notamLayerRef = useRef<L.LayerGroup | null>(null);
  const lfaLayerRef = useRef<L.LayerGroup | null>(null);

  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => loadEnabled());
  const [point, setPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [address, setAddress] = useState<string>("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("interactive");
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      minZoom: 5,
      maxZoom: 18,
      maxBounds: MAP_BOUNDS,
      maxBoundsViscosity: 1.0,
      worldCopyJump: false,
    });
    // Subtiler, weniger bunter Basemap-Stil (CartoDB Positron). Fällt bei
    // Ausfall stillschweigend auf OSM zurück.
    const baseLayer = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          "© OpenStreetMap-Mitwirkende · © CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      }
    );
    baseLayer.on("tileerror", () => {
      // Fallback auf OSM, falls Carto-Tiles nicht erreichbar sind.
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap-Mitwirkende",
        maxZoom: 19,
      }).addTo(map);
    });
    baseLayer.addTo(map);
    notamLayerRef.current = L.layerGroup().addTo(map);
    lfaLayerRef.current = L.layerGroup().addTo(map);
    map.on("click", async (e) => {
      const { lat, lng } = e.latlng;
      setPoint({ lat, lon: lng });
      await showFeatureInfoPopup(map, e.latlng, e.containerPoint, enabledRef.current);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync enabled WMS overlays to map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const all = LAYER_GROUPS.flatMap((g) => g.layers);
    for (const layer of all) {
      const isOn = !!enabled[layer.id];
      const existing = wmsLayersRef.current[layer.id];
      if (isOn && !existing) {
        const wms = L.tileLayer.wms(layer.baseUrl, {
          layers: layer.layer,
          format: layer.format || "image/png",
          version: layer.version || "1.3.0",
          transparent: true,
          opacity: 0.7,
          attribution: layer.label,
          minZoom: WMS_MIN_ZOOM,
          maxZoom: WMS_MAX_ZOOM,
          updateWhenIdle: true,
          updateWhenZooming: false,
          keepBuffer: 1,
        });
        wms.on("tileerror", () => {
          // Einzelne Tile-Fehler stillschweigend ignorieren statt die ganze
          // Karte abstürzen zu lassen.
        });
        wms.addTo(map);
        wmsLayersRef.current[layer.id] = wms;
      } else if (!isOn && existing) {
        map.removeLayer(existing);
        delete wmsLayersRef.current[layer.id];
      }
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled));
    } catch {}
  }, [enabled]);

  // Marker for current point
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current) {
      map.removeLayer(markerRef.current);
      markerRef.current = null;
    }
    if (point) {
      markerRef.current = L.marker([point.lat, point.lon]).addTo(map);
    }
  }, [point]);

  // Reverse geocode + NOTAMs when point changes
  useEffect(() => {
    if (!point) return;
    let cancelled = false;
    setAddress("Lade Adresse …");
    reverseGeocode(point.lat, point.lon)
      .then((r) => {
        if (!cancelled) setAddress(r.display_name || `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`);
      })
      .catch(() => !cancelled && setAddress(`${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`));
    return () => {
      cancelled = true;
    };
  }, [point]);

  const notamsQuery = useQuery({
    queryKey: ["notams", point?.lat, point?.lon],
    queryFn: () => fetchNotams(point!.lat, point!.lon),
    enabled: !!point,
    staleTime: 5 * 60_000,
  });

  // LFA (Tieffluggebiete 250 ft) — wird nur geladen wenn der Layer aktiv ist
  const lfaQuery = useQuery<{ type: string; features: GeoJSON.Feature[] }>({
    queryKey: ["/api/lfa"],
    enabled: !!enabled["de_lfa"],
    staleTime: 60 * 60_000,
  });

  // Render LFA-Polygone als GeoJSON-Layer
  useEffect(() => {
    const layer = lfaLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!enabled["de_lfa"]) return;
    const fc = lfaQuery.data;
    if (!fc?.features?.length) return;
    const style = { color: "#7c3aed", weight: 1.5, fillColor: "#7c3aed", fillOpacity: 0.15 };
    L.geoJSON(fc as GeoJSON.FeatureCollection, {
      style: () => style,
      onEachFeature: (feat, lyr) => {
        const p = (feat.properties || {}) as { id?: string; name?: string; altitudeFt?: number };
        const html = `<div style="max-width:240px"><b>${escapeHtml(p.id || "LFA")}</b><br/><span style="font-size:12px;color:#475569">${escapeHtml(p.name || "")}</span><br/><span style="font-size:12px">Bundeswehr-Tiefflug GND — ${p.altitudeFt ?? 250} ft AGL (≈ ${Math.round((p.altitudeFt ?? 250) * 0.3048)} m)</span></div>`;
        lyr.bindPopup(html);
      },
    }).addTo(layer);
  }, [enabled, lfaQuery.data]);

  // Render NOTAM circles on map
  useEffect(() => {
    const layer = notamLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const rows = notamsQuery.data?.rows || [];
    for (const n of rows) {
      const popup = `<div style="max-width:260px"><b>${n.series || ""}${n.number || ""}/${n.year || ""}</b><br/><span style="font-size:12px;color:#475569">${(n.ItemQ || "").slice(0, 80)}</span><br/><span style="font-size:12px">${(n.ItemE || "").slice(0, 280)}</span></div>`;
      const style = { color: "#dc2626", weight: 2, fillColor: "#dc2626", fillOpacity: 0.28 };
      if (Array.isArray(n.points) && n.points.length >= 3) {
        L.polygon(n.points, style).bindPopup(popup).addTo(layer);
      } else if (n.lat != null && n.lon != null) {
        const radiusMeters = Math.max(((n.radius || 5) * 1852), 500);
        L.circle([n.lat, n.lon], { ...style, radius: radiusMeters }).bindPopup(popup).addTo(layer);
      }
    }
  }, [notamsQuery.data]);

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
        mapRef.current?.setView([lat, lon], 13);
        setPoint({ lat, lon });
      }
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function pickResult(r: GeocodeResult) {
    const lat = parseFloat(r.lat);
    const lon = parseFloat(r.lon);
    mapRef.current?.setView([lat, lon], 13);
    setPoint({ lat, lon });
    setResults([]);
    setSearch(r.display_name);
  }

  function locateMe() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        mapRef.current?.setView([lat, lon], 14);
        setPoint({ lat, lon });
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // Beim ersten Aufruf der Karten-Seite einmalig den aktuellen Standort
  // ermitteln. Schlägt fehl (keine Berechtigung, kein GPS), bleibt die
  // Standardansicht (Mitte Deutschland) – der Pilot kann jederzeit selbst
  // auf "Mein Standort" tippen oder eine Adresse suchen.
  const didAutoLocate = useRef(false);
  useEffect(() => {
    if (didAutoLocate.current) return;
    if (point) return; // bereits ein Punkt gesetzt (z.B. aus localStorage)
    didAutoLocate.current = true;
    locateMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Baut für die eingebetteten Fremd-Karten (Dipul, Geoportail, BAZL) eine
  // URL, die – sofern ein Punkt ausgewählt wurde – auf diesen Punkt zentriert.
  // Funktioniert per bekannten URL-Parametern; falls die Seite die Parameter
  // ignoriert, kann der Pilot zusätzlich den eingebauten "Mein Standort"-
  // Knopf der jeweiligen Karte nutzen (geolocation ist via `allow` freigegeben).
  function externalMapUrl(id: TabId, baseUrl: string): string {
    if (!point) return baseUrl;
    const lat = point.lat;
    const lon = point.lon;
    try {
      if (id === "dipul") {
        // Dipul akzeptiert lat/lon/zoom als Query-Parameter.
        return `${baseUrl}?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&zoom=14`;
      }
      if (id === "geoportail-lu") {
        // Geoportail Luxembourg nimmt X (lon) / Y (lat) als WGS84.
        return `${baseUrl}?zoom=14&X=${lon.toFixed(5)}&Y=${lat.toFixed(5)}`;
      }
      if (id === "swissdrones") {
        // map.geo.admin.ch akzeptiert WGS84 via crosshair=…&E=lon&N=lat
        // (intern wird nach LV95 umgerechnet, wenn die Werte im WGS84-Bereich
        // liegen).
        const sep = baseUrl.includes("?") ? "&" : "?";
        return `${baseUrl}${sep}E=${lon.toFixed(5)}&N=${lat.toFixed(5)}&zoom=10&crosshair=marker`;
      }
    } catch {}
    return baseUrl;
  }

  const enabledCount = useMemo(() => Object.values(enabled).filter(Boolean).length, [enabled]);

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="card flex flex-col sm:flex-row gap-2">
        <input
          className="input"
          placeholder="Adresse oder Ort suchen …"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-map-search"
        />
        <button type="submit" className="btn-primary" disabled={searching} data-testid="button-map-search">
          {searching ? "Suche …" : "Suchen"}
        </button>
        <button type="button" className="btn-secondary" onClick={locateMe} data-testid="button-map-locate">
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
                  onClick={() => pickResult(r)}
                  className="w-full text-left py-2 text-sm hover:bg-slate-50"
                >
                  {r.display_name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto" role="tablist">
        <TabButton id="interactive" active={activeTab} onSelect={setActiveTab}>
          Interaktive Karte
        </TabButton>
        {EXTERNAL_MAPS.map((m) => (
          <TabButton key={m.id} id={m.id} active={activeTab} onSelect={setActiveTab}>
            {m.label}
          </TabButton>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="card p-0 overflow-hidden">
          <div
            ref={containerRef}
            style={{ height: 560, width: "100%", display: activeTab === "interactive" ? "block" : "none" }}
            data-testid="map-container"
          />
          {EXTERNAL_MAPS.map((m) =>
            activeTab === m.id ? (
              <iframe
                // Key enthält Koordinaten, damit das iframe nach Klick auf
                // "Mein Standort" / Suche neu geladen wird und auf den
                // gewählten Punkt zentriert.
                key={`${m.id}-${point ? `${point.lat.toFixed(4)},${point.lon.toFixed(4)}` : "default"}`}
                src={externalMapUrl(m.id, m.url)}
                title={m.label}
                allow="geolocation; fullscreen"
                referrerPolicy="no-referrer-when-downgrade"
                style={{ height: 560, width: "100%", border: 0, display: "block" }}
                data-testid={`iframe-${m.id}`}
              />
            ) : null
          )}
        </div>
        <div className="space-y-4">
          <div className="card">
            <div className="font-semibold mb-1">Auswahlpunkt</div>
            {point ? (
              <>
                <div className="text-sm text-slate-700" data-testid="text-map-address">{address}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
                </div>
                <div className="text-xs text-slate-500 mt-2">
                  NOTAMs:{" "}
                  {notamsQuery.isLoading
                    ? "lade …"
                    : notamsQuery.isError
                    ? "Fehler"
                    : `${notamsQuery.data?.rows.length ?? 0} aktiv`}
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500">Tippe auf die Karte, um einen Punkt zu wählen.</div>
            )}
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">Layer</div>
              <div className="text-xs text-slate-500">{enabledCount} aktiv</div>
            </div>
            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Tiefflugstrecken (DE)
                </div>
                <ul className="space-y-1">
                  <li>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!enabled["de_lfa"]}
                        onChange={(e) => setEnabled((prev) => ({ ...prev, de_lfa: e.target.checked }))}
                        data-testid="checkbox-layer-de_lfa"
                      />
                      <span className="text-slate-700">LFA Bundeswehr-Tiefflug (250 ft AGL)</span>
                    </label>
                  </li>
                </ul>
              </div>
              {LAYER_GROUPS.map((g) => (
                <div key={g.country}>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    {g.label}
                  </div>
                  <ul className="space-y-1">
                    {g.layers.map((layer) => (
                      <LayerRow
                        key={layer.id}
                        layer={layer}
                        checked={!!enabled[layer.id]}
                        onChange={(v) => setEnabled((prev) => ({ ...prev, [layer.id]: v }))}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

async function showFeatureInfoPopup(
  map: L.Map,
  latlng: L.LatLng,
  containerPoint: L.Point,
  enabled: Record<string, boolean>
) {
  const active = LAYER_GROUPS.flatMap((g) => g.layers).filter((l) => enabled[l.id]);
  if (active.length === 0) return;
  const size = map.getSize();
  const bounds = map.getBounds();
  // Project to EPSG:3857 (web mercator)
  const sw = L.CRS.EPSG3857.project(bounds.getSouthWest());
  const ne = L.CRS.EPSG3857.project(bounds.getNorthEast());
  const bbox = `${sw.x},${sw.y},${ne.x},${ne.y}`;

  const popup = L.popup({ maxWidth: 360 }).setLatLng(latlng);
  popup.setContent(`<div style="font-size:12px;color:#64748b">Lade Detailinformationen …</div>`).openOn(map);

  const fragments: string[] = [];
  for (const layer of active) {
    try {
      const url = `/api/proxy/wms-info?baseUrl=${encodeURIComponent(layer.baseUrl)}&layer=${encodeURIComponent(
        layer.layer
      )}&bbox=${encodeURIComponent(bbox)}&width=${size.x}&height=${size.y}&x=${Math.round(
        containerPoint.x
      )}&y=${Math.round(containerPoint.y)}&crs=EPSG:3857`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) continue;
      const html = (await r.text()).trim();
      if (!html) continue;
      const safe = sanitizeWmsHtml(html);
      if (!safe) continue;
      fragments.push(
        `<div style="margin-bottom:8px"><b>${escapeHtml(layer.label)}</b><div style="font-size:12px">${safe}</div></div>`
      );
    } catch {
      /* ignore */
    }
    if (fragments.length >= 4) break;
  }
  if (fragments.length === 0) {
    popup.setContent(
      `<div style="font-size:12px;color:#64748b">Keine Geozonen-Informationen für diesen Punkt — zoome näher heran oder aktiviere weitere Layer.</div>`
    );
    return;
  }
  popup.setContent(`<div style="max-height:300px;overflow:auto">${fragments.join("")}</div>`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Render WMS GetFeatureInfo HTML safely. We never trust the upstream markup —
 * instead we parse it in a detached document and only emit our own escaped
 * key/value rows extracted from <table>/<tr>/<td> elements. Anything outside
 * that structure is dropped.
 */
function sanitizeWmsHtml(html: string): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return "";
  }
  const rows: string[] = [];
  const tables = Array.from(doc.querySelectorAll("table"));
  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll("th")).map((th) => (th.textContent || "").trim());
    for (const tr of Array.from(table.querySelectorAll("tr"))) {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent || "").trim());
      if (cells.length === 0) continue;
      if (cells.length === 2) {
        rows.push(`<div><b>${escapeHtml(cells[0])}:</b> ${escapeHtml(cells[1])}</div>`);
      } else if (headers.length === cells.length) {
        const parts = cells
          .map((c, i) => (c ? `<b>${escapeHtml(headers[i] || "")}:</b> ${escapeHtml(c)}` : ""))
          .filter(Boolean);
        if (parts.length) rows.push(`<div>${parts.join(" · ")}</div>`);
      } else {
        rows.push(`<div>${cells.map((c) => escapeHtml(c)).join(" · ")}</div>`);
      }
    }
  }
  if (rows.length === 0) {
    const text = (doc.body?.textContent || "").trim();
    if (text.length < 5 || text.length > 800) return "";
    return `<div>${escapeHtml(text)}</div>`;
  }
  return rows.slice(0, 30).join("");
}

function TabButton({
  id,
  active,
  onSelect,
  children,
}: {
  id: TabId;
  active: TabId;
  onSelect: (id: TabId) => void;
  children: React.ReactNode;
}) {
  const isActive = active === id;
  return (
    <button
      role="tab"
      onClick={() => onSelect(id)}
      className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
        isActive
          ? "border-brand-500 text-brand-700"
          : "border-transparent text-slate-500 hover:text-slate-800"
      }`}
      data-testid={`tab-${id}`}
    >
      {children}
    </button>
  );
}

function LayerRow({
  layer,
  checked,
  onChange,
}: {
  layer: WmsLayer;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <li>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          data-testid={`checkbox-layer-${layer.id}`}
        />
        <span className="text-slate-700">{layer.label}</span>
      </label>
    </li>
  );
}
