import { describe, expect, it } from "vitest";

import * as client from "../client";

/**
 * Loads the client entry inside the `edge-runtime` VM (the `edge` project in
 * `vitest.config.ts`), which has no `HTMLElement`, `document` or
 * `customElements`. The entry fails to load there if it reaches an element
 * class from `@zitadel/components`, whose edge entry has none.
 */
describe("client entry in the edge runtime", () => {
  it("runs without a DOM", () => {
    expect(typeof HTMLElement).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof customElements).toBe("undefined");
  });

  it("loads and keeps the locale data and the configuration it re-exports", () => {
    expect(Object.keys(client.businessLocales).length).toBeGreaterThan(0);
    expect(client.configureZitadel).toBeTypeOf("function");
    expect(client.getApi).toBeTypeOf("function");
  });

  it("exports no element class", () => {
    expect(Object.keys(client).filter((name) => /^Zitadel[A-Z]/.test(name))).toEqual([]);
  });
});
