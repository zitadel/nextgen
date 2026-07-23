import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

type PublishPlan = {
  shouldPublish: boolean;
  dryRun: boolean;
  reason: string;
  version: string;
  tag: string;
  commit: string;
  prerelease: boolean;
  recoverVersion: string;
};

type CommandCall = { command: string; args: string[] };

type ReleaseNpmModule = {
  DEFAULT_REGISTRY_URL: string;
  publishNpmTarballs: (options: {
    repoRoot?: string;
    plan: PublishPlan;
    registryUrl?: string;
    tarballsDir: string;
    distTag?: string;
    distTagToken?: string;
    publicPackageNames?: string[];
    run?: (command: string, args: string[], options?: unknown) => Promise<unknown>;
    runCapture?: (
      command: string,
      args: string[],
      options?: unknown,
    ) => Promise<{ stdout: string }>;
    log?: (message: string) => void;
  }) => Promise<{
    skipped: boolean;
    distTag?: string;
    results: Array<{ name: string; version: string; action: string }>;
  }>;
  versionExistsOnRegistry: (options: {
    spec: string;
    registryUrl: string;
    runCapture?: (command: string, args: string[]) => Promise<{ stdout: string }>;
  }) => Promise<boolean>;
  readRegistryDistTags: (options: {
    name: string;
    registryUrl: string;
    runCapture?: (command: string, args: string[]) => Promise<{ stdout: string }>;
  }) => Promise<Record<string, string>>;
  resolveDistTag: (repoRoot: string) => Promise<string>;
  parseArgs: (args: string[]) => { registryUrl: string; tarballsDir: string; distTag: string };
};

const tempDirs: string[] = [];

async function loadModule(): Promise<ReleaseNpmModule> {
  return (await import(
    new URL("../../../../../scripts/release-npm.mjs", import.meta.url).href
  )) as ReleaseNpmModule;
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function plan(overrides: Partial<PublishPlan> = {}): PublishPlan {
  return {
    shouldPublish: true,
    dryRun: false,
    reason: "version commit detected",
    version: "0.1.0-alpha.14",
    tag: "v0.1.0-alpha.14",
    commit: "a".repeat(40),
    prerelease: true,
    recoverVersion: "",
    ...overrides,
  };
}

function notFoundError(spec: string): Error {
  return Object.assign(new Error(`npm view ${spec} failed with exit 1`), {
    stderr: `npm ERR! code E404\nnpm ERR! 404 Not Found - GET ${spec}`,
    code: 1,
  });
}

// Simulates the external inspection commands used by publishNpmTarballs:
// tarball manifests, exact npm versions, and package dist-tags.
function fakeRunCapture(options: {
  manifests: Record<string, { name: string; version: string; private?: boolean }>;
  existingSpecs?: string[];
  distTags?: Record<string, Record<string, string>>;
  viewError?: Error;
}) {
  return async (command: string, args: string[]) => {
    if (command === "tar") {
      const tarball = args[1] ?? "";
      const file = tarball.split("/").at(-1) ?? tarball;
      const manifest = options.manifests[file];
      if (!manifest) {
        throw new Error(`unexpected tarball ${tarball}`);
      }
      return { stdout: JSON.stringify(manifest) };
    }
    if (command === "npm" && args[0] === "view") {
      if (options.viewError) {
        throw options.viewError;
      }
      const spec = args[1] ?? "";
      if (args[2] === "dist-tags") {
        return { stdout: JSON.stringify(options.distTags?.[spec] ?? {}) };
      }
      if ((options.existingSpecs ?? []).includes(spec)) {
        return { stdout: "0.1.0-alpha.14\n" };
      }
      throw notFoundError(spec);
    }
    throw new Error(`unexpected command ${command} ${args.join(" ")}`);
  };
}

describe("release npm tarball promotion", () => {
  it("publishes missing versions and skips ones already on the registry", async () => {
    const { publishNpmTarballs } = await loadModule();
    const tarballsDir = await tempDir("zitadel-npm-tarballs-");
    await writeFile(join(tarballsDir, "zitadel-cli-0.1.0-alpha.14.tgz"), "");
    await writeFile(join(tarballsDir, "zitadel-sdk-core-0.1.0-alpha.14.tgz"), "");

    const publishCalls: CommandCall[] = [];
    const result = await publishNpmTarballs({
      plan: plan(),
      tarballsDir,
      distTag: "alpha",
      distTagToken: "test-dist-tag-token",
      registryUrl: "https://registry.example.test",
      publicPackageNames: ["@zitadel/cli", "@zitadel/sdk-core"],
      run: async (command, args) => {
        publishCalls.push({ command, args });
      },
      runCapture: fakeRunCapture({
        manifests: {
          "zitadel-cli-0.1.0-alpha.14.tgz": { name: "@zitadel/cli", version: "0.1.0-alpha.14" },
          "zitadel-sdk-core-0.1.0-alpha.14.tgz": {
            name: "@zitadel/sdk-core",
            version: "0.1.0-alpha.14",
          },
        },
        existingSpecs: ["@zitadel/cli@0.1.0-alpha.14"],
        distTags: { "@zitadel/cli": { alpha: "0.1.0-alpha.14" } },
      }),
      log: () => undefined,
    });

    expect(result.results).toEqual([
      { name: "@zitadel/cli", version: "0.1.0-alpha.14", action: "exists" },
      { name: "@zitadel/sdk-core", version: "0.1.0-alpha.14", action: "published" },
    ]);
    expect(publishCalls).toHaveLength(1);
    const args = publishCalls[0]?.args ?? [];
    expect(publishCalls[0]?.command).toBe("npm");
    expect(args[0]).toBe("publish");
    expect(args[1]).toContain("zitadel-sdk-core-0.1.0-alpha.14.tgz");
    expect(args).toEqual(
      expect.arrayContaining([
        "--registry",
        "https://registry.example.test",
        "--tag",
        "alpha",
        "--access",
        "public",
        "--ignore-scripts",
      ]),
    );
  });

  it("does not roll the release dist-tag backward during historical recovery", async () => {
    const { publishNpmTarballs } = await loadModule();
    const tarballsDir = await tempDir("zitadel-npm-historical-existing-");
    await writeFile(join(tarballsDir, "zitadel-cli-0.1.0-alpha.14.tgz"), "");

    const calls: CommandCall[] = [];
    const result = await publishNpmTarballs({
      plan: plan({ recoverVersion: "0.1.0-alpha.14" }),
      tarballsDir,
      distTag: "alpha",
      publicPackageNames: ["@zitadel/cli"],
      run: async (command, args) => {
        calls.push({ command, args });
      },
      runCapture: fakeRunCapture({
        manifests: {
          "zitadel-cli-0.1.0-alpha.14.tgz": {
            name: "@zitadel/cli",
            version: "0.1.0-alpha.14",
          },
        },
        existingSpecs: ["@zitadel/cli@0.1.0-alpha.14"],
        distTags: { "@zitadel/cli": { alpha: "0.1.0-alpha.17" } },
      }),
      log: () => undefined,
    });

    expect(calls).toHaveLength(0);
    expect(result.results).toEqual([
      { name: "@zitadel/cli", version: "0.1.0-alpha.14", action: "exists" },
    ]);
  });

  it("uses and removes a temporary tag when backfilling a historical npm version", async () => {
    const { publishNpmTarballs } = await loadModule();
    const tarballsDir = await tempDir("zitadel-npm-historical-missing-");
    await writeFile(join(tarballsDir, "zitadel-cli-0.1.0-alpha.14.tgz"), "");

    const calls: CommandCall[] = [];
    const result = await publishNpmTarballs({
      plan: plan({ recoverVersion: "0.1.0-alpha.14" }),
      tarballsDir,
      distTag: "alpha",
      distTagToken: "test-dist-tag-token",
      publicPackageNames: ["@zitadel/cli"],
      run: async (command, args) => {
        calls.push({ command, args });
      },
      runCapture: fakeRunCapture({
        manifests: {
          "zitadel-cli-0.1.0-alpha.14.tgz": {
            name: "@zitadel/cli",
            version: "0.1.0-alpha.14",
          },
        },
      }),
      log: () => undefined,
    });

    expect(result.results).toEqual([
      { name: "@zitadel/cli", version: "0.1.0-alpha.14", action: "published" },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining(["publish", "--tag", "zitadel-recovery-0-1-0-alpha-14"]),
    );
    expect(calls[1]?.args).toEqual([
      "dist-tag",
      "rm",
      "@zitadel/cli",
      "zitadel-recovery-0-1-0-alpha-14",
      "--registry",
      "https://registry.npmjs.org",
      "--loglevel",
      "warn",
    ]);
  });

  it("repairs a stale dist-tag when the exact version already exists", async () => {
    const { publishNpmTarballs } = await loadModule();
    const tarballsDir = await tempDir("zitadel-npm-retag-");
    await writeFile(join(tarballsDir, "zitadel-cli-0.1.0-alpha.14.tgz"), "");

    const calls: CommandCall[] = [];
    const result = await publishNpmTarballs({
      plan: plan(),
      tarballsDir,
      distTag: "alpha",
      distTagToken: "test-dist-tag-token",
      registryUrl: "https://registry.example.test",
      publicPackageNames: ["@zitadel/cli"],
      run: async (command, args) => {
        calls.push({ command, args });
      },
      runCapture: fakeRunCapture({
        manifests: {
          "zitadel-cli-0.1.0-alpha.14.tgz": {
            name: "@zitadel/cli",
            version: "0.1.0-alpha.14",
          },
        },
        existingSpecs: ["@zitadel/cli@0.1.0-alpha.14"],
        distTags: { "@zitadel/cli": { alpha: "0.1.0-alpha.13" } },
      }),
      log: () => undefined,
    });

    expect(result.results).toEqual([
      { name: "@zitadel/cli", version: "0.1.0-alpha.14", action: "tagged" },
    ]);
    expect(calls).toEqual([
      {
        command: "npm",
        args: [
          "dist-tag",
          "add",
          "@zitadel/cli@0.1.0-alpha.14",
          "alpha",
          "--registry",
          "https://registry.example.test",
          "--loglevel",
          "warn",
        ],
      },
    ]);
  });

  it("reports a stale dist-tag without mutating it during dry runs", async () => {
    const { publishNpmTarballs } = await loadModule();
    const tarballsDir = await tempDir("zitadel-npm-retag-dry-");
    await writeFile(join(tarballsDir, "zitadel-cli-0.1.0-alpha.14.tgz"), "");

    const calls: CommandCall[] = [];
    const result = await publishNpmTarballs({
      plan: plan({ dryRun: true }),
      tarballsDir,
      distTag: "alpha",
      publicPackageNames: ["@zitadel/cli"],
      run: async (command, args) => {
        calls.push({ command, args });
      },
      runCapture: fakeRunCapture({
        manifests: {
          "zitadel-cli-0.1.0-alpha.14.tgz": {
            name: "@zitadel/cli",
            version: "0.1.0-alpha.14",
          },
        },
        existingSpecs: ["@zitadel/cli@0.1.0-alpha.14"],
        distTags: { "@zitadel/cli": { alpha: "0.1.0-alpha.13" } },
      }),
      log: () => undefined,
    });

    expect(calls).toHaveLength(0);
    expect(result.results).toEqual([
      { name: "@zitadel/cli", version: "0.1.0-alpha.14", action: "would-tag" },
    ]);
  });

  it("only reports what a dry-run plan would publish", async () => {
    const { publishNpmTarballs } = await loadModule();
    const tarballsDir = await tempDir("zitadel-npm-dry-");
    await writeFile(join(tarballsDir, "zitadel-cli-0.1.0-alpha.14.tgz"), "");

    const publishCalls: CommandCall[] = [];
    const result = await publishNpmTarballs({
      plan: plan({ dryRun: true }),
      tarballsDir,
      distTag: "alpha",
      publicPackageNames: ["@zitadel/cli"],
      run: async (command, args) => {
        publishCalls.push({ command, args });
      },
      runCapture: fakeRunCapture({
        manifests: {
          "zitadel-cli-0.1.0-alpha.14.tgz": { name: "@zitadel/cli", version: "0.1.0-alpha.14" },
        },
      }),
      log: () => undefined,
    });

    expect(publishCalls).toHaveLength(0);
    expect(result.results).toEqual([
      { name: "@zitadel/cli", version: "0.1.0-alpha.14", action: "would-publish" },
    ]);
  });

  it("no-ops when the publish plan says skip", async () => {
    const { publishNpmTarballs } = await loadModule();
    const result = await publishNpmTarballs({
      plan: plan({ shouldPublish: false, reason: "not a version commit" }),
      tarballsDir: "/nonexistent",
      run: async () => {
        throw new Error("must not publish");
      },
      runCapture: async () => {
        throw new Error("must not inspect");
      },
      log: () => undefined,
    });

    expect(result).toEqual({ skipped: true, results: [] });
  });

  it("refuses private and unexpected packages", async () => {
    const { publishNpmTarballs } = await loadModule();
    const tarballsDir = await tempDir("zitadel-npm-guard-");
    await writeFile(join(tarballsDir, "internal-0.0.1.tgz"), "");

    await expect(
      publishNpmTarballs({
        plan: plan(),
        tarballsDir,
        publicPackageNames: ["@zitadel/cli"],
        runCapture: fakeRunCapture({
          manifests: {
            "internal-0.0.1.tgz": { name: "@zitadel/internal", version: "0.0.1", private: true },
          },
        }),
        log: () => undefined,
      }),
    ).rejects.toThrow("refusing to publish private package");

    await expect(
      publishNpmTarballs({
        plan: plan(),
        tarballsDir,
        publicPackageNames: ["@zitadel/cli"],
        runCapture: fakeRunCapture({
          manifests: {
            "internal-0.0.1.tgz": { name: "@zitadel/internal", version: "0.0.1" },
          },
        }),
        log: () => undefined,
      }),
    ).rejects.toThrow("unexpected package");
  });

  it("refuses tarballs whose version differs from the publish plan", async () => {
    const { publishNpmTarballs } = await loadModule();
    const tarballsDir = await tempDir("zitadel-npm-version-guard-");
    await writeFile(join(tarballsDir, "zitadel-cli-0.1.0-alpha.13.tgz"), "");

    await expect(
      publishNpmTarballs({
        plan: plan(),
        tarballsDir,
        publicPackageNames: ["@zitadel/cli"],
        runCapture: fakeRunCapture({
          manifests: {
            "zitadel-cli-0.1.0-alpha.13.tgz": {
              name: "@zitadel/cli",
              version: "0.1.0-alpha.13",
            },
          },
        }),
        log: () => undefined,
      }),
    ).rejects.toThrow("expected release 0.1.0-alpha.14");
  });

  it("treats only 404s as missing versions and surfaces other registry errors", async () => {
    const { versionExistsOnRegistry } = await loadModule();

    await expect(
      versionExistsOnRegistry({
        spec: "@zitadel/cli@0.1.0-alpha.14",
        registryUrl: "https://registry.example.test",
        runCapture: async () => ({ stdout: "0.1.0-alpha.14\n" }),
      }),
    ).resolves.toBe(true);

    await expect(
      versionExistsOnRegistry({
        spec: "@zitadel/cli@0.1.0-alpha.14",
        registryUrl: "https://registry.example.test",
        runCapture: async () => {
          throw notFoundError("@zitadel/cli@0.1.0-alpha.14");
        },
      }),
    ).resolves.toBe(false);

    await expect(
      versionExistsOnRegistry({
        spec: "@zitadel/cli@0.1.0-alpha.14",
        registryUrl: "https://registry.example.test",
        runCapture: async () => {
          throw Object.assign(new Error("npm view failed"), {
            stderr: "npm ERR! code E401 Unauthorized",
          });
        },
      }),
    ).rejects.toThrow("failed to check");
  });

  it("reads package dist-tags as registry state", async () => {
    const { readRegistryDistTags } = await loadModule();

    await expect(
      readRegistryDistTags({
        name: "@zitadel/cli",
        registryUrl: "https://registry.example.test",
        runCapture: async () => ({
          stdout: JSON.stringify({ alpha: "0.1.0-alpha.14", latest: "0.0.9" }),
        }),
      }),
    ).resolves.toEqual({ alpha: "0.1.0-alpha.14", latest: "0.0.9" });
  });

  it("resolves the dist-tag from Changesets pre mode", async () => {
    const { resolveDistTag } = await loadModule();

    const preRepo = await tempDir("zitadel-dist-tag-pre-");
    await mkdir(join(preRepo, ".changeset"));
    await writeFile(
      join(preRepo, ".changeset", "pre.json"),
      JSON.stringify({ mode: "pre", tag: "alpha", changesets: [] }),
    );
    await expect(resolveDistTag(preRepo)).resolves.toBe("alpha");

    const exitRepo = await tempDir("zitadel-dist-tag-exit-");
    await mkdir(join(exitRepo, ".changeset"));
    await writeFile(
      join(exitRepo, ".changeset", "pre.json"),
      JSON.stringify({ mode: "exit", tag: "alpha", changesets: [] }),
    );
    await expect(resolveDistTag(exitRepo)).resolves.toBe("latest");

    const stableRepo = await tempDir("zitadel-dist-tag-stable-");
    await expect(resolveDistTag(stableRepo)).resolves.toBe("latest");
  });

  it("parses registry, tarballs-dir, and dist-tag flags", async () => {
    const { parseArgs } = await loadModule();

    expect(parseArgs(["--registry", "http://127.0.0.1:4873", "--dist-tag", "alpha"])).toMatchObject(
      { registryUrl: "http://127.0.0.1:4873", distTag: "alpha" },
    );
    expect(() => parseArgs(["--registry"])).toThrow("--registry requires a value");
    expect(() => parseArgs(["--bogus"])).toThrow("unknown option");
  });
});
