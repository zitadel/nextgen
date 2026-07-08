import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

type PublishPlan = {
  shouldPublish: boolean;
  dryRun: boolean;
  reason: string;
  version: string;
  tag: string;
  prerelease: boolean;
  recoverVersion: string;
};

type PublishResult = {
  skipped: boolean;
  distTag?: string;
  results: Array<{ name: string; version: string; action: string }>;
};

type ReleaseRehearsalModule = {
  assertLocalRegistryUrl: (registryUrl: string) => void;
  parseArgs: (args: string[]) => { npmRehearsal: boolean; smoke: boolean; help: boolean };
  runNpmRehearsal: (options: {
    repoRoot?: string;
    plan: PublishPlan;
    workDir?: string;
    registryPort?: number;
    startRegistry?: (input: unknown) => Promise<unknown>;
    stopRegistry?: (registry: unknown) => Promise<void>;
    waitForHttp?: (url: string, label: string, child: unknown, log: unknown) => Promise<void>;
    publishTarballs?: (options: {
      plan: PublishPlan;
      registryUrl: string;
      tarballsDir: string;
    }) => Promise<PublishResult>;
    log?: (message: string) => void;
  }) => Promise<PublishResult>;
};

const tempDirs: string[] = [];

async function loadModule(): Promise<ReleaseRehearsalModule> {
  return (await import(
    new URL("../../../../../scripts/release-rehearsal.mjs", import.meta.url).href
  )) as ReleaseRehearsalModule;
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

function rehearsalPlan(overrides: Partial<PublishPlan> = {}): PublishPlan {
  return {
    shouldPublish: true,
    dryRun: true,
    reason: "release rehearsal (gate-free dry run)",
    version: "0.1.0-alpha.14",
    tag: "v0.1.0-alpha.14",
    prerelease: true,
    recoverVersion: "",
    ...overrides,
  };
}

describe("release npm rehearsal", () => {
  it("accepts only loopback http registries", async () => {
    const { assertLocalRegistryUrl } = await loadModule();

    expect(() => assertLocalRegistryUrl("http://127.0.0.1:4873")).not.toThrow();
    expect(() => assertLocalRegistryUrl("https://registry.npmjs.org")).toThrow(
      "local registry",
    );
    expect(() => assertLocalRegistryUrl("http://localhost:4873")).toThrow("local registry");
    expect(() => assertLocalRegistryUrl("http://0.0.0.0:4873")).toThrow("local registry");
    expect(() => assertLocalRegistryUrl("not-a-url")).toThrow("must be a URL");
  });

  it("publishes through the production path with a non-dry plan and tears down", async () => {
    const { runNpmRehearsal } = await loadModule();
    const workDir = await tempDir("zitadel-rehearsal-");

    const events: string[] = [];
    let publishedPlan: PublishPlan | undefined;
    let publishedRegistryUrl = "";
    const result = await runNpmRehearsal({
      plan: rehearsalPlan(),
      workDir,
      registryPort: 54873,
      startRegistry: async () => {
        events.push("start");
        return { fake: true };
      },
      stopRegistry: async () => {
        events.push("stop");
      },
      waitForHttp: async (url) => {
        events.push(`wait:${url}`);
      },
      publishTarballs: async (options) => {
        events.push("publish");
        publishedPlan = options.plan;
        publishedRegistryUrl = options.registryUrl;
        return {
          skipped: false,
          distTag: "alpha",
          results: [{ name: "@zitadel/cli", version: "0.1.0-alpha.14", action: "published" }],
        };
      },
      log: () => undefined,
    });

    expect(events).toEqual(["start", "wait:http://127.0.0.1:54873/-/ping", "publish", "stop"]);
    expect(publishedPlan?.dryRun).toBe(false);
    expect(publishedPlan?.shouldPublish).toBe(true);
    expect(publishedRegistryUrl).toBe("http://127.0.0.1:54873");
    expect(result.results).toHaveLength(1);
  });

  it("fails when a fresh registry reports anything but published, and still stops the registry", async () => {
    const { runNpmRehearsal } = await loadModule();
    const workDir = await tempDir("zitadel-rehearsal-fail-");

    let stopped = false;
    await expect(
      runNpmRehearsal({
        plan: rehearsalPlan(),
        workDir,
        registryPort: 54874,
        startRegistry: async () => ({}),
        stopRegistry: async () => {
          stopped = true;
        },
        waitForHttp: async () => undefined,
        publishTarballs: async () => ({
          skipped: false,
          distTag: "alpha",
          results: [{ name: "@zitadel/cli", version: "0.1.0-alpha.14", action: "exists" }],
        }),
        log: () => undefined,
      }),
    ).rejects.toThrow("must publish every tarball");
    expect(stopped).toBe(true);
  });

  it("rejects skip plans instead of silently rehearsing nothing", async () => {
    const { runNpmRehearsal } = await loadModule();

    await expect(
      runNpmRehearsal({
        plan: rehearsalPlan({ shouldPublish: false, reason: "not a version commit" }),
      }),
    ).rejects.toThrow("requires a rehearsal publish plan");
  });

  it("parses the npm-rehearsal and smoke flags", async () => {
    const { parseArgs } = await loadModule();

    expect(parseArgs([])).toEqual({ npmRehearsal: false, smoke: false, help: false });
    expect(parseArgs(["--npm-rehearsal", "--smoke"])).toEqual({
      npmRehearsal: true,
      smoke: true,
      help: false,
    });
    expect(() => parseArgs(["--bogus"])).toThrow("unknown option");
  });
});
