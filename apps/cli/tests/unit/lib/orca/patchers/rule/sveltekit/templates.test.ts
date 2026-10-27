import { describe, expect, it } from "vitest";

import { hooksServerTemplate } from "../../../../../../../src/lib/orca/patchers/rule/sveltekit/templates";

describe("hooksServerTemplate", () => {
  it("names no Node global, so an app without @types/node type-checks", () => {
    expect(hooksServerTemplate()).not.toMatch(/\bprocess\b/);
  });

  it("reads its settings from SvelteKit's server-only env module", () => {
    expect(hooksServerTemplate()).toContain(
      'import { ZITADEL_PROJECT_ID, ZITADEL_PROJECT_SECRET, ZITADEL_URL } from "$app/env/private";',
    );
  });
});
