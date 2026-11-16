// Führt das Worker-HTML (Parser-WebAssembly + Worker-Skript) wie die
// Android-WebView aus – nur in einem Node-vm-Kontext. Nachrichten gehen exakt
// so hinein wie in der App (encodeWorkerRequest → JS-Quelltext) und kommen als
// JSON-Strings über window.ReactNativeWebView.postMessage heraus.
import vm from "node:vm";

import {
  DJI_LOG_PARSER_JS,
  DJI_LOG_PARSER_VERSION,
} from "../../djiLogParserBundle";
import {
  buildDjiWorkerScript,
  type DjiWorkerConfig,
} from "../../djiLogWorkerScript";
import {
  encodeWorkerRequest,
  type DjiWorkerRequest,
} from "../../djiLogWorkerProtocol";

export interface WorkerVm {
  /** wie injectJavaScript */
  inject(js: string): void;
  send(msg: DjiWorkerRequest): void;
  /** alle bisher gesendeten Antworten (roh) */
  outbox: string[];
  onMessage: ((raw: string) => void) | null;
}

export function createWorkerVm(
  overrides: Partial<DjiWorkerConfig> = {},
): WorkerVm {
  const outbox: string[] = [];
  const self: WorkerVm = {
    outbox,
    onMessage: null,
    inject(js) {
      vm.runInContext(js, ctx);
    },
    send(msg) {
      self.inject(encodeWorkerRequest(msg));
    },
  };
  const windowObj: Record<string, unknown> = {
    ReactNativeWebView: {
      postMessage(s: string) {
        outbox.push(s);
        // asynchron wie die echte Brücke
        setImmediate(() => self.onMessage?.(s));
      },
    },
  };
  const ctx = vm.createContext({
    window: windowObj,
    TextDecoder,
    TextEncoder,
    atob,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    FinalizationRegistry,
    console,
  });
  // Browser: globale Variablen hängen an window
  vm.runInContext(
    "var globalThis_ = this; window.WebAssembly = WebAssembly;",
    ctx,
  );
  // Parser schreibt window.__djiLogParser; Worker liest window.*
  vm.runInContext(DJI_LOG_PARSER_JS, ctx);
  vm.runInContext(buildDjiWorkerScript(DJI_LOG_PARSER_VERSION, overrides), ctx);
  return self;
}
