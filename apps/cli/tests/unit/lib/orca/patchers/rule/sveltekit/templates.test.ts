import { describe, expect, it } from "vitest";

import { hooksServerTemplate } from "../../../../../../../src/lib/orca/patchers/rule/sveltekit/templates";

describe("hooksServerTemplate", () => {
  it("names no Node global, so an app without @types/node type-checks", () => {
    expect(hooksServerTemplate()).not.toMatch(/\bprocess\b/);
  });

  it("leaves the backend url and project secret to the SDK's defaults", () => {
    expect(hooksServerTemplate()).not.toMatch(/\b(url|projectSecret):/);
  });
});
