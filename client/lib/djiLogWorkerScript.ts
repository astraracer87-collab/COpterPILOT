/**
 * Skript der versteckten "Worker"-WebView für DJI-Flugprotokolle.
 *
 * Läuft in der Android-System-WebView (eigener Thread, nicht der JS-Thread der
 * App) zusammen mit dji-log-parser (WebAssembly, siehe djiLogParserBundle.ts).
 * Die schwere Arbeit – Entschlüsseln, Dekodieren aller Frames, Kennzahlen über
 * alle Frames, Ausdünnen – passiert hier; an die App gehen nur kompakte
 * Zeilen, gestreamt in Stücken (Protokoll: djiLogWorkerProtocol.ts).
 *
 * Bewusst ES2017 ohne Template-Literale, damit auch ältere WebViews es laden.
 * RN-frei: Tests führen genau dieses Skript in einem Node-vm-Kontext aus.
 */
import {
  DJI_MAX_STREAM_ROWS,
  DJI_ROWS_PER_MESSAGE,
  DJI_ROW_COLUMNS,
  DJI_WORKER_PROTOCOL,
} from "./djiLogWorkerProtocol";

const WORKER_SOURCE = String.raw`
(function () {
  "use strict";
  var CFG = __CONFIG__;
  var jobs = Object.create(null);

  function post(msg) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (e) {}
  }
  function errText(e) {
    var s = e && typeof e === "object" && e.message ? e.message : String(e);
    s = s.replace(/\u001b\[[0-9;]*m/g, "").replace(/\s+/g, " ").trim();
    return s.length > 300 ? s.slice(0, 300) + "…" : s;
  }
  function fail(jobId, code, message) {
    post({ type: "error", jobId: jobId, code: code, message: message });
  }
  function b64ToBytes(b64) {
    var bin = atob(b64);
    var n = bin.length;
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function concat(parts, total) {
    var out = new Uint8Array(total);
    var off = 0;
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      out.set(parts[i], off);
      off += parts[i].length;
    }
    return off === total ? out : out.subarray(0, off);
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function round(v, d) {
    if (!isNum(v)) return null;
    var f = Math.pow(10, d);
    return Math.round(v * f) / f;
  }
  function validLatLon(lat, lon) {
    return isNum(lat) && isNum(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
      !(Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6);
  }
  function hav(aLat, aLon, bLat, bLon) {
    var R = 6371000, r = Math.PI / 180;
    var dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // DJI-Knüppel roh 364..1684, Mitte 1024 → -1..1; 0 = nicht geloggt.
  function stick(v) {
    if (!isNum(v) || v === 0) return null;
    var x = (v - 1024) / 660;
    if (x > 1) x = 1;
    if (x < -1) x = -1;
    return Math.round(x * 1000) / 1000;
  }
  function enumName(v) {
    if (v == null) return null;
    if (typeof v === "string") return v;
    if (typeof v === "object") { for (var k in v) return k === "Unknown" ? "Unbekannt (" + v[k] + ")" : k; }
    return String(v);
  }
  function str(v) { return typeof v === "string" && v.trim() ? v.trim() : undefined; }
  function pickDetails(d) {
    d = d || {};
    return {
      startTime: str(d.startTime),
      latitude: isNum(d.latitude) ? d.latitude : undefined,
      longitude: isNum(d.longitude) ? d.longitude : undefined,
      totalDistance: isNum(d.totalDistance) ? d.totalDistance : undefined,
      totalTime: isNum(d.totalTime) ? d.totalTime : undefined,
      maxHeight: isNum(d.maxHeight) ? d.maxHeight : undefined,
      maxHorizontalSpeed: isNum(d.maxHorizontalSpeed) ? d.maxHorizontalSpeed : undefined,
      maxVerticalSpeed: isNum(d.maxVerticalSpeed) ? d.maxVerticalSpeed : undefined,
      productType: enumName(d.productType) || undefined,
      aircraftName: str(d.aircraftName),
      aircraftSn: str(d.aircraftSn),
      batterySn: str(d.batterySn),
      rcSn: str(d.rcSn),
      cameraSn: str(d.cameraSn),
      appPlatform: enumName(d.appPlatform) || undefined,
      appVersion: str(d.appVersion),
      city: str(d.city),
      area: str(d.area)
    };
  }
  function fnv(bytes, start, end, h) {
    for (var i = start; i < end; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 16777619);
    }
    return h;
  }
  function fingerprint(bytes, version, d) {
    var n = bytes.length;
    var h = fnv(bytes, 0, Math.min(n, 65536), 0x811c9dc5 | 0);
    h = fnv(bytes, Math.max(0, n - 65536), n, h);
    return "v" + version + "-" + n + "-" + (h >>> 0).toString(16) + "-" + (d.aircraftSn || "") + "-" + (d.startTime || "");
  }
  function release(jobId) {
    var job = jobs[jobId];
    if (!job) return;
    delete jobs[jobId];
    try { if (job.log && job.log.free) job.log.free(); } catch (e) {}
  }

  function withLog(jobId, fn) {
    var job = jobs[jobId];
    if (!job) return fail(jobId, "unknown_job", "Unbekannter Auftrag");
    var p = window.__djiLogParser;
    if (!p) return fail(jobId, "internal", "Parser nicht geladen");
    p.then(function (P) {
      if (!jobs[jobId]) return;
      if (!job.log) {
        if (!job.bytes) { job.bytes = concat(job.parts, job.size); job.parts = []; }
        try {
          job.log = new P.DJILog(job.bytes);
        } catch (e) {
          var t = errText(e);
          return fail(jobId, /version/i.test(t) && !/magic/i.test(t) ? "unsupported" : "not_a_log", t);
        }
      }
      try { fn(job, job.log); } catch (e2) { fail(jobId, "internal", errText(e2)); }
    }, function (e) { fail(jobId, "internal", "Parser nicht geladen: " + errText(e)); });
  }

  function inspect(job, log) {
    var version = log.version;
    var details = pickDetails(log.details);
    var needs = version >= 13;
    var req = null;
    if (needs) {
      try { req = log.keychainsRequest(); } catch (e) { return fail(job.id, "decrypt_failed", errText(e)); }
    }
    post({ type: "inspected", jobId: job.id, info: {
      version: version,
      byteLength: job.bytes.length,
      fingerprint: fingerprint(job.bytes, version, details),
      details: details,
      keychainsRequired: needs,
      keychainsRequest: req
    } });
  }

  function rowOf(f, home) {
    var o = f.osd || {}, b = f.battery || {}, rc = f.rc || {}, c = f.custom || {};
    var ts = c.dateTime ? Date.parse(c.dateTime) : NaN;
    var gps = validLatLon(o.latitude, o.longitude);
    var dist = null;
    if (gps && home) dist = Math.round(hav(home.lat, home.lon, o.latitude, o.longitude));
    var cells = null;
    if (b.cellVoltages && b.cellVoltages.length) {
      var any = false, cs = [];
      for (var i = 0; i < b.cellVoltages.length; i++) {
        var v = b.cellVoltages[i];
        if (isNum(v) && v > 0) any = true;
        cs.push(round(v, 3));
      }
      if (any) cells = cs;
    }
    var hs = isNum(o.xSpeed) && isNum(o.ySpeed) ? Math.sqrt(o.xSpeed * o.xSpeed + o.ySpeed * o.ySpeed) : null;
    return [
      round(o.flyTime, 1),
      isNum(ts) && ts > 1262304000000 ? ts : null,
      gps ? round(o.latitude, 7) : null,
      gps ? round(o.longitude, 7) : null,
      round(o.height, 1),
      isNum(o.vpsHeight) && o.vpsHeight > 0 ? round(o.vpsHeight, 1) : null,
      isNum(o.altitude) && o.altitude !== 0 ? round(o.altitude, 1) : null,
      round(hs, 1),
      isNum(o.zSpeed) ? round(-o.zSpeed, 1) : null,
      dist,
      isNum(o.gpsNum) ? o.gpsNum : null,
      isNum(b.chargeLevel) && b.chargeLevel > 0 ? b.chargeLevel : null,
      isNum(b.voltage) && b.voltage > 0 ? round(b.voltage, 2) : null,
      stick(rc.aileron),
      stick(rc.elevator),
      stick(rc.throttle),
      stick(rc.rudder),
      round(o.pitch, 1),
      round(o.roll, 1),
      round(o.yaw, 1),
      enumName(o.flycState),
      cells,
      isNum(b.temperature) && b.temperature !== 0 && b.temperature > -40 && b.temperature < 100 ? round(b.temperature, 1) : null
    ];
  }

  function parse(job, log, keychains) {
    var jobId = job.id;
    var version = log.version;
    if (version >= 13 && !keychains) return fail(jobId, "keychain_required", "Für Log-Version " + version + " sind DJI-Schlüssel nötig");
    var frames;
    try {
      frames = keychains ? log.frames(keychains) : log.frames();
    } catch (e) {
      var t = errText(e);
      return fail(jobId, /keychain/i.test(t) ? "keychain_required" : "decrypt_failed", t);
    }
    var details = pickDetails(log.details);
    var n = frames.length;

    // --- Kennzahlen über ALLE Frames ---
    var st = { frameCount: n };
    var home = null, firstGps = null, prev = null, dist = 0, maxDist = 0;
    var maxH = null, maxT = 0, bStart = null, bEnd = null, bMin = null;
    var cellMin = null, cellEstMin = null, tempMax = null, t0 = null, t1 = null;
    var messages = [], useful = 0;
    for (var i = 0; i < n; i++) {
      var f = frames[i], o = f.osd || {}, b = f.battery || {}, hm = f.home || {};
      if (!home && validLatLon(hm.latitude, hm.longitude)) home = { lat: hm.latitude, lon: hm.longitude };
      if (isNum(o.flyTime) && o.flyTime > maxT) maxT = o.flyTime;
      if (isNum(o.height) && (maxH === null || o.height > maxH)) maxH = o.height;
      if (validLatLon(o.latitude, o.longitude)) {
        useful++;
        if (!firstGps) firstGps = { lat: o.latitude, lon: o.longitude };
        if (prev) {
          var d = hav(prev.lat, prev.lon, o.latitude, o.longitude);
          if (d < 150) dist += d; // GPS-Sprünge ignorieren
        }
        prev = { lat: o.latitude, lon: o.longitude };
        var ref = home || firstGps;
        var dh = hav(ref.lat, ref.lon, o.latitude, o.longitude);
        if (dh > maxDist) maxDist = dh;
      }
      if (isNum(b.chargeLevel) && b.chargeLevel > 0 && b.chargeLevel <= 100) {
        if (bStart === null) bStart = b.chargeLevel;
        bEnd = b.chargeLevel;
        if (bMin === null || b.chargeLevel < bMin) bMin = b.chargeLevel;
        useful++;
      }
      if (b.cellVoltages && b.cellVoltages.length) {
        for (var k = 0; k < b.cellVoltages.length; k++) {
          var cv = b.cellVoltages[k];
          if (!isNum(cv) || cv < 2.5 || cv > 4.6) continue; // plausibel für LiPo/LiHV
          if (b.isCellVoltageEstimated) { if (cellEstMin === null || cv < cellEstMin) cellEstMin = cv; }
          else if (cellMin === null || cv < cellMin) cellMin = cv;
        }
      }
      var temps = [b.temperature, b.maxTemperature];
      for (var q = 0; q < temps.length; q++) {
        var tv = temps[q];
        if (isNum(tv) && tv !== 0 && tv > -40 && tv < 100 && (tempMax === null || tv > tempMax)) tempMax = tv;
      }
      var ts = f.custom && f.custom.dateTime ? Date.parse(f.custom.dateTime) : NaN;
      if (isNum(ts) && ts > 1262304000000) { if (t0 === null) t0 = ts; t1 = ts; }
      var app = f.app || {};
      if (app.tip) { var tips = String(app.tip).split("; "); for (var a = 0; a < tips.length; a++) if (tips[a]) messages.push({ t: round(o.flyTime, 1), text: tips[a], kind: "tip" }); }
      if (app.warn) { var ws = String(app.warn).split("; "); for (var w = 0; w < ws.length; w++) if (ws[w]) messages.push({ t: round(o.flyTime, 1), text: ws[w], kind: "warn" }); }
    }
    // falsche Schlüssel liefern Zufallswerte ohne GPS/Akku – nie eine leere "Auswertung" zeigen
    if (version >= 13 && useful === 0) {
      return fail(jobId, "decrypt_failed", "Entschlüsselung lieferte keine Flugdaten");
    }
    st.durationSec = maxT > 0 ? round(maxT, 1) : (isNum(details.totalTime) ? details.totalTime : undefined);
    if (maxH !== null) st.maxHeightM = round(maxH, 1);
    st.distanceM = Math.round(dist);
    st.maxDistFromHomeM = Math.round(maxDist);
    if (bStart !== null) st.batteryStartPercent = bStart;
    if (bEnd !== null) st.batteryEndPercent = bEnd;
    if (bMin !== null) st.batteryMinPercent = bMin;
    if (cellMin !== null) { st.minCellV = round(cellMin, 3); st.minCellEstimated = false; }
    else if (cellEstMin !== null) { st.minCellV = round(cellEstMin, 3); st.minCellEstimated = true; }
    if (tempMax !== null) st.maxTempC = round(tempMax, 1);
    if (t0 !== null) st.startTs = t0;
    if (t1 !== null) st.endTs = t1;
    if (home) { st.homeLat = home.lat; st.homeLon = home.lon; }
    if (useful === 0) st.empty = true;

    // --- Akku-Seriennummer, Zyklen, ernste Warnungen (Rohdatensätze, best effort) ---
    var battery = { batterySn: details.batterySn, aircraftSn: details.aircraftSn };
    for (var r = n - 1; r >= 0 && (!battery.batterySn || !battery.aircraftSn); r--) {
      var rec = frames[r].recover || {};
      if (!battery.batterySn && str(rec.batterySn)) battery.batterySn = str(rec.batterySn);
      if (!battery.aircraftSn && str(rec.aircraftSn)) battery.aircraftSn = str(rec.aircraftSn);
    }
    var serious = Object.create(null);
    if (job.bytes.length <= CFG.maxRecordsBytes) {
      try {
        var recs = keychains ? log.records(keychains) : log.records();
        // Zyklen: manche Modelle liefern den Wert byteweise vertauscht (2 → 512).
        // Alle Kandidaten sammeln, normalisieren, häufigsten plausiblen nehmen.
        var cycleCands = [];
        for (var x = 0; x < recs.length; x++) {
          var R = recs[x], cnt = R.content;
          if (R.type === "SmartBatteryGroup" && cnt && cnt.type === "SmartBatteryStatic") {
            if (isNum(cnt.loop_times)) cycleCands.push(cnt.loop_times);
            if (isNum(cnt.battery_life) && cnt.battery_life > 0 && cnt.battery_life <= 100) battery.healthPercent = cnt.battery_life;
          } else if (R.type === "CenterBattery" && cnt) {
            if (isNum(cnt.numberOfDischarges)) cycleCands.push(cnt.numberOfDischarges);
          } else if (R.type === "ComponentSerial" && cnt) {
            if (cnt.componentType === "Battery" && !battery.batterySn && str(cnt.serial)) battery.batterySn = str(cnt.serial);
            if (cnt.componentType === "Aircraft" && !battery.aircraftSn && str(cnt.serial)) battery.aircraftSn = str(cnt.serial);
          } else if (R.type === "AppSeriousWarn" && cnt && cnt.message) {
            serious[cnt.message] = true;
          }
        }
        recs = null;
        var cycleFreq = Object.create(null), bestCyc = 0, bestCnt = 0;
        for (var ci = 0; ci < cycleCands.length; ci++) {
          var cv = cycleCands[ci];
          if (cv >= 256 && cv % 256 === 0 && cv <= 65280) cv = cv / 256;
          if (!(cv > 0 && cv <= 1500)) continue;
          cycleFreq[cv] = (cycleFreq[cv] || 0) + 1;
          if (cycleFreq[cv] > bestCnt || (cycleFreq[cv] === bestCnt && cv > bestCyc)) { bestCyc = cv; bestCnt = cycleFreq[cv]; }
        }
        if (bestCyc > 0) battery.cycleCount = bestCyc;
      } catch (e) {}
    }
    for (var m = 0; m < messages.length; m++) if (serious[messages[m].text]) messages[m].kind = "serious";
    // gleiche Meldung kurz hintereinander nur einmal
    var msgs = [];
    for (var mm = 0; mm < messages.length; mm++) {
      var last = msgs.length ? msgs[msgs.length - 1] : null;
      if (last && last.text === messages[mm].text && isNum(last.t) && isNum(messages[mm].t) && messages[mm].t - last.t < 5) continue;
      msgs.push(messages[mm]);
      if (msgs.length >= CFG.maxMessages) break;
    }

    // --- Zeilen ausdünnen und streamen ---
    var stride = Math.max(1, Math.ceil(n / CFG.maxRows));
    var rows = [];
    var rowHome = home || firstGps;
    for (var y = 0; y < n; y += stride) rows.push(rowOf(frames[y], rowHome));
    if (n > 0 && (n - 1) % stride !== 0) rows.push(rowOf(frames[n - 1], rowHome));
    frames = null;

    var per = CFG.rowsPerMessage;
    var chunks = Math.ceil(rows.length / per);
    post({ type: "summary", jobId: jobId, totalRows: rows.length, rowChunks: chunks, summary: {
      version: version, columns: CFG.columns, details: details, stats: st, battery: battery, messages: msgs, rowStride: stride
    } });
    // ohne Timer (eine unsichtbare WebView kann Timer drosseln); die Brücke puffert
    for (var idx = 0; idx < chunks; idx++) {
      post({ type: "rows", jobId: jobId, index: idx, rows: rows.slice(idx * per, (idx + 1) * per) });
    }
    post({ type: "done", jobId: jobId });
  }

  function handle(msg) {
    if (!msg || typeof msg !== "object") return;
    var job;
    switch (msg.type) {
      case "begin":
        release(msg.jobId);
        jobs[msg.jobId] = { id: msg.jobId, fileName: msg.fileName, parts: [], size: 0, bytes: null, log: null };
        post({ type: "ack", jobId: msg.jobId, index: -1 });
        return;
      case "chunk":
        job = jobs[msg.jobId];
        if (!job) return fail(msg.jobId, "unknown_job", "Unbekannter Auftrag");
        try {
          var bytes = b64ToBytes(msg.data);
          job.parts[msg.index] = bytes;
          job.size += bytes.length;
        } catch (e) {
          return fail(msg.jobId, "internal", "Datenstück beschädigt: " + errText(e));
        }
        post({ type: "ack", jobId: msg.jobId, index: msg.index });
        return;
      case "inspect":
        return withLog(msg.jobId, inspect);
      case "parse":
        return withLog(msg.jobId, function (j, log) { parse(j, log, msg.keychains || null); });
      case "release":
        release(msg.jobId);
        return;
    }
  }

  window.__djiWorker = {
    receive: function (msg) {
      try { handle(msg); } catch (e) { fail(msg && msg.jobId, "internal", errText(e)); }
    }
  };

  var parser = window.__djiLogParser;
  if (!parser) {
    post({ type: "fatal", message: "Parser-Skript fehlt" });
  } else {
    parser.then(function () {
      post({ type: "ready", protocol: CFG.protocol, parserVersion: CFG.parserVersion });
    }, function (e) {
      post({ type: "fatal", message: errText(e) });
    });
  }
})();
`;

export interface DjiWorkerConfig {
  protocol: number;
  parserVersion: string;
  columns: readonly string[];
  maxRows: number;
  rowsPerMessage: number;
  maxMessages: number;
  /** Rohdatensätze (Zyklen/Seriennummern) nur bis zu dieser Dateigröße lesen. */
  maxRecordsBytes: number;
}

export function buildDjiWorkerScript(
  parserVersion: string,
  overrides: Partial<DjiWorkerConfig> = {},
): string {
  const cfg: DjiWorkerConfig = {
    protocol: DJI_WORKER_PROTOCOL,
    parserVersion,
    columns: DJI_ROW_COLUMNS,
    maxRows: DJI_MAX_STREAM_ROWS,
    rowsPerMessage: DJI_ROWS_PER_MESSAGE,
    maxMessages: 500,
    maxRecordsBytes: 12 * 1024 * 1024,
    ...overrides,
  };
  return WORKER_SOURCE.replace("__CONFIG__", () => JSON.stringify(cfg));
}

/** HTML der Worker-WebView: Parser (WebAssembly) + Worker-Skript, komplett offline. */
export function buildDjiWorkerHtml(
  parserJs: string,
  parserVersion: string,
): string {
  // "</script" im eingebetteten Code würde das Skript-Element beenden.
  const safe = (s: string) => s.replace(/<\/script/gi, "<\\/script");
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
    "<script>" +
    safe(parserJs) +
    "</script><script>" +
    safe(buildDjiWorkerScript(parserVersion)) +
    "</script></body></html>"
  );
}
