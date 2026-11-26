import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "./en.js";
import { Translations } from "./translations.js";

// The chunk of a built-in translation that cannot be fetched: a network
// failure, or a deploy that replaced it.
vi.mock("./de.js", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Translations.load without the translation's chunk", () => {
  it("renders the bundled English and the app's own text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const translations = await Translations.load("de-CH", {
      de: { "identifier.title": "Willkommen" },
    });

    expect(translations.texts["identifier.title"]).toBe("Willkommen");
    expect(translations.texts["password.title"]).toBe(en["password.title"]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
