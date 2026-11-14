// Keep DST boundary assertions independent from the machine running the tests.
// The planning helpers intentionally use the device's local calendar/time.
process.env.TZ = "Europe/Berlin";

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  dateForLocalTime,
  formatLocalDateKey,
  getDeviceTimeZone,
  parseLocalDateKey,
} from "../planningDateTime";

describe("planning date/time picker values", () => {
  it("formats and parses a local date without UTC day shifts", () => {
    const source = new Date(2026, 8, 6, 18, 30, 0, 0);
    const key = formatLocalDateKey(source);
    const parsed = parseLocalDateKey(key);

    assert.equal(key, "2026-09-06");
    assert.equal(parsed?.getFullYear(), 2026);
    assert.equal(parsed?.getMonth(), 8);
    assert.equal(parsed?.getDate(), 6);
  });

  it("creates tomorrow's time picker value on tomorrow, not today", () => {
    const value = dateForLocalTime("2026-09-06", "08:15");

    assert.equal(formatLocalDateKey(value), "2026-09-06");
    assert.equal(value.getHours(), 8);
    assert.equal(value.getMinutes(), 15);
  });

  it("keeps both picker values local immediately before and after spring DST starts", () => {
    const startBeforeTransition = dateForLocalTime("2026-03-29", "01:59");
    const endBeforeTransition = dateForLocalTime("2026-03-29", "01:59");
    const startAfterTransition = dateForLocalTime("2026-03-29", "03:01");
    const endAfterTransition = dateForLocalTime("2026-03-29", "03:01");

    for (const value of [
      startBeforeTransition,
      endBeforeTransition,
      startAfterTransition,
      endAfterTransition,
    ]) {
      assert.equal(formatLocalDateKey(value), "2026-03-29");
    }

    assert.equal(startBeforeTransition.getHours(), 1);
    assert.equal(startBeforeTransition.getMinutes(), 59);
    assert.equal(endBeforeTransition.getHours(), 1);
    assert.equal(endBeforeTransition.getMinutes(), 59);
    assert.equal(startAfterTransition.getHours(), 3);
    assert.equal(startAfterTransition.getMinutes(), 1);
    assert.equal(endAfterTransition.getHours(), 3);
    assert.equal(endAfterTransition.getMinutes(), 1);
    assert.equal(startBeforeTransition.getTimezoneOffset(), -60);
    assert.equal(startAfterTransition.getTimezoneOffset(), -120);
  });

  it("keeps both picker values local immediately before and after autumn DST ends", () => {
    const startBeforeTransition = dateForLocalTime("2026-10-25", "02:59");
    const endBeforeTransition = dateForLocalTime("2026-10-25", "02:59");
    const startAfterTransition = dateForLocalTime("2026-10-25", "03:01");
    const endAfterTransition = dateForLocalTime("2026-10-25", "03:01");

    for (const value of [
      startBeforeTransition,
      endBeforeTransition,
      startAfterTransition,
      endAfterTransition,
    ]) {
      assert.equal(formatLocalDateKey(value), "2026-10-25");
    }

    assert.equal(startBeforeTransition.getHours(), 2);
    assert.equal(startBeforeTransition.getMinutes(), 59);
    assert.equal(endBeforeTransition.getHours(), 2);
    assert.equal(endBeforeTransition.getMinutes(), 59);
    assert.equal(startAfterTransition.getHours(), 3);
    assert.equal(startAfterTransition.getMinutes(), 1);
    assert.equal(endAfterTransition.getHours(), 3);
    assert.equal(endAfterTransition.getMinutes(), 1);
    assert.equal(startBeforeTransition.getTimezoneOffset(), -120);
    assert.equal(startAfterTransition.getTimezoneOffset(), -60);
  });

  it("keeps the selected end-time independent from the planning date", () => {
    const value = dateForLocalTime(formatLocalDateKey(new Date()), "17:45");

    assert.equal(value.getHours(), 17);
    assert.equal(value.getMinutes(), 45);
  });

  it("exposes the runtime timezone for the native picker bridge", () => {
    assert.equal(getDeviceTimeZone(), "Europe/Berlin");
  });

  it("rejects impossible calendar dates", () => {
    assert.equal(parseLocalDateKey("2026-02-30"), null);
    assert.notEqual(parseLocalDateKey("2026-09-06"), null);
  });
});
