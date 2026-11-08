import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const files = [
  "shared.js",\n  "auth-crypto.js",
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
