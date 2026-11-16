import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { djiLogWorkerHub } from "@/lib/djiLogWorkerHub";

/**
 * Unsichtbare "Worker"-WebView für die Auswertung von DJI-Flugprotokollen.
 *
 * Hermes kennt kein WebAssembly – dji-log-parser (Rust → WebAssembly) läuft
 * deshalb in der Android-System-WebView, also in einem eigenen Thread. Die
 * WebView existiert nur, solange Auswertungen laufen (plus kurze Leerlaufzeit,
 * siehe djiLogWorkerHub). Einmal in App.tsx eingehängt.
 */
export function DjiLogWorkerHost() {
  const [wanted, setWanted] = useState(() => djiLogWorkerHub.isWanted());
  const [generation, setGeneration] = useState(() =>
    djiLogWorkerHub.getGeneration(),
  );

  useEffect(
    () =>
      djiLogWorkerHub.subscribe(() => {
        setWanted(djiLogWorkerHub.isWanted());
        setGeneration(djiLogWorkerHub.getGeneration());
      }),
    [],
  );

  if (!wanted || Platform.OS === "web") return null;
  return <WorkerWebView key={generation} />;
}

function WorkerWebView() {
  const ref = useRef<WebView>(null);

  // Das große HTML (Parser ~0,7 MB) erst bei Bedarf erzeugen.
  const html = useMemo(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const {
      DJI_LOG_PARSER_JS,
      DJI_LOG_PARSER_VERSION,
    } = require("@/lib/djiLogParserBundle");
    const { buildDjiWorkerHtml } = require("@/lib/djiLogWorkerScript");
    /* eslint-enable @typescript-eslint/no-require-imports */
    return buildDjiWorkerHtml(
      DJI_LOG_PARSER_JS,
      DJI_LOG_PARSER_VERSION,
    ) as string;
  }, []);

  useEffect(() => {
    djiLogWorkerHub.attach((js) => ref.current?.injectJavaScript(js));
    return () => djiLogWorkerHub.detach("Die Log-Auswertung wurde beendet.");
  }, []);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    djiLogWorkerHub.onMessage(e.nativeEvent.data);
  }, []);

  const onCrash = useCallback(() => {
    djiLogWorkerHub.detach(
      "Die Log-Auswertung ist abgestürzt (zu wenig Speicher?).",
      { restart: true },
    );
  }, []);

  return (
    <View
      style={styles.hidden}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
    >
      <WebView
        ref={ref}
        source={{ html, baseUrl: "about:blank" }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled={false}
        cacheEnabled={false}
        incognito
        allowFileAccess={false}
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(req) =>
          !/^(https?|file|intent):/i.test(req?.url || "")
        }
        onMessage={onMessage}
        onRenderProcessGone={onCrash}
        onContentProcessDidTerminate={onCrash}
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    left: 0,
    top: 0,
    opacity: 0,
    overflow: "hidden",
  },
  webview: { width: 1, height: 1, backgroundColor: "transparent" },
});
