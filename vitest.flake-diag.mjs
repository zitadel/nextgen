// SPIKE (#1490) — not for merge.
//
// Diagnostics for the CI-only browser-mode flake, where a real-Chromium suite
// fails to load with "Failed to fetch dynamically imported module". Chromium
// reports any failure anywhere in a module's import graph against the
// top-level file, and Vite answers an outdated optimized-dep request with a
// silent 504, so the normal CI log cannot say which request died or how. This
// records both ends of every request:
//
// - server side, a Vite middleware logs each non-2xx response, each request
//   the browser abandoned before the response finished, each slow response,
//   and every message Vite pushes over the hot channel (full reloads);
// - browser side, Chromium writes a NetLog with the network error or HTTP
//   status of every request, summarised by scripts/flake-diag-report.mjs.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const flakeDiagDir = join(dirname(fileURLToPath(import.meta.url)), "flake-diag");

const SLOW_MS = 3000;

export function flakeDiagPlugin(name) {
  return {
    name: "flake-diag",
    configureServer(server) {
      const started = Date.now();
      const log = (message) =>
        console.log(`[flake-diag ${name}] +${Date.now() - started}ms ${message}`);
      log(`server up root=${server.config.root} cacheDir=${server.config.cacheDir}`);

      const hot = server.environments?.client?.hot;
      if (hot && typeof hot.send === "function") {
        const send = hot.send.bind(hot);
        hot.send = (...args) => {
          const payload = typeof args[0] === "string" ? args[0] : JSON.stringify(args[0]);
          log(`hot.send ${String(payload).slice(0, 300)}`);
          return send(...args);
        };
      }

      server.middlewares.use((req, res, next) => {
        const begin = Date.now();
        let finished = false;
        res.on("finish", () => {
          finished = true;
          const ms = Date.now() - begin;
          if (res.statusCode >= 400 || ms > SLOW_MS) {
            log(`${res.statusCode} ${res.statusMessage ?? ""} ${ms}ms ${req.method} ${req.url}`);
          }
        });
        res.on("close", () => {
          if (!finished) {
            log(`ABORTED by client after ${Date.now() - begin}ms ${req.method} ${req.url}`);
          }
        });
        next();
      });
    },
  };
}

export function flakeDiagLaunchArgs(name) {
  mkdirSync(flakeDiagDir, { recursive: true });
  const file = join(flakeDiagDir, `${name}-${process.pid}-${Date.now()}.netlog.json`);
  return [`--log-net-log=${file}`, "--net-log-capture-mode=Default"];
}
