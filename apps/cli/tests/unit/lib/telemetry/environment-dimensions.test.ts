import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `EnvironmentCommand.connect` records which credential a command used and
 * whether an env file was given, and the event catalog is the contract for what
 * may be sent. Names, URLs, paths and values are never recorded: each of them
 * identifies a project, a machine or a credential.
 *
 * Every connecting command records these, so they are not in the catalog's
 * per-command `dimensions` map that `catalog.test.ts` walks; this checks the
 * catalog defines them and that the recorder sends nothing else.
 *
 * Reading the source rather than running a command is deliberate, for the same
 * reason as in `variables-dimensions.test.ts`: consent gates the transport, so
 * a command test cannot see what a dimension is called.
 */
const source = join(import.meta.dirname, "../../../../src/lib/oclif/environment-command.ts");
const catalogDoc = join(
  import.meta.dirname,
  "../../../../../../docs/product-analytics-events.yaml",
);

async function recordedDimensions(): Promise<string[]> {
  const calls = [...(await readFile(source, "utf8")).matchAll(/recordTelemetry\(\{([^}]*)\}/gs)];
  return calls.flatMap((call) =>
    [...(call[1] ?? "").matchAll(/(\w+)\s*[:,]/g)].map((key) => key[1] as string),
  );
}

describe("environment telemetry dimensions", () => {
  it("records the credential kind and whether a file was used", async () => {
    expect(await recordedDimensions()).toEqual(["credential", "has_env_file"]);
  });

  it("records only dimensions the event catalog defines", async () => {
    const catalog = await readFile(catalogDoc, "utf8");

    for (const key of await recordedDimensions()) {
      expect(catalog, `an undocumented dimension: ${key}`).toContain(`\n  ${key}:\n`);
    }
  });

  it("records nothing that identifies a project, a machine, or a credential", async () => {
    const forbidden = ["environment", "env", "name", "file", "path", "server", "url", "project"];
    for (const key of await recordedDimensions()) {
      expect(forbidden, `${key} is not allow-listed`).not.toContain(key);
    }
  });
});
