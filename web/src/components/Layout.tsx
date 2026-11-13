import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Clipboard,
  Radio,
  AlertCircle,
  BookOpen,
  Menu,
  Plus,
  X,
  LayoutGrid,
  Map,
  CloudSun,
  Plane,
  CalendarClock,
  ListChecks,
  User,
  BookMarked,
  Link as LinkIcon,
  Settings,
  Shield,
  LogOut,
  Smartphone,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../lib/auth";

type TabKey = "briefings" | "radar" | "karte" | "logbuch" | "mehr";

const TABS: {
  key: TabKey;
  to?: string;
  label: string;
  icon: LucideIcon;
}[] = [
  { key: "briefings", to: "/briefings", label: "Briefings", icon: Clipboard },
  { key: "radar", to: "/verkehrsradar", label: "Radar", icon: Radio },
  { key: "karte", to: "/karte", label: "NOTAMs", icon: AlertCircle },
  { key: "logbuch", to: "/logbuch", label: "Logbuch", icon: BookOpen },
  { key: "mehr", label: "Mehr", icon: Menu },
];

type SheetItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  description?: string;
  adminOnly?: boolean;
  external?: boolean;
};

const SHEET_ITEMS: SheetItem[] = [
  { to: "/", label: "Übersicht", icon: LayoutGrid, description: "Aktive Flüge & Schnellzugriffe" },
  { to: "/karte", label: "Karte", icon: Map, description: "Geozonen, NOTAMs, Tieffluggebiete" },
  { to: "/wetter", label: "Wetter", icon: CloudSun, description: "Live-Wetter & Limits" },
  { to: "/drohnen", label: "Drohnen", icon: Plane, description: "Flotte & Wartung" },
  { to: "/flugplanung", label: "Flugplanung", icon: CalendarClock, description: "Vorab-Planung (1 Tag zuvor)" },
  { to: "/fluege", label: "Flüge", icon: ListChecks, description: "Alle Pre-Flight Checks" },
  { to: "/profil", label: "Profil", icon: User, description: "Pilot:in & Lizenz" },
  { to: "/glossar", label: "Glossar", icon: BookMarked },
  { to: "/ressourcen", label: "Ressourcen", icon: LinkIcon },
  { to: "/einstellungen", label: "Einstellungen", icon: Settings },
  {
    to: "/expo",
    label: "Mobile App (Expo Go)",
    icon: Smartphone,
    description: "QR-Code zum Laden der App auf dein Handy",
    external: true,
  },
  { to: "/admin", label: "Admin", icon: Shield, adminOnly: true },
];

const TITLES: { match: RegExp; title: string; subtitle?: string }[] = [
  { match: /^\/$/, title: "COpter Pilot", subtitle: "Drohnen Pre-Flight Check" },
  { match: /^\/briefings\/[^/]+$/, title: "Briefing" },
  { match: /^\/briefings$/, title: "Briefings", subtitle: "Aktive & abgeschlossene Pre-Flight Checks" },
  { match: /^\/verkehrsradar$/, title: "Verkehrsradar", subtitle: "Live-Luftraum in deiner Nähe" },
  { match: /^\/karte$/, title: "Karte", subtitle: "Geozonen · NOTAMs · Tieffluggebiete" },
  { match: /^\/logbuch\/[^/]+$/, title: "Logbuch-Eintrag" },
  { match: /^\/logbuch$/, title: "Logbuch", subtitle: "Alle absolvierten Flüge" },
  { match: /^\/wetter$/, title: "Wetter", subtitle: "Live-Wetter & Flugwetter-Limits" },
  { match: /^\/drohnen\/[^/]+\/historie$/, title: "Drohnen-Historie" },
  { match: /^\/drohnen$/, title: "Drohnen", subtitle: "Deine Flotte" },
  { match: /^\/flugplanung\/[^/]+$/, title: "Flugplanung" },
  { match: /^\/flugplanung$/, title: "Flugplanung", subtitle: "Vorab-Planung für deinen nächsten Flug" },
  { match: /^\/fluege$/, title: "Flüge", subtitle: "Alle Pre-Flight Checks" },
  { match: /^\/flug\/[^/]+$/, title: "Flug" },
  { match: /^\/profil$/, title: "Profil", subtitle: "Pilot:in & Lizenz" },
  { match: /^\/glossar$/, title: "Glossar" },
  { match: /^\/ressourcen$/, title: "Ressourcen" },
  { match: /^\/einstellungen$/, title: "Einstellungen" },
  { match: /^\/admin\/users\/[^/]+$/, title: "Nutzer-Detail" },
  { match: /^\/admin$/, title: "Admin", subtitle: "Nutzer- und Datenverwaltung" },
];

function activeTabFor(pathname: string): TabKey | null {
  if (pathname === "/" || pathname.startsWith("/dashboard")) return "briefings";
  if (pathname.startsWith("/briefings")) return "briefings";
  if (pathname.startsWith("/verkehrsradar")) return "radar";
  if (pathname.startsWith("/karte")) return "karte";
  if (pathname.startsWith("/logbuch")) return "logbuch";
  return null;
}

function pageTitle(pathname: string): { title: string; subtitle?: string } {
  for (const t of TITLES) {
    if (t.match.test(pathname)) return { title: t.title, subtitle: t.subtitle };
  }
  return { title: "COpter Pilot" };
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const activeTab = activeTabFor(location.pathname);
  const isOnBriefings = activeTab === "briefings";
  const { title, subtitle } = useMemo(() => pageTitle(location.pathname), [location.pathname]);

  // Sheet bei Routenwechsel automatisch schließen
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-[var(--color-app-bg-root)]">
      {/* Phone-Frame: auf Desktop mittig, mit Schatten und subtiler Umrahmung,
         damit das Web-Erlebnis bewusst wie die iOS-App aussieht. */}
      <div className="app-frame">
        {/* iOS-Style Navigation Bar — kompakt, transluzent, zentriert.
           Bewusst sehr ähnlich dem nativen App-Look (kein dunkler Brand-Header). */}
        <header className="ios-navbar">
          <div className="ios-navbar-title">{title}</div>
        </header>

        {/* Optional: dezenter Subtitle direkt unter der Navbar */}
        {subtitle ? (
          <div className="px-5 pt-2 pb-1 text-center">
            <p className="text-[13px] text-[var(--color-app-text-secondary)]">
              {subtitle}
            </p>
          </div>
        ) : null}

        {/* Inhalt */}
        <main className="px-4 pt-3 pb-32">
          <Outlet />
        </main>

        {/* Floating Action Button — nur auf Briefings-Tab, wie in der App */}
        {isOnBriefings ? (
          <button
            onClick={() => navigate("/flugplanung")}
            className="app-fab"
            title="Neuer Flug"
            data-testid="fab-new-check"
          >
            <Plus size={26} strokeWidth={2.5} />
          </button>
        ) : null}

        {/* Bottom Tab Bar (Liquid-Glass-Anmutung) */}
        <nav className="app-tabbar" role="tablist">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const Icon = tab.icon;
            const content = (
              <>
                <Icon size={22} strokeWidth={isActive ? 2.4 : 1.9} />
                <span className="text-[10.5px] font-medium mt-0.5">{tab.label}</span>
              </>
            );
            const cls = `app-tab ${isActive ? "app-tab-active" : ""}`;
            if (tab.key === "mehr") {
              return (
                <button
                  key={tab.key}
                  onClick={() => setMoreOpen(true)}
                  className={cls}
                  data-testid="tab-mehr"
                  role="tab"
                  aria-selected={moreOpen}
                >
                  {content}
                </button>
              );
            }
            return (
              <NavLink
                key={tab.key}
                to={tab.to!}
                className={cls}
                data-testid={`tab-${tab.key}`}
                role="tab"
                aria-selected={isActive}
              >
                {content}
              </NavLink>
            );
          })}
        </nav>

        {/* "Mehr"-Sheet (iOS Bottom Sheet) */}
        {moreOpen ? (
          <div className="sheet-backdrop" onClick={() => setMoreOpen(false)} role="dialog">
            <div
              className="sheet-panel"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sheet-handle" />
              <div className="flex items-center justify-between px-5 pb-2">
                <div>
                  <div className="text-[20px] font-bold tracking-tight">Mehr</div>
                  <div className="text-[13px] text-[var(--color-app-text-secondary)]">
                    Alle Bereiche der App
                  </div>
                </div>
                <button
                  onClick={() => setMoreOpen(false)}
                  className="sheet-close"
                  aria-label="Schließen"
                >
                  <X size={18} />
                </button>
              </div>
              <ul className="px-3 pb-2">
                {SHEET_ITEMS.filter((it) => !it.adminOnly || user?.isAdmin).map((it) => {
                  const Icon = it.icon;
                  const inner = (
                    <>
                      <span className="sheet-row-icon">
                        <Icon size={20} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[15px] font-semibold text-[var(--color-app-text)]">
                          {it.label}
                        </span>
                        {it.description ? (
                          <span className="block text-[12.5px] text-[var(--color-app-text-secondary)] mt-0.5">
                            {it.description}
                          </span>
                        ) : null}
                      </span>
                      <ChevronRight size={18} className="text-[var(--color-app-text-tertiary)]" />
                    </>
                  );
                  return (
                    <li key={it.to}>
                      {it.external ? (
                        <a
                          href={it.to}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="sheet-row"
                          data-testid={`sheet-${it.to.replace(/\//g, "-")}`}
                        >
                          {inner}
                        </a>
                      ) : (
                        <NavLink
                          to={it.to}
                          className="sheet-row"
                          data-testid={`sheet-${it.to.replace(/\//g, "-")}`}
                        >
                          {inner}
                        </NavLink>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="px-3 pt-2 pb-3 border-t border-[var(--color-app-border)]">
                <div className="px-2 pb-2 pt-1">
                  <div className="text-[12px] uppercase tracking-wider text-[var(--color-app-text-tertiary)]">
                    Angemeldet als
                  </div>
                  <div className="text-[15px] font-semibold text-[var(--color-app-text)] truncate">
                    {user?.name || user?.email || "—"}
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="sheet-row w-full text-left"
                  data-testid="button-logout"
                >
                  <span className="sheet-row-icon" style={{ color: "#ef4444" }}>
                    <LogOut size={20} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-semibold" style={{ color: "#ef4444" }}>
                      Abmelden
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
