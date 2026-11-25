import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Config } from "@oclif/core";
import { describe, expect } from "vitest";

import Start from "@/cli/commands/server/start";
import { LocalRuntime } from "@/lib/server";
import { LOCAL_RUNTIME_FILE } from "@/lib/server/local/runtime";
import { it } from "@tests/fixtures";
import { parseFlag } from "@tests/helpers/inputs";
import { parseJson, runCliForTest } from "@tests/helpers/run-cli";

const config = {
  version: "0.0.0-test",
  runHook: async () => {
    return {
      successes: [],
      failures: [],
    };
  },
} as unknown as Config;

/** `start`, with the server it resolves before the run has a context exposed. */
class Reading extends Start {
  public sourceFor(cwd: string): Promise<string> {
    return this.sourceOf({}, cwd);
  }
}

/**
 * Makes a directory remember a server on `port`, whatever port that is.
 *
 * @param cwd - The directory.
 * @param port - The port the server is remembered on.
 * @returns Once the directory remembers it.
 */
async function aDirectoryRemembering(cwd: string, port: number): Promise<void> {
  await LocalRuntime.write(cwd, {
    schema_version: 1,
    backend: "docker",
    container_name: LocalRuntime.containerName(cwd),
    container_id: "container-test-id",
    image: "ghcr.io/zitadel/nextgen:test",
    port,
    server_url: `http://localhost:${port}`,
    data_dir: LocalRuntime.paths(cwd).dataDir,
    created_at: "2026-06-09T00:00:00.000Z",
    cli_version: "0.0.0-test",
  });
}

describe("the port a directory remembers", () => {
  it("is where the server is, when no port is asked for", async ({ dir: cwd }) => {
    await aDirectoryRemembering(cwd, 3000);

    await expect(new Reading([], config).sourceFor(cwd)).resolves.toBe("http://localhost:3000");
  });

  it("is nothing where it is no port a server can listen on, so the default stands", async ({
    dir: cwd,
  }) => {
    await aDirectoryRemembering(cwd, 99_999);

    await expect(new Reading([], config).sourceFor(cwd)).resolves.toBe("http://localhost:8080");
  });
});

describe("--port", () => {
  it.each(["1", "8080", "65535"])("reads %s", async (input) => {
    await expect(parseFlag(Start.flags.port, input, "port")).resolves.toBe(Number(input));
  });

  it.each(["0", "65536", "-1", "many", "80.5", "", "1e3", "9".repeat(309), "9007199254740993"])(
    "refuses %j, naming the ports a server can listen on",
    async (input) => {
      await expect(parseFlag(Start.flags.port, input, "port")).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: `${input} is not a TCP port`,
        hint: "Use a TCP port from 1 to 65535.",
      });
    },
  );
});

describe("a record of the local server that is malformed", () => {
  it("is refused with the reset and start that repair it", async ({ dir: cwd }) => {
    await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
    await writeFile(join(cwd, LOCAL_RUNTIME_FILE), JSON.stringify({ backend: "nope" }));

    const result = await runCliForTest(["start", "--cwd", cwd, "--json"]);

    expect(parseJson(result.stdout)).toMatchObject({
      status: "error",
      code: "E_VALIDATION",
      hint: expect.stringContaining("reset --force"),
    });
  });
});
