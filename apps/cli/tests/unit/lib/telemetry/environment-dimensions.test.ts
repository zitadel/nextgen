import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `EnvironmentCommand.connect` records which credential a command used and
 * whether an env file was given, and `AGENTS.md`'s tracking plan is the
 * contract for what may be sent. Names, URLs, paths and values are never
 * recorded: each of them identifies a project, a machine or a credential.
 *
 * Reading the source rather than running a command is deliberate, for the same
 * reason as in `variables-dimensions.test.ts`: consent gates the transport, so
 * a command test cannot see what a dimension is called.
 */
const source = join(import.meta.dirname, "../../../../src/lib/oclif/environment-command.ts");
const agentsDoc = join(import.meta.dirname, "../../../../AGENTS.md");

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

  it("records only dimensions the tracking plan documents", async () => {
    const documented = (await readFile(agentsDoc, "utf8"))
      .split("\n")
      .find((line) => line.startsWith("- **any command that connects to a project**"));
    expect(documented, "AGENTS.md has no entry for connecting commands").toBeDefined();

    for (const key of await recordedDimensions()) {
      expect(documented, `an undocumented dimension: ${key}`).toContain(`\`${key}\``);
    }
  });

  it("records nothing that identifies a project, a machine, or a credential", async () => {
    const forbidden = ["environment", "env", "name", "file", "path", "server", "url", "project"];
    for (const key of await recordedDimensions()) {
      expect(forbidden, `${key} is not allow-listed`).not.toContain(key);
    }
  });
});
