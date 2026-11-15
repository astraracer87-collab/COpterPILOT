export interface Ed269SourceLink {
  label: string;
  url: string;
}

export interface Ed269SourceInfo {
  details: string[];
  links: Ed269SourceLink[];
}

function plainText(value: unknown): string {
  return String(value ?? "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Bekannte Schlüssel der Bedingungscodes (wörtlich ausgeschrieben, ohne Bewertung). */
function conditionTokenDe(token: string): string | null {
  const [k, v] = token.split("=").map((x) => x.trim());
  if (!k || v == null || v === "") return null;
  const n = Number(v);
  switch (k.toUpperCase()) {
    case "LOS":
      return v.toUpperCase() === "VLOS" ? "Sichtverbindung (VLOS)" : v.toUpperCase() === "BVLOS" ? "außerhalb der Sichtweite (BVLOS)" : `LOS ${v}`;
    case "ALTITUDE_AGL_MAX":
      return Number.isFinite(n) ? `max. ${n} m über Grund` : null;
    case "MTOM_G_MAX":
      return Number.isFinite(n) ? (n >= 1000 ? `Startmasse max. ${n / 1000} kg` : `Startmasse max. ${n} g`) : null;
    default:
      return null;
  }
}

/**
 * authorityRequirementConditions (Austro Control: „EXCLUDED/LOS=VLOS/
 * ALTITUDE_AGL_MAX=30/MTOM_G_MAX=249“) → Infozeilen. Bedeutung von
 * EXCLUDED/INCLUDED ist nicht bestätigt → nur Information, KEINE Freigabe.
 */
export function authorityRequirementConditionLines(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const out: string[] = [];
  for (const entry of list) {
    const raw = typeof entry === "string" ? entry : entry && typeof entry === "object" ? (entry as any).condition : "";
    const condition = plainText(raw);
    if (!condition) continue;
    const authority = entry && typeof entry === "object" ? plainText((entry as any).authority) : "";
    const parts = condition.split("/").map((t) => conditionTokenDe(t)).filter((t): t is string => !!t);
    out.push(
      `Bedingungscode der Behörde (nur Information, keine Freigabe – Bedeutung nicht bestätigt): ${authority ? `${authority}: ` : ""}${condition}${parts.length ? ` (${parts.join(" · ")})` : ""}`,
    );
  }
  return [...new Set(out)];
}

/** Extract official legal and authority information without interpreting undocumented rule codes. */
export function ed269SourceInfo(properties: Record<string, any>): Ed269SourceInfo {
  const details: string[] = [];
  const links: Ed269SourceLink[] = [];
  const extended = properties.extendedProperties ?? {};
  const legalBasis = plainText(extended.legalBasis ?? properties.legalBasis);
  if (legalBasis) details.push(`Rechtsgrundlage: ${legalBasis}`);
  const legalUrl = safeHttpUrl(extended.legalBasisURL ?? properties.legalBasisURL);
  if (legalUrl) links.push({ label: "Rechtsgrundlage öffnen", url: legalUrl });

  const authorities = Array.isArray(properties.zoneAuthority)
    ? properties.zoneAuthority
    : properties.zoneAuthority ? [properties.zoneAuthority] : [];
  for (const authority of authorities) {
    if (!authority || typeof authority !== "object") continue;
    const name = plainText(authority.name);
    if (name) details.push(`Zuständige Stelle: ${name}`);
    const site = safeHttpUrl(authority.siteURL);
    if (site) links.push({ label: name ? `Webseite: ${name}` : "Webseite der zuständigen Stelle", url: site });
    const email = typeof authority.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authority.email)
      ? authority.email
      : undefined;
    if (email) links.push({ label: `E-Mail: ${email}`, url: email }); // „mailto:“ ergänzt die Anzeige (InfrastructureFlightGuidance)
  }

  // Austro Control's authorityRequirementConditions (nested in
  // extendedProperties): shown as INFO TEXT only (P3, PO decision) – the code
  // is displayed verbatim, the known keys are spelled out literally, and the
  // line says explicitly that it is no clearance. Never applied to the
  // restriction/verdict. Likewise, regulationExemption is deliberately not
  // treated as an authorization signal.
  details.push(...authorityRequirementConditionLines(extended.authorityRequirementConditions ?? properties.authorityRequirementConditions));

  const seen = new Set<string>();
  return {
    details,
    links: links.filter((link) => {
      if (seen.has(link.url)) return false;
      seen.add(link.url);
      return true;
    }),
  };
}
