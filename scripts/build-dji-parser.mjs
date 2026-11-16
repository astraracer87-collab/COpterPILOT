#!/usr/bin/env node
// Erzeugt client/lib/djiLogParserBundle.ts aus dem npm-Paket dji-log-parser-js
// (MIT, © Luc Vauvillier, https://github.com/lvauvillier/dji-log-parser).
//
// Das Paket ist ein ES-Modul mit eingebettetem WebAssembly (Base64), das beim
// Import SYNCHRON instanziiert wird. Für die versteckte WebView der App
// (Hermes hat kein WebAssembly) wird daraus ein klassisches Skript:
//
//  1. `export` entfernt, alles in eine IIFE gekapselt.
//  2. Synchrones `new WebAssembly.Module/Instance` durch asynchrones
//     `WebAssembly.instantiate` ersetzt (Chromium verbietet die synchrone
//     Übersetzung großer Module im Hauptthread).
//  3. Das WebAssembly mit binaryen auf den MVP-Funktionsumfang gebracht:
//     Das Paket ist mit rustc 1.83 gebaut und kündigt `reference-types` und
//     `multivalue` an (erst ab Chromium 96 verfügbar). Beides wird tatsächlich
//     nicht benutzt; binaryen kodiert das Modul neu, senkt `sign-ext` ab und
//     entfernt die Feature-Sektion. Damit läuft der Parser auch in älteren
//     Android-System-WebViews (Android 11 auf der DJI RC Pro 2).
//
// Ergebnis: window.__djiLogParser = Promise<{ DJILog }>.
//
// Aufruf: node scripts/build-dji-parser.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = dirname(require.resolve("dji-log-parser-js/package.json"));
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
let src = readFileSync(join(pkgDir, pkg.main), "utf8");

function mustReplace(pattern, replacement, label) {
  const before = src;
  src = src.replace(pattern, replacement);
  if (src === before) throw new Error(`build-dji-parser: Muster nicht gefunden (${label}) – Paketstand geändert?`);
}

// 1) WebAssembly herauslösen und MVP-kompatibel neu kodieren
const wasmMatch = src.match(/__toBinary\("([A-Za-z0-9+/=]+)"\)/);
if (!wasmMatch) throw new Error("build-dji-parser: eingebettetes WebAssembly nicht gefunden");
const tmp = mkdtempSync(join(tmpdir(), "dji-parser-"));
let wasmB64;
try {
  const orig = join(tmp, "orig.wasm");
  const lowered = join(tmp, "lowered.wasm");
  const out = join(tmp, "mvp.wasm");
  writeFileSync(orig, Buffer.from(wasmMatch[1], "base64"));
  const wasmOpt = join(dirname(require.resolve("binaryen/package.json")), "bin", "wasm-opt");
  // Validiert beim Laden gegen die erlaubten Features – schlägt fehl, falls das
  // Modul reference-types/multivalue doch benutzt.
  execFileSync(process.execPath, [wasmOpt, orig, "--mvp-features", "--enable-sign-ext", "--signext-lowering", "-o", lowered], { stdio: "pipe" });
  execFileSync(process.execPath, [wasmOpt, lowered, "--mvp-features", "--strip-target-features", "-o", out], { stdio: "pipe" });
  wasmB64 = readFileSync(out).toString("base64");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
src = src.replace(wasmMatch[0], () => `__toBinary("${wasmB64}")`);

// 2) Synchrone Instanziierung → asynchron
mustReplace(
  /const wasmModule = new WebAssembly\.Module\(bytes\);\s*const wasmInstance = new WebAssembly\.Instance\(wasmModule, imports\);\s*wasm = wasmInstance\.exports;\s*export const __wasm = imports\.__wasm = wasm;\s*export default imports;?/,
  () =>
    "var __ready = WebAssembly.instantiate(bytes, imports).then(function (r) {\n" +
    "  wasm = r.instance.exports;\n" +
    "  imports.__wasm = wasm;\n" +
    "  return { DJILog: DJILogClass };\n" +
    "});\n",
  "Instanziierung",
);

// 3) ES-Modul → klassisches Skript
src = src.replace(/^export const /gm, "const ");
if (/^export /m.test(src)) throw new Error("build-dji-parser: unerwartete export-Anweisung übrig");

const script =
  `/* dji-log-parser-js ${pkg.version} (MIT, (c) Luc Vauvillier and other contributors) - rebuilt for WebView */\n` +
  "(function () {\n" +
  src +
  "\nwindow.__djiLogParser = __ready;\n" +
  "})();\n";

const banner = `/* eslint-disable */
/**
 * dji-log-parser-js ${pkg.version} (MIT, © Luc Vauvillier and other contributors,
 * https://github.com/lvauvillier/dji-log-parser) – eingebettet, damit DJI-Flugprotokolle
 * ohne Server und ohne Internet in einer versteckten WebView ausgewertet werden.
 * GENERIERT von scripts/build-dji-parser.mjs – nicht von Hand ändern.
 */
`;
// Nur ASCII: sonst speichert Hermes den ganzen String als UTF-16 (doppelte Größe).
if (/[^\x00-\x7f]/.test(script)) throw new Error("build-dji-parser: Skript enthält Nicht-ASCII-Zeichen");
const outFile = join(root, "client", "lib", "djiLogParserBundle.ts");
writeFileSync(
  outFile,
  banner +
    `export const DJI_LOG_PARSER_VERSION = ${JSON.stringify(pkg.version)};\n` +
    `export const DJI_LOG_PARSER_JS: string = ${JSON.stringify(script)};\n`,
);
console.log(`geschrieben: ${outFile} (${Math.round(script.length / 1024)} KB, WebAssembly ${Math.round((wasmB64.length * 3) / 4 / 1024)} KB)`);
