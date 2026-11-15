import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const baseUrl = String(process.env.BASE_URL || "").replace(/\/$/, "");
const requestedAccounts = Number(process.env.MAX_ACCOUNTS || 3);
const accountCount = Number.isFinite(requestedAccounts) ? Math.floor(requestedAccounts) : 3;
const outputUrl = new URL("./load-test-accounts.json", import.meta.url);
const input = createInterface({ input: stdin, output: stdout });
const accounts = [];

if (!baseUrl.startsWith("https://")) {
  throw new Error("Set BASE_URL to the live site URL, including its /GcseVault path.");
}
if (accountCount < 1 || accountCount > 10) {
  throw new Error("MAX_ACCOUNTS must be between 1 and 10.");
}

let browser;

try {
  const existing = await readFile(outputUrl, "utf8").catch(() => null);
  if (existing) {
    const overwrite = await input.question("Replace the existing local test-account file? Type yes to continue: ");
    if (overwrite.trim().toLowerCase() !== "yes") {
      console.log("No changes made.");
      process.exitCode = 1;
      process.exit();
    }
  }

  browser = await chromium.launch({ headless: false });

  for (let index = 0; index < accountCount; index++) {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      console.log("");
      console.log("Account " + (index + 1) + " of " + accountCount);
      console.log("Sign in using a dedicated load-test account in the browser window.");
      console.log("Do not use your normal account.");
      let account;

      while (!account) {
        await input.question("After signing in, press Enter here to capture this account: ");
        account = await page.evaluate(() => ({
          session: localStorage.getItem("vault_account_session") || "",
          userKey: localStorage.getItem("vault_userKey") || ""
        }));

        if (!/^[a-f0-9]{64}$/i.test(account.session) || !account.userKey.trim()) {
          account = null;
          console.log("A valid GCSE Vault session was not found. Check the sign-in, then try again.");
        }
      }

      accounts.push(account);
      console.log("Account session captured locally. Its credentials will not be printed.");
    } finally {
      await context.close();
    }
  }

  await writeFile(outputUrl, JSON.stringify(accounts, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  console.log("");
  console.log("Saved " + accounts.length + " test-account sessions to scripts/load-test-accounts.json.");
  console.log("That file is ignored by Git. Do not share or commit it.");
} finally {
  if (browser) await browser.close();
  input.close();
}
