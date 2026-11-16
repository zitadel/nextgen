import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";

import Start from "@/cli/commands/start";
import {
  localContainerName,
  localRuntimePaths,
  writeRuntimeMetadata,
} from "@/lib/local-server/runtime";
import { parseFlag } from "@tests/helpers/inputs";

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

/** A directory that remembers a server on `port`, whatever port that is. */
async function aDirectoryRemembering(port: number): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-start-"));
  await writeRuntimeMetadata(cwd, {
    schema_version: 1,
    backend: "docker",
    container_name: localContainerName(cwd),
    container_id: "container-test-id",
    image: "ghcr.io/zitadel/nextgen:test",
    port,
    server_url: `http://localhost:${port}`,
    data_dir: localRuntimePaths(cwd).dataDir,
    created_at: "2026-06-09T00:00:00.000Z",
    cli_version: "0.0.0-test",
  });
  return cwd;
}

describe("the port a directory remembers", () => {
  it("is where the server is, when no port is asked for", async () => {
    const cwd = await aDirectoryRemembering(3000);

    await expect(new Reading([], config).sourceFor(cwd)).resolves.toBe("http://localhost:3000");
  });

  it("is nothing where it is no port a server can listen on, so the default stands", async () => {
    const cwd = await aDirectoryRemembering(99_999);

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
