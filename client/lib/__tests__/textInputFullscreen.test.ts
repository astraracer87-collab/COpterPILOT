// Querformat der Fernsteuerung: Android darf beim Tippen KEINE Vollbild-
// Eingabemaske („Extract Mode“ mit FERTIG-Taste) öffnen. Jedes <TextInput
// braucht deshalb disableFullscreenUI – dieser Test verhindert Rückfälle.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const CLIENT_DIR = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Text des öffnenden Tags ab `<TextInput` bis zum Tag-Ende (`/>` bzw. `>` außerhalb von {…}). */
function openingTag(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

describe("TextInput ohne Vollbild-Tastatur", () => {
  it("jedes <TextInput in client/ setzt disableFullscreenUI", () => {
    const missing: string[] = [];
    let total = 0;
    for (const file of walk(CLIENT_DIR)) {
      const src = fs.readFileSync(file, "utf8");
      const re = /<TextInput(?![A-Za-z0-9_])/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        total++;
        const tag = openingTag(src, m.index);
        if (!/\bdisableFullscreenUI\b/.test(tag)) {
          const line = src.slice(0, m.index).split("\n").length;
          missing.push(`${path.relative(CLIENT_DIR, file)}:${line}`);
        }
      }
    }
    assert.ok(total > 10, `zu wenige TextInputs gefunden (${total}) – Pfad falsch?`);
    assert.deepEqual(missing, [], `TextInput ohne disableFullscreenUI:\n${missing.join("\n")}`);
  });
});
