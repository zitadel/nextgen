import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { IDP_PROVIDERS } from "@zitadel/config/idp";
import { describe, expect, it } from "vitest";

/**
 * `setup` records per-command dimensions. `catalog.test.ts` checks that the
 * event catalog lists each one; these check what they may hold. Like there,
 * they read the source: consent gates the transport, so running the command
 * proves nothing about what a dimension is *called*.
 */
const setupCommand = join(import.meta.dirname, "../../../../src/commands/setup/index.ts");

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
    // The flag is oclif-constrained to the catalog plus "custom", so every value
    // this can take is a slug that shipped with the CLI, "custom", or "none". A
    // custom connection's own slug is the developer's free text and is never
    // recorded: the dimension says "custom", not which one.
    const source = await readFile(setupCommand, "utf8");
    expect(source).toContain('sso: flags.sso ?? "none"');
    expect(source).toContain("options: [...IDP_PROVIDERS, CUSTOM_PROVIDER]");
    expect([...IDP_PROVIDERS].every((slug) => /^[a-z][a-z0-9_-]*$/.test(slug))).toBe(true);
  });

  // Setup can enable several providers at once. The dimension stays
  // enumerable by collapsing that to one bucket rather than joining the
  // slugs, which would make the value space combinatorial.
  it("reports several providers as one bucket, not a joined set", async () => {
    const source = await readFile(setupCommand, "utf8");
    expect(source).toContain('"multiple"');
    expect(source).not.toContain(".map((a) => a.provider).join(");
  });
});
