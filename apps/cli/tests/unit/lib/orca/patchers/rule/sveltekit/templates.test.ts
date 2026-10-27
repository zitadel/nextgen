import { describe, expect, it } from "vitest";

import {
  envTemplate,
  hooksServerTemplate,
} from "../../../../../../../src/lib/orca/patchers/rule/sveltekit/templates";

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

describe("envTemplate", () => {
  it.each(["ZITADEL_URL", "ZITADEL_PROJECT_SECRET", "ZITADEL_PROJECT_ID"])(
    "declares %s",
    (name) => {
      expect(envTemplate()).toMatch(new RegExp(`^  ${name}: \\{`, "m"));
    },
  );

  it("keeps every variable server-only", () => {
    expect(envTemplate()).not.toMatch(/\bpublic:/);
  });
});
