import { describe, expect, it } from "vitest";

import { de } from "./de.js";
import { en } from "./en.js";
import { it as italian } from "./it.js";

describe("built-in locale dictionaries", () => {
  it("keeps translated locale keys aligned with English", () => {
    const englishKeys = Object.keys(en).sort();

    expect(Object.keys(de).sort()).toEqual(englishKeys);
    expect(Object.keys(italian).sort()).toEqual(englishKeys);
  });
});
