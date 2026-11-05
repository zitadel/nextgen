import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DISPATCHED_EVENTS } from "./events.js";

// Resolved from the package cwd, not `import.meta.url` — vite rewrites module
// URLs in the jsdom environment (same convention as standalone-artifact.spec.ts).
const src = join(process.cwd(), "src");

// Both dispatch forms, any quote style, digits allowed in the event name. The
// target may be a member expression, as in a controller's `emit(this.host, …)`:
//   emit(this, "zitadel-…")   emit(host, 'zitadel-…')   new CustomEvent(`zitadel-…`)
const WIDGET_EVENT =
  /(?:emit\(\s*[\w.]+\s*,\s*|new\s+CustomEvent\(\s*)["'`](zitadel-[a-z0-9-]+)["'`]/g;

function dispatchedWidgetEvents(): string[] {
  const events = new Set<string>();
  for (const relativePath of readdirSync(src, { recursive: true, encoding: "utf8" })) {
    if (!relativePath.endsWith(".ts") || relativePath.endsWith(".spec.ts")) continue;
    for (const match of readFileSync(join(src, relativePath), "utf8").matchAll(WIDGET_EVENT)) {
      if (match[1]) events.add(match[1]);
    }
  }
  return [...events].sort();
}

describe("DISPATCHED_EVENTS", () => {
  it("lists exactly the events the elements dispatch", () => {
    expect(dispatchedWidgetEvents()).toEqual([...DISPATCHED_EVENTS].sort());
  });
});
