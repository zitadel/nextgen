import { describe, expect, it } from "vitest";

import * as entry from "../dist/server.mjs";

/**
 * Loads the built `server.ts` inside the `edge-runtime` VM (the `edge` project
 * in `vitest.config.ts`), which has no `HTMLElement`, `document` or
 * `customElements`, with dependencies resolved under the `browser` condition.
 * The entry fails to load there the moment it reaches Lit. The identity of each
 * export with the package root's is checked in `server.spec.ts`, which needs a
 * DOM to import the root.
 */
describe("server entry in the edge runtime", () => {
  it("runs without a DOM", () => {
    expect(typeof HTMLElement).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof customElements).toBe("undefined");
  });

  it("loads and keeps the locale data the SDKs re-export", () => {
    expect(entry.businessLocales).toBeTypeOf("object");
    expect(Object.keys(entry.businessLocales).length).toBeGreaterThan(0);
  });

  it("defines no element", () => {
    expect(Object.keys(entry).filter((name) => /^(Zitadel|Zl)[A-Z]/.test(name))).toEqual([]);
  });

  it("runs the pure helpers it exports", () => {
    expect(entry.zitadelTrustmarkInnerHtml).toBeTypeOf("function");
    expect(entry.TEMPLATE_NAMES).toBeTypeOf("object");
    expect(entry.publishedSides(undefined)).toBeInstanceOf(Array);
  });
});
