import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const files = [
  "shared.js",
  "index.html",
  "quotes/index.html",
  "quotes/quotes.js",
  "dates/index.html",
  "dates/dates.js",
  "revision/index.html",
  "revision/app.js",
  "revision/product.js",
  "revision/practice.js",
  "admin/index.html",
  "admin/admin.js",
  "admin/push-sw.js",
  "admin/editor.html",
  "admin/editor.js"
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
    if (scripts.length) {
      for (let index = 0; index < scripts.length; index++) {
        new vm.Script(scripts[index][2], { filename: `${file}:script-${index + 1}` });
      }
    } else {
      assert.ok(source.includes("<script src="), `No scripts found in ${file}`);
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
    window: { render() {}, addEventListener() {}, __vaultAccountFetchWrapped: true },
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
  const end = source.indexOf("if (!window.__vaultAccountFetchWrapped)", start);
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
  const end = source.indexOf("if (!window.__vaultAccountFetchWrapped)", start);
  assert.ok(start >= 0 && end > start);
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
  const end = source.indexOf("if (!window.__vaultAccountFetchWrapped)", start);
  assert.ok(start >= 0 && end > start);
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

test("Revision sync status reflects successful remote loads", async () => {
  const source = fs.readFileSync(new URL("../revision/product.js", import.meta.url), "utf8");
  const start = source.indexOf("const productOriginalLoadRevision=loadRevision;");
  const end = source.indexOf("\nwindow.addEventListener('online'", start);
  assert.ok(start >= 0 && end > start);
  assert.match(source.slice(source.lastIndexOf("updateRevisionSyncStatus();")), /if\(VaultUser\.getAccountSession\(\)\)loadRevision\(\);/);
  const context = {
    state: { syncStatus: "local", accountMessage: "" },
    VaultUser: { getAccountSession: () => "account-session" },
    revisionSyncConflict: false,
    loadRevision: async () => {},
    updateRevisionSyncStatus() {}
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  await context.loadRevision();
  assert.equal(context.state.syncStatus, "synced");

  const failedContext = {
    state: { syncStatus: "local", accountMessage: "" },
    VaultUser: { getAccountSession: () => "account-session" },
    revisionSyncConflict: false,
    loadRevision: async () => { failedContext.state.accountMessage = "Could not load synced revision data."; },
    updateRevisionSyncStatus() {}
  };
  vm.createContext(failedContext);
  vm.runInContext(source.slice(start, end), failedContext);
  await failedContext.loadRevision();
  assert.equal(failedContext.state.syncStatus, "failed");
});

test("DateVault timed challenge skip renders the next prompt", () => {
  const source = fs.readFileSync(new URL("../dates/dates.js", import.meta.url), "utf8");
  const renderStart = source.indexOf("function rTimed(){");
  const renderEnd = source.indexOf("\nfunction startTC()", renderStart);
  const skipStart = source.indexOf("function skipTC(){");
  const skipEnd = source.indexOf("\nfunction endTC()", skipStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.ok(skipStart >= 0 && skipEnd > skipStart);

  let input = { value: "stale answer", focus() { this.focused = true; } };
  let markup = "";
  const context = {
    S: {
      tc: {
        active: true,
        tLeft: 60,
        total: 60,
        qs: [
          { event: "First prompt", year: "2020", topic: "Audit" },
          { event: "Second prompt", year: "2021", topic: "Audit" }
        ],
        idx: 0,
        score: 0,
        result: { ok: false }
      }
    },
    document: { getElementById() { return input; } },
    pct: () => 100,
    render() {
      markup = vm.runInContext("rTimed()", context);
      input = { value: "", focus() { this.focused = true; } };
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(renderStart, renderEnd)}\n${source.slice(skipStart, skipEnd)}\nglobalThis.__skipTC = skipTC;`,
    context
  );
  context.__skipTC();

  assert.equal(context.S.tc.idx, 1);
  assert.equal(context.S.tc.result, null);
  assert.match(markup, /Second prompt/);
  assert.match(markup, /Q2 · Audit/);
  assert.equal(input.value, "");
  assert.equal(input.focused, true);
});

test("QuoteVault due count respects scheduled review dates", () => {
  const source = fs.readFileSync(new URL("../quotes/quotes.js", import.meta.url), "utf8");
  const start = source.indexOf("function dueCount(){");
  const end = source.indexOf("\n", start);
  assert.ok(start >= 0 && end > start);
  const context = {
    allQ: () => [{ id: "reviewed" }, { id: "new" }],
    qSRS: id => id === "reviewed" ? { due: "2026-11-11" } : {},
    isDue: srs => !srs.due || srs.due <= "2026-11-10"
  };
  vm.runInNewContext(
    `${source.slice(start, end)}\nglobalThis.__dueCount = dueCount;`,
    context
  );
  assert.equal(context.__dueCount(), 1);
});

test("QuoteVault timed challenge skip renders the next prompt", () => {
  const source = fs.readFileSync(new URL("../quotes/quotes.js", import.meta.url), "utf8");
  const renderStart = source.indexOf("function rTimed(){");
  const renderEnd = source.indexOf("\nfunction startTC()", renderStart);
  const skipStart = source.indexOf("function skipTC(){");
  const skipEnd = source.indexOf("\nfunction endTC()", skipStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.ok(skipStart >= 0 && skipEnd > skipStart);

  let input = { value: "stale answer", focus() { this.focused = true; } };
  let markup = "";
  const context = {
    S: {
      tc: {
        active: true,
        tLeft: 60,
        total: 60,
        qs: [
          { text: "First prompt", work: "Audit", loc: "One" },
          { text: "Second prompt", work: "Audit", loc: "Two" }
        ],
        idx: 0,
        score: 0,
        result: { ok: false },
        type: "who_said"
      }
    },
    document: { getElementById() { return input; } },
    pct: () => 100,
    render() {
      markup = vm.runInContext("rTimed()", context);
      input = { value: "", focus() { this.focused = true; } };
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(renderStart, renderEnd)}\n${source.slice(skipStart, skipEnd)}\nglobalThis.__skipTC = skipTC;`,
    context
  );
  context.__skipTC();

  assert.equal(context.S.tc.idx, 1);
  assert.equal(context.S.tc.result, null);
  assert.match(markup, /Second prompt/);
  assert.match(markup, /Q2 · Audit/);
  assert.equal(input.value, "");
  assert.equal(input.focused, true);
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
  const app = fs.readFileSync(new URL("../revision/app.js", import.meta.url), "utf8");
  const practice = fs.readFileSync(new URL("../revision/practice.js", import.meta.url), "utf8");
  assert.match(worker, /practice:\s*set\s*&&\s*set\.practice/);
  assert.match(worker, /formulas:\s*Array\.isArray\(set\.practice\.formulas\)/);
  assert.match(practice, /practiceRecommend/);
  assert.match(practice, /practiceImport/);
  assert.match(practice, /practiceConnections/);
  assert.match(app, /async function importPublicNote/);
  assert.match(practice, /revision-course-pack/);
  assert.match(practice, /practiceResourcesView/);
  assert.match(app, /resources: Array\.isArray\(set\.practice\.resources\)/);
  assert.match(worker, /resources: Array\.isArray\(set\.practice\.resources\)/);
});


test("Revision themes sync across devices without discarding local themes", () => {
  const shared = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
  const revision = fs.readFileSync(new URL("../revision/app.js", import.meta.url), "utf8");
  assert.match(shared, /'barker-orange':\s*\{/);
  assert.match(shared, /'bricked-device':\s*\{/);
  assert.match(shared, /const merged = \{ \.\.\.remote \};/);
  assert.match(shared, /uploads\.push\(\[key, theme\]\)/);
  assert.match(shared, /if \(!response\.ok\)/);
  assert.match(shared, /async applyTheme\(key, scope = 'global', sync = true\)/);
  assert.match(revision, /await ThemeManager\.applyTheme\(data\.user\.theme,'global',false\)/);
  assert.match(revision, /Your current theme has been kept/);
  assert.match(shared, /await window\.syncRevisionTheme\(\)/);
});


test("Revision account dialog has working modal helpers", () => {
  const app = fs.readFileSync(new URL("../revision/app.js", import.meta.url), "utf8");
  assert.match(app, /function openModal\(html\)[\s\S]*?modal\.innerHTML=html[\s\S]*?backdrop\.classList\.add\('open'\)/);
  assert.match(app, /function closeModal\(\)[\s\S]*?classList\.remove\('open'\)/);
  assert.match(app, /window\.openModal=openModal/);
  assert.match(app, /window\.closeModal=closeModal/);
  assert.match(app, /VaultUser\.showAccountDialog\(\)/);
});

test("Revision uses separate files, accessible navigation and contained lists", () => {
  const html = fs.readFileSync(new URL("../revision/index.html", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../revision/revision.css", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../revision/app.js", import.meta.url), "utf8");
  assert.match(html, /revision\.css/);
  assert.match(html, /app\.js/);
  assert.match(html, /practice\.js/);
  assert.match(html, /<button type="button" class="ni/);
  assert.doesNotMatch(html, /maximum-scale/);
  assert.ok(html.trimEnd().endsWith("</html>"));
  assert.equal((html.match(/name="viewport"/g)||[]).length,1);
  assert.match(css, /knowledge-list[\s\S]*?max-height:[^;]+;overflow-y:auto/);
  assert.match(css, /overview-hero/);
  assert.match(app, /aria-current/);
  assert.match(app, /scrollTop = 0/);
});


test("Revision product tools provide search, daily planning, resource tracking and sync status", () => {
  const html=fs.readFileSync(new URL("../revision/index.html",import.meta.url),"utf8");
  const product=fs.readFileSync(new URL("../revision/product.js",import.meta.url),"utf8");
  assert.match(html,/id="revision-search"/);
  assert.match(html,/id="sync-status"/);
  assert.match(product,/function searchRevision\(/);
  assert.match(product,/function practiceDailyPlan\(/);
  assert.match(product,/function practiceToggleResource\(/);
  assert.match(product,/Next action \(optional\)/);
  assert.match(product,/relatedResourceIds/);
  assert.match(product,/state\.publicNotes/);
  assert.match(product,/Not enough data/);
});

test("course pack imports preserve existing cards and deduplicate cards, resources and formulas", () => {
  const source = fs.readFileSync(new URL("../revision/practice.js", import.meta.url), "utf8");
  const start = source.indexOf("function practiceImport(input){");
  const end = source.indexOf("function practiceResourcesView()", start);
  assert.ok(start >= 0 && end > start);
  const state = {
    cards: [{ id: "saved-card", subject: "Chemistry", topic: "Amount of substance", title: "Moles in a solution", answer: "Keep this answer", links: [] }],
    view: "settings",
    setMessage: ""
  };
  const practice = {
    catalogues: { chemistry: { topics: [{ id: "amount", name: "Amount of substance" }] } },
    resources: [],
    formulas: []
  };
  const pack = {
    type: "revision-course-pack",
    version: 1,
    subject: "Chemistry",
    examBoard: "AQA",
    catalogueId: "chemistry",
    cards: [
      { id: "existing", topicId: "amount", front: "Moles in a solution!", back: "New content should not replace a student's card", links: ["new"] },
      { id: "new", topicId: "amount", front: "Calculate concentration", back: "Use amount divided by volume", links: ["existing"] },
      { id: "duplicate", topicId: "amount", front: "Calculate concentration", back: "Duplicate in same pack" }
    ],
    resources: [
      { topicId: "amount", kind: "notes", title: "Concentration", content: "Course notes" },
      { topicId: "amount", kind: "notes", title: "Concentration", content: "Duplicate course notes" }
    ],
    formulas: [
      { topicId: "amount", name: "Concentration", expression: "c = n / V" },
      { topicId: "amount", name: "Concentration", expression: "c = n ÷ V" }
    ]
  };
  const context = {
    state,
    practiceStore: () => practice,
    normalizeTopic: value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    saveRevision() {},
    renderRevision() {},
    cardById: id => state.cards.find(card => card.id === id),
    FileReader: function () {
      this.readAsText = () => { this.result = JSON.stringify(pack); this.onload(); };
    },
    Date,
    Math,
    JSON,
    String,
    Array,
    Map,
    Set
  };
  vm.runInNewContext(source.slice(start, end) + "\nglobalThis.runImport = practiceImport;", context);
  context.runImport({ files: [{ name: "pack.json" }] });
  assert.equal(state.cards.length, 2);
  assert.equal(state.cards[0].id, "saved-card");
  assert.equal(state.cards[0].answer, "Keep this answer");
  assert.equal(state.cards[1].title, "Calculate concentration");
  assert.ok(state.cards[0].links.includes(state.cards[1].id));
  assert.ok(state.cards[1].links.includes("saved-card"));
  assert.equal(practice.resources.length, 1);
  assert.equal(practice.formulas.length, 1);
  assert.equal(practice.formulas[0].expression, "c = n ÷ V");
});


test("QuoteVault and DateVault use separate scripts, accessible navigation and contained libraries", () => {
  for (const [page, script, stylesheet] of [
    ["quotes/index.html", "quotes/quotes.js", "quotes/quotes.css"],
    ["dates/index.html", "dates/dates.js", "dates/dates.css"]
  ]) {
    const html = fs.readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
    const app = fs.readFileSync(new URL(`../${script}`, import.meta.url), "utf8");
    const css = fs.readFileSync(new URL(`../${stylesheet}`, import.meta.url), "utf8");
    assert.ok(html.includes(script.split("/").pop()));
    assert.ok(html.includes(stylesheet.split("/").pop()));
    assert.doesNotMatch(html, /maximum-scale/);
    assert.match(app, /<button type="button" class="ni/);
    assert.match(app, /aria-current=/);
    assert.match(app, /scrollTop=0/);
    assert.match(app, /class="library-results"/);
    assert.match(css, /library-results[\s\S]*?overflow-y:auto/);
  }
});


test("review schedules are stored per account and synchronised through authenticated routes", () => {
  const worker = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  for (const path of ["../quotes/quotes.js", "../dates/dates.js"]) {
    const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
    assert.ok(source.includes("function loadReviewScheduleData(site)"));
    assert.ok(source.includes("reviewScheduleKey(scope=reviewScheduleScope)"));
    assert.ok(source.includes("async function syncReviewSchedules()"));
    assert.ok(source.includes("function scheduleReviewSync()"));
    assert.ok(source.includes("updatedAt:new Date().toISOString()"));
    assert.ok(source.includes("/review-schedules?site="));
    assert.ok(source.includes("X-Account-Session"));
    assert.ok(source.includes("token!==VaultUser.getAccountSession()||userKey!==VaultUser.getKey()"));
    assert.ok(source.includes("reviewScheduleSyncPromise"));
  }
  assert.ok(worker.includes('url.pathname === "/review-schedules"'));
  assert.ok(worker.includes("CREATE TABLE IF NOT EXISTS review_schedules"));
  const routeStart = worker.indexOf("/review-schedules");
  const routeEnd = worker.indexOf("/revision/sync", routeStart);
  const scheduleRoute = worker.slice(routeStart, routeEnd);
  assert.ok(scheduleRoute.includes("verifyPasswordAccountAccess(session.user_key, request)"));
});

test("Revision local snapshots are isolated between anonymous use and signed-in accounts", () => {
  const app = fs.readFileSync(new URL("../revision/app.js", import.meta.url), "utf8");
  const shared = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
  assert.ok(app.includes("function revisionUserKey(){return VaultUser.getAccountSession()?VaultUser.getKey():null;}"));
  assert.ok(app.includes("window.prepareRevisionAccountLogout"));
  assert.ok(app.includes("window.finishRevisionAccountLogout"));
  assert.ok(app.includes("window.activateRevisionAccount"));
  assert.ok(app.includes("Import it into "));
  assert.ok(app.includes("revisionStartupUserKey"));
  assert.ok(app.includes("revisionUseLegacyLocal"));
  assert.ok(app.includes("revisionActiveScope!==revisionUserKey()"));
  assert.ok(app.includes("Another tab changed accounts"));
  assert.ok(app.includes("let revisionLoadPromise=null;"));
  assert.ok(app.includes("requestedToken!==VaultUser.getAccountSession()||requestedUserKey!==revisionUserKey()"));
  assert.ok(app.includes("revisionLoadQueued"));
  assert.ok(app.includes("revisionSyncQueued"));
  assert.ok(app.includes("syncToken!==VaultUser.getAccountSession()||syncUserKey!==revisionUserKey()"));
  assert.ok(shared.includes("prepareRevisionAccountLogout"));
  assert.ok(shared.includes("finishRevisionAccountLogout"));
  assert.ok(shared.includes("typeof window !=="));
});

test("admin moderation has a separate full-content editor and safe submitter metadata", () => {
  const shared = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
  const worker = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  const queue = fs.readFileSync(new URL("../admin/admin.js", import.meta.url), "utf8");
  const editor = fs.readFileSync(new URL("../admin/editor.js", import.meta.url), "utf8");
  assert.ok(queue.includes("Open editor"));
  assert.ok(editor.includes("submission-json"));
  assert.ok(editor.includes("Save changes"));
  assert.ok(shared.includes("admin/editor.html"));
  assert.ok(!shared.includes("Edit the complete submission as JSON"));
  assert.ok(worker.includes("function sanitizeSubmission"));
  assert.ok(worker.includes("data.submittedBy = submitter"));
  assert.ok(worker.includes("getSubmissionOwners"));
});

test("expired account sessions preserve Revision and review schedule caches before logout", () => {
  const shared = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
  assert.ok(shared.includes("typeof window !== 'undefined' && typeof window.prepareRevisionAccountLogout"));
  assert.ok(shared.includes("typeof window !== 'undefined' && typeof window.finishRevisionAccountLogout"));
  assert.ok(shared.includes("typeof window !== 'undefined' && typeof window.syncReviewSchedules"));
});

test("review schedule account switching never offers one signed-in account's data to another", () => {
  for (const path of ["../quotes/quotes.js", "../dates/dates.js"]) {
    const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
    assert.ok(source.includes('reviewScheduleScope==="anonymous"&&next!=="anonymous"'));
    assert.ok(source.includes('event.key==="vault_userKey"'));
  }
});

test("moderation editors can update feedback and published content excludes submitter metadata", () => {
  const worker = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  const editor = fs.readFileSync(new URL("../admin/editor.js", import.meta.url), "utf8");
  assert.ok(worker.includes('url.pathname === "/feedback/update"'));
  assert.ok(editor.includes('feedback:"/feedback/update"'));
  assert.ok(worker.includes("delete publishedQuote.submittedBy"));
  assert.ok(worker.includes("delete publishedFact.submittedBy"));
  assert.ok(worker.includes("function sanitizeSubmission"));
});

test("content submissions authenticate their account and admin moderation is auditable", () => {
  const worker = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  const quotes = fs.readFileSync(new URL("../quotes/quotes.js", import.meta.url), "utf8");
  const dates = fs.readFileSync(new URL("../dates/dates.js", import.meta.url), "utf8");
  const admin = fs.readFileSync(new URL("../admin/admin.js", import.meta.url), "utf8");
  assert.ok(quotes.includes("X-Account-Session"));
  assert.ok(dates.includes("X-Account-Session"));
  assert.ok(worker.includes("async function recordApproval"));
  assert.ok(worker.includes("/admin/moderation-log"));
  assert.ok(worker.includes("recordApproval(\"quote\""));
  assert.ok(worker.includes("recordApproval(\"date\""));
  assert.ok(worker.includes("recordApproval(\"revision-note\""));
  assert.ok(worker.includes("leaderboard_hidden"));
  assert.ok(worker.includes("/admin/leaderboard-visibility"));
  assert.ok(admin.includes("Moderation history"));
  assert.ok(admin.includes("Leaderboard visibility"));
});


test("all site admin navigation points to the shared workspace", () => {
  const quoteIndex = fs.readFileSync(new URL("../quotes/index.html", import.meta.url), "utf8");
  const dateIndex = fs.readFileSync(new URL("../dates/index.html", import.meta.url), "utf8");
  const revisionIndex = fs.readFileSync(new URL("../revision/index.html", import.meta.url), "utf8");
  const quoteApp = fs.readFileSync(new URL("../quotes/quotes.js", import.meta.url), "utf8");
  const dateApp = fs.readFileSync(new URL("../dates/dates.js", import.meta.url), "utf8");

  for (const html of [quoteIndex, dateIndex, revisionIndex]) {
    assert.match(html, /href="\/GcseVault\/admin\/">Admin workspace/);
  }
  for (const app of [quoteApp, dateApp]) {
    assert.doesNotMatch(app, /label:'Admin'|admin:rAdmin/);
  }
});

test("central admin can search accounts and moderate already-published content", () => {
  const admin = fs.readFileSync(new URL("../admin/admin.js", import.meta.url), "utf8");
  const shared = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
  const worker = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  assert.match(admin, /Search accounts/);
  assert.match(admin, /Filter accounts by role/);
  assert.match(admin, /pageSize=50/);
  assert.match(admin, /removePublished/);
  assert.match(shared, /this\.request\('\/admin\/published'\)/);
  assert.match(worker, /url\.pathname === "\/admin\/published"/);
  assert.match(worker, /recordModerationAction\("quote", body\.id/);
  assert.match(worker, /recordModerationAction\("date", body\.id/);
});

test("submission ownership and one-time notifications cover all three sites", () => {
  const worker = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  const quote = fs.readFileSync(new URL("../quotes/quotes.js", import.meta.url), "utf8");
  const date = fs.readFileSync(new URL("../dates/dates.js", import.meta.url), "utf8");
  const revision = fs.readFileSync(new URL("../revision/app.js", import.meta.url), "utf8");
  assert.match(worker, /data\._submittedByUserKey = userKey/);
  assert.match(worker, /async function createSubmissionNotification/);
  assert.match(worker, /CREATE TABLE IF NOT EXISTS submission_notifications/);
  assert.match(worker, /url\.pathname === "\/submissions\/notifications"/);
  assert.match(worker, /url\.pathname === "\/submissions\/notifications\/resolve"/);
  assert.match(worker, /originalSubmission/);
  assert.match(quote, /checkSubmissionNotifications/);
  assert.match(date, /checkSubmissionNotifications/);
  assert.match(revision, /checkRevisionSubmissionNotifications/);
  assert.match(quote, /Keep my original/);
  assert.match(date, /Use approved version/);
});

test("central admin workspace includes owner account management controls", () => {
  const admin = fs.readFileSync(new URL("../admin/admin.js", import.meta.url), "utf8");
  const shared = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
  const worker = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  assert.match(admin, /function renderOwnerAccounts\([\s\S]*?if\(AdminManager\.role!=='owner'\)return ''/);
  assert.match(admin, /AdminManager\.setRole\(username,role\)/);
  assert.match(admin, /AdminManager\.setAIAccess/);
  assert.match(admin, /setLeaderboardHidden/);
  assert.match(admin, /AdminManager\.migrateStorage\(\)/);
  assert.match(shared, /this\.users = this\.role === 'owner' \? \(await this\.request\('\/admin\/users'\)\)/);
  assert.match(worker, /if \(actor\.role !== "owner"\) return new Response\("Owner access required"/);
  assert.match(worker, /if \(!user \|\| !\["owner", "admin"\]\.includes\(user\.role\)\) return null/);
});


test("Revision leaderboard excludes accounts hidden by owner controls", () => {
  const worker = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  const route = worker.slice(worker.indexOf('url.pathname === "/revision/leaderboard"'), worker.indexOf('url.pathname === "/revision/public"'));
  assert.match(route, /LEFT JOIN users u ON u\.user_key = r\.user_key/);
  assert.match(route, /COALESCE\(u\.leaderboard_hidden, 0\) = 0/);
});

test("admin submissions use Web Push when the admin site is closed", () => {
  const worker = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  const admin = fs.readFileSync(new URL("../admin/admin.js", import.meta.url), "utf8");
  const serviceWorker = fs.readFileSync(new URL("../admin/push-sw.js", import.meta.url), "utf8");
  assert.match(worker, /CREATE TABLE IF NOT EXISTS admin_push_subscriptions/);
  assert.match(worker, /url\.pathname === "\/admin\/push\/subscribe"/);
  assert.match(worker, /Content-Encoding": "aes128gcm"/);
  assert.match(worker, /createVapidToken/);
  assert.match(worker, /encryptPushPayload/);
  assert.match(admin, /enableAdminPushNotifications/);
  assert.match(admin, /PushManager/);
  assert.match(admin, /Notification\.requestPermission/);
  assert.match(admin, /pushManager\.subscribe/);
  assert.match(serviceWorker, /addEventListener\("push"/);
  assert.match(serviceWorker, /showNotification/);
  assert.match(serviceWorker, /notificationclick/);
});


test("automatic bug reports redact secrets and identify the failing site", async () => {
  const source = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
  const start = source.indexOf("const VaultBugReporter = (() => {");
  const end = source.indexOf("window.VaultBugReporter = VaultBugReporter;", start) + "window.VaultBugReporter = VaultBugReporter;".length;
  assert.ok(start >= 0 && end > start);
  const listeners = {};
  const requests = [];
  const context = {
    window: { addEventListener(name, callback) { listeners[name] = callback; } },
    VaultUser: { WORKER_URL: "https://worker.example" },
    location: { pathname: "/GcseVault/revision/" },
    navigator: { platform: "Android", userAgent: "Test Browser" },
    document: { documentElement: { dataset: {} } },
    URL,
    fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true }; },
    Date,
    Map,
    Error,
    String,
    Math,
    JSON
  };
  vm.runInNewContext(source.slice(start, end), context);
  listeners.error({ error: new Error("Token=secret-value failed for student@example.com"), filename: "https://site.example/app.js?session=private", lineno: 4, colno: 2 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.type, "Automatic bug report");
  assert.equal(requests[0].body.sourceApplication, "Revision");
  assert.equal(requests[0].body.page, "/GcseVault/revision/");
  assert.doesNotMatch(JSON.stringify(requests[0].body), /secret-value|student@example.com|session=private/);
});


test("review schedule responses cannot cross accounts during an account switch", async () => {
  const source = fs.readFileSync(new URL("../quotes/quotes.js", import.meta.url), "utf8");
  const start = source.indexOf("let reviewScheduleScope=");
  const end = source.indexOf("\n\nfunction save(){", start);
  assert.ok(start >= 0 && end > start);
  let account = { token: "token-A", key: "account-A" };
  let resolveA;
  const requests = [];
  const storage = new Map([["qv_srs:account-A", JSON.stringify({ a: { updatedAt: "2026-11-10T10:00:00.000Z" } })]]);
  const context = {
    S: { srsData: { a: { updatedAt: "2026-11-10T10:00:00.000Z" } } },
    VaultUser: { getAccountSession: () => account.token, getKey: () => account.key },
    WORKER_URL: "https://worker.example",
    navigator: { onLine: true },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); }
    },
    window: { addEventListener() {}, confirm() { return false; } },
    fetch: (url, options) => {
      const token = options.headers["X-Account-Session"];
      if (options.method === "POST") {
        requests.push({ method: "POST", token, schedules: JSON.parse(options.body).schedules });
        return Promise.resolve({ ok: true });
      }
      requests.push({ method: "GET", token });
      if (token === "token-A") return new Promise(resolve => { resolveA = resolve; });
      return Promise.resolve({ ok: true, json: async () => ({ schedules: { b: { updatedAt: "2026-11-11T10:00:00.000Z" } } }) });
    },
    Date,
    Promise,
    Object,
    JSON,
    console,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(source.slice(start, end) + "\nglobalThis.__sync = syncReviewSchedules;", context);
  const first = context.__sync();
  await Promise.resolve();
  account = { token: "token-B", key: "account-B" };
  const second = context.__sync();
  resolveA({ ok: true, json: async () => ({ schedules: { a: { updatedAt: "2026-11-10T10:00:00.000Z" } } }) });
  await Promise.all([first, second]);
  await new Promise(resolve => setImmediate(resolve));
  const posts = requests.filter(request => request.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].token, "token-B");
  assert.deepEqual(JSON.parse(JSON.stringify(posts[0].schedules)), { b: { updatedAt: "2026-11-11T10:00:00.000Z" } });
});

test("Revision makes multiple sets visible and requires explicit publish selection", () => {
  const app = fs.readFileSync(new URL("../revision/app.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../revision/index.html", import.meta.url), "utf8");
  assert.match(html, /id="revision-set-switcher"/);
  assert.match(app, /const setSwitcher=document\.getElementById\('revision-set-switcher'\)/);
  assert.match(app, /function renderRevisionSetOverview\(\)/);
  assert.match(app, /\$\{renderRevisionSetOverview\(\)\}/);
  assert.match(app, /Keep different subjects, courses or revision projects separate/);
  assert.match(app, /function renderPublishSetControl\(\)/);
  assert.match(app, /Pick a set to publish/);
  assert.match(app, /onchange="state\.publishSetId=this\.value"/);
  assert.match(app, /Publish selected set/);
  assert.match(app, /function publishRevisionSet\(setId\)\{\s*const target = state\.accountSets\.find\(set => set\.id === setId\);\s*if \(!target\)/);
  assert.doesNotMatch(app, /onclick="publishRevisionSet\('\$\{set\.id\}'\)"/);
  assert.match(html, /app\.js\?v=20261113-offline-sync/);
  assert.match(html, /revision\.css\?v=20261113-offline-sync/);
});


test("Revision sets can be duplicated with their progress and reordered", () => {
  const app = fs.readFileSync(new URL("../revision/app.js", import.meta.url), "utf8");
  assert.match(app, /function duplicateRevisionSet\(setId\)/);
  assert.match(app, /JSON\.parse\(JSON\.stringify\(source\)\)/);
  assert.match(app, /copy\.published=false/);
  assert.match(app, /function moveRevisionSet\(setId,direction\)/);
  assert.match(app, /state\.accountSets\.splice\(next,0,set\)/);
  assert.match(app, /onclick="duplicateRevisionSet\('\$\{set\.id\}'\)">Duplicate/);
  assert.match(app, /onclick="moveRevisionSet\('\$\{set\.id\}',-1\)"/);
  assert.match(app, /onclick="moveRevisionSet\('\$\{set\.id\}',1\)"/);
});


test("Revision daily study goals are stored and calculated per set", () => {
  const app = fs.readFileSync(new URL("../revision/app.js", import.meta.url), "utf8");
  assert.match(app, /dailyGoal: Math\.max\(1, Math\.min\(200, Number\(set && set\.dailyGoal\) \|\| 20\)\)/);
  assert.match(app, /function dailyReviewCount\(\)/);
  assert.match(app, /function updateDailyGoal\(\)/);
  assert.match(app, /getActiveRevisionSet\(\)\.reviewLog/);
  assert.match(app, /<h2>Daily study goal<\/h2>/);
  assert.match(app, /onclick="updateDailyGoal\(\)"/);
});


test("Revision library supports safe bulk subject and topic edits and deletion", () => {
  const app = fs.readFileSync(new URL("../revision/app.js", import.meta.url), "utf8");
  assert.ok(app.includes("function applyBulkEdit()"));
  assert.ok(app.includes("function deleteBulkSelected()"));
  assert.ok(app.includes("data-bulk-card"));
  assert.ok(app.includes("Select all filtered"));
  assert.ok(app.includes("This cannot be undone."));
  assert.ok(app.includes("state.bulkSelected = []"));
});


test("Revision queues sync while online and preserves changes locally while offline", () => {
  const app = fs.readFileSync(new URL("../revision/app.js", import.meta.url), "utf8");
  const start = app.indexOf("function syncRevisionSoon(){");
  const end = app.indexOf("\nwindow.addEventListener('pagehide'", start);
  assert.ok(start >= 0 && end > start);
  let scheduled = 0;
  const context = {
    navigator: { onLine: false },
    state: { syncStatus: "synced", accountMessage: "", accountMessageType: "" },
    revisionSyncTimer: null,
    clearTimeout() {},
    revisionActiveScope: "account",
    revisionUserKey: () => "account",
    revisionUsername: () => "student",
    VaultUser: { getAccountSession: () => "session" },
    setTimeout() { scheduled++; return 1; }
  };
  vm.runInNewContext(app.slice(start, end), context);
  context.syncRevisionSoon();
  assert.equal(context.state.syncStatus, "offline");
  assert.match(context.state.accountMessage, /saved on this device/);
  assert.equal(scheduled, 0);
  context.navigator.onLine = true;
  context.syncRevisionSoon();
  assert.equal(scheduled, 1);
  assert.match(app, /window\.addEventListener\('online'/);
  assert.match(app, /window\.addEventListener\('offline'/);
  assert.match(app, /Offline · saved on this device/);
});
