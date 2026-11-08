import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { TextEncoder, TextDecoder } from "node:util";

const source = fs.readFileSync(new URL("../auth-crypto.js", import.meta.url), "utf8");
const browser = {
  crypto: webcrypto,
  btoa: value => Buffer.from(value, "binary").toString("base64"),
  atob: value => Buffer.from(value, "base64").toString("binary"),
  TextEncoder,
  TextDecoder
};
vm.runInNewContext(source, { window: browser, crypto: webcrypto, btoa: browser.btoa, atob: browser.atob, TextEncoder, TextDecoder });

test("encrypted data round-trips and recovery key restores the encryption key", async () => {
  const crypto = browser.GcseVaultCrypto;
  const key = await crypto.createVaultKey();
  const original = { cards: [{ front: "Question", back: "Answer" }], progress: { xp: 42 } };
  const envelope = await crypto.encrypt(key, original);
  assert.equal(JSON.stringify(await crypto.decrypt(key, envelope)), JSON.stringify(original));

  const recovery = await crypto.createRecoveryPackage(key);
  const recoveredKey = await crypto.recoverKey(recovery.recoveryKey, recovery.wrappedKey);
  assert.equal(JSON.stringify(await crypto.decrypt(recoveredKey, envelope)), JSON.stringify(original));
});

test("tampered ciphertext is rejected", async () => {
  const crypto = browser.GcseVaultCrypto;
  const key = await crypto.createVaultKey();
  const envelope = await crypto.encrypt(key, { private: true });
  envelope.ciphertext = envelope.ciphertext.slice(0, -4) + "AAAA";
  await assert.rejects(() => crypto.decrypt(key, envelope));
});
