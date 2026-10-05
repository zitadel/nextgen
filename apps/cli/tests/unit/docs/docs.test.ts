import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Assertions about the checked-in documentation. These read files, not the
 * CLI, so they are unit tests -- `tests/integration` is for specs that drive
 * the built binary against the mock platform.
 */

const legacyPatterns = [
  /\bunclaimed\b/i,
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
    const root = join(import.meta.dirname, "../../..");
    const files = ["README.md", "SKILLS.md"];

    for (const file of files) {
      const contents = await readFile(join(root, file), "utf8");
      for (const pattern of legacyPatterns) {
        expect(contents, `${file} matched ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});

describe("agent contract", () => {
  it("SKILLS.md is the canonical agent contract", async () => {
    const root = join(import.meta.dirname, "../../..");
    const skills = await readFile(join(root, "SKILLS.md"), "utf8");
    expect(skills).toContain("name: zitadel-cli");
    expect(skills).toContain("## Golden path");
    expect(skills).toContain("--non-interactive --json");
    expect(skills).toContain("E_PORT_IN_USE");
    expect(skills).toContain("stop --all");
  });
});
