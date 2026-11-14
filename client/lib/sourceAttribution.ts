// Zentrale Render-Time-Gating-Logik für Datenquellen-Hinweise.
//
// Normale Piloten sollen KEINE Hinweise auf die zugrunde liegenden Datenquellen
// (Wetter, NOTAMs, Geozonen, Live-Verkehr) sehen — diese Quellen-Attributionen
// sind ausschließlich für Admins sichtbar (siehe Task: "Verify pilots never see
// hidden data sources").
//
// Bisher war diese Entscheidung als Inline-Ausdruck (`isAdmin ? … : …`) über ~12
// Screens dupliziert. Ein künftiger Refactor (z. B. geänderte useAuth-Form oder
// ein Screen, der das Muster vergisst) könnte die Quellenangaben still wieder
// freilegen. Diese Helfer kapseln die wiederkehrenden Entscheidungen an EINER
// Stelle, damit das Verhalten testbar bleibt (siehe
// client/lib/__tests__/sourceAttribution.test.ts).
//
// Bewusst react-native-frei gehalten (nur String-Logik), damit der tsx-
// Test-Runner das Modul ohne Expo-/RN-Module importieren kann.

// Quellen-Erläuterungstext (z. B. "Die Daten stammen vom dipul WMS-Dienst …")
// als anzuhängender Suffix — nur für Admins, sonst leerer String. Der separator
// (Standard: zwei Zeilenumbrüche) wird nur vorangestellt, wenn tatsächlich Text
// ausgegeben wird.
export function adminSourceSuffix(
  sourceText: string | undefined | null,
  isAdmin: boolean,
  separator = "\n\n",
): string {
  if (!isAdmin || !sourceText) return "";
  return `${separator}${sourceText}`;
}

// Geozonen-Badge: Piloten sehen für ED-269-Vektorzonen nur das neutrale Label
// "Geozone" statt des Quellen-Labels (z. B. "skeyes / Droneguide (ED-269)").
// Admins sehen das echte Quell-Label. `ed269Labels` ist die Liste der bekannten
// ED-269-Quellen-Labels (Object.values(ED269_SOURCE_LABELS)) — als Parameter
// übergeben, damit dieses Modul den RN-abhängigen ed269.ts-Import vermeidet.
export function geozoneBadgeLabel(
  layerLabel: string,
  isAdmin: boolean,
  ed269Labels: string[],
): string {
  if (!isAdmin && ed269Labels.includes(layerLabel)) return "Geozone";
  return layerLabel;
}

// Detail-Zeilen einer Geozone: leere Zeilen entfernen; für Piloten zusätzlich
// alle "Quelle: …"-Zeilen herausfiltern (Quellenangabe nur für Admins). Admins
// behalten alle nicht-leeren Zeilen.
export function filterGeozoneDetailLines(details: string, isAdmin: boolean): string[] {
  return (details || "")
    .split("\n")
    .filter(
      (d) => d.trim().length > 0 && (isAdmin || !d.trim().toLowerCase().startsWith("quelle")),
    );
}

// Generisches Zwei-Varianten-Idiom: Admins sehen einen quellenhaltigen Text
// (z. B. "Karte und Details auf dipul.de"), Piloten einen neutralen Text ohne
// Quellenhinweis (z. B. "Karte und Details ansehen"). Kapselt das wiederkehrende
// `isAdmin ? <quellenhaltig> : <neutral>`-Muster für Link-Labels, Badge-Texte
// und Fehlermeldungen an EINER Stelle, damit ein Refactor nicht versehentlich
// den Admin-Text für Piloten freilegt.
export function attributionLabel(
  isAdmin: boolean,
  adminText: string,
  pilotText: string,
): string {
  return isAdmin ? adminText : pilotText;
}

// Wetter-Quellen-Label (DFS dipul vs. DWD BrightSky) — nur für Admins, sonst
// leerer String. `withModel` hängt für dipul das Modell ("(ICON-D2)") an;
// `prefix` stellt z. B. "Quelle: " voran. Pilotinnen und Piloten sollen die
// zugrunde liegende Wetterquelle nicht sehen.
export function weatherSourceLabel(
  source: string | undefined | null,
  isAdmin: boolean,
  opts?: { withModel?: boolean; prefix?: string },
): string {
  if (!isAdmin || !source) return "";
  const base = source === "dipul" ? "DFS dipul" : source === "openmeteo" ? "Open-Meteo" : "DWD BrightSky";
  const withModel = opts?.withModel && source === "dipul" ? `${base} (ICON-D2)` : base;
  return opts?.prefix ? `${opts.prefix}${withModel}` : withModel;
}
