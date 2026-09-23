import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The `variables` commands record per-command dimensions, and `AGENTS.md`'s
 * tracking plan is the contract for what may be sent: every dimension is
 * listed there, boolean names carry an `is_`/`has_`/`dry_`/`non_` prefix, and
 * nothing that identifies a person, a machine, or a credential is recorded.
 *
 * Reading the sources rather than running the commands is deliberate: consent
 * gates the transport, so a command test proves nothing about what a dimension
 * is *called*, which is the part that reaches Mixpanel and cannot be renamed
 * later without breaking saved reports.
 */
const commandsDir = join(import.meta.dirname, "../../../../src/commands/variables");
const agentsDoc = join(import.meta.dirname, "../../../../AGENTS.md");

/** The dimension names each command passes to `recordTelemetry`. */
async function recordedDimensions(): Promise<Map<string, string[]>> {
  const files = (await readdir(commandsDir)).filter((name) => name.endsWith(".ts"));
  const entries = await Promise.all(
    files.map(async (file) => {
      const source = await readFile(join(commandsDir, file), "utf8");
      const calls = [...source.matchAll(/recordTelemetry\(\{([^}]*)\}/gs)];
      const keys = calls.flatMap((call) =>
        [...(call[1] ?? "").matchAll(/(\w+)\s*:/g)].map((key) => key[1] as string),
      );
      return [file, keys] as const;
    }),
  );
  return new Map(entries);
}

describe("variables telemetry dimensions", () => {
  it("records only dimensions the tracking plan documents", async () => {
    const documented = (await readFile(agentsDoc, "utf8"))
      .split("\n")
      .find((line) => line.startsWith("- **variables**"));
    expect(documented, "AGENTS.md has no variables entry in the tracking plan").toBeDefined();

    for (const [file, keys] of await recordedDimensions()) {
      for (const key of keys) {
        expect(documented, `${file} records an undocumented dimension: ${key}`).toContain(
          `\`${key}\``,
        );
      }
    }
  });

  it("names booleans with the documented prefixes", async () => {
    for (const [file, keys] of await recordedDimensions()) {
      for (const key of keys) {
        expect(key, `${file}: ${key} is not snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
        if (!key.endsWith("_count")) {
          expect(key, `${file}: ${key} needs an is_/has_/dry_/non_ prefix`).toMatch(
            /^(is|has|dry|non)_/,
          );
        }
      }
    }
  });

  it("records nothing that identifies a person, a machine, or a credential", async () => {
    const forbidden = ["name", "value", "secret_value", "file", "path", "environment", "project"];
    for (const [file, keys] of await recordedDimensions()) {
      for (const key of keys) {
        expect(forbidden, `${file} records ${key}, which is not allow-listed`).not.toContain(key);
      }
    }
  });

  it("covers every variables command", async () => {
    const recorded = await recordedDimensions();
    expect([...recorded.keys()].sort()).toEqual(["delete.ts", "get.ts", "list.ts", "set.ts"]);
    for (const [file, keys] of recorded) {
      expect(keys.length, `${file} records no dimensions`).toBeGreaterThan(0);
    }
  });
});
