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
    if (email) links.push({ label: `E-Mail: ${email}`, url: email });
  }

  // Austro Control's authorityRequirementConditions is nested in
  // extendedProperties, but its codes are undocumented and not confirmed as
  // legal exemptions. Do not display or apply them until the authority confirms
  // their meaning. Likewise, regulationExemption is deliberately not treated as
  // an authorization signal.

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
