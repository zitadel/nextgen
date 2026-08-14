import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

type RunCapture = (
  command: string,
  args: string[],
  options: { cwd: string },
) => Promise<{ stdout: string }>;

type ServerBuildModule = {
  SERVER_BUILD_PACKAGE: string;
  assertServerBuildPackage: (options: {
    repoRoot: string;
    runCapture: RunCapture;
  }) => Promise<string>;
  buildLocalServer: (options: {
    repoRoot: string;
    output: string;
    metadataPath?: string;
    gitInfo: { commit: string; shortCommit: string; branch?: string; date: string };
    runCapture?: RunCapture;
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
  gitInfo: (options: { repoRoot: string; runCapture: RunCapture }) => Promise<{
    commit: string;
    shortCommit: string;
    branch: string;
    date: string;
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

// `go list` is the only capture buildLocalServer makes once gitInfo is injected.
function goListStub(importPath = "github.com/zitadel/nextgen/internal/build"): RunCapture {
  return async () => ({ stdout: `${importPath}\n` });
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
        branch: "feat/stamp-builds",
        date: "2026-06-16T00:00:00Z",
      },
      runCapture: goListStub(),
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
    // The branch stays in the sidecar and out of the ldflags above: version
    // becomes OTel service.version and every log line's version attribute.
    expect(built.metadata).toEqual({
      schema_version: 1,
      version: "dev+abcdef123456",
      commit: "abcdef1234567890",
      short_commit: "abcdef123456",
      branch: "feat/stamp-builds",
      date: "2026-06-16T00:00:00Z",
    });
    await expect(readServerBuildMetadata(built.metadataPath)).resolves.toEqual(built.metadata);
    await expect(readFile(built.metadataPath, "utf8")).resolves.toMatch(/\n$/);
  });

  it("creates the metadata directory when it sits outside the binary's own", async () => {
    const { buildLocalServer, readServerBuildMetadata } = await loadModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-server-build-meta-"));
    tempDirs.push(repoRoot);

    const built = await buildLocalServer({
      repoRoot,
      output: join(repoRoot, "dist/server/nextgen"),
      metadataPath: join(repoRoot, "dist/meta/server/metadata.json"),
      gitInfo: {
        commit: "abcdef1234567890",
        shortCommit: "abcdef123456",
        branch: "feat/stamp-builds",
        date: "2026-06-16T00:00:00Z",
      },
      runCapture: goListStub(),
      run: async () => {},
    });

    await expect(readServerBuildMetadata(built.metadataPath)).resolves.toMatchObject({
      version: "dev+abcdef123456",
    });
  });

  it("fails loudly when the metadata package moves out from under the -X targets", async () => {
    const { assertServerBuildPackage } = await loadModule();

    await expect(
      assertServerBuildPackage({
        repoRoot: "/repo",
        runCapture: goListStub("github.com/zitadel/nextgen/internal/buildinfo"),
      }),
    ).rejects.toThrow("server build metadata package moved");
  });

  it("falls back to the short commit when HEAD is detached", async () => {
    const { gitInfo } = await loadModule();

    const info = await gitInfo({
      repoRoot: "/repo",
      runCapture: async (_command, args) => {
        if (args[0] === "symbolic-ref") {
          // What `git symbolic-ref -q` does under actions/checkout.
          throw new Error("exit 1");
        }
        if (args.includes("--short=12")) return { stdout: "abcdef123456\n" };
        if (args[0] === "show") return { stdout: "2026-06-16T00:00:00Z\n" };
        return { stdout: "abcdef1234567890\n" };
      },
    });

    expect(info.branch).toBe("abcdef123456");
  });

  it("rejects metadata values that cannot be passed safely to go -ldflags", async () => {
    const { serverLdflags } = await loadModule();

    expect(() =>
      serverLdflags({ version: "dev build", commit: "abcdef", date: "2026-06-16T00:00:00Z" }),
    ).toThrow("version");
  });
});
