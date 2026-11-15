import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { normalizePortugueseZones, portugueseMessage } from "../../../shared/portugueseGeozones";
import { parseEd269ToGeozoneInfo } from "../ed269";

const body = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "anac-pt-ed269-sample.json"), "utf8"));

describe("Portugal (ANAC) – ED-269", () => {
  it("zweisprachige Meldung: englischer Teil", () => {
    assert.equal(portugueseMessage("PT-Categoria aberta: proibido. EN-Open category: prohibited."), "Open category: prohibited.");
  });
  it("Kreise werden Polygone, Höhen in Metern", () => {
    const f = normalizePortugueseZones(body);
    assert.ok(f.length >= body.features.length);
    for (const x of f) assert.ok(["Polygon", "MultiPolygon"].includes(x.geometry.type));
    const circle = f.find((x: any) => x.properties.name === body.features.find((z: any) => z.geometry[0].horizontalProjection.type === "Circle").name);
    assert.ok(circle);
    assert.equal(circle.properties.upperMeters, 120);
  });
  it("lässt sich als Geozonen-Info darstellen", () => {
    const infos = parseEd269ToGeozoneInfo(normalizePortugueseZones(body), "PT");
    assert.ok(infos.length >= 1);
    assert.ok(infos.every((i) => i.restriction));
  });
});
