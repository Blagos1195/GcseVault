import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const files = [
  "shared.js",
  "quotes/index.html",
  "dates/index.html",
  "revision/index.html"
];

for (const file of files) {
  test(`JavaScript syntax: ${file}`, () => {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    if (file.endsWith(".js")) {
      new vm.Script(source, { filename: file });
      return;
    }
    const scripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(match => !/\bsrc\s*=/.test(match[1]));
    assert.ok(scripts.length, `No inline scripts found in ${file}`);
    for (let index = 0; index < scripts.length; index++) {
      new vm.Script(scripts[index][2], { filename: `${file}:script-${index + 1}` });
    }
  });
}


test("storage migration summary aggregates all phases", async () => {
  const source = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
  const phases = {
    revision: { processed: 2, migrated: 1, alreadyPresent: 1, skipped: 0, complete: true, cursor: null },
    "revision-leaderboard": { processed: 3, migrated: 1, alreadyPresent: 1, skipped: 1, complete: true, cursor: null },
    themes: { processed: 4, migrated: 2, alreadyPresent: 2, skipped: 0, complete: true, cursor: null }
  };
  const context = {
    document: { addEventListener() {} },
    window: { render() {}, __vaultAccountFetchWrapped: true },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return "test-session"; }, setItem() {}, removeItem() {} },
    fetch: async (_url, options) => {
      const { phase } = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => phases[phase]
      };
    },
    console,
    URL,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(source + "\nglobalThis.__AdminManager = AdminManager;", context);
  const manager = context.__AdminManager;
  manager.role = "owner";
  manager.refresh = async () => {};
  await manager.migrateStorage();
  assert.equal(manager.migrationStatus, "Migration finished: 4 copied, 4 already present, 1 skipped. Review skipped records before relying on D1-only data. Original KV copies remain available.");
});


test("revoked account sessions are cleared and cannot appear signed in", async () => {
  const source = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
  const start = source.indexOf("const VaultUser = {");
  const end = source.indexOf("\n\nif (!window.__vaultAccountFetchWrapped)", start);
  assert.ok(start >= 0 && end > start);
  const storage = new Map([["vault_account_session", "revoked-token"]]);
  const localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); }
  };
  const context = {
    localStorage,
    fetch: async () => ({ status: 401, ok: false }),
    console
  };
  vm.runInNewContext(source.slice(start, end) + "\nglobalThis.__VaultUser = VaultUser;", context);
  const user = context.__VaultUser;
  assert.equal(await user.validateAccountSession(), false);
  assert.equal(user.getAccountSession(), null);
  storage.set("vault_account_session", "revoked-token");
  await user.logoutAccount();
  assert.equal(user.getAccountSession(), null);
});

test("valid account sessions refresh the stored username", async () => {
  const source = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
  const start = source.indexOf("const VaultUser = {");
  const end = source.indexOf("\n\nif (!window.__vaultAccountFetchWrapped)", start);
  const storage = new Map([["vault_account_session", "valid-token"]]);
  const localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); }
  };
  const context = {
    localStorage,
    fetch: async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ username: "TestUser" }) }),
    console
  };
  vm.runInNewContext(source.slice(start, end) + "\nglobalThis.__VaultUser = VaultUser;", context);
  assert.equal(await context.__VaultUser.validateAccountSession(), true);
  assert.equal(context.__VaultUser.getUsername(), "TestUser");
});
