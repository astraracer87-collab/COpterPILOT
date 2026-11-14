import {
  parseMetar,
  parseTAF,
  CloudQuantity,
  Descriptive,
  Intensity,
  Phenomenon,
  WeatherChangeType,
  type IMetar,
  type ITAF,
  type IWind,
  type ICloud,
  type IWeatherCondition,
  type Visibility,
  type TAFTrend,
} from "metar-taf-parser";

// Reine Dekodier-Logik (METAR/TAF -> deutscher Klartext). Bewusst ohne
// Abhängigkeit zu query-client/expo-constants, damit das Web-Bundle (Vite) diese
// Funktionen importieren kann, ohne React-Native-only-Pakete einzuziehen.

// ---- Deutsche Mapping-Tabellen (Parser-Ausgabe ist englisch) ----

const QUANTITY_DE: Record<string, string> = {
  [CloudQuantity.SKC]: "wolkenlos",
  [CloudQuantity.FEW]: "vereinzelt (1-2/8)",
  [CloudQuantity.SCT]: "aufgelockert (3-4/8)",
  [CloudQuantity.BKN]: "stark bewölkt (5-7/8)",
  [CloudQuantity.OVC]: "bedeckt (8/8)",
  [CloudQuantity.NSC]: "keine signifikanten Wolken",
};

const INTENSITY_DE: Record<string, string> = {
  [Intensity.LIGHT]: "leicht",
  [Intensity.HEAVY]: "stark",
  [Intensity.IN_VICINITY]: "in der Umgebung",
};

const DESCRIPTIVE_DE: Record<string, string> = {
  [Descriptive.SHOWERS]: "Schauer",
  [Descriptive.SHALLOW]: "flach",
  [Descriptive.PATCHES]: "stellenweise",
  [Descriptive.PARTIAL]: "teilweise",
  [Descriptive.DRIFTING]: "treibend",
  [Descriptive.THUNDERSTORM]: "Gewitter",
  [Descriptive.BLOWING]: "verweht",
  [Descriptive.FREEZING]: "gefrierend",
};

const PHENOMENON_DE: Record<string, string> = {
  [Phenomenon.RAIN]: "Regen",
  [Phenomenon.DRIZZLE]: "Nieselregen",
  [Phenomenon.SNOW]: "Schnee",
  [Phenomenon.SNOW_GRAINS]: "Schneegriesel",
  [Phenomenon.ICE_PELLETS]: "Eiskörner",
  [Phenomenon.ICE_CRYSTALS]: "Eisnadeln",
  [Phenomenon.HAIL]: "Hagel",
  [Phenomenon.SMALL_HAIL]: "kleiner Hagel/Graupel",
  [Phenomenon.UNKNOW_PRECIPITATION]: "unbekannter Niederschlag",
  [Phenomenon.FOG]: "Nebel",
  [Phenomenon.VOLCANIC_ASH]: "Vulkanasche",
  [Phenomenon.MIST]: "feuchter Dunst",
  [Phenomenon.HAZE]: "trockener Dunst",
  [Phenomenon.WIDESPREAD_DUST]: "Staub",
  [Phenomenon.SMOKE]: "Rauch",
  [Phenomenon.SAND]: "Sand",
  [Phenomenon.SPRAY]: "Gischt",
  [Phenomenon.SQUALL]: "Bö",
  [Phenomenon.SAND_WHIRLS]: "Staubteufel",
  [Phenomenon.THUNDERSTORM]: "Gewitter",
  [Phenomenon.DUSTSTORM]: "Staubsturm",
  [Phenomenon.SANDSTORM]: "Sandsturm",
  [Phenomenon.FUNNEL_CLOUD]: "Trichterwolke",
  [Phenomenon.NO_SIGNIFICANT_WEATHER]: "kein signifikantes Wetter",
};

const CHANGE_DE: Record<string, string> = {
  [WeatherChangeType.FM]: "Ab",
  [WeatherChangeType.BECMG]: "Übergang",
  [WeatherChangeType.TEMPO]: "Zeitweise",
  [WeatherChangeType.INTER]: "Vorübergehend",
  [WeatherChangeType.PROB]: "Wahrscheinlich",
};

const COMPASS_DE = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

function compassDe(deg: number): string {
  return COMPASS_DE[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export interface KlartextRow {
  label: string;
  value: string;
}

function describeWind(wind?: IWind): string {
  if (!wind) return "Keine Angabe";
  const kt = wind.speed;
  const kmh = Math.round(kt * 1.852);
  if (kt === 0) return "Windstill";
  let dir: string;
  if (wind.degrees == null) {
    dir = "veränderlich";
  } else {
    dir = `aus ${wind.degrees}° (${compassDe(wind.degrees)})`;
  }
  let txt = `${dir}, ${kt} kt (${kmh} km/h)`;
  if (wind.gust != null) {
    txt += `, Böen ${wind.gust} kt (${Math.round(wind.gust * 1.852)} km/h)`;
  }
  if (wind.minVariation != null && wind.maxVariation != null) {
    txt += `, schwankend ${wind.minVariation}°-${wind.maxVariation}°`;
  }
  return txt;
}

function describeVisibility(vis?: Visibility, cavok?: boolean): string | null {
  if (cavok) return "CAVOK (10 km oder mehr, keine signifikanten Wolken)";
  if (!vis) return null;
  if (vis.unit === "m") {
    if (vis.value >= 9999) return "10 km oder mehr";
    if (vis.value >= 5000) return `${(vis.value / 1000).toFixed(0)} km`;
    return `${vis.value} m`;
  }
  const prefix = vis.indicator === "P" ? "mehr als " : vis.indicator === "M" ? "weniger als " : "";
  return `${prefix}${vis.value} ${vis.unit === "SM" ? "SM (Statute Miles)" : vis.unit}`;
}

export function describeWeather(conditions: IWeatherCondition[]): string | null {
  if (!conditions || conditions.length === 0) return null;
  const parts = conditions.map((c) => {
    const seg: string[] = [];
    if (c.intensity) seg.push(INTENSITY_DE[c.intensity] || c.intensity);
    if (c.descriptive) seg.push(DESCRIPTIVE_DE[c.descriptive] || c.descriptive);
    for (const p of c.phenomenons) seg.push(PHENOMENON_DE[p] || p);
    return seg.join(" ");
  });
  return parts.filter(Boolean).join(", ");
}

function describeClouds(clouds: ICloud[], verticalVisibility?: number): string | null {
  if (verticalVisibility != null) {
    return `Vertikalsicht ${verticalVisibility} ft`;
  }
  if (!clouds || clouds.length === 0) return null;
  const lines = clouds.map((c) => {
    const q = QUANTITY_DE[c.quantity] || c.quantity;
    const h = c.height != null ? ` in ${c.height} ft` : "";
    const cb = c.type === "CB" ? " (Gewitterwolke CB)" : c.type === "TCU" ? " (mächtige Quellwolke TCU)" : "";
    return `${q}${h}${cb}`;
  });
  return lines.join("; ");
}

function ceilingText(clouds: ICloud[]): string | null {
  const ceil = clouds
    .filter((c) => (c.quantity === CloudQuantity.BKN || c.quantity === CloudQuantity.OVC) && c.height != null)
    .sort((a, b) => (a.height || 0) - (b.height || 0))[0];
  if (!ceil) return null;
  return `${ceil.height} ft (${Math.round((ceil.height || 0) * 0.3048)} m)`;
}

export function decodeMetar(raw: string): KlartextRow[] {
  const m: IMetar = parseMetar(raw);
  const rows: KlartextRow[] = [];
  rows.push({ label: "Wind", value: describeWind(m.wind) });
  const vis = describeVisibility(m.visibility, m.cavok);
  if (vis) rows.push({ label: "Sicht", value: vis });
  const wx = describeWeather(m.weatherConditions);
  if (wx) rows.push({ label: "Wetter", value: wx });
  const clouds = describeClouds(m.clouds, m.verticalVisibility);
  if (clouds) rows.push({ label: "Wolken", value: clouds });
  const ceil = ceilingText(m.clouds);
  if (ceil) rows.push({ label: "Hauptwolkenuntergrenze", value: ceil });
  if (m.temperature != null) {
    const dew = m.dewPoint != null ? ` / Taupunkt ${m.dewPoint} °C` : "";
    rows.push({ label: "Temperatur", value: `${m.temperature} °C${dew}` });
  }
  if (m.altimeter != null) {
    rows.push({ label: "QNH", value: `${m.altimeter.value} ${m.altimeter.unit}` });
  }
  return rows;
}

export interface TafTrendKlartext {
  heading: string;
  rows: KlartextRow[];
}

export interface TafKlartext {
  validity: string;
  base: KlartextRow[];
  trends: TafTrendKlartext[];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function validityText(startDay: number, startHour: number, endDay?: number, endHour?: number): string {
  const start = `${pad2(startDay)}. ${pad2(startHour)}:00 UTC`;
  if (endDay == null || endHour == null) return `ab ${start}`;
  return `${start} bis ${pad2(endDay)}. ${pad2(endHour)}:00 UTC`;
}

function describeContainer(c: { wind?: IWind; visibility?: Visibility; cavok?: boolean; weatherConditions: IWeatherCondition[]; clouds: ICloud[]; verticalVisibility?: number }): KlartextRow[] {
  const rows: KlartextRow[] = [];
  if (c.wind) rows.push({ label: "Wind", value: describeWind(c.wind) });
  const vis = describeVisibility(c.visibility, c.cavok);
  if (vis) rows.push({ label: "Sicht", value: vis });
  const wx = describeWeather(c.weatherConditions);
  if (wx) rows.push({ label: "Wetter", value: wx });
  const clouds = describeClouds(c.clouds, c.verticalVisibility);
  if (clouds) rows.push({ label: "Wolken", value: clouds });
  return rows;
}

function trendHeading(trend: TAFTrend): string {
  const kind = CHANGE_DE[trend.type] || trend.type;
  const v = trend.validity;
  const prob = trend.probability != null ? ` ${trend.probability}%` : "";
  if (trend.type === WeatherChangeType.FM) {
    const minutes = (v as { startMinutes?: number }).startMinutes ?? 0;
    return `${kind} ${pad2(v.startDay)}. ${pad2(v.startHour)}:${pad2(minutes)} UTC`;
  }
  const endDay = (v as { endDay?: number }).endDay;
  const endHour = (v as { endHour?: number }).endHour;
  return `${kind}${prob} (${validityText(v.startDay, v.startHour, endDay, endHour)})`;
}

export function decodeTaf(raw: string): TafKlartext {
  const t: ITAF = parseTAF(raw);
  const validity = validityText(t.validity.startDay, t.validity.startHour, t.validity.endDay, t.validity.endHour);
  const base = describeContainer(t);
  const trends: TafTrendKlartext[] = (t.trends || []).map((tr) => ({
    heading: trendHeading(tr),
    rows: describeContainer(tr),
  }));
  return { validity, base, trends };
}

export function formatObservedTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
