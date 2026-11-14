import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { decodeMetar, decodeTaf, formatObservedTime, type KlartextRow } from "../aviationWeatherDecode";

function rowMap(rows: KlartextRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) out[r.label] = r.value;
  return out;
}

describe("decodeMetar – Wind", () => {
  it("decodes direction, knots and km/h with compass point", () => {
    const m = rowMap(decodeMetar("EDDF 231150Z 24008KT CAVOK 18/10 Q1018"));
    assert.equal(m.Wind, "aus 240° (WSW), 8 kt (15 km/h)");
  });

  it("reports calm wind as Windstill", () => {
    const m = rowMap(decodeMetar("EDDB 231150Z 00000KT 9999 NSC 20/05 Q1020"));
    assert.equal(m.Wind, "Windstill");
  });

  it("reports variable direction as veränderlich", () => {
    const m = rowMap(decodeMetar("EDDH 231150Z VRB02KT 0300 FG VV002 02/02 Q1012"));
    assert.equal(m.Wind, "veränderlich, 2 kt (4 km/h)");
  });

  it("includes gusts in km/h", () => {
    const m = rowMap(decodeMetar("EDDM 231150Z 27015G28KT 5000 +TSRA BKN012 OVC040CB 14/12 Q1005"));
    assert.equal(m.Wind, "aus 270° (W), 15 kt (28 km/h), Böen 28 kt (52 km/h)");
  });

  it("includes variable wind range when present", () => {
    const m = rowMap(decodeMetar("EDDK 231150Z 24008KT 200V280 9999 FEW030 15/08 Q1015"));
    assert.equal(m.Wind, "aus 240° (WSW), 8 kt (15 km/h), schwankend 200°-280°");
  });
});

describe("decodeMetar – Sicht / CAVOK", () => {
  it("expands CAVOK", () => {
    const m = rowMap(decodeMetar("EDDF 231150Z 24008KT CAVOK 18/10 Q1018"));
    assert.equal(m.Sicht, "CAVOK (10 km oder mehr, keine signifikanten Wolken)");
  });

  it("maps 9999 to 10 km oder mehr", () => {
    const m = rowMap(decodeMetar("EDDB 231150Z 00000KT 9999 NSC 20/05 Q1020"));
    assert.equal(m.Sicht, "10 km oder mehr");
  });

  it("formats 5000 m as 5 km", () => {
    const m = rowMap(decodeMetar("EDDM 231150Z 27015G28KT 5000 +TSRA BKN012 OVC040CB 14/12 Q1005"));
    assert.equal(m.Sicht, "5 km");
  });

  it("keeps low visibility in metres", () => {
    const m = rowMap(decodeMetar("EDDH 231150Z VRB02KT 0300 FG VV002 02/02 Q1012"));
    assert.equal(m.Sicht, "300 m");
  });
});

describe("decodeMetar – Wetter (Phänomene)", () => {
  it("decodes heavy thunderstorm rain", () => {
    const m = rowMap(decodeMetar("EDDM 231150Z 27015G28KT 5000 +TSRA BKN012 OVC040CB 14/12 Q1005"));
    assert.equal(m.Wetter, "stark Gewitter Regen");
  });

  it("decodes fog", () => {
    const m = rowMap(decodeMetar("EDDH 231150Z VRB02KT 0300 FG VV002 02/02 Q1012"));
    assert.equal(m.Wetter, "Nebel");
  });

  it("omits the Wetter row when no phenomena are present", () => {
    const m = rowMap(decodeMetar("EDDF 231150Z 24008KT CAVOK 18/10 Q1018"));
    assert.equal(m.Wetter, undefined);
  });
});

describe("decodeMetar – Wolken & Untergrenze", () => {
  it("decodes multiple cloud layers and marks CB", () => {
    const m = rowMap(decodeMetar("EDDM 231150Z 27015G28KT 5000 +TSRA BKN012 OVC040CB 14/12 Q1005"));
    assert.equal(m.Wolken, "stark bewölkt (5-7/8) in 1200 ft; bedeckt (8/8) in 4000 ft (Gewitterwolke CB)");
  });

  it("computes the lowest BKN/OVC ceiling in ft and m", () => {
    const m = rowMap(decodeMetar("EDDM 231150Z 27015G28KT 5000 +TSRA BKN012 OVC040CB 14/12 Q1005"));
    assert.equal(m.Hauptwolkenuntergrenze, "1200 ft (366 m)");
  });

  it("decodes NSC as keine signifikanten Wolken without a ceiling row", () => {
    const m = rowMap(decodeMetar("EDDB 231150Z 00000KT 9999 NSC 20/05 Q1020"));
    assert.equal(m.Wolken, "keine signifikanten Wolken");
    assert.equal(m.Hauptwolkenuntergrenze, undefined);
  });

  it("reports vertical visibility instead of clouds", () => {
    const m = rowMap(decodeMetar("EDDH 231150Z VRB02KT 0300 FG VV002 02/02 Q1012"));
    assert.equal(m.Wolken, "Vertikalsicht 200 ft");
  });
});

describe("decodeMetar – Temperatur & QNH", () => {
  it("decodes temperature with dew point and QNH", () => {
    const m = rowMap(decodeMetar("EDDF 231150Z 24008KT CAVOK 18/10 Q1018"));
    assert.equal(m.Temperatur, "18 °C / Taupunkt 10 °C");
    assert.equal(m.QNH, "1018 hPa");
  });

  it("decodes negative temperatures", () => {
    const m = rowMap(decodeMetar("EDDF 231150Z 09003KT 9999 FEW020 M03/M06 Q1024"));
    assert.equal(m.Temperatur, "-3 °C / Taupunkt -6 °C");
  });
});

describe("decodeTaf – Gültigkeit & Basis", () => {
  it("formats the validity window", () => {
    const t = decodeTaf("TAF EDDF 231100Z 2312/2418 24010KT 9999 SCT035 BECMG 2316/2318 30015G25KT TEMPO 2400/2406 4000 SHRA BKN012");
    assert.equal(t.validity, "23. 12:00 UTC bis 24. 18:00 UTC");
  });

  it("decodes the base group", () => {
    const t = decodeTaf("TAF EDDF 231100Z 2312/2418 24010KT 9999 SCT035 BECMG 2316/2318 30015G25KT TEMPO 2400/2406 4000 SHRA BKN012");
    const base = rowMap(t.base);
    assert.equal(base.Wind, "aus 240° (WSW), 10 kt (19 km/h)");
    assert.equal(base.Sicht, "10 km oder mehr");
    assert.equal(base.Wolken, "aufgelockert (3-4/8) in 3500 ft");
  });
});

describe("decodeTaf – Trends BECMG / TEMPO", () => {
  const taf = "TAF EDDF 231100Z 2312/2418 24010KT 9999 SCT035 BECMG 2316/2318 30015G25KT TEMPO 2400/2406 4000 SHRA BKN012";

  it("labels BECMG as Übergang with its window", () => {
    const t = decodeTaf(taf);
    assert.equal(t.trends[0].heading, "Übergang (23. 16:00 UTC bis 23. 18:00 UTC)");
    assert.equal(rowMap(t.trends[0].rows).Wind, "aus 300° (WNW), 15 kt (28 km/h), Böen 25 kt (46 km/h)");
  });

  it("labels TEMPO as Zeitweise and decodes its weather", () => {
    const t = decodeTaf(taf);
    assert.equal(t.trends[1].heading, "Zeitweise (24. 00:00 UTC bis 24. 06:00 UTC)");
    const r = rowMap(t.trends[1].rows);
    assert.equal(r.Sicht, "4000 m");
    assert.equal(r.Wetter, "Schauer Regen");
    assert.equal(r.Wolken, "stark bewölkt (5-7/8) in 1200 ft");
  });
});

describe("decodeTaf – Trends FM / PROB", () => {
  const taf = "TAF EDDM 231100Z 2312/2418 27008KT CAVOK FM240600 31012KT 9999 BKN030 PROB30 TEMPO 2410/2414 SHRA";

  it("labels FM as Ab with a timestamp", () => {
    const t = decodeTaf(taf);
    assert.equal(t.trends[0].heading, "Ab 24. 06:00 UTC");
    assert.equal(rowMap(t.trends[0].rows).Wind, "aus 310° (NW), 12 kt (22 km/h)");
  });

  it("includes the probability percentage in the heading", () => {
    const t = decodeTaf(taf);
    assert.equal(t.trends[1].heading, "Zeitweise 30% (24. 10:00 UTC bis 24. 14:00 UTC)");
    assert.equal(rowMap(t.trends[1].rows).Wetter, "Schauer Regen");
  });

  it("expands CAVOK in the base group", () => {
    const t = decodeTaf(taf);
    assert.equal(rowMap(t.base).Sicht, "CAVOK (10 km oder mehr, keine signifikanten Wolken)");
  });
});

describe("formatObservedTime", () => {
  it("returns null for null input", () => {
    assert.equal(formatObservedTime(null), null);
  });

  it("returns null for an unparseable string", () => {
    assert.equal(formatObservedTime("not-a-date"), null);
  });

  it("formats a valid ISO timestamp without throwing", () => {
    const out = formatObservedTime("2026-06-23T11:50:00Z");
    assert.ok(out && out.length > 0);
  });
});
