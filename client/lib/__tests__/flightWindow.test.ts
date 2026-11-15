import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeFlightWindow,
  crossesMidnight,
  effectiveEndMinutes,
  flightWindowLocalIso,
  flightWindowSampleTimes,
  formatDurationMinutes,
  formatFlightWindowRange,
  formatHHMM,
  formatPlannedTimeRange,
  parseHHMM,
  windowDurationMinutes,
} from "../../../shared/flightWindow";
import {
  isZoneActiveInContext,
  zoneTimeReferences,
  type ZoneActivityInput,
} from "../../../shared/ed269Restriction";
import { isFlightWindowDuringNight } from "../../../shared/solar";
import { aggregate } from "../../../shared/checks";
import { nightChecks } from "../flightChecks";

// Alle Zeiten werden lokal gebaut (new Date(y, m, d, h, min)), damit die Tests
// unabhängig von der Zeitzone des Runners sind.
const local = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

describe("Flugfenster über Mitternacht (reine Helfer)", () => {
  it("parseHHMM / formatHHMM", () => {
    assert.equal(parseHHMM("23:30"), 1410);
    assert.equal(parseHHMM("3:05"), 185);
    assert.equal(parseHHMM("24:00"), null);
    assert.equal(parseHHMM("abc"), null);
    assert.equal(parseHHMM(undefined), null);
    assert.equal(formatHHMM(1410), "23:30");
    assert.equal(formatHHMM(1440 + 180), "03:00");
    assert.equal(formatHHMM(-15), "23:45");
  });

  it("Ende <= Start = Folgetag", () => {
    assert.equal(effectiveEndMinutes(1410, 180), 1620);
    assert.equal(windowDurationMinutes(1410, 180), 210);
    assert.equal(crossesMidnight(1410, 180), true);
    assert.equal(windowDurationMinutes(600, 720), 120);
    assert.equal(crossesMidnight(600, 720), false);
    // Gleiche Uhrzeit = volles 24-h-Fenster (nicht 0 min)
    assert.equal(windowDurationMinutes(600, 600), 1440);
  });

  it("23:30–03:00 → Ende am Folgetag 03:00, Dauer 3 h 30 min", () => {
    const w = computeFlightWindow("2026-11-15", "23:30", "03:00");
    assert.ok(w);
    assert.equal(w.start.getTime(), local(2026, 11, 15, 23, 30).getTime());
    assert.equal(w.end.getTime(), local(2026, 11, 16, 3, 0).getTime());
    assert.equal(w.durationMin, 210);
    assert.equal(w.crossesMidnight, true);
    assert.equal(w.endDateKey, "2026-11-16");
    assert.equal(w.startMin, 1410);
    assert.equal(w.endMin, 1620);
  });

  it("Monats-/Jahreswechsel über Mitternacht", () => {
    const w = computeFlightWindow("2026-12-31", "22:00", "01:15");
    assert.ok(w);
    assert.equal(w.endDateKey, "2027-01-01");
    assert.equal(w.end.getTime(), local(2027, 1, 1, 1, 15).getTime());
    assert.equal(w.durationMin, 195);
  });

  it("gleicher Tag bleibt unverändert", () => {
    const w = computeFlightWindow("2026-11-15", "10:00", "12:30");
    assert.ok(w);
    assert.equal(w.crossesMidnight, false);
    assert.equal(w.endDateKey, "2026-11-15");
    assert.equal(w.durationMin, 150);
  });

  it("ungültige Eingaben", () => {
    assert.equal(computeFlightWindow("2026-02-30", "10:00", "11:00"), null);
    assert.equal(computeFlightWindow("2026-11-15", "x", "11:00"), null);
    // Fehlende Endzeit → Fallback-Dauer
    assert.equal(computeFlightWindow("2026-11-15", "23:30", undefined)?.durationMin, 60);
  });

  it("lokale ISO-Strings tragen beim Ende das Folgedatum", () => {
    assert.deepEqual(flightWindowLocalIso("2026-11-15", "23:30", "03:00"), {
      startIso: "2026-11-15T23:30",
      endIso: "2026-11-16T03:00",
    });
    assert.deepEqual(flightWindowLocalIso("2026-11-15", "10:00", "11:00"), {
      startIso: "2026-11-15T10:00",
      endIso: "2026-11-15T11:00",
    });
  });

  it("Anzeige-Texte", () => {
    assert.equal(formatFlightWindowRange("23:30", "03:00"), "23:30–03:00 (+1 Tag)");
    assert.equal(formatFlightWindowRange("10:00", "12:00"), "10:00–12:00");
    assert.equal(formatDurationMinutes(210), "3h 30min");
    assert.equal(formatDurationMinutes(60), "1h");
    assert.equal(formatDurationMinutes(45), "45min");
    assert.equal(
      `Flugzeit ${formatFlightWindowRange("23:30", "03:00")} · ${formatDurationMinutes(210)}`,
      "Flugzeit 23:30–03:00 (+1 Tag) · 3h 30min",
    );
    // Logbuch: echte Endzeit, Altbestand ohne Endzeit wie bisher (+2 h)
    assert.equal(formatPlannedTimeRange("23:30", "03:00"), "23:30 - 03:00 (+1 Tag)");
    assert.equal(formatPlannedTimeRange("23:30", undefined), "23:30 - 01:30");
  });

  it("Abtastung deckt das ganze Fenster inkl. Folgetag ab", () => {
    const w = computeFlightWindow("2026-11-15", "23:30", "03:00")!;
    const samples = flightWindowSampleTimes(w.start, w.end, 15);
    assert.equal(samples[0].getTime(), w.start.getTime());
    assert.equal(samples[samples.length - 1].getTime(), w.end.getTime());
    assert.equal(samples.length, 15); // 23:30, 23:45, …, 02:45, 03:00
    assert.ok(samples.some((d) => d.getTime() === local(2026, 11, 16, 1, 0).getTime()));
  });
});

describe("Nachgelagerte Prüfungen nutzen das volle Fenster", () => {
  const w = computeFlightWindow("2026-11-15", "23:30", "03:00")!;

  // Temporäre Beschränkung (NOTAM-artig) nur 01:00–02:00 am Folgetag.
  const notamLikeZone: ZoneActivityInput = {
    validStartTs: local(2026, 11, 16, 1, 0).getTime(),
    validEndTs: local(2026, 11, 16, 2, 0).getTime(),
  };

  it("Zone 01:00–02:00 wird für 23:30–03:00 erkannt", () => {
    assert.equal(
      isZoneActiveInContext(notamLikeZone, { kind: "planned", planned: w.start, plannedEnd: w.end }),
      true,
    );
  });

  it("ohne Fensterende (nur Startzeitpunkt) wäre sie übersehen worden", () => {
    assert.equal(isZoneActiveInContext(notamLikeZone, { kind: "planned", planned: w.start }), false);
  });

  it("kurze Aktivität zwischen zwei Abtastpunkten wird über ihren Beginn erfasst", () => {
    const brief: ZoneActivityInput = {
      validStartTs: local(2026, 11, 16, 1, 5).getTime(),
      validEndTs: local(2026, 11, 16, 1, 10).getTime(),
    };
    assert.equal(isZoneActiveInContext(brief, { kind: "planned", planned: w.start, plannedEnd: w.end }), true);
  });

  it("Zone nach dem Fensterende bleibt inaktiv", () => {
    const later: ZoneActivityInput = {
      validStartTs: local(2026, 11, 16, 4, 0).getTime(),
      validEndTs: local(2026, 11, 16, 5, 0).getTime(),
    };
    assert.equal(isZoneActiveInContext(later, { kind: "planned", planned: w.start, plannedEnd: w.end }), false);
  });

  it("Pre-Check-Kontext tastet das Fenster ebenfalls ab", () => {
    const now = local(2026, 11, 15, 20, 0);
    const refs = zoneTimeReferences({ kind: "precheck", planned: w.start, plannedEnd: w.end, now });
    assert.equal(refs[0].getTime(), now.getTime());
    assert.equal(refs[refs.length - 1].getTime(), w.end.getTime());
    assert.equal(
      isZoneActiveInContext(notamLikeZone, { kind: "precheck", planned: w.start, plannedEnd: w.end, now }),
      true,
    );
  });

  it("Nachtflug-Prüfung: 23:30–03:00 ist Nacht", () => {
    const r = isFlightWindowDuringNight(52.52, 13.405, local(2026, 11, 15, 0), w.startMin, parseHHMM("03:00")!);
    assert.equal(r.anyNight, true);
    assert.equal(r.allNight, true);
  });

  it("Gesamturteil: Fenster ab Tageslicht bis nach Mitternacht wird als Nacht erkannt (NL = Verbot)", () => {
    // 21.06., Amsterdam: 19:00 UTC Sonne ~8° (Tag), um 00:00 UTC ~-14° (Nacht).
    const at = new Date(Date.UTC(2026, 5, 21, 19, 0));
    const until = new Date(Date.UTC(2026, 5, 22, 1, 0));
    const base = { context: "planning" as const, latitude: 52.37, longitude: 4.9 };
    assert.notEqual(aggregate(nightChecks({ ...base, at })).verdict, "nogo");
    assert.equal(aggregate(nightChecks({ ...base, at, until })).verdict, "nogo");
  });
});
