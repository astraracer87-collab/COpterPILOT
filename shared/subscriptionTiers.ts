/**
 * Kanonische Definition der drei Abo-Stufen (Basic / Professional / Advanced).
 *
 * EINZIGE Quelle der Wahrheit für die Standard-Zuordnung Stufe -> Features +
 * Preis. Genutzt von:
 *  - `server/setupSubscriptionPackages.ts` (legt die Stripe-Produkte an),
 *  - `server/__tests__/tierEntitlements.test.ts` (prüft das Feature-Gating).
 *
 * Zur LAUFZEIT bleibt Stripe die Quelle der Wahrheit: die Berechtigungsprüfung
 * liest die Features aus den Produkt-Metadaten (`parseFeaturesFromMetadata`).
 * Diese Datei beschreibt nur die anzulegenden Standard-Pakete; ein Admin kann
 * Features pro Paket weiterhin im Dashboard ändern.
 */
import { type FeatureKey } from "./featureCatalog";

export interface SubscriptionTierDef {
  /** Stabiler Stufen-Schlüssel (in Produkt-`metadata.tier` referenziert). */
  tier: "basic" | "professional" | "advanced";
  name: string;
  description: string;
  /** Sortierreihenfolge (kleiner = weiter vorne). */
  order: number;
  /** Monatspreis in kleinster Währungseinheit (Cent). */
  unitAmount: number;
  currency: string;
  /** Enthaltene Feature-Keys (kumulativ aufsteigend). */
  features: FeatureKey[];
}

const BASIC_FEATURES: FeatureKey[] = [
  "flight_planning",
  "geozone_maps",
  "weather",
  "notams",
  "compliance",
  "edr",
  "drone_management",
  "logbook",
  "glossary_links",
];

const PROFESSIONAL_FEATURES: FeatureKey[] = [
  ...BASIC_FEATURES,
  "live_traffic",
  "nd_filter",
  "web_platform",
];

const ADVANCED_FEATURES: FeatureKey[] = [
  ...PROFESSIONAL_FEATURES,
  "dji_log",
  "pdf_export",
  "document_management",
];

export const SUBSCRIPTION_TIERS: readonly SubscriptionTierDef[] = [
  {
    tier: "basic",
    name: "Basic",
    description:
      "Flugplanung, Geozonen-Karten, Wetter, NOTAMs, Compliance, ED-R, Drohnen-Management und Glossar/Links. Ohne Web-Plattform.",
    order: 1,
    unitAmount: 499,
    currency: "eur",
    features: BASIC_FEATURES,
  },
  {
    tier: "professional",
    name: "Professional",
    description:
      "Alles aus Basic plus Live-Flugverkehr, ND-Filter-Empfehlung und Zugang zur Web-Plattform.",
    order: 2,
    unitAmount: 999,
    currency: "eur",
    features: PROFESSIONAL_FEATURES,
  },
  {
    tier: "advanced",
    name: "Advanced",
    description:
      "Alles aus Professional plus Fluglog (DJI), PDF-Export und Dokumentenverwaltung.",
    order: 3,
    unitAmount: 1899,
    currency: "eur",
    features: ADVANCED_FEATURES,
  },
] as const;

export function getTierDef(tier: string): SubscriptionTierDef | undefined {
  return SUBSCRIPTION_TIERS.find((t) => t.tier === tier);
}
