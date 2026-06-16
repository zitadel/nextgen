import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGIN_EVENTS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENTS,
} from "./types.js";

/**
 * The element↔contract drift guard.
 *
 * The `@zitadel/components` elements dispatch their widget events as string
 * literals — either through the `emit(host, "zitadel-…")` helper or a raw
 * `new CustomEvent("zitadel-…")`. This test scans the entire component source
 * for every `zitadel-*` event it dispatches (any quote style, digits allowed)
 * and asserts the set is EXACTLY the SPA contract ({@link ZITADEL_LOGIN_EVENTS}
 * + {@link ZITADEL_LOGOUT_EVENTS}). Adding or removing a widget event in the
 * element therefore fails here until the contract is updated — and updating the
 * contract forces every SDK (via their contract-driven forwarding tests) to
 * wire or drop the event.
 */
const componentsSrc = fileURLToPath(new URL("../../components/src/", import.meta.url));

// Both dispatch forms, any quote style, digits allowed in the event name:
//   emit(this, "zitadel-…")   emit(host, 'zitadel-…')   new CustomEvent(`zitadel-…`)
const WIDGET_EVENT =
  /(?:emit\(\s*\w+\s*,\s*|new\s+CustomEvent\(\s*)["'`](zitadel-[a-z0-9-]+)["'`]/g;

function dispatchedWidgetEvents(): string[] {
  const events = new Set<string>();
  for (const relativePath of readdirSync(componentsSrc, {
    recursive: true,
    encoding: "utf8",
  })) {
    if (!relativePath.endsWith(".ts") || relativePath.endsWith(".spec.ts")) {
      continue;
    }
    const source = readFileSync(`${componentsSrc}${relativePath}`, "utf8");
    for (const match of source.matchAll(WIDGET_EVENT)) {
      const event = match[1];
      if (event) {
        events.add(event);
      }
    }
  }
  return [...events].sort();
}

describe("SPA widget contract ↔ @zitadel/components", () => {
  it("declares exactly the events the elements dispatch", () => {
    const declared = [...ZITADEL_LOGIN_EVENTS, ...ZITADEL_LOGOUT_EVENTS].sort();
    expect(dispatchedWidgetEvents()).toEqual(declared);
  });

  it("maps every event to a distinct handler prop", () => {
    for (const handlers of [ZITADEL_LOGIN_EVENT_HANDLERS, ZITADEL_LOGOUT_EVENT_HANDLERS]) {
      const names = Object.values(handlers);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
