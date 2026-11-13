import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const adminKey = process.env.STAGING_ADMIN_KEY;
const accountApi = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };

if (!accountId || !apiToken || !adminKey) {
  throw new Error("Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and STAGING_ADMIN_KEY in GitHub Actions secrets.");
}

async function cloudflare(method, path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(`Cloudflare API ${method} ${path} failed: ${(payload.errors || []).map(error => error.message).join("; ") || response.statusText}`);
  }
  return payload.result;
}

async function findOrCreateD1(name) {
  const databases = await cloudflare("GET", `/accounts/${accountId}/d1/database?per_page=100`);
  const existing = databases.find(database => database.name === name);
  if (existing) return existing;
  return cloudflare("POST", `/accounts/${accountId}/d1/database`, { name });
}

async function findOrCreateKv(title) {
  let page = 1;
  while (true) {
    const result = await cloudflare("GET", `/accounts/${accountId}/storage/kv/namespaces?per_page=100&page=${page}`);
    const existing = result.find(namespace => namespace.title === title);
    if (existing) return existing;
    if (result.length < 100) break;
    page++;
  }
  return cloudflare("POST", `/accounts/${accountId}/storage/kv/namespaces`, { title });
}

async function ensurePagesProject(name) {
  const projects = await cloudflare("GET", `/accounts/${accountId}/pages/projects`);
  if (projects.some(project => project.name === name)) return;
  await cloudflare("POST", `/accounts/${accountId}/pages/projects`, { name, production_branch: "main" });
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function run(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    input,
    encoding: "utf8",
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"]
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

const databaseName = "gcsevault-staging";
const kvBindings = ["DV_PENDING", "DV_PUBLIC", "FEEDBACK", "PUBLIC_QUOTES", "QUOTEVAULT", "THEMES", "REVISION"];
const [database, ...namespaces] = await Promise.all([
  findOrCreateD1(databaseName),
  ...kvBindings.map(binding => findOrCreateKv(`gcsevault-staging-${binding}`))
]);
const pagesProject = "gcsevault-staging";
await ensurePagesProject(pagesProject);
const subdomainData = await cloudflare("GET", `/accounts/${accountId}/workers/subdomain`);
const subdomain = subdomainData?.subdomain;
if (!subdomain) throw new Error("Enable a workers.dev subdomain for this Cloudflare account before deploying staging.");

const workerUrl = `https://quotevault-api-staging.${subdomain}.workers.dev`;
const configLines = [
  'name = "quotevault-api-staging"',
  'main = "worker.js"',
  'compatibility_date = "2026-05-11"',
  'workers_dev = true',
  "",
  "[version_metadata]",
  'binding = "CF_VERSION_METADATA"',
  "",
  "[observability.logs]",
  "enabled = true",
  "",
  "[observability.traces]",
  "enabled = true",
  "",
  "[[d1_databases]]",
  'binding = "DB"',
  `database_name = ${tomlString(databaseName)}`,
  `database_id = ${tomlString(database.uuid)}`,
  'migrations_dir = "migrations"',
  ""
];
kvBindings.forEach((binding, index) => {
  configLines.push("[[kv_namespaces]]", `binding = ${tomlString(binding)}`, `id = ${tomlString(namespaces[index].id)}`, "");
});
configLines.push("[vars]", `VAPID_SUBJECT = ${tomlString("mailto:staging@gcsevault.invalid")}`);
const configPath = resolve("wrangler.staging.generated.toml");
writeFileSync(configPath, configLines.join("\n") + "\n");

run("npx", ["wrangler", "d1", "migrations", "apply", databaseName, "--remote", "--config", configPath]);
run("npx", ["wrangler", "deploy", "--config", configPath]);
run("npx", ["wrangler", "secret", "put", "ADMIN_KEY", "--config", configPath], adminKey);

const distRoot = resolve("dist/GcseVault");
rmSync(resolve("dist"), { recursive: true, force: true });
mkdirSync(distRoot, { recursive: true });
for (const file of ["index.html", "shared.js", "worker-config.js", "offline.js", "sw.js"]) {
  cpSync(resolve(file), resolve(distRoot, file));
}
for (const directory of ["quotes", "dates", "revision", "admin", "feedback", "progress"]) {
  cpSync(resolve(directory), resolve(distRoot, directory), { recursive: true });
}
writeFileSync(resolve(distRoot, "worker-config.js"),
  `window.GCSE_VAULT_WORKER_URL = ${JSON.stringify(workerUrl)};\nwindow.GCSE_VAULT_DISABLE_PUSH = true;\n`
);

run("npx", ["wrangler", "pages", "deploy", resolve("dist"), "--project-name", pagesProject, "--branch", "staging"]);
console.log(`Staging site: https://${pagesProject}.pages.dev/GcseVault/\nStaging API: ${workerUrl}`);
