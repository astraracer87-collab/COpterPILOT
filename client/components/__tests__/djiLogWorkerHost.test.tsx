/**
 * Versteckte Worker-WebView für DJI-Logs: existiert nur bei Bedarf, lädt den
 * Parser offline (HTML inline, keine Netz-Navigation), leitet Nachrichten an
 * den Hub weiter und startet nach einem Absturz neu.
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";

const mockWebView = {
  mounted: 0,
  latestProps: null as any,
  injected: [] as string[],
};
jest.mock("react-native-webview", () => {
  const ReactLib = require("react");
  const { View } = require("react-native");
  const WebView = ReactLib.forwardRef((props: any, ref: any) => {
    ReactLib.useImperativeHandle(ref, () => ({
      injectJavaScript: (js: string) => mockWebView.injected.push(js),
    }));
    ReactLib.useEffect(() => {
      mockWebView.mounted += 1;
      return () => {
        mockWebView.mounted -= 1;
      };
    }, []);
    mockWebView.latestProps = props;
    return ReactLib.createElement(View, null);
  });
  return { __esModule: true, WebView };
});

import { DjiLogWorkerHost } from "../DjiLogWorkerHost";
import { djiLogWorkerHub } from "@/lib/djiLogWorkerHub";

describe("DjiLogWorkerHost", () => {
  it("rendert die WebView nur bei Bedarf und verbindet den Hub", async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DjiLogWorkerHost />);
    });
    expect(mockWebView.mounted).toBe(0);

    let acquired: Promise<unknown> | null = null;
    await act(async () => {
      acquired = djiLogWorkerHub.acquire(2000);
    });
    expect(mockWebView.mounted).toBe(1);
    const props = mockWebView.latestProps;
    expect(props.source.html).toContain("window.__djiLogParser");
    expect(props.source.html).toContain("window.__djiWorker");
    expect(props.javaScriptEnabled).toBe(true);
    // keine Navigation ins Netz aus der Worker-WebView
    expect(
      props.onShouldStartLoadWithRequest({ url: "https://example.com" }),
    ).toBe(false);
    expect(props.onShouldStartLoadWithRequest({ url: "about:blank" })).toBe(
      true,
    );

    // WebView meldet "ready" → acquire löst auf
    await act(async () => {
      props.onMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: "ready",
            protocol: 1,
            parserVersion: "0.5.7",
          }),
        },
      });
    });
    const client: any = await acquired;
    expect(client.isReady).toBe(true);

    // Anfrage wird als JS injiziert
    const p = client.inspect("job-1").catch((e: Error) => e);
    expect(mockWebView.injected[mockWebView.injected.length - 1]).toContain(
      '"type":"inspect"',
    );
    // Absturz → laufender Auftrag endet mit Fehler, WebView startet neu
    await act(async () => {
      props.onRenderProcessGone({ nativeEvent: {} });
    });
    expect(String(await p)).toMatch(/abgestürzt/);
    expect(mockWebView.mounted).toBe(1);

    djiLogWorkerHub.releaseClient();
    await act(async () => {
      tree.unmount();
    });
    expect(mockWebView.mounted).toBe(0);
  });
});
