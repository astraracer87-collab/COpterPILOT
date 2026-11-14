/**
 * Alle Web-Links öffnen in der App (eingebauter Browser, siehe
 * components/InAppBrowser.tsx) – nie in einem externen Browser, egal was auf
 * dem Gerät installiert ist. Nur tel:, mailto:, sms: und geo: gehen an das System.
 *
 * Die Funktionsnamen entsprechen expo-web-browser, damit Screens nur den
 * Import tauschen: import * as WebBrowser from "@/lib/webBrowser";
 */
import { Linking } from "react-native";

export type BrowserRequest = { url: string; title?: string };
type Listener = (req: BrowserRequest | null) => void;

let listener: Listener | null = null;
let pending: BrowserRequest | null = null;

/** Wird vom InAppBrowser beim Einhängen registriert. */
export function registerBrowser(l: Listener | null): void {
  listener = l;
  if (l && pending) {
    l(pending);
    pending = null;
  }
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/** Öffnet einen Link: http(s) im App-Browser, Telefon/Mail über das System. */
export async function openLink(url: string, title?: string): Promise<void> {
  if (!url) return;
  const u = url.trim();
  if (isWebUrl(u)) {
    const req = { url: u, title };
    if (listener) listener(req);
    else pending = req;
    return;
  }
  await Linking.openURL(u);
}

export async function openBrowserAsync(url: string, _options?: unknown): Promise<{ type: "opened" }> {
  await openLink(url);
  return { type: "opened" };
}

export function dismissBrowser(): void {
  listener?.(null);
}
