import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The `api` commands record per-command dimensions; `catalog.test.ts` checks
 * that the event catalog lists each one. `operation` is an `operationId` of
 * the spec: a value from a closed set, never a path, which carries ids.
 *
 * Read from the sources, as the variables dimensions are: consent gates the
 * transport, so running the command proves nothing about what a dimension is
 * called.
 */
const commandsDir = join(import.meta.dirname, "../../../../src/commands/api");

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

describe("api telemetry dimensions", () => {
  it("records the operation and whether it paged, and nothing of the request", async () => {
    expect((await recordedDimensions()).get("index.ts")).toEqual(["operation", "is_paginated"]);
  });
});
