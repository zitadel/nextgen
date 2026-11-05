import * as client from "@zitadel/sdk-next/client";
import { describe, expect, it } from "vitest";

const { businessLocales } = client;

// edge-entry:begin
/**
 * Loads the built package, as a consumer's bundler resolves it, inside the
 * `edge-runtime` VM (the `edge` project in `vitest.config.ts`), which has no
 * `HTMLElement`, `document` or `customElements`, with dependencies resolved the
 * way a bundler resolves them for the edge.
 */
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

describe("the client entry in the edge runtime", () => {
  it("keeps the configuration it re-exports", () => {
    expect(client.configureZitadel).toBeTypeOf("function");
    expect(client.getApi).toBeTypeOf("function");
  });

  it("exports no element class", () => {
    expect(Object.keys(client).filter((name) => /^Zitadel[A-Z]/.test(name))).toEqual([]);
  });
});
