import { readdir, readFile } from "node:fs/promises";
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

const root = join(import.meta.dirname, "../../..");
const skillDir = join(root, "skills/zitadel-cli");

// README plus every markdown file of the agent skill (SKILL.md and its
// progressive-disclosure references), so the glossary gate covers the content
// an agent can load, not just the entry file.
async function skillMarkdown(): Promise<string[]> {
  const refs = await readdir(join(skillDir, "references"));
  return [
    join(root, "README.md"),
    join(skillDir, "SKILL.md"),
    ...refs.filter((name) => name.endsWith(".md")).map((name) => join(skillDir, "references", name)),
  ];
}

describe("public vocabulary", () => {
  it("keeps docs on glossary terms", async () => {
    for (const file of await skillMarkdown()) {
      const contents = await readFile(file, "utf8");
      for (const pattern of legacyPatterns) {
        expect(contents, `${file} matched ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});

describe("agent contract", () => {
  it("SKILL.md carries the invocation contract", async () => {
    const skill = await readFile(join(skillDir, "SKILL.md"), "utf8");
    expect(skill).toContain("name: zitadel-cli");
    expect(skill).toContain("## Golden path");
    expect(skill).toContain("--non-interactive --json");
    expect(skill).toContain("E_PORT_IN_USE");
  });

  it("reference files carry the detailed command surface", async () => {
    const commands = await readFile(join(skillDir, "references/commands.md"), "utf8");
    expect(commands).toContain("stop --all");
  });
});
