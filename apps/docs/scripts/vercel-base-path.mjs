#!/usr/bin/env node
// Relocates Waku's Vercel Build Output under DOCS_BASE_PATH.
//
// `waku build` with VERCEL set writes `.vercel/output` through Waku's Vercel
// adapter. With a non-root `basePath` the adapter already prefixes its routes
// (`/docs/assets/*`, `/docs/(.*)` → `/docs/RSC/`) but still writes the static
// files to `static/` and the server function to `functions/RSC.func`, where
// Vercel would serve them at the root. Moving both under the base path makes
// the output consistent with the routes. No-op at the root and outside Vercel.
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const base = normalizeBasePath(process.env.DOCS_BASE_PATH);
if (!process.env.VERCEL || base === "/") {
  process.exit(0);
}

const output = resolve(import.meta.dirname, "..", ".vercel", "output");
if (!existsSync(output)) {
  console.error(`vercel-base-path: ${output} does not exist; run waku build with VERCEL set first`);
  process.exit(1);
}
const segments = base.slice(1, -1); // "docs" or "docs/preview"

const staticDir = join(output, "static");
const staged = join(output, "static.base-path");
renameSync(staticDir, staged);
mkdirSync(join(staticDir, dirname(segments)), { recursive: true });
renameSync(staged, join(staticDir, segments));

const serverFunction = join(output, "functions", "RSC.func");
if (existsSync(serverFunction)) {
  const target = join(output, "functions", segments, "RSC.func");
  mkdirSync(dirname(target), { recursive: true });
  renameSync(serverFunction, target);
}

const config = JSON.parse(readFileSync(join(output, "config.json"), "utf8"));
const routed = (config.routes ?? []).some((route) => typeof route.src === "string" && route.src.includes(base));
if (!routed) {
  console.error(`vercel-base-path: no route in config.json mentions ${base}; was waku built with this DOCS_BASE_PATH?`);
  process.exit(1);
}
console.log(`vercel-base-path: output relocated under ${base}`);

function normalizeBasePath(value) {
  const trimmed = (value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}
