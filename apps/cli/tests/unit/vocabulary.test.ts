import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const legacyPatterns = [
  /\bunclaimed\b/i,
  /\borganization\b/i,
  /\btenant\b/i,
  /\binstance\b/i,
  /\bplatform_user\b/i,
  /\bzp_/i,
  /\bzpp_/i,
  /\/v1\b/i,
];

describe("public vocabulary", () => {
  it("keeps docs and fixtures on glossary terms", async () => {
    const root = join(import.meta.dirname, "../..");
    const files = [
      "README.md",
      "AGENTS.md",
      "src/platform/fixtures/createProject.ok.json",
    ];

    for (const file of files) {
      const contents = await readFile(join(root, file), "utf8");
      for (const pattern of legacyPatterns) {
        expect(contents, `${file} matched ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
