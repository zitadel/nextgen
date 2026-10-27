import { describe, expect, it } from "vitest";

import manifest from "../package.json";
import * as entry from "../dist/server.mjs";

/**
 * Entries that define elements or import Lit and so need a DOM. Every other
 * entry in the exports map must load in the edge VM, so a new one is tested
 * here unless it is added to this list on purpose.
 */
const NEEDS_A_DOM = ["./standalone", "./atoms", "./manifests", "./orchestrator"];

/**
 * Loads the built `server.ts` inside the `edge-runtime` VM (the `edge` project
 * in `vitest.config.ts`), which has no `HTMLElement`, `document` or
 * `customElements`, with dependencies resolved under the `browser` condition.
 * The entry fails to load there the moment it reaches Lit. The identity of each
 * export with the package root's is checked in `server.spec.ts`, which needs a
 * DOM to import the root.
 */
describe("the server entry in the edge runtime", () => {
  it("runs without a DOM", () => {
    expect(typeof HTMLElement).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof customElements).toBe("undefined");
  });

  it("keeps the locale data the SDKs re-export", () => {
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

  const domFree = Object.entries(manifest.exports).flatMap(([subpath, target]) => {
    const file = typeof target === "object" && "import" in target ? target.import : undefined;
    const isEntry = file !== undefined && !subpath.includes("*") && !NEEDS_A_DOM.includes(subpath);
    return isEntry && subpath !== "." ? [{ subpath, file }] : [];
  });

  it("finds the entries that need no DOM in the exports map", () => {
    expect(domFree.map((entry) => entry.subpath)).toEqual(
      expect.arrayContaining(["./events", "./tokens"]),
    );
  });

  it.each(domFree)("loads $subpath", async ({ file }) => {
    expect(Object.keys(await import(`../${file.slice(2)}`)).length).toBeGreaterThan(0);
  });
});
