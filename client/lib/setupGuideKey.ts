/**
 * Reine (React-Native-freie) Schlüssel- und Entscheidungslogik für den
 * Einrichtungs-Assistenten. Bewusst OHNE AsyncStorage-Import, damit diese
 * Logik unter dem tsx-Test-Runner importierbar bleibt (vgl. setupGuide.ts,
 * das hier aufsetzt und die eigentliche Persistenz übernimmt).
 */

export type SetupGuideStatus = "completed" | "skipped";

export const SETUP_GUIDE_KEY_PREFIX = "@preflight/setup_guide_status";

/**
 * Der Onboarding-Status wird pro Konto (User-ID) getrennt abgelegt, damit auf
 * einem geteilten Gerät der Status nicht zwischen Konten durchsickert. Ohne
 * User-ID (anonyme/Offline-Nutzung) wird der Basis-Schlüssel verwendet — dieser
 * unterdrückt den Assistenten NICHT für ein später angemeldetes Konto, weil der
 * Lesepfad dann den konto-spezifischen Schlüssel abfragt.
 */
export function setupGuideKey(userId?: string | null): string {
  return userId ? `${SETUP_GUIDE_KEY_PREFIX}:${userId}` : SETUP_GUIDE_KEY_PREFIX;
}

export function isValidSetupGuideStatus(value: unknown): value is SetupGuideStatus {
  return value === "completed" || value === "skipped";
}

/**
 * Eingaben für die (geteilte) Entscheidung, ob der Assistent automatisch
 * angeboten wird. Damit nutzen mobile App und Web denselben Pfad.
 */
export interface SetupGuideOfferInput {
  /**
   * Konto-gebundener Status vom Server (Quelle der Wahrheit, geräteunabhängig).
   * Ein gesetzter Status bedeutet: nicht erneut automatisch anbieten.
   */
  serverStatus?: SetupGuideStatus | null;
  /**
   * Lokaler Best-Effort-Fallback (AsyncStorage/localStorage). Greift z.B. bei
   * Offline-Nutzung oder wenn der Server (noch) keinen Status liefert.
   */
  localStatus?: SetupGuideStatus | null;
  /**
   * Hat das Konto bereits relevante Daten (mind. eine Drohne, ausgefülltes
   * Pilotenprofil oder eine Lizenz)? Dann ist es kein echter Erstnutzer und der
   * Assistent wird NICHT automatisch angeboten.
   */
  hasContent?: boolean;
  /**
   * Steht der Inhaltsstatus (`hasContent`) zweifelsfrei fest? Nur dann darf der
   * Assistent bei vermeintlich leerem Konto automatisch angeboten werden.
   * Solange die Inhaltsprüfung noch nicht aufgelöst ist (Server-Abruf läuft,
   * lokal→Server-Abgleich noch nicht abgeschlossen), übergeben Aufrufer hier
   * `false` -> im Zweifel NICHT anbieten. Default `true` für Abwärtskompatibilität
   * (Aufrufer, die den Inhalt bereits sicher kennen, müssen nichts ändern).
   */
  contentResolved?: boolean;
}

/**
 * Den Assistenten automatisch anbieten, wenn das Konto echter Erstnutzer ist:
 * kein konto-gebundener Server-Status, kein lokaler Status und noch keine
 * relevanten Daten. Ein manueller Neustart aus den Einstellungen läuft an dieser
 * Logik vorbei.
 *
 * Akzeptiert zur Abwärtskompatibilität auch direkt einen Status-Wert (oder
 * `null`) – dann wird er als lokaler Status interpretiert.
 */
export function shouldOfferSetupGuide(
  input: SetupGuideOfferInput | SetupGuideStatus | null = {},
): boolean {
  const normalized: SetupGuideOfferInput =
    input === null || typeof input === "string" ? { localStatus: input } : input;
  const serverStatus = normalized.serverStatus ?? null;
  const localStatus = normalized.localStatus ?? null;
  if (serverStatus !== null) return false;
  if (localStatus !== null) return false;
  // Im Zweifel NICHT anbieten: Steht der Inhaltsstatus noch nicht zweifelsfrei
  // fest (Server-Abruf läuft, lokal→Server-Abgleich noch nicht fertig), gilt das
  // Konto NICHT als bestätigt leer -> kein Auto-Anbieten (verhindert das kurze
  // Aufblitzen bei Bestandskonten).
  if (normalized.contentResolved === false) return false;
  if (normalized.hasContent) return false;
  return true;
}
