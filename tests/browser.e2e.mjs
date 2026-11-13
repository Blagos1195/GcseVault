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
      for (const path of ["/", "/quotes/", "/dates/", "/revision/"]) {
        const page = await context.newPage();
        page.on("pageerror", error => failures.push(viewport.width + "px " + path + ": " + error.message));
        await mockWorker(page);
        const response = await page.goto(base + path, { waitUntil: "domcontentloaded" });
        assert.ok(response && response.ok(), "Failed to load " + path + " at " + viewport.width + "px");
        assert.ok((await page.locator("body").innerText()).trim().length > 0, "Empty page at " + path);
        if (path === "/" && viewport.width === 390) {
          const search = page.locator("#global-search-input");
          await search.fill("vault-e2e-no-match");
          await page.getByText("No matching public content found.").waitFor({ timeout: 5000 });
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
