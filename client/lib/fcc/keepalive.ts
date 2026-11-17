import { BackgroundJobs } from "@/lib/background/service";

/**
 * FCC-Modus halten – läuft jetzt über den gemeinsamen Hintergrunddienst
 * (siehe client/lib/background/service.ts), damit es nicht mit der
 * Verkehrsüberwachung kollidiert (nur ein Hintergrund-Task möglich).
 */
export const Keepalive = {
  isRunning: () => BackgroundJobs.isFccHold(),
  start: () => BackgroundJobs.setFccHold(true),
  stop: () => BackgroundJobs.setFccHold(false),
};
