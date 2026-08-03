import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

type RunCall = {
  command: string;
  args: string[];
  options: { cwd: string; env: Record<string, string | undefined> };
};

type LocalRegistryModule = {
  localRegistryPaths: (workDir: string) => {
    npmrcPath: string;
    registryLogPath: string;
    storagePath: string;
    tarballsDir: string;
    verdaccioConfigPath: string;
  };
  localRegistryPort: (repoRoot: string, env?: Record<string, string | undefined>) => number;
  npmEnvironment: (
    env: Record<string, string | undefined>,
    registryUrl: string,
    npmrcPath: string,
  ) => Record<string, string | undefined>;
  packageDirs: string[];
  prepareLocalRegistry: (options: {
    env: Record<string, string | undefined>;
    log?: (message: string) => void;
    onStarted?: (registry: { exitCode: number | null; logFile: string }) => void;
    paths?: ReturnType<LocalRegistryModule["localRegistryPaths"]>;
    prebuiltTarballsDir?: string;
    registryPort: number;
    registryUrl: string;
    repoRoot: string;
    run: (command: string, args: string[], options: RunCall["options"]) => Promise<void>;
    startLocalRegistry?: (options: {
      paths: ReturnType<LocalRegistryModule["localRegistryPaths"]>;
      registryPort: number;
      repoRoot: string;
      env: Record<string, string | undefined>;
    }) => Promise<{ exitCode: number | null; logFile: string }>;
    waitForHttp?: (url: string, label: string) => Promise<void>;
    workDir: string;
  }) => Promise<{
    env: Record<string, string | undefined>;
    paths: ReturnType<LocalRegistryModule["localRegistryPaths"]>;
    registry: { exitCode: number | null; logFile: string };
  }>;
};

let localRegistry: LocalRegistryModule;
const tempDirs: string[] = [];

beforeAll(async () => {
  localRegistry = (await import(
    new URL("../../../../../apps/cli-journey-e2e/scripts/local-registry.mjs", import.meta.url).href
  )) as LocalRegistryModule;
});

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("local registry helper", () => {
  it("prepares local package tarballs and publishes them to Verdaccio", async () => {
    const repoRoot = await fixtureRepo();
    const workDir = await mkdtemp(join(tmpdir(), "zitadel-local-registry-"));
    tempDirs.push(workDir);
    const paths = localRegistry.localRegistryPaths(workDir);
    const calls: Array<
      | RunCall
      | { type: "start-registry"; port: number }
      | { type: "started" }
      | { type: "wait"; label: string; url: string }
    > = [];
    const logs: string[] = [];
    const env = { PATH: "/bin" };
    const registry = { exitCode: null, logFile: paths.registryLogPath };

    const result = await localRegistry.prepareLocalRegistry({
      env,
      log: (message) => logs.push(message),
      onStarted: () => {
        calls.push({ type: "started" });
      },
      paths,
      registryPort: 51_234,
      registryUrl: "http://127.0.0.1:51234",
      repoRoot,
      run: async (command, args, options) => {
        calls.push({ command, args, options });
        if (command === "moon" && args.join(" ") === "run release:pack") {
          await fixtureReleaseTarballs(repoRoot);
        }
      },
      startLocalRegistry: async (options) => {
        calls.push({ type: "start-registry", port: options.registryPort });
        return registry;
      },
      waitForHttp: async (url, label) => {
        calls.push({ type: "wait", label, url });
      },
      workDir,
    });

    expect(logs).toContain(
      "building release npm tarballs for @zitadel/cli, @zitadel/server, @zitadel/server-linux-x64, @zitadel/server-linux-arm64, @zitadel/server-darwin-x64, @zitadel/server-darwin-arm64, @zitadel/server-win32-x64, @zitadel/api, @zitadel/config, @zitadel/components, @zitadel/sdk-core, @zitadel/sdk-next, @zitadel/sdk-nuxt, @zitadel/sdk-react, @zitadel/sdk-vue, @zitadel/sdk-angular, @zitadel/sdk-solid, @zitadel/sdk-svelte, @zitadel/sdk-qwik, @zitadel/testing",
    );
    expect(await readFile(paths.npmrcPath, "utf8")).toContain(
      "//127.0.0.1:51234/:_authToken=journey-token",
    );
    expect(await readFile(paths.verdaccioConfigPath, "utf8")).toContain("'@zitadel/*'");
    expect(await readFile(paths.verdaccioConfigPath, "utf8")).toContain(paths.storagePath);
    expect(await readFile(paths.verdaccioConfigPath, "utf8")).toContain(
      "max_body_size: 200mb",
    );

    const runCalls = calls.filter((call): call is RunCall => "command" in call);
    expect(runCalls[0]).toEqual({
      command: "moon",
      args: ["run", "release:pack"],
      options: { cwd: repoRoot, env },
    });
    // The registry carries exactly the release tarball set, verified strictly.
    expect(runCalls).toContainEqual({
      command: "node",
      args: ["apps/cli-journey-e2e/scripts/verify-tarballs.mjs", paths.tarballsDir],
      options: { cwd: repoRoot, env },
    });
    expect(calls).toContainEqual({ type: "start-registry", port: 51_234 });
    expect(calls).toContainEqual({ type: "started" });
    expect(calls).toContainEqual({
      type: "wait",
      label: "Verdaccio",
      url: "http://127.0.0.1:51234/-/ping",
    });
    expect(result.registry).toBe(registry);
    expect(runCalls.at(-1)).toMatchObject({
      command: "node",
      args: ["apps/cli-journey-e2e/scripts/publish-tarballs.mjs", paths.tarballsDir],
      options: {
        cwd: repoRoot,
        env: {
          JOURNEY_REGISTRY_URL: "http://127.0.0.1:51234",
          NPM_CONFIG_USERCONFIG: paths.npmrcPath,
          PATH: "/bin",
        },
      },
    });
    expect(result.env).toMatchObject({
      NPM_CONFIG_USERCONFIG: paths.npmrcPath,
      PATH: "/bin",
      npm_config_registry: "http://127.0.0.1:51234",
    });
  });

  it("scrubs inherited npm config before pointing installs at the local registry", () => {
    expect(
      localRegistry.npmEnvironment(
        {
          NPM_CONFIG_REGISTRY: "https://registry.example.test",
          NPM_CONFIG_TOKEN: "secret",
          PATH: "/bin",
          npm_config_registry: "https://registry.npmjs.org",
          npm_config_yes: "false",
        },
        "http://127.0.0.1:51234",
        "/tmp/verdaccio.npmrc",
      ),
    ).toEqual({
      NPM_CONFIG_USERCONFIG: "/tmp/verdaccio.npmrc",
      PATH: "/bin",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_registry: "http://127.0.0.1:51234",
      npm_config_yes: "true",
    });
  });

  it("uses prebuilt tarballs without rebuilding release packages", async () => {
    const repoRoot = await fixtureRepo();
    const workDir = await mkdtemp(join(tmpdir(), "zitadel-local-registry-"));
    const prebuiltTarballsDir = await mkdtemp(join(tmpdir(), "zitadel-prebuilt-tarballs-"));
    tempDirs.push(workDir, prebuiltTarballsDir);
    const paths = localRegistry.localRegistryPaths(workDir);
    const calls: Array<
      | RunCall
      | { type: "start-registry"; port: number }
      | { type: "wait"; label: string; url: string }
    > = [];
    const logs: string[] = [];
    const env = { PATH: "/bin" };
    const registry = { exitCode: null, logFile: paths.registryLogPath };
    await fixtureTarballs(prebuiltTarballsDir);

    await localRegistry.prepareLocalRegistry({
      env,
      log: (message) => logs.push(message),
      paths,
      prebuiltTarballsDir,
      registryPort: 51_234,
      registryUrl: "http://127.0.0.1:51234",
      repoRoot,
      run: async (command, args, options) => {
        calls.push({ command, args, options });
      },
      startLocalRegistry: async (options) => {
        calls.push({ type: "start-registry", port: options.registryPort });
        return registry;
      },
      waitForHttp: async (url, label) => {
        calls.push({ type: "wait", label, url });
      },
      workDir,
    });

    expect(logs).toContain(`using prebuilt release npm tarballs from ${prebuiltTarballsDir}`);
    const runCalls = calls.filter((call): call is RunCall => "command" in call);
    expect(runCalls).not.toContainEqual({
      command: "moon",
      args: ["run", "release:pack"],
      options: { cwd: repoRoot, env },
    });
    // Prebuilt release tarballs already carry the full public set (including
    // @zitadel/testing), so no build runs — verification comes first.
    expect(runCalls[0]).toEqual({
      command: "node",
      args: ["apps/cli-journey-e2e/scripts/verify-tarballs.mjs", paths.tarballsDir],
      options: { cwd: repoRoot, env },
    });
    expect(await readFile(join(paths.tarballsDir, "zitadel-cli-0.1.0-alpha.5.tgz"), "utf8")).toBe(
      "@zitadel/cli\n",
    );
  });

  it("validates explicit local registry ports and derives stable defaults", () => {
    expect(
      localRegistry.localRegistryPort("/repo", {
        ZITADEL_CLI_LOCAL_REGISTRY_PORT: "51234",
      }),
    ).toBe(51_234);
    expect(() =>
      localRegistry.localRegistryPort("/repo", {
        ZITADEL_CLI_LOCAL_REGISTRY_PORT: "nope",
      }),
    ).toThrow("ZITADEL_CLI_LOCAL_REGISTRY_PORT must be a TCP port");

    const port = localRegistry.localRegistryPort("/repo", {});
    expect(port).toBeGreaterThanOrEqual(54_873);
    expect(port).toBeLessThanOrEqual(64_872);
    expect(localRegistry.localRegistryPort("/repo", {})).toBe(port);
  });
});

async function fixtureRepo(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-local-registry-repo-"));
  tempDirs.push(repoRoot);

  for (const dir of localRegistry.packageDirs) {
    const name = packageNameForDir(dir);
    const packageDir = join(repoRoot, dir);
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      `${JSON.stringify({ license: "MIT", name, version: "0.1.0-alpha.5" }, null, 2)}\n`,
    );
  }

  return repoRoot;
}

async function fixtureReleaseTarballs(repoRoot: string): Promise<void> {
  const outDir = join(repoRoot, "dist", "release", "0.1.0-alpha.5", "npm");
  await fixtureTarballs(outDir);
}

async function fixtureTarballs(outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const dir of localRegistry.packageDirs) {
    const name = packageNameForDir(dir);
    const fileName = `${name.replace("@", "").replace("/", "-")}-0.1.0-alpha.5.tgz`;
    await writeFile(join(outDir, fileName), `${name}\n`);
  }
}

function packageNameForDir(dir: string): string {
  if (dir === "apps/cli") {
    return "@zitadel/cli";
  }
  return `@zitadel/${basename(dir)}`;
}
