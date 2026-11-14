/**
 * Alle Web-Links öffnen in der App als normaler Bildschirm (WebPageScreen) –
 * nie in einem externen Browser. Nur tel:, mailto:, sms: und geo: gehen an das System.
 *
 * Die Funktionsnamen entsprechen expo-web-browser, damit Screens nur den
 * Import tauschen: import * as WebBrowser from "@/lib/webBrowser";
 */
import { Linking } from "react-native";
import { navigationRef } from "@/navigation/navigationRef";

/** Öffnet einen Link: http(s) als App-Seite, Telefon/Mail über das System. */
export async function openLink(url: string, title?: string): Promise<void> {
  if (!url) return;
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) {
    if (navigationRef.isReady()) navigationRef.navigate("WebPage", { url: u, title });
    return;
  }
  await Linking.openURL(u);
}

export async function openBrowserAsync(url: string, _options?: unknown): Promise<{ type: "opened" }> {
  await openLink(url);
  return { type: "opened" };
}
