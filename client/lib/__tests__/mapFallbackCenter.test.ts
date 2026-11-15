// Ersatz-Mittelpunkt der Radar-Karte ohne Standort: GPS → letzte Position →
// erstes aktives Land → Deutschland; Speicher der letzten Position.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  __resetLastKnownPositionForTests,
  COUNTRY_CENTERS,
  LAST_POSITION_STORAGE_KEY,
  loadLastKnownPosition,
  mapCenterHint,
  resolveMapCenter,
  saveLastKnownPosition,
} from "../mapFallbackCenter";
import { USAGE_COUNTRIES } from "../countryUsage";

function memStorage() {
  const m = new Map<string, string>();
  return { m, getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v) };
}

describe("resolveMapCenter", () => {
  it("GPS hat Vorrang", () => {
    const c = resolveMapCenter({ gps: { latitude: 50.1, longitude: 8.6 }, lastKnown: { latitude: 48, longitude: 11, timestamp: 1 }, activeCountries: ["AT"] });
    assert.equal(c.source, "gps");
    assert.equal(c.latitude, 50.1);
    assert.equal(mapCenterHint(c.source), null);
  });
  it("ohne GPS: letzte bekannte Position", () => {
    const c = resolveMapCenter({ gps: null, lastKnown: { latitude: 48.1, longitude: 11.5, timestamp: 1 }, activeCountries: ["AT"] });
    assert.equal(c.source, "last");
    assert.deepEqual([c.latitude, c.longitude], [48.1, 11.5]);
    assert.equal(mapCenterHint("last"), "Kein Standort – Karte zeigt letzte bekannte Position");
  });
  it("ohne Position: Mitte des ersten aktiven Landes", () => {
    const c = resolveMapCenter({ activeCountries: ["IT", "DE"] });
    assert.equal(c.source, "country");
    assert.equal(c.iso, "IT");
    assert.equal(c.latitude, COUNTRY_CENTERS.IT.lat);
    assert.ok(mapCenterHint("country"));
  });
  it("ungültige Werte (NaN, 0/0) werden übersprungen; sonst Deutschland", () => {
    const c = resolveMapCenter({ gps: { latitude: NaN, longitude: 8 }, lastKnown: { latitude: 0, longitude: 0, timestamp: 1 }, activeCountries: ["XX"] });
    assert.equal(c.source, "default");
    assert.equal(c.iso, "DE");
  });
  it("jedes Land der Länder-Nutzung hat eine Mitte", () => {
    for (const { iso } of USAGE_COUNTRIES) assert.ok(COUNTRY_CENTERS[iso], iso);
  });
});

describe("letzte bekannte Position (Speicher)", () => {
  let st: ReturnType<typeof memStorage>;
  beforeEach(() => {
    st = memStorage();
    __resetLastKnownPositionForTests(st);
  });
  it("speichert und lädt nach Neustart", async () => {
    await saveLastKnownPosition(51.3, 9.5, 1000);
    assert.ok(st.m.get(LAST_POSITION_STORAGE_KEY));
    __resetLastKnownPositionForTests(st); // „Neustart“
    const p = await loadLastKnownPosition();
    assert.deepEqual(p, { latitude: 51.3, longitude: 9.5, timestamp: 1000 });
  });
  it("ignoriert ungültige Positionen und kaputten Speicher", async () => {
    await saveLastKnownPosition(NaN, 9);
    assert.equal(st.m.size, 0);
    st.m.set(LAST_POSITION_STORAGE_KEY, "{kaputt");
    __resetLastKnownPositionForTests(st);
    assert.equal(await loadLastKnownPosition(), null);
  });
  it("drosselt Schreibzugriffe bei kleinen Bewegungen", async () => {
    let writes = 0;
    const counting = { getItem: st.getItem, setItem: async (k: string, v: string) => { writes++; await st.setItem(k, v); } };
    __resetLastKnownPositionForTests(counting);
    await saveLastKnownPosition(51.3, 9.5);
    await saveLastKnownPosition(51.3001, 9.5001);
    assert.equal(writes, 1);
    await saveLastKnownPosition(51.4, 9.5); // > 500 m
    assert.equal(writes, 2);
  });
});
