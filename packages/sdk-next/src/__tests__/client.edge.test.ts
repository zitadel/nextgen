import { describe, expect, it } from "vitest";

import * as client from "../client";

const { businessLocales } = client;

// edge-entry:begin
describe("the SDK entry in the edge runtime", () => {
  it("runs without a DOM", () => {
    expect(typeof HTMLElement).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof customElements).toBe("undefined");
  });

  it("keeps the locale data it re-exports", () => {
    expect(Object.keys(businessLocales).length).toBeGreaterThan(0);
  });
});
// edge-entry:end

/**
 * Loads the client entry inside the `edge-runtime` VM (the `edge` project in
 * `vitest.config.ts`). The entry fails to load there if it reaches an element
 * class from `@zitadel/components`, whose edge entry has none. It renders no
 * widget, so it has no `edge-render` block.
 */
describe("the client entry in the edge runtime", () => {
  it("keeps the configuration it re-exports", () => {
    expect(client.configureZitadel).toBeTypeOf("function");
    expect(client.getApi).toBeTypeOf("function");
  });

  it("exports no element class", () => {
    expect(Object.keys(client).filter((name) => /^Zitadel[A-Z]/.test(name))).toEqual([]);
  });
});
