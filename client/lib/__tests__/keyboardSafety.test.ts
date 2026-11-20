// App-weite Regel: Eingabefelder bleiben bei offener Tastatur sichtbar.
// - Jedes TextInput hat disableFullscreenUI (keine Vollbild-Eingabe im Querformat)
// - Eingabefelder in einem <Modal> brauchen useKeyboardInset (Android verkleinert
//   Modal-Fenster nicht)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === "__tests__" || n === "node_modules") continue;
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const ROOT = join(__dirname, "..", "..");
const files = tsxFiles(ROOT).map((f) => ({ f, src: readFileSync(f, "utf8") }));

describe("Tastatur", () => {
  it("jedes TextInput mit disableFullscreenUI", () => {
    const bad: string[] = [];
    for (const { f, src } of files) {
      const re = /<TextInput\b([\s\S]*?)\/?>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) if (!/disableFullscreenUI/.test(m[1])) bad.push(f);
    }
    assert.deepEqual([...new Set(bad)], []);
  });

  it("Eingabefelder in Modals weichen der Tastatur aus (useKeyboardInset)", () => {
    const bad: string[] = [];
    for (const { f, src } of files) {
      let depth = 0;
      let inputInModal = false;
      for (const line of src.split("\n")) {
        if (/<Modal\b/.test(line)) depth++;
        if (line.includes("</Modal>")) depth--;
        if (depth > 0 && line.includes("<TextInput")) inputInModal = true;
      }
      if (inputInModal && !src.includes("useKeyboardInset")) bad.push(f);
    }
    assert.deepEqual(bad, []);
  });
});
