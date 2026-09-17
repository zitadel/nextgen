import { describe, expect, it } from "vitest";

import cases from "./__fixtures__/branding-contrast-cases.json" with { type: "json" };
import { contrastIssues } from "./branding-contrast.js";

/**
 * The fixture is the contract between implementations: the console reads these
 * rules today, the API is expected to return the same ids later. If this file
 * and that implementation disagree, one of them is wrong about what a customer
 * is told.
 */
describe("branding contrast fixture", () => {
  for (const testCase of cases.cases) {
    it(testCase.name, () => {
      expect(contrastIssues(testCase.branding)).toEqual(testCase.issues);
    });
  }
});
