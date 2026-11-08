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
  const salt = crypto.createSalt();
  const key = await crypto.deriveKey("a-long-unique-test-password", salt);
  const original = { cards: [{ front: "Question", back: "Answer" }], progress: { xp: 42 } };
  const envelope = await crypto.encrypt(key, original);
  assert.deepEqual(await crypto.decrypt(key, envelope), original);

  const recovery = await crypto.createRecoveryPackage(key);
  const recoveredKey = await crypto.recoverKey(recovery.recoveryKey, recovery.wrappedKey);
  assert.deepEqual(await crypto.decrypt(recoveredKey, envelope), original);
});

test("tampered ciphertext is rejected", async () => {
  const crypto = browser.GcseVaultCrypto;
  const key = await crypto.deriveKey("another-long-unique-test-password", crypto.createSalt());
  const envelope = await crypto.encrypt(key, { private: true });
  envelope.ciphertext = envelope.ciphertext.slice(0, -4) + "AAAA";
  await assert.rejects(() => crypto.decrypt(key, envelope));
});
