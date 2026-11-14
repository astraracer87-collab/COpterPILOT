import AsyncStorage from "@react-native-async-storage/async-storage";
import { LEGAL_CONSENT_VERSION } from "../../shared/legalConsent";

/**
 * Lokale Spiegelung der akzeptierten Consent-Version. Wird zusätzlich zum
 * Server gespeichert, damit der Consent-Schritt offline (anonyme Nutzung)
 * und vor dem ersten Server-Refresh entschieden werden kann.
 */
const LOCAL_CONSENT_KEY = "@preflight/legal_consent_version";

export async function getLocalConsentVersion(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LOCAL_CONSENT_KEY);
  } catch {
    return null;
  }
}

export async function setLocalConsentVersion(
  version: string = LEGAL_CONSENT_VERSION,
): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCAL_CONSENT_KEY, version);
  } catch {
    // Lokales Speichern darf den Ablauf nicht blockieren — die serverseitige
    // Persistenz bleibt die maßgebliche Quelle für eingeloggte Nutzer.
  }
}
