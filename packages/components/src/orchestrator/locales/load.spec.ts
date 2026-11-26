import { describe, expect, it } from "vitest";

import { de } from "./de.js";
import { en } from "./en.js";
import { it as italian } from "./it.js";
import { loadLocale } from "./load.js";

describe("loadLocale", () => {
  it.each([
    ["de-CH", de],
    ["it", italian],
    ["en-GB", en],
    ["fr", en],
  ])("loads the built-in dictionary for %s", async (tag, expected) => {
    expect(await loadLocale(tag, undefined)).toEqual(expected);
  });

  it("merges the integrator's text over the loaded translation", async () => {
    const locale = await loadLocale("de", { de: { "identifier.title": "Willkommen" } });

    expect(locale["identifier.title"]).toBe("Willkommen");
  });
});
