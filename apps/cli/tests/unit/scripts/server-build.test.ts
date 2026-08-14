import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

type ServerBuildModule = {
  buildLocalServer: (options: {
    repoRoot: string;
    output: string;
    gitInfo: { commit: string; shortCommit: string; date: string };
    run: (
      command: string,
      args: string[],
      options: { cwd: string; env: NodeJS.ProcessEnv },
    ) => Promise<void>;
  }) => Promise<{
    output: string;
    metadataPath: string;
    metadata: Record<string, unknown>;
  }>;
  readServerBuildMetadata: (path: string) => Promise<Record<string, unknown>>;
  serverLdflags: (input: {
    version: string;
    commit: string;
    date: string;
    strip?: boolean;
  }) => string;
};

const tempDirs: string[] = [];

async function loadModule(): Promise<ServerBuildModule> {
  return (await import(
    new URL("../../../../../scripts/server-build.mjs", import.meta.url).href
  )) as ServerBuildModule;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("server build metadata", () => {
  it("builds a source binary and writes matching sidecar metadata", async () => {
    const { buildLocalServer, readServerBuildMetadata } = await loadModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-server-build-"));
    tempDirs.push(repoRoot);
    const output = join(repoRoot, "dist/server/nextgen");
    const calls: Array<{ command: string; args: string[] }> = [];

    const built = await buildLocalServer({
      repoRoot,
      output,
      gitInfo: {
        commit: "abcdef1234567890",
        shortCommit: "abcdef123456",
        date: "2026-06-16T00:00:00Z",
      },
      run: async (command, args) => {
        calls.push({ command, args });
      },
    });

    expect(calls).toEqual([
      {
        command: "go",
        args: [
          "build",
          "-trimpath",
          "-ldflags",
          "-X github.com/zitadel/nextgen/internal/build.version=dev+abcdef123456 -X github.com/zitadel/nextgen/internal/build.commit=abcdef1234567890 -X github.com/zitadel/nextgen/internal/build.date=2026-06-16T00:00:00Z",
          "-o",
          output,
          ".",
        ],
      },
    ]);
    expect(built.metadata).toEqual({
      schema_version: 1,
      version: "dev+abcdef123456",
      commit: "abcdef1234567890",
      short_commit: "abcdef123456",
      date: "2026-06-16T00:00:00Z",
    });
    await expect(readServerBuildMetadata(built.metadataPath)).resolves.toEqual(built.metadata);
    await expect(readFile(built.metadataPath, "utf8")).resolves.toMatch(/\n$/);
  });

  it("rejects metadata values that cannot be passed safely to go -ldflags", async () => {
    const { serverLdflags } = await loadModule();

    expect(() =>
      serverLdflags({ version: "dev build", commit: "abcdef", date: "2026-06-16T00:00:00Z" }),
    ).toThrow("version");
  });
});
