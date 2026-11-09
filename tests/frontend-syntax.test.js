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

test("temporary account session verification failures preserve the stored token", async () => {
  const source = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
  const start = source.indexOf("const VaultUser = {");
  const end = source.indexOf("\n\nif (!window.__vaultAccountFetchWrapped)", start);
  const storage = new Map([["vault_account_session", "temporary-failure-token"]]);
  const localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); }
  };
  const context = {
    localStorage,
    fetch: async () => ({ status: 503, ok: false, text: async () => JSON.stringify({ error: "Temporarily unavailable" }) }),
    console
  };
  vm.runInNewContext(source.slice(start, end) + "\nglobalThis.__VaultUser = VaultUser;", context);
  await assert.rejects(context.__VaultUser.validateAccountSession(), /Temporarily unavailable/);
  assert.equal(context.__VaultUser.getAccountSession(), "temporary-failure-token");
});


test("A-level practice catalogues cover the configured subjects", () => {
  const catalogues = [
    ["revision/catalogues/edexcel-a-level-mathematics.json", "Mathematics", "Pearson Edexcel"],
    ["revision/catalogues/aqa-a-level-physics-core.json", "Physics", "AQA"],
    ["revision/catalogues/aqa-a-level-chemistry.json", "Chemistry", "AQA"]
  ].map(([path, subject, examBoard]) => {
    const data = JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
    assert.equal(data.type, "revision-catalogue");
    assert.equal(data.version, 1);
    assert.equal(data.subject, subject);
    assert.equal(data.examBoard, examBoard);
    assert.ok(data.topics.length > 0);
    const ids = new Set();
    for (const topic of data.topics) {
      assert.ok(topic.id && topic.name);
      assert.ok(!ids.has(topic.id), `Duplicate topic ID: ${topic.id}`);
      ids.add(topic.id);
      assert.ok(Array.isArray(topic.subtopics));
      assert.ok(topic.subtopics.every(item => typeof item === "string" && item.length));
    }
    return data;
  });
  assert.ok(catalogues[0].topics.length >= 30);
  assert.equal(catalogues[1].optionalModule.status, "unconfirmed");
  assert.ok(catalogues[2].topics.length >= 20);
});

test("A-level course packs cover their catalogues and include usable revision data", () => {
  const subjects = [
    ["edexcel-a-level-mathematics", "revision/course-packs/edexcel-a-level-mathematics.json", "revision/catalogues/edexcel-a-level-mathematics.json"],
    ["aqa-a-level-physics", "revision/course-packs/aqa-a-level-physics-core.json", "revision/catalogues/aqa-a-level-physics-core.json"],
    ["aqa-a-level-chemistry", "revision/course-packs/aqa-a-level-chemistry.json", "revision/catalogues/aqa-a-level-chemistry.json"]
  ];
  for (const [catalogueId, packPath, cataloguePath] of subjects) {
    const pack = JSON.parse(fs.readFileSync(new URL(`../${packPath}`, import.meta.url), "utf8"));
    const catalogue = JSON.parse(fs.readFileSync(new URL(`../${cataloguePath}`, import.meta.url), "utf8"));
    const topicIds = new Set(catalogue.topics.map(topic => topic.id));
    const cardIds = new Set(pack.cards.map(card => card.id));
    assert.equal(pack.type, "revision-course-pack");
    assert.equal(pack.version, 1);
    assert.equal(pack.catalogueId, catalogueId);
    assert.ok(pack.cards.length >= catalogue.topics.length * 3);
    assert.ok(pack.resources.length >= catalogue.topics.length);
    assert.ok(pack.formulas.length > 0);
    for (const topic of catalogue.topics) {
      assert.ok(pack.cards.some(card => card.topicId === topic.id), `No flashcards for ${topic.id}`);
      assert.ok(pack.resources.some(resource => resource.topicId === topic.id), `No learning resource for ${topic.id}`);
    }
    for (const card of pack.cards) {
      assert.ok(topicIds.has(card.topicId));
      assert.ok(card.front && card.back);
      assert.ok((card.links || []).every(id => cardIds.has(id)));
    }
    for (const resource of pack.resources) assert.ok(topicIds.has(resource.topicId) && resource.content);
    for (const formula of pack.formulas) assert.ok(topicIds.has(formula.topicId) && formula.name && formula.expression);
  }
  const physics = JSON.parse(fs.readFileSync(new URL("../revision/course-packs/aqa-a-level-physics-core.json", import.meta.url), "utf8"));
  const chemistry = JSON.parse(fs.readFileSync(new URL("../revision/course-packs/aqa-a-level-chemistry.json", import.meta.url), "utf8"));
  assert.equal(physics.resources.filter(resource => resource.kind === "required-practical").length, 12);
  assert.equal(chemistry.resources.filter(resource => resource.kind === "required-practical").length, 12);
});

test("Revision sync retains private exam-practice data", () => {
  const worker = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  const revision = fs.readFileSync(new URL("../revision/index.html", import.meta.url), "utf8");
  assert.match(worker, /practice:\s*set\s*&&\s*set\.practice/);
  assert.match(worker, /formulas:\s*Array\.isArray\(set\.practice\.formulas\)/);
  assert.match(revision, /practiceRecommend/);
  assert.match(revision, /practiceImport/);
  assert.match(revision, /practiceConnections/);
  assert.match(revision, /importPublicNote = async function/);
  assert.match(revision, /revision-course-pack/);
  assert.match(revision, /practiceResourcesView/);
  assert.match(revision, /resources:Array\.isArray\(practice\.resources\)/);
  assert.match(worker, /resources: Array\.isArray\(set\.practice\.resources\)/);
});

test("Amount of substance depth pack covers calculations and imports incrementally", () => {
  const pack = JSON.parse(fs.readFileSync(new URL("../revision/course-packs/aqa-chemistry-amount-of-substance.json", import.meta.url), "utf8"));
  assert.equal(pack.type, "revision-course-pack");
  assert.equal(pack.catalogueId, "aqa-a-level-chemistry");
  assert.ok(pack.cards.length >= 45);
  assert.ok(pack.resources.length >= 8);
  assert.ok(pack.formulas.length >= 10);
  const cardIds = new Set(pack.cards.map(card => card.id));
  assert.equal(cardIds.size, pack.cards.length);
  assert.ok(pack.cards.every(card => card.topicId === "chemistry-02" && card.front && card.back));
  assert.ok(pack.resources.every(resource => resource.topicId === "chemistry-02" && resource.content.length > 500));
  assert.ok(pack.formulas.every(formula => formula.topicId === "chemistry-02" && formula.name && formula.expression));
  const revision = fs.readFileSync(new URL("../revision/index.html", import.meta.url), "utf8");
  assert.match(revision, /const resolveCardId=id=>idMap\.get/);
  assert.match(revision, /mergeByKey\(p\.resources,resources,resourceKey\)/);
  assert.match(revision, /mergeByKey\(p\.formulas,formulas,formulaKey\)/);
  assert.match(revision, /Existing cards and review history were preserved/);
});
