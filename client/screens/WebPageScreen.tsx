/**
 * Zeigt eine Webseite als normalen App-Bildschirm: gleicher Kopf wie alle
 * anderen Seiten, Zurück-Pfeil geht erst in der Seite zurück, dann zurück in
 * die App. Keine Browser-Leiste, keine externen Fenster.
 * PDFs (kann die Android-WebView nicht) werden mit pdf.js als Seiten gezeigt.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";

export function looksLikePdf(url: string): boolean {
  return /\.pdf($|[?#])/i.test(url) || /[?&](format|type)=pdf\b/i.test(url);
}

function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/(?:www\.)?([^/?#]+)/i);
  return m ? m[1] : "";
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const parts: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    parts.push(chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63]);
  }
  if (i < bytes.length) {
    const has2 = i + 1 < bytes.length;
    const n = (bytes[i] << 16) | ((has2 ? bytes[i + 1] : 0) << 8);
    parts.push(chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + (has2 ? chars[(n >> 6) & 63] : "=") + "=");
  }
  return parts.join("");
}

function pdfHtml(base64: string, bg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
<style>body{margin:0;background:${bg};font-family:sans-serif}
canvas{display:block;margin:8px auto;max-width:100%;height:auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3)}
#msg{color:#888;text-align:center;padding:24px}</style>
<script src="${PDFJS}/pdf.min.js"></script></head><body><div id="msg">Dokument wird angezeigt …</div><script>
(async function(){
  try{
    pdfjsLib.GlobalWorkerOptions.workerSrc="${PDFJS}/pdf.worker.min.js";
    const raw=atob("${base64}");const data=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)data[i]=raw.charCodeAt(i);
    const pdf=await pdfjsLib.getDocument({data}).promise;
    document.getElementById('msg').remove();
    const w=Math.min(window.innerWidth,1400)*(window.devicePixelRatio||1);
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);const v0=page.getViewport({scale:1});
      const vp=page.getViewport({scale:w/v0.width});
      const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;
      document.body.appendChild(c);
      await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
    }
  }catch(e){document.getElementById('msg').textContent='Dokument konnte nicht angezeigt werden.';}
})();
</script></body></html>`;
}

type Nav = NativeStackNavigationProp<RootStackParamList, "WebPage">;

export default function WebPageScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<RootStackParamList, "WebPage">>();
  const { theme } = useTheme();
  const webRef = useRef<WebView>(null);
  const canBackRef = useRef(false);
  const [title, setTitle] = useState(params.title || "");
  const [pdfUrl, setPdfUrl] = useState<string | null>(looksLikePdf(params.url) ? params.url : null);
  const [pdfHtmlDoc, setPdfHtmlDoc] = useState<string | null>(null);
  const [pdfFailed, setPdfFailed] = useState(false);
  // Kam die PDF aus einer Webseite? Dann führt "Zurück" wieder zur Seite.
  const pdfFromPage = useRef(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: title || hostOf(params.url) || "Seite" });
  }, [navigation, title, params.url]);

  // PDF laden
  useEffect(() => {
    if (!pdfUrl) return;
    let cancelled = false;
    setPdfHtmlDoc(null);
    setPdfFailed(false);
    (async () => {
      try {
        const res = await fetch(pdfUrl);
        if (!res.ok) throw new Error(String(res.status));
        const b64 = toBase64(await res.arrayBuffer());
        if (!cancelled) setPdfHtmlDoc(pdfHtml(b64, theme.backgroundRoot));
      } catch {
        if (!cancelled) setPdfFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfUrl, theme.backgroundRoot]);

  // Zurück (Pfeil oben oder Taste): erst innerhalb der Seite, dann zurück in die App
  useEffect(() => {
    return navigation.addListener("beforeRemove", (e) => {
      if (pdfUrl && pdfFromPage.current) {
        e.preventDefault();
        pdfFromPage.current = false;
        setPdfUrl(null);
        setPdfHtmlDoc(null);
        return;
      }
      if (!pdfUrl && canBackRef.current) {
        e.preventDefault();
        webRef.current?.goBack();
      }
    });
  }, [navigation, pdfUrl]);

  const onNav = useCallback((nav: WebViewNavigation) => {
    canBackRef.current = nav.canGoBack;
    if (nav.title && !/^https?:|^about:/.test(nav.title)) setTitle(nav.title);
  }, []);

  const onShouldStart = useCallback((r: { url: string }) => {
    const url = r.url || "";
    if (/^(tel|mailto|sms|geo):/i.test(url)) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    if (/^https?:/i.test(url) && looksLikePdf(url)) {
      pdfFromPage.current = true;
      setPdfUrl(url);
      return false;
    }
    return /^(https?|about|data|blob):/i.test(url);
  }, []);

  const spinner = (
    <View style={[styles.center, { backgroundColor: theme.backgroundRoot }]}>
      <ActivityIndicator size="large" color={theme.primary} />
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      {/* Webseite bleibt geladen, während ein PDF darüber angezeigt wird */}
      {!looksLikePdf(params.url) ? (
        <View style={[styles.fill, pdfUrl ? styles.hidden : null]}>
          <WebView
            ref={webRef}
            source={{ uri: params.url }}
            style={[styles.fill, { backgroundColor: theme.backgroundRoot }]}
            onNavigationStateChange={onNav}
            onShouldStartLoadWithRequest={onShouldStart}
            setSupportMultipleWindows={false}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => spinner}
          />
        </View>
      ) : null}
      {pdfUrl ? (
        pdfFailed ? (
          <View style={[styles.center, { backgroundColor: theme.backgroundRoot }]}>
            <Feather name="file-text" size={36} color={theme.textSecondary ?? "#8E8E93"} />
            <Text style={[styles.msg, { color: theme.text }]}>Das Dokument konnte nicht geladen werden.</Text>
            <Pressable onPress={() => { const u = pdfUrl; setPdfUrl(null); setTimeout(() => setPdfUrl(u), 0); }} style={[styles.retry, { backgroundColor: theme.primary }]}>
              <Text style={styles.retryText}>Erneut versuchen</Text>
            </Pressable>
          </View>
        ) : pdfHtmlDoc ? (
          <WebView
            key={pdfUrl}
            originWhitelist={["*"]}
            source={{ html: pdfHtmlDoc, baseUrl: "https://cdnjs.cloudflare.com/" }}
            style={[styles.fill, { backgroundColor: theme.backgroundRoot }]}
            setSupportMultipleWindows={false}
            javaScriptEnabled
          />
        ) : spinner
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fill: { flex: 1 },
  hidden: { position: "absolute", width: 0, height: 0, opacity: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  overlay: { ...StyleSheet.absoluteFillObject },
  msg: { fontSize: 15, textAlign: "center" },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  retryText: { color: "#FFFFFF", fontWeight: "700" },
});
