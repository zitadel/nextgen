// SPIKE (#1490) — not for merge.
//
// Summarises the Chromium NetLogs that vitest.flake-diag.mjs makes the
// browser-mode suites write: for every request to the local test server, print
// the ones that ended in a network error or a non-2xx/3xx HTTP status. A NetLog
// from a browser that was killed mid-write has no closing brackets, so parsing
// retries with them appended.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "flake-diag";

let files = [];
try {
  files = readdirSync(dir).filter((file) => file.endsWith(".netlog.json"));
} catch {
  console.log(`[flake-diag-report] no ${dir} directory`);
  process.exit(0);
}

const invert = (record) => Object.fromEntries(Object.entries(record).map(([k, v]) => [v, k]));

for (const file of files) {
  const raw = readFileSync(join(dir, file), "utf8").trim().replace(/,\s*$/, "");
  let netlog;
  for (const suffix of ["", "]}", "\n]}"]) {
    try {
      netlog = JSON.parse(raw + suffix);
      break;
    } catch {
      // try the next closing suffix
    }
  }
  if (!netlog) {
    console.log(`[flake-diag-report] ${file}: unparseable`);
    continue;
  }

  const eventTypes = invert(netlog.constants?.logEventTypes ?? {});
  const netErrors = invert(netlog.constants?.netError ?? {});
  const urls = new Map();
  const statuses = new Map();
  const errors = new Map();
  for (const event of netlog.events ?? []) {
    const id = event.source?.id;
    const params = event.params ?? {};
    if (typeof params.url === "string" && !urls.has(id)) urls.set(id, params.url);
    const headers = params.headers;
    if (Array.isArray(headers) && typeof headers[0] === "string" && headers[0].startsWith("HTTP/")) {
      statuses.set(id, headers[0]);
    }
    if (typeof params.net_error === "number" && params.net_error < 0) {
      const code = netErrors[params.net_error] ?? params.net_error;
      errors.set(id, `${code} at ${eventTypes[event.type] ?? event.type}`);
    }
  }

  const networkChangedCode = netlog.constants?.netError?.ERR_NETWORK_CHANGED;
  let networkChanges = 0;
  let killedByNetworkChange = 0;
  for (const event of netlog.events ?? []) {
    const type = eventTypes[event.type] ?? "";
    if (type.startsWith("NETWORK_") && type.endsWith("CHANGED")) networkChanges += 1;
    if (event.params?.net_error === networkChangedCode) killedByNetworkChange += 1;
  }
  console.log(
    `[flake-diag-report] ${file}: network-change events=${networkChanges} requests killed by ERR_NETWORK_CHANGED=${killedByNetworkChange}`,
  );

  let abnormal = 0;
  for (const [id, url] of urls) {
    if (!/\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) continue;
    // A WebSocket handshake ends as 101 + ERR_WS_UPGRADE in a NetLog; that is normal.
    if (url.startsWith("ws")) continue;
    const status = statuses.get(id);
    const error = errors.get(id);
    const badStatus = status !== undefined && !/^HTTP\/[\d.]+ [23]\d\d\b/.test(status);
    if (error || badStatus) {
      abnormal += 1;
      console.log(`[flake-diag-report] ${file} ${status ?? "(no response)"} ${error ?? ""} ${url}`);
    }
  }
  console.log(`[flake-diag-report] ${file}: ${urls.size} requests, ${abnormal} abnormal`);
}
