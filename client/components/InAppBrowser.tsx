/**
 * Eingebauter Browser: zeigt Web-Links als Vollbild-Fenster in der App.
 * PDFs (Android-WebView kann sie nicht anzeigen) werden geladen und mit pdf.js
 * als Seiten dargestellt.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { registerBrowser, type BrowserRequest } from "@/lib/webBrowser";

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";

function looksLikePdf(url: string): boolean {
  return /\.pdf($|[?#])/i.test(url) || /[?&](format|type)=pdf\b/i.test(url);
}

function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1] : url;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + (i + 1 < bytes.length ? chars[(n >> 6) & 63] : "=") + "=";
  }
  return out;
}

function pdfHtml(base64: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
<style>body{margin:0;background:#525659;font-family:sans-serif}
canvas{display:block;margin:8px auto;max-width:100%;height:auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}
#msg{color:#fff;text-align:center;padding:24px}</style>
<script src="${PDFJS}/pdf.min.js"></script></head><body><div id="msg">PDF wird angezeigt …</div><script>
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
  }catch(e){document.getElementById('msg').textContent='PDF konnte nicht angezeigt werden: '+e.message;}
})();
</script></body></html>`;
}

export function InAppBrowser() {
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);
  const [req, setReq] = useState<BrowserRequest | null>(null);
  const [currentUrl, setCurrentUrl] = useState("");
  const [title, setTitle] = useState("");
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pdf, setPdf] = useState<{ html: string } | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const loadPdf = useCallback(async (url: string) => {
    setPdf(null);
    setPdfError(null);
    setLoading(true);
    setCurrentUrl(url);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server antwortet mit ${res.status}`);
      const buf = await res.arrayBuffer();
      setPdf({ html: pdfHtml(arrayBufferToBase64(buf)) });
    } catch (e: any) {
      setPdfError(e?.message || "PDF konnte nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    registerBrowser((r) => {
      setReq(r);
      setTitle(r?.title || "");
      setCanBack(false);
      setCanForward(false);
      setPdf(null);
      setPdfError(null);
      if (r) {
        setCurrentUrl(r.url);
        if (looksLikePdf(r.url)) loadPdf(r.url);
      }
    });
    return () => registerBrowser(null);
  }, [loadPdf]);

  const close = useCallback(() => {
    setReq(null);
    setPdf(null);
    setPdfError(null);
  }, []);

  const goBack = useCallback(() => {
    if (pdf || pdfError) {
      // aus der PDF-Ansicht zurück zur Webseite (falls die PDF aus einer Seite kam)
      if (req && !looksLikePdf(req.url)) {
        setPdf(null);
        setPdfError(null);
        return true;
      }
      close();
      return true;
    }
    if (canBack) {
      webRef.current?.goBack();
      return true;
    }
    close();
    return true;
  }, [pdf, pdfError, req, canBack, close]);

  useEffect(() => {
    if (!req) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", goBack);
    return () => sub.remove();
  }, [req, goBack]);

  const onNav = useCallback((nav: WebViewNavigation) => {
    setCanBack(nav.canGoBack);
    setCanForward(nav.canGoForward);
    if (nav.url) setCurrentUrl(nav.url);
    if (nav.title && !/^https?:/.test(nav.title)) setTitle(nav.title);
  }, []);

  const onShouldStart = useCallback((r: { url: string }) => {
    const url = r.url || "";
    if (/^(tel|mailto|sms|geo):/i.test(url)) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    if (/^https?:/i.test(url) && looksLikePdf(url)) {
      loadPdf(url);
      return false;
    }
    if (/^intent:/i.test(url)) return false;
    return true;
  }, [loadPdf]);

  const showingPdf = !!(pdf || pdfError || (req && looksLikePdf(req.url)));

  return (
    <Modal visible={!!req} animationType="slide" onRequestClose={goBack} statusBarTranslucent>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={close} hitSlop={10} style={styles.btn} accessibilityLabel="Schließen">
            <Feather name="x" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={styles.titleBox}>
            <Text style={styles.title} numberOfLines={1}>{title || hostOf(currentUrl)}</Text>
            <Text style={styles.url} numberOfLines={1}>{hostOf(currentUrl)}</Text>
          </View>
          <Pressable onPress={goBack} hitSlop={8} style={styles.btn} accessibilityLabel="Zurück">
            <Feather name="chevron-left" size={24} color="#FFFFFF" />
          </Pressable>
          {!showingPdf ? (
            <>
              <Pressable onPress={() => webRef.current?.goForward()} disabled={!canForward} hitSlop={8} style={styles.btn}>
                <Feather name="chevron-right" size={24} color={canForward ? "#FFFFFF" : "rgba(255,255,255,0.3)"} />
              </Pressable>
              <Pressable onPress={() => webRef.current?.reload()} hitSlop={8} style={styles.btn}>
                <Feather name="rotate-cw" size={20} color="#FFFFFF" />
              </Pressable>
            </>
          ) : null}
        </View>
        {loading ? <View style={styles.progress}><ActivityIndicator size="small" color="#4A90D9" /></View> : null}
        {req ? (
          showingPdf ? (
            pdfError ? (
              <View style={styles.errorBox}>
                <Feather name="file-text" size={36} color="#8E8E93" />
                <Text style={styles.errorText}>{pdfError}</Text>
                <Pressable onPress={() => loadPdf(currentUrl)} style={styles.retry}>
                  <Text style={styles.retryText}>Erneut versuchen</Text>
                </Pressable>
              </View>
            ) : pdf ? (
              <WebView
                key={`pdf-${currentUrl}`}
                originWhitelist={["*"]}
                source={{ html: pdf.html, baseUrl: "https://cdnjs.cloudflare.com/" }}
                style={styles.web}
                javaScriptEnabled
              />
            ) : (
              <View style={styles.errorBox}><ActivityIndicator size="large" color="#4A90D9" /></View>
            )
          ) : (
            <WebView
              ref={webRef}
              key={req.url}
              source={{ uri: req.url }}
              style={styles.web}
              onNavigationStateChange={onNav}
              onShouldStartLoadWithRequest={onShouldStart}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              setSupportMultipleWindows={false}
              javaScriptEnabled
              domStorageEnabled
              allowsBackForwardNavigationGestures
              startInLoadingState
              renderLoading={() => <View style={styles.errorBox}><ActivityIndicator size="large" color="#4A90D9" /></View>}
            />
          )
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0E1A" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    height: 52,
    backgroundColor: "#0A4D8C",
    gap: 4,
  },
  btn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  titleBox: { flex: 1, paddingHorizontal: 4 },
  title: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  url: { color: "rgba(255,255,255,0.7)", fontSize: 11 },
  progress: { position: "absolute", top: 60, right: 16, zIndex: 10 },
  web: { flex: 1, backgroundColor: "#FFFFFF" },
  errorBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12, backgroundColor: "#1A202C" },
  errorText: { color: "#FFFFFF", textAlign: "center", fontSize: 15 },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: "#0A4D8C" },
  retryText: { color: "#FFFFFF", fontWeight: "700" },
});
