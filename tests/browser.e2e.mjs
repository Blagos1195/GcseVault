import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2"
};

function createStaticServer() {
  return createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname === "/GcseVault") pathname = "/GcseVault/";
      if (pathname.startsWith("/GcseVault/")) pathname = pathname.slice("/GcseVault".length);
      let file = resolve(root, "." + pathname);
      if (!file.startsWith(root)) {
        response.writeHead(403).end();
        return;
      }
      try {
        if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
      } catch {}
      const body = await readFile(file);
      response.writeHead(200, { "Content-Type": contentTypes[extname(file)] || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
}

async function mockWorker(page) {
  await page.route("https://quotevault-api.noah-l-barker.workers.dev/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    let body = { success: true, items: [], notes: [], quotes: [], dates: [], results: [] };
    if (pathname === "/quotes" || pathname === "/dv/quotes") body = { items: [] };
    if (pathname === "/revision/public") body = { notes: [] };
    if (pathname === "/admin/status") body = { initialized: true, deployment: null };
    if (pathname === "/account/progress-summary") body = {
      account: { username: "student" },
      quoteVault: { scheduled: 8, due: 3, mastered: 6, xp: 900, updatedAt: "2026-11-13T10:00:00.000Z" },
      dateVault: { scheduled: 5, due: 2, mastered: 4, xp: 650, updatedAt: "2026-11-13T10:00:00.000Z" },
      revision: { sets: 2, cards: 20, reviewed: 12, due: 8, xp: 340, updatedAt: "2026-11-13T11:00:00.000Z" }
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
}

test("GCSE Vault apps load without browser exceptions at desktop and mobile widths", async () => {
  const server = createStaticServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/GcseVault`;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      for (const path of ["/", "/quotes/", "/dates/", "/revision/", "/progress/"]) {
        const page = await context.newPage();
        page.on("pageerror", error => failures.push(viewport.width + "px " + path + ": " + error.message));
        await mockWorker(page);
        const response = await page.goto(base + path, { waitUntil: "domcontentloaded" });
        assert.ok(response && response.ok(), "Failed to load " + path + " at " + viewport.width + "px");
        assert.ok((await page.locator("body").innerText()).trim().length > 0, "Empty page at " + path);
        if (path === "/progress/") {
          await page.evaluate(() => localStorage.setItem("vault_account_session", "e2e-session"));
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.getByText("Signed in as student").waitFor({ timeout: 5000 });
          assert.equal(await page.locator("#revision-reviewed").innerText(), "12");
          assert.equal(await page.locator("#qv-due").innerText(), "3");
          assert.equal(await page.locator("#qv-mastered").innerText(), "6");
          assert.equal(await page.locator("#dv-xp").innerText(), "650");
        }
        if (path === "/" && viewport.width === 390) {
          const search = page.locator("#global-search-input");
          if (await search.count()) {
            await search.fill("vault-e2e-no-match");
            await page.getByText("No matching public content found.").waitFor({ timeout: 5000 });
          }
        }
        if (viewport.width === 390 && ["/quotes/", "/dates/", "/revision/"].includes(path)) {
          const menu = page.locator("#hbg");
          await menu.focus();
          await page.keyboard.press("Space");
          assert.equal(await menu.getAttribute("aria-expanded"), "true", path + " menu did not announce its open state");
          await page.keyboard.press("Escape");
          assert.equal(await menu.getAttribute("aria-expanded"), "false", path + " menu did not close on Escape");
        }
        if (viewport.width === 390) {
          const width = await page.evaluate(() => document.documentElement.scrollWidth);
          assert.ok(width <= viewport.width + 2, path + " overflows horizontally at mobile width (" + width + "px)");
        }
        await page.close();
      }
      await context.close();
    }
    assert.deepEqual(failures, []);
  } finally {
    await browser.close();
    await new Promise(resolveClose => server.close(resolveClose));
  }
});


test("the main learning tools remain available after the device goes offline", async () => {
  const server = createStaticServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/GcseVault`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "allow" });
  try {
    const page = await context.newPage();
    await mockWorker(page);
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    await page.goto(base + "/admin/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => navigator.serviceWorker.register("/GcseVault/admin/push-sw.js", { scope: "/GcseVault/admin/" }));
    await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith("/admin/push-sw.js"), null, { timeout: 15000 });
    await context.setOffline(true);
    for (const [path, title] of [["/quotes/", "QuoteVault"], ["/dates/", "DateVault"], ["/revision/", "Revision"], ["/progress/", "Your progress"], ["/", "GCSE Vault"], ["/admin/", "Admin"]]) {
      await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 10000 });
      assert.ok((await page.locator("body").innerText()).includes(title), path + " did not load from the offline shell");
    }
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolveClose => server.close(resolveClose));
  }
});
