import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { IDP_PROVIDERS } from "@zitadel/config/idp";
import { describe, expect, it } from "vitest";

/**
 * `setup` records per-command dimensions, and `AGENTS.md`'s tracking plan is
 * the contract for what may be sent. This mirrors `variables-dimensions.test.ts`
 * for the same reason it exists: consent gates the transport, so running the
 * command proves nothing about what a dimension is *called*, which is the part
 * that reaches Mixpanel and cannot be renamed later without breaking saved
 * reports.
 */
const setupCommand = join(import.meta.dirname, "../../../../src/commands/setup/index.ts");
const agentsDoc = join(import.meta.dirname, "../../../../AGENTS.md");

/** The dimension names `setup` passes to `recordTelemetry`. */
async function recordedDimensions(): Promise<string[]> {
  const source = await readFile(setupCommand, "utf8");
  const calls = [...source.matchAll(/recordTelemetry\(\{([^}]*)\}/gs)];
  return [
    ...new Set(
      calls.flatMap((call) =>
        [...(call[1] ?? "").matchAll(/^\s*(\w+)\s*:/gm)].map((key) => key[1] as string),
      ),
    ),
  ];
}

describe("setup telemetry dimensions", () => {
  it("records only dimensions the tracking plan documents", async () => {
    const documented = (await readFile(agentsDoc, "utf8"))
      .split("\n")
      .find((line) => line.startsWith("- **setup**"));
    expect(documented, "AGENTS.md has no setup entry in the tracking plan").toBeDefined();

    for (const key of await recordedDimensions()) {
      expect(documented, `setup records an undocumented dimension: ${key}`).toContain(`\`${key}\``);
    }
  });

  it("records nothing that identifies a person, a machine, or a credential", async () => {
    // `sso` is the provider slug, never the client id or the secret; the
    // catalog slugs are the only values it can take.
    const forbidden = ["client_id", "sso_client_id", "secret", "name", "path", "file", "project"];
    for (const key of await recordedDimensions()) {
      expect(forbidden, `setup records ${key}, which is not allow-listed`).not.toContain(key);
      expect(key, `${key} is not snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("keeps the sso dimension an enum, so no provider value is free text", async () => {
    // The flag is oclif-constrained to the catalog, so every value this can
    // take is a slug that shipped with the CLI, plus "none".
    const source = await readFile(setupCommand, "utf8");
    expect(source).toContain('sso: flags.sso ?? "none"');
    expect(source).toContain("options: [...IDP_PROVIDERS]");
    expect([...IDP_PROVIDERS].every((slug) => /^[a-z][a-z0-9_-]*$/.test(slug))).toBe(true);
  });
});
