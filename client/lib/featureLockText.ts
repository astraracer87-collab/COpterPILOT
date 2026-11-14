// RN-freie Auflösung der Upgrade-Hinweis-Texte (Name + Beschreibung) eines
// gesperrten Features für die mobile App. Bewusst ohne react-native-Importe,
// damit `client/components/FeatureGate.tsx` UND der tsx-Logik-Test
// (`server/__tests__/featureLockWordingSync.test.ts`) dieselbe Quelle nutzen.
//
// Beide Oberflächen (Web + Mobile) ziehen Name + Beschreibung aus
// `shared/featureCatalog.ts`, damit die Wortwahl nicht auseinanderdriftet.

import { getFeatureDefinition } from "../../shared/featureCatalog";

/** Fallback-Anzeigename, falls der Feature-Key nicht im Katalog steht. */
export const FEATURE_LOCK_NAME_FALLBACK = "Diese Funktion";

/** Fallback-Beschreibung (informelle Anrede), falls der Key fehlt. */
export const FEATURE_LOCK_DESCRIPTION_FALLBACK =
  "Diese Funktion ist in deinem aktuellen Paket nicht enthalten.";

/** Anzeigename eines Features (aus dem geteilten Katalog) mit Fallback. */
export function featureLockName(featureKey: string): string {
  return getFeatureDefinition(featureKey)?.name ?? FEATURE_LOCK_NAME_FALLBACK;
}

/** Beschreibung eines Features (aus dem geteilten Katalog) mit Fallback. */
export function featureLockDescription(featureKey: string): string {
  return (
    getFeatureDefinition(featureKey)?.description ??
    FEATURE_LOCK_DESCRIPTION_FALLBACK
  );
}
