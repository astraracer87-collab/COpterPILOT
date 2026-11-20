import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, privateEncrypt, constants } from "node:crypto";
import forge from "node-forge";

import {
  DFLIGHT_CONFIG_EVENT,
  DFLIGHT_CSRF_DECRYPT_KEY_PEM,
  buildCsrfHeaders,
  decryptCsrfPublicKey,
  dflightLoginErrorMessage,
  dflightNonce,
  parseSocketConfigPackets,
  runtimeConfigFromEvent,
  fetchPreflightValue,
  fetchSocketConfigViaPolling,
  fetchSocketConfigViaWebSocket,
} from "../geozoneDirect/dflightAuth";

// Testschlüssel: „outer“ simuliert den d-flight-Schlüssel, mit dem der Server
// csrf_pub_key privat verschlüsselt (Client: publicDecrypt), „inner“ den echten
// CSRF-Schlüssel (Client: publicEncrypt, Server: privateDecrypt).
let outer: { publicKey: string; privateKey: string };
let inner: { publicKey: string; privateKey: string };

before(() => {
  const enc = { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } } as const;
  outer = generateKeyPairSync("rsa", { modulusLength: 4096, ...enc });
  inner = generateKeyPairSync("rsa", { modulusLength: 2048, ...enc });
});

function serverEncryptedCsrfKey(): string {
  // Wie der Server: privateEncrypt (PKCS#1 v1.5, Blocktyp 1) des inneren PEM.
  return privateEncrypt({ key: outer.privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(inner.publicKey)).toString(
    "base64",
  );
}

function serverDecryptToken(tokenB64: string): string {
  // Server-Seite mit forge (Node 22 sperrt PKCS#1-v1.5-privateDecrypt teils).
  const key = forge.pki.privateKeyFromPem(inner.privateKey);
  return forge.util.decodeUtf8(key.decrypt(forge.util.decode64(tokenB64), "RSAES-PKCS1-V1_5"));
}

describe("dflightAuth – CSRF", () => {
  it("decryptCsrfPublicKey liefert das innere PEM", () => {
    const pem = decryptCsrfPublicKey(serverEncryptedCsrfKey(), outer.publicKey);
    assert.equal(pem, inner.publicKey.trim());
  });

  it("falscher Entschlüsselungs-Key -> Fehler", () => {
    assert.throws(() => decryptCsrfPublicKey(serverEncryptedCsrfKey(), DFLIGHT_CSRF_DECRYPT_KEY_PEM));
  });

  it("buildCsrfHeaders: Token entschlüsselt zu nonce|value, Nonce-Header = nonce", () => {
    const pem = decryptCsrfPublicKey(serverEncryptedCsrfKey(), outer.publicKey);
    const h = buildCsrfHeaders(pem, 1794707057404, "1b4e28ba-2fa1-41d2-883f-0016d3cca427");
    assert.equal(h["X-CSRF-Nonce"], "1b4e28ba-2fa1-41d2-883f-0016d3cca427");
    assert.equal(serverDecryptToken(h["X-CSRF-Token"]), "1b4e28ba-2fa1-41d2-883f-0016d3cca427|1794707057404");
    // 2048-Bit-Schlüssel -> 256 Byte Chiffrat
    assert.equal(Buffer.from(h["X-CSRF-Token"], "base64").length, 256);
  });

  it("buildCsrfHeaders: Standard-Nonce ist eine UUID v4, Token pro Aufruf verschieden", () => {
    const a = buildCsrfHeaders(inner.publicKey, "W");
    const b = buildCsrfHeaders(inner.publicKey, "W");
    assert.match(a["X-CSRF-Nonce"], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(a["X-CSRF-Nonce"], b["X-CSRF-Nonce"]);
    assert.equal(serverDecryptToken(a["X-CSRF-Token"]), `${a["X-CSRF-Nonce"]}|W`);
    assert.notEqual(dflightNonce(), dflightNonce());
  });
});

describe("dflightAuth – socket.io / Fehler", () => {
  it("parseSocketConfigPackets findet das Event auch in gebündelten Polling-Paketen", () => {
    const cfg = { general: { csrf_pub_key: "abc", gatewayBaseUrl: "https://www.d-flight.it:443/api-gateway" } };
    const payload = `40{"sid":"x"}\x1e42${JSON.stringify([DFLIGHT_CONFIG_EVENT, cfg])}`;
    assert.deepEqual(parseSocketConfigPackets(payload), cfg);
    assert.equal(parseSocketConfigPackets('42["other",{}]'), null);
    assert.equal(parseSocketConfigPackets("2"), null);
  });

  it("runtimeConfigFromEvent normalisiert :443 und ignoriert clientSecret", () => {
    const c = runtimeConfigFromEvent({
      general: { csrf_pub_key: "abc", gatewayBaseUrl: "https://www.d-flight.it:443/api-gateway/" },
      iam: { clientSecret: "geheim" },
      geoawareness: { baseUrl: "https://www.d-flight.it:443/geo-awareness/api/ed-269/geo-zones/download" },
    });
    assert.deepEqual(c, {
      csrfPubKey: "abc",
      gatewayBaseUrl: "https://www.d-flight.it/api-gateway",
      ed269Url: "https://www.d-flight.it/geo-awareness/api/ed-269/geo-zones/download",
    });
    assert.ok(!JSON.stringify(c).includes("geheim"));
    assert.throws(() => runtimeConfigFromEvent({ general: {} }));
  });

  it("dflightLoginErrorMessage", () => {
    assert.equal(dflightLoginErrorMessage(403, "Missing Headers").kind, "csrf");
    assert.equal(dflightLoginErrorMessage(403, "Malformed Headers").kind, "csrf");
    const bad = dflightLoginErrorMessage(401, { error: "invalid_grant", error_description: "Invalid user credentials" });
    assert.equal(bad.kind, "credentials");
    assert.match(bad.message, /Benutzername oder Passwort falsch/);
    assert.match(
      dflightLoginErrorMessage(400, { error: "invalid_grant", error_description: "Account is not fully set up" }).message,
      /nicht vollständig eingerichtet/,
    );
    assert.match(dflightLoginErrorMessage(400, { error: "invalid_grant", error_description: "Account disabled" }).message, /gesperrt/);
    assert.equal(dflightLoginErrorMessage(500, "x").kind, "server");
    // HTTP 400 ohne eindeutige Keycloak-Antwort ist KEIN „Passwort falsch“
    const req = dflightLoginErrorMessage(400, { error: "invalid_request", error_description: "Missing form parameter: grant_type" });
    assert.equal(req.kind, "server");
    assert.match(req.message, /HTTP 400 – invalid_request: Missing form parameter/);
  });
});

// Öffentliche, nicht authentifizierte Teile live prüfen (ohne Login):
//   DFLIGHT_LIVE=1 npx -y tsx --tsconfig tsconfig.json --test client/lib/__tests__/dflightAuth.test.ts
describe("dflightAuth – live (DFLIGHT_LIVE=1)", { skip: process.env.DFLIGHT_LIVE !== "1" }, () => {
  async function checkConfig(cfgEvent: any) {
    const c = runtimeConfigFromEvent(cfgEvent);
    const pem = decryptCsrfPublicKey(c.csrfPubKey);
    assert.match(pem, /^-----BEGIN PUBLIC KEY-----/);
    assert.equal(forge.pki.publicKeyFromPem(pem).n.bitLength(), 2048);
    assert.equal(c.gatewayBaseUrl, "https://www.d-flight.it/api-gateway");
    return { c, pem };
  }

  it("socket.io-Polling liefert d-flight.hci.configuration, CSRF-Key entschlüsselbar", async () => {
    await checkConfig(await fetchSocketConfigViaPolling());
  });

  it("socket.io-WebSocket liefert d-flight.hci.configuration", { skip: typeof WebSocket === "undefined" }, async () => {
    await checkConfig(await fetchSocketConfigViaWebSocket());
  });

  it("pre-flight liefert value, Header lassen sich bauen", async () => {
    const { c, pem } = await checkConfig(await fetchSocketConfigViaPolling());
    const v = await fetchPreflightValue(c.gatewayBaseUrl);
    assert.ok(v != null && String(v).length > 0);
    const h = buildCsrfHeaders(pem, v);
    assert.equal(Buffer.from(h["X-CSRF-Token"], "base64").length, 256);
  });
});
