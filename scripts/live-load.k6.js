import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const baseUrl = (__ENV.BASE_URL || "https://blagos1195.github.io/GcseVault").replace(/\/$/, "");
const workerUrl = (__ENV.WORKER_URL || "https://quotevault-api.noah-l-barker.workers.dev").replace(/\/$/, "");
const requestedMaxVUs = Number(__ENV.MAX_VUS || 5);
const maxVUs = Number.isFinite(requestedMaxVUs) ? Math.min(20, Math.max(1, Math.floor(requestedMaxVUs))) : 5;
const accounts = JSON.parse(open("./scripts/load-test-accounts.json"));
const pageFailures = new Rate("page_failure_rate");
const apiFailures = new Rate("account_api_failure_rate");
const pageDuration = new Trend("page_duration");
const apiDuration = new Trend("account_api_duration");

export const options = {
  stages: [
    { duration: "30s", target: 1 },
    { duration: "30s", target: Math.min(5, maxVUs) },
    { duration: "1m", target: maxVUs },
    { duration: "2m", target: maxVUs },
    { duration: "30s", target: 0 }
  ],
  thresholds: {
    page_failure_rate: ["rate<0.01"],
    account_api_failure_rate: ["rate<0.01"],
    page_duration: ["p(95)<1500"],
    account_api_duration: ["p(95)<1500"]
  },
  userAgent: "GCSEVault-load-test/1.0"
};

const pages = ["/", "/quotes/", "/dates/", "/revision/", "/progress/"];

export function setup() {
  if (!Array.isArray(accounts) || accounts.length < maxVUs) {
    throw new Error("Add at least " + maxVUs + " dedicated test-account sessions to scripts/load-test-accounts.json.");
  }
  for (let index = 0; index < maxVUs; index++) {
    const session = String(accounts[index]?.session || "");
    if (!/^[a-f0-9]{64}$/i.test(session)) {
      throw new Error("Test account " + (index + 1) + " does not contain a valid 64-character account session.");
    }
  }
  return accounts;
}

export default function (accounts) {
  const pagePath = pages[(__ITER + __VU - 1) % pages.length];
  const pageResponse = http.get(baseUrl + pagePath, { tags: { request_type: "page", page: pagePath } });
  const pageOk = check(pageResponse, { "site page returns HTTP 200": response => response.status === 200 });
  pageFailures.add(!pageOk);
  pageDuration.add(pageResponse.timings.duration);

  const session = accounts[__VU - 1].session;
  const apiResponse = http.get(workerUrl + "/account/progress-summary", {
    headers: { "X-Account-Session": session },
    tags: { request_type: "account_api" }
  });
  const apiOk = check(apiResponse, { "account progress API returns HTTP 200": response => response.status === 200 });
  apiFailures.add(!apiOk);
  apiDuration.add(apiResponse.timings.duration);

  sleep(2);
}
