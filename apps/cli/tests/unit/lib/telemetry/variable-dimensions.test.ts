import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The `variable` commands record per-command dimensions. `catalog.test.ts`
 * checks that the event catalog lists each one; these check that boolean names
 * carry an `is_`/`has_`/`dry_`/`non_` prefix and that nothing that identifies a
 * person, a machine, or a credential is recorded.
 *
 * Reading the sources rather than running the commands is deliberate: consent
 * gates the transport, so a command test proves nothing about what a dimension
 * is *called*, which is the part that reaches the analytics tools and cannot be
 * renamed later without breaking saved reports.
 */
const commandsDir = join(import.meta.dirname, "../../../../src/commands/variable");

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

describe("variable telemetry dimensions", () => {
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
    const forbidden = [
      "name",
      "value",
      "secret_value",
      "file",
      "path",
      "environment",
      // The owner dimension the commands recorded while they could address an
      // environment. Every run has the same owner now, so it says nothing.
      "is_environment_scoped",
      "project",
    ];
    for (const [file, keys] of await recordedDimensions()) {
      for (const key of keys) {
        expect(forbidden, `${file} records ${key}, which is not allow-listed`).not.toContain(key);
      }
    }
  });

  it("covers every variable command that has a dimension to record", async () => {
    const recorded = await recordedDimensions();
    expect([...recorded.keys()].sort()).toEqual([
      "get.ts",
      "list.ts",
      "resolve.ts",
      "rm.ts",
      "set.ts",
    ]);
    // `rm` records none: with no per-command shape to report, the lifecycle
    // events already carry everything true of the run.
    expect(recorded.get("rm.ts")).toEqual([]);
    for (const command of ["get.ts", "list.ts", "resolve.ts", "set.ts"]) {
      expect(recorded.get(command)?.length, `${command} records no dimensions`).toBeGreaterThan(0);
    }
  });
});
