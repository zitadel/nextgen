import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

type PlatformPackage = {
  goos: string;
  goarch: string;
  packageName: string;
  packageDir: string;
};

type ReleaseArtifactsModule = {
  assertServerBinaries: (options: {
    repoRoot: string;
    platformPackages: PlatformPackage[];
  }) => Promise<void>;
  buildServerBinaries: (options: {
    repoRoot: string;
    outDir?: string;
    version: string;
    gitInfo: { commit: string; shortCommit: string; date: string };
    platforms: Array<{ goos: string; goarch: string }>;
    output?: (platform: { goos: string; goarch: string }) => string;
    runCapture?: (
      command: string,
      args: string[],
      options: { cwd: string },
    ) => Promise<{ stdout: string }>;
    run: (
      command: string,
      args: string[],
      options: { cwd: string; env: NodeJS.ProcessEnv },
    ) => Promise<void>;
  }) => Promise<unknown>;
  collectServerBinaries: (options: {
    repoRoot: string;
    outDir: string;
    version: string;
    platformPackages: PlatformPackage[];
  }) => Promise<void>;
  containerTags: (input: { image?: string; version: string; prerelease: boolean }) => string[];
  createArchives: (options: {
    repoRoot: string;
    outDir: string;
    version: string;
    run: (
      command: string,
      args: string[],
      options: { cwd: string; env: NodeJS.ProcessEnv },
    ) => Promise<void>;
  }) => Promise<{ archives: string[]; checksumPath: string }>;
  SERVER_PLATFORMS: Array<{ goos: string; goarch: string }>;
  readServerRelease: (repoRoot: string) => Promise<{
    name: string;
    version: string;
    tag: string;
    prerelease: boolean;
  }>;
  packPublicPackages: (options: {
    repoRoot: string;
    dirs?: string[];
    outDir?: string;
    tarballsDir?: string;
    version?: string;
    run?: (
      command: string,
      args: string[],
      options: { cwd: string; env: NodeJS.ProcessEnv },
    ) => Promise<void>;
  }) => Promise<string>;
  validateSemver: (version: string) => void;
  verifyLocalArtifacts: (options: {
    repoRoot: string;
    release: { name: string; version: string; tag: string; prerelease: boolean };
    outDir: string;
  }) => Promise<void>;
};

const tempDirs: string[] = [];

async function loadModule(): Promise<ReleaseArtifactsModule> {
  return (await import(
    new URL("../../../../../scripts/release-artifacts.mjs", import.meta.url).href
  )) as ReleaseArtifactsModule;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("release artifact helpers", () => {
  it("stamps the runtime metadata package in release binaries", async () => {
    const { buildServerBinaries } = await loadModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-release-build-"));
    tempDirs.push(repoRoot);
    const calls: Array<{ command: string; args: string[] }> = [];

    await buildServerBinaries({
      repoRoot,
      outDir: join(repoRoot, "dist/release/0.1.0-alpha.6"),
      version: "0.1.0-alpha.6",
      gitInfo: {
        commit: "abcdef1234567890",
        shortCommit: "abcdef123456",
        date: "2026-06-16T00:00:00Z",
      },
      platforms: [{ goos: "linux", goarch: "amd64" }],
      // The ldflags target package is verified via `go list` before any build.
      runCapture: async () => ({ stdout: "github.com/zitadel/nextgen/internal/build\n" }),
      run: async (command, args) => {
        calls.push({ command, args });
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: "go",
      args: [
        "build",
        "-trimpath",
        "-ldflags",
        "-s -w -X github.com/zitadel/nextgen/internal/build.version=0.1.0-alpha.6 -X github.com/zitadel/nextgen/internal/build.commit=abcdef1234567890 -X github.com/zitadel/nextgen/internal/build.date=2026-06-16T00:00:00Z",
        "-o",
        expect.stringMatching(/dist\/release\/0\.1\.0-alpha\.6\/build\/linux\/amd64\/nextgen$/),
        ".",
      ],
    });
  });

  it("reads the server npm package as the product version source", async () => {
    const { readServerRelease } = await loadModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-server-package-"));
    tempDirs.push(repoRoot);
    await mkdir(join(repoRoot, "apps/server"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/server/package.json"),
      JSON.stringify({
        name: "@zitadel/server",
        version: "0.1.0-alpha.6",
      }),
    );

    await expect(readServerRelease(repoRoot)).resolves.toEqual({
      name: "@zitadel/server",
      version: "0.1.0-alpha.6",
      tag: "v0.1.0-alpha.6",
      prerelease: true,
    });
  });

  it("adds latest for stable container releases", async () => {
    const { containerTags } = await loadModule();

    expect(containerTags({ version: "1.2.3", prerelease: false })).toEqual([
      "ghcr.io/zitadel/nextgen:1.2.3",
      "ghcr.io/zitadel/nextgen:latest",
    ]);
  });

  it("keeps latest off prereleases", async () => {
    const { containerTags } = await loadModule();

    expect(containerTags({ version: "1.2.3-alpha.1", prerelease: true })).toEqual([
      "ghcr.io/zitadel/nextgen:1.2.3-alpha.1",
    ]);
  });

  it("validates semver-like release versions", async () => {
    const { validateSemver } = await loadModule();

    expect(() => validateSemver("1.2.3")).not.toThrow();
    expect(() => validateSemver("1.2.3-alpha.1")).not.toThrow();
    expect(() => validateSemver("v1.2.3")).toThrow("invalid release version");
  });

  it("builds a release binary into the path it is given", async () => {
    const { buildServerBinaries } = await loadModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-release-binary-"));
    tempDirs.push(repoRoot);
    const output = join(repoRoot, "apps/server-darwin-arm64/bin/nextgen");
    const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];

    await buildServerBinaries({
      repoRoot,
      version: "0.1.0-alpha.6",
      gitInfo: { commit: "abcdef1234567890", shortCommit: "abcdef123456", date: "2026-06-16" },
      platforms: [{ goos: "darwin", goarch: "arm64" }],
      output: () => output,
      runCapture: async () => ({ stdout: "github.com/zitadel/nextgen/internal/build\n" }),
      run: async (_command, args, options) => {
        calls.push({ args, env: options.env });
      },
    });

    expect(calls.map(({ args }) => args.at(-2))).toEqual([output]);
    expect(calls[0]?.env).toMatchObject({ CGO_ENABLED: "0", GOOS: "darwin", GOARCH: "arm64" });
    await expect(stat(join(repoRoot, "apps/server-darwin-arm64/bin"))).resolves.toBeDefined();
  });

  it("collects the platform packages' binaries into the release directory", async () => {
    const { collectServerBinaries } = await loadModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-release-collect-"));
    tempDirs.push(repoRoot);
    const outDir = join(repoRoot, "dist/release/0.1.0-alpha.6");
    await mkdir(join(repoRoot, "apps/server-linux-arm64/bin"), { recursive: true });
    await writeFile(join(repoRoot, "apps/server-linux-arm64/bin/nextgen"), "server-binary");

    await collectServerBinaries({
      repoRoot,
      outDir,
      version: "0.1.0-alpha.6",
      platformPackages: [
        {
          goos: "linux",
          goarch: "arm64",
          packageName: "@zitadel/server-linux-arm64",
          packageDir: "apps/server-linux-arm64",
        },
      ],
    });

    const collected = join(outDir, "build/linux/arm64/nextgen");
    await expect(readFile(collected, "utf8")).resolves.toBe("server-binary");
    expect((await stat(collected)).mode & 0o111).toBeGreaterThan(0);
  });

  it("names each platform package whose binary is missing", async () => {
    const { assertServerBinaries } = await loadModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-release-missing-"));
    tempDirs.push(repoRoot);
    await mkdir(join(repoRoot, "apps/server-linux-x64/bin"), { recursive: true });
    await writeFile(join(repoRoot, "apps/server-linux-x64/bin/nextgen"), "server-binary");

    await expect(
      assertServerBinaries({
        repoRoot,
        platformPackages: [
          {
            goos: "linux",
            goarch: "amd64",
            packageName: "@zitadel/server-linux-x64",
            packageDir: "apps/server-linux-x64",
          },
          {
            goos: "windows",
            goarch: "amd64",
            packageName: "@zitadel/server-win32-x64",
            packageDir: "apps/server-win32-x64",
          },
        ],
      }),
    ).rejects.toThrow(/^missing server binaries: @zitadel\/server-win32-x64\. /);
  });

  it("compresses every platform archive at once and lists checksums in platform order", async () => {
    const { createArchives, SERVER_PLATFORMS } = await loadModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-release-archives-"));
    tempDirs.push(repoRoot);
    const outDir = join(repoRoot, "dist/release/0.1.0-alpha.6");
    await writeFile(join(repoRoot, "LICENSE"), "license");
    await writeFile(join(repoRoot, "README.md"), "readme");
    for (const platform of SERVER_PLATFORMS) {
      const dir = join(outDir, "build", platform.goos, platform.goarch);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, platform.goos === "windows" ? "nextgen.exe" : "nextgen"), "binary");
    }

    const running = new Set<string>();
    const runningCounts: number[] = [];
    const startedListeners: Array<() => void> = [];
    const allStarted = new Promise<void>((resolve) => startedListeners.push(resolve));
    const everyoneStarted = () =>
      startedListeners.forEach((resolve) => {
        resolve();
      });
    const { archives, checksumPath } = await createArchives({
      repoRoot,
      outDir,
      version: "0.1.0-alpha.6",
      run: async (_command, args) => {
        // tar -czf <archive> … and zip -qr <archive> . both name the archive second.
        const archivePath = args[1];
        if (!archivePath) {
          throw new Error(`no archive path in: ${args.join(" ")}`);
        }
        running.add(archivePath);
        runningCounts.push(running.size);
        if (running.size === SERVER_PLATFORMS.length) {
          everyoneStarted();
        }
        await allStarted;
        await writeFile(archivePath, `archive ${basename(archivePath)}`);
        running.delete(archivePath);
      },
    });

    expect(Math.max(...runningCounts)).toBe(SERVER_PLATFORMS.length);
    const names = SERVER_PLATFORMS.map(
      (platform) =>
        `nextgen_0.1.0-alpha.6_${platform.goos}_${platform.goarch}.${
          platform.goos === "windows" ? "zip" : "tar.gz"
        }`,
    );
    expect(archives.map((archive) => basename(archive))).toEqual(names);
    const checksums = await readFile(checksumPath, "utf8");
    expect(checksums.trimEnd().split("\n")).toEqual(
      names.map(
        (name) => `${createHash("sha256").update(`archive ${name}`).digest("hex")}  ${name}`,
      ),
    );
  });

  it("rejects incomplete local release artifacts", async () => {
    const { verifyLocalArtifacts } = await loadModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-release-artifacts-"));
    tempDirs.push(repoRoot);
    const outDir = join(repoRoot, "dist/release/0.1.0-alpha.6");
    await mkdir(outDir, { recursive: true });

    await expect(
      verifyLocalArtifacts({
        repoRoot,
        outDir,
        release: {
          name: "@zitadel/server",
          version: "0.1.0-alpha.6",
          tag: "v0.1.0-alpha.6",
          prerelease: true,
        },
      }),
    ).rejects.toThrow("missing release artifacts");
  });

  it("rejects packing public packages before release build output exists", async () => {
    const { packPublicPackages } = await loadModule();
    const manifest = (await import(
      new URL("../../../../../scripts/release-manifest.mjs", import.meta.url).href
    )) as { PUBLIC_RELEASE_PACKAGES: Array<{ name: string; dir: string }> };
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-release-packages-"));
    tempDirs.push(repoRoot);
    const outDir = join(repoRoot, "dist/release/0.1.0-alpha.6");
    for (const pkg of manifest.PUBLIC_RELEASE_PACKAGES) {
      await mkdir(join(repoRoot, pkg.dir), { recursive: true });
      await writeFile(
        join(repoRoot, pkg.dir, "package.json"),
        `${JSON.stringify({ license: "MIT", name: pkg.name, version: "0.1.0-alpha.6", files: ["dist"] }, null, 2)}\n`,
      );
    }

    await expect(
      packPublicPackages({
        repoRoot,
        outDir,
        version: "0.1.0-alpha.6",
        run: async () => undefined,
      }),
    ).rejects.toThrow(/requires .+\/dist before packing/);
  });

  it("packs the CLI release tarball", async () => {
    const { packPublicPackages } = await loadModule();
    const manifest = (await import(
      new URL("../../../../../scripts/release-manifest.mjs", import.meta.url).href
    )) as {
      PUBLIC_RELEASE_PACKAGES: Array<{ name: string; dir: string }>;
    };
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-release-packages-"));
    tempDirs.push(repoRoot);
    const outDir = join(repoRoot, "dist/release/0.1.0-alpha.6");
    for (const pkg of manifest.PUBLIC_RELEASE_PACKAGES) {
      await mkdir(join(repoRoot, pkg.dir, "dist"), { recursive: true });
      await writeFile(
        join(repoRoot, pkg.dir, "package.json"),
        `${JSON.stringify({ license: "MIT", name: pkg.name, version: "0.1.0-alpha.6", files: ["dist"] }, null, 2)}\n`,
      );
    }

    const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    await packPublicPackages({
      repoRoot,
      outDir,
      version: "0.1.0-alpha.6",
      run: async (_command, args, options) => {
        calls.push({ args, env: options.env });
      },
    });

    // The CLI ships as a single generic build, so its pack is invoked like
    // every other public package — no special telemetry-channel env.
    const cliPack = calls.find((call) => call.args.includes("apps/cli"));
    expect(cliPack).toBeDefined();
  });

  it("packs only the given directories into the given tarball directory", async () => {
    const { packPublicPackages } = await loadModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-release-packages-"));
    tempDirs.push(repoRoot);
    const tarballsDir = join(repoRoot, "registry/npm-packages");
    await mkdir(join(repoRoot, "packages/sdk-core/dist"), { recursive: true });
    await writeFile(
      join(repoRoot, "packages/sdk-core/package.json"),
      `${JSON.stringify({ name: "@zitadel/sdk-core", version: "0.1.0-alpha.6" })}\n`,
    );

    const packed: string[][] = [];
    const result = await packPublicPackages({
      repoRoot,
      dirs: ["packages/sdk-core"],
      tarballsDir,
      run: async (_command, args) => {
        packed.push(args);
      },
    });

    expect(result).toBe(tarballsDir);
    expect(packed).toEqual([
      ["pnpm", "--dir", "packages/sdk-core", "pack", "--pack-destination", tarballsDir],
    ]);
  });
});
