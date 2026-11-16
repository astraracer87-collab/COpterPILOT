// DJI Open API (Keychains für verschlüsselte Flugprotokolle ab v13):
// Request-/Response-Abbildung und deutsche Fehlermeldungen – mit Fake-fetch.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DJI_KEYCHAINS_ENDPOINT,
  DjiKeychainError,
  classifyApiMessage,
  djiKeychainErrorMessage,
  fetchDjiKeychains,
  validateDjiApiKey,
} from "../djiKeychainApi";
import type { DjiKeychainsRequest } from "../djiLogWorkerProtocol";

interface Call {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
}

function fakeFetch(status: number, body: unknown, calls: Call[] = []) {
  const impl = async (url: string, init: Call["init"]) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        if (body === undefined) throw new Error("kein JSON");
        return body;
      },
    };
  };
  return { impl, calls };
}

const REQ: DjiKeychainsRequest = {
  version: 4,
  department: 3,
  keychainsArray: [
    [
      {
        featurePoint: "FR_Standardization_Feature_Base_1",
        aesCiphertext: "QUJD",
      },
      {
        featurePoint: "FR_Standardization_Feature_Vision_2",
        aesCiphertext: "REVG",
      },
    ],
  ],
};

const KEYS = [
  [
    {
      featurePoint: "FR_Standardization_Feature_Base_1",
      aesKey: "a2V5MQ==",
      aesIv: "aXYx",
    },
    {
      featurePoint: "FR_Standardization_Feature_Vision_2",
      aesKey: "a2V5Mg==",
      aesIv: "aXYy",
    },
  ],
];

describe("fetchDjiKeychains – Request", () => {
  it("POST an dev.dji.com mit Api-Key-Header und KeychainsRequest als JSON-Body", async () => {
    const { impl, calls } = fakeFetch(200, {
      result: { code: 0, msg: "ok" },
      data: KEYS,
    });
    const out = await fetchDjiKeychains("  my-key_123  ", REQ, {
      fetchImpl: impl,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, DJI_KEYCHAINS_ENDPOINT);
    assert.equal(
      DJI_KEYCHAINS_ENDPOINT,
      "https://dev.dji.com/openapi/v1/flight-records/keychains",
    );
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["Api-Key"], "my-key_123");
    assert.equal(calls[0].init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(calls[0].init.body), REQ);
    // Feldnamen exakt wie dji-log-parser (keychainsArray, aesCiphertext)
    assert.ok(calls[0].init.body.includes('"keychainsArray"'));
    assert.ok(calls[0].init.body.includes('"aesCiphertext"'));
    assert.deepEqual(out, KEYS);
  });

  it("ohne Schlüssel wird gar nicht angefragt", async () => {
    const { impl, calls } = fakeFetch(200, {});
    await assert.rejects(
      fetchDjiKeychains("   ", REQ, { fetchImpl: impl }),
      (e: unknown) => e instanceof DjiKeychainError && e.code === "no_key",
    );
    assert.equal(calls.length, 0);
  });
});

describe("fetchDjiKeychains – Antworten und Fehler", () => {
  const cases: [string, number, unknown, string][] = [
    [
      "403 → ungültiger Schlüssel",
      403,
      { result: { code: 403, msg: "Forbidden" } },
      "invalid_key",
    ],
    ["401 ohne JSON → ungültiger Schlüssel", 401, undefined, "invalid_key"],
    ["429 → Kontingent", 429, undefined, "quota"],
    [
      "code≠0 Limit-Meldung → Kontingent",
      200,
      { result: { code: 7, msg: "Request limit exceeded" } },
      "quota",
    ],
    [
      "code≠0 Auth-Meldung → ungültiger Schlüssel",
      200,
      { result: { code: 3, msg: "Invalid api key" } },
      "invalid_key",
    ],
    [
      "code≠0 Versions-Meldung → Version",
      200,
      { result: { code: 9, msg: "unsupported version" } },
      "version",
    ],
    ["500 → Server", 500, undefined, "server"],
    ["200 ohne result → unerwartete Antwort", 200, { foo: 1 }, "bad_response"],
    [
      "200 ohne data → unerwartete Antwort",
      200,
      { result: { code: 0, msg: "ok" } },
      "bad_response",
    ],
    [
      "200 mit kaputten Schlüsseln → unerwartete Antwort",
      200,
      { result: { code: 0, msg: "ok" }, data: [[{ featurePoint: "x" }]] },
      "bad_response",
    ],
  ];
  for (const [name, status, body, code] of cases) {
    it(name, async () => {
      const { impl } = fakeFetch(status, body);
      await assert.rejects(
        fetchDjiKeychains("k".repeat(16), REQ, { fetchImpl: impl }),
        (e: unknown) => {
          assert.ok(e instanceof DjiKeychainError);
          assert.equal(e.code, code);
          assert.ok(e.message.length > 20);
          return true;
        },
      );
    });
  }

  it("Netzwerkfehler → offline (deutsche Meldung)", async () => {
    const impl = async () => {
      throw new TypeError("Network request failed");
    };
    await assert.rejects(
      fetchDjiKeychains("k".repeat(16), REQ, { fetchImpl: impl }),
      (e: unknown) => {
        assert.ok(e instanceof DjiKeychainError && e.code === "offline");
        assert.match(e.message, /Keine Verbindung zu DJI/);
        return true;
      },
    );
  });

  it("Meldungen sind deutsch und enthalten den Schlüssel nie", async () => {
    const secret = "SECRET-KEY-1234567";
    const { impl } = fakeFetch(403, { result: { code: 1, msg: "forbidden" } });
    await assert.rejects(
      fetchDjiKeychains(secret, REQ, { fetchImpl: impl }),
      (e: unknown) => {
        assert.ok(!(e as Error).message.includes(secret));
        return true;
      },
    );
    for (const c of [
      "no_key",
      "invalid_key",
      "quota",
      "offline",
      "version",
      "server",
      "bad_response",
    ] as const) {
      assert.match(djiKeychainErrorMessage(c), /[äöüÄÖÜß]|Bitte|DJI/);
    }
  });

  it("classifyApiMessage", () => {
    assert.equal(classifyApiMessage("Daily quota exceeded"), "quota");
    assert.equal(classifyApiMessage("too many requests"), "quota");
    assert.equal(classifyApiMessage("apikey not activated"), "invalid_key");
    assert.equal(classifyApiMessage("version not supported"), "version");
    assert.equal(classifyApiMessage("internal error"), "server");
  });
});

describe("validateDjiApiKey – günstige Prüfung", () => {
  it("sendet eine leere Anfrage und akzeptiert jede Nicht-Auth-Antwort", async () => {
    const { impl, calls } = fakeFetch(200, {
      result: { code: 4, msg: "keychainsArray empty" },
    });
    const r = await validateDjiApiKey("abcdef123456", { fetchImpl: impl });
    assert.deepEqual(r, { ok: true, verified: true });
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      version: 1,
      department: 3,
      keychainsArray: [],
    });
  });

  it("403 → abgelehnt", async () => {
    const { impl } = fakeFetch(403, undefined);
    const r = await validateDjiApiKey("abcdef123456", { fetchImpl: impl });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "invalid_key");
  });

  it("Auth-Meldung im Body → abgelehnt", async () => {
    const { impl } = fakeFetch(200, {
      result: { code: 2, msg: "invalid api-key" },
    });
    const r = await validateDjiApiKey("abcdef123456", { fetchImpl: impl });
    assert.equal(r.ok, false);
  });

  it("offline → gespeichert, aber unbestätigt", async () => {
    const r = await validateDjiApiKey("abcdef123456", {
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.verified, false);
  });

  it("offensichtlich falsches Format wird ohne Netz abgelehnt", async () => {
    const { impl, calls } = fakeFetch(200, {});
    const r = await validateDjiApiKey("kurz", { fetchImpl: impl });
    assert.equal(r.ok, false);
    const r2 = await validateDjiApiKey("mit leerzeichen drin", {
      fetchImpl: impl,
    });
    assert.equal(r2.ok, false);
    assert.equal(calls.length, 0);
  });
});
