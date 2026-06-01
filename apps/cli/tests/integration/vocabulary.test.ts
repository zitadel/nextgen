import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const legacyPatterns = [
  /\borganization\b/i,
  /\btenant\b/i,
  /\binstance\b/i,
  /\bplatform_user\b/i,
  /\bzp_/i,
  /\bzpp_/i,
  // Legacy API path prefix (e.g. `/v1/users`). Requires the trailing slash so
  // it targets real paths, not unrelated `v1` version tags in generated docs
  // (the README embeds oclif plugin `_See code:` links like `blob/v1.2.50`).
  /\/v1\//i,
];

describe("public vocabulary", () => {
  it("keeps docs on glossary terms", async () => {
    const root = join(import.meta.dirname, "../..");
    const files = ["README.md", "SKILLS.md"];

    for (const file of files) {
      const contents = await readFile(join(root, file), "utf8");
      for (const pattern of legacyPatterns) {
        expect(contents, `${file} matched ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
