/**
 * Öffnet Links. Auf DJI-Fernsteuerungen gibt es oft keinen Browser mit
 * "Custom Tabs" (Chrome fehlt), dann schlägt expo-web-browser fehl. In dem Fall
 * wird der Link an den System-Browser übergeben.
 */
import { Linking } from "react-native";
import * as ExpoWebBrowser from "expo-web-browser";

export { WebBrowserResultType } from "expo-web-browser";

export async function openBrowserAsync(
  url: string,
  options?: ExpoWebBrowser.WebBrowserOpenOptions,
): Promise<ExpoWebBrowser.WebBrowserResult | { type: "opened" }> {
  try {
    return await ExpoWebBrowser.openBrowserAsync(url, options);
  } catch {
    await Linking.openURL(url);
    return { type: "opened" };
  }
}
