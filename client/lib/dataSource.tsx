import { type ReactNode } from "react";
import { useAuth } from "./auth";

/**
 * Zentrale Definition der Regel "Live-Datenquellen-Hinweise nur für Admins".
 *
 * Gemeint sind technische Quellen-Hinweise zu Live-Daten (z. B. "DWD",
 * "DFS Dipul", "Austro Control (ED-269)", "dipul Geoapi v4") — also woher die
 * aktuell angezeigten Geozonen-/Wetter-/NOTAM-/Traffic-Daten stammen. Diese
 * Hinweise sollen nur Admins sehen.
 *
 * NICHT hierüber laufen Inhalts-Credits/Attributionen (OSM/CARTO-Kartenlayer,
 * Glossar "Quelle: dipul.de", Account-/Abo-Hinweise) — die bleiben für alle
 * sichtbar und sind bewusst aus dem Scope dieser Regel ausgenommen.
 *
 * Einzige Stelle, an der `user?.isAdmin === true` für die Quellen-Sichtbarkeit
 * ausgewertet wird. Neue Screens nutzen diesen Hook (oder <DataSource>), damit
 * die Regel konsistent bleibt.
 */
export function useShowDataSources(): boolean {
  const { user } = useAuth();
  return user?.isAdmin === true;
}

/**
 * Wrapper, der seine Kinder (einen Quellen-Hinweis) nur rendert, wenn der
 * aktuelle Nutzer die Quellen sehen darf. Macht einen neuen Quellen-Hinweis zu
 * einem Einzeiler, der standardmäßig korrekt gated ist.
 */
export function DataSource({ children }: { children: ReactNode }) {
  const show = useShowDataSources();
  if (!show) return null;
  return <>{children}</>;
}
