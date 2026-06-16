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
    composeEnvPath: string;
    npmrcPath: string;
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
    compose: {
      envPath: string;
      file: string;
      projectName: string;
      repoRoot: string;
    };
    env: Record<string, string | undefined>;
    log?: (message: string) => void;
    onStarted?: () => void;
    paths?: ReturnType<LocalRegistryModule["localRegistryPaths"]>;
    registryPort: number;
    registryUrl: string;
    repoRoot: string;
    run: (command: string, args: string[], options: RunCall["options"]) => Promise<void>;
    waitForHttp?: (url: string, label: string) => Promise<void>;
    workDir: string;
  }) => Promise<{
    env: Record<string, string | undefined>;
    paths: ReturnType<LocalRegistryModule["localRegistryPaths"]>;
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
    const calls: Array<RunCall | { type: "started" } | { type: "wait"; label: string; url: string }> = [];
    const logs: string[] = [];
    const env = { PATH: "/bin" };

    const result = await localRegistry.prepareLocalRegistry({
      compose: {
        envPath: paths.composeEnvPath,
        file: join(repoRoot, "docker-compose.local.yaml"),
        projectName: "zitadel-local-test",
        repoRoot,
      },
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
      },
      waitForHttp: async (url, label) => {
        calls.push({ type: "wait", label, url });
      },
      workDir,
    });

    expect(logs).toContain(
      "building @zitadel/cli, @zitadel/api, @zitadel/components, @zitadel/sdk-core, @zitadel/sdk-next, @zitadel/sdk-nuxt, @zitadel/sdk-react, @zitadel/sdk-vue, @zitadel/sdk-angular",
    );
    expect(await readFile(paths.composeEnvPath, "utf8")).toContain(
      "JOURNEY_REGISTRY_PORT=51234",
    );
    expect(await readFile(paths.npmrcPath, "utf8")).toContain(
      "//127.0.0.1:51234/:_authToken=journey-token",
    );
    expect(await readFile(paths.verdaccioConfigPath, "utf8")).toContain("'@zitadel/*'");

    const runCalls = calls.filter((call): call is RunCall => "command" in call);
    expect(runCalls.slice(0, localRegistry.packageDirs.length)).toEqual([
      { command: "moon", args: ["run", "cli:build"], options: { cwd: repoRoot, env } },
      { command: "moon", args: ["run", "api:build"], options: { cwd: repoRoot, env } },
      { command: "moon", args: ["run", "components:build"], options: { cwd: repoRoot, env } },
      { command: "moon", args: ["run", "sdk-core:build"], options: { cwd: repoRoot, env } },
      { command: "moon", args: ["run", "sdk-next:build"], options: { cwd: repoRoot, env } },
      { command: "moon", args: ["run", "sdk-nuxt:build"], options: { cwd: repoRoot, env } },
      { command: "moon", args: ["run", "sdk-react:build"], options: { cwd: repoRoot, env } },
      { command: "moon", args: ["run", "sdk-vue:build"], options: { cwd: repoRoot, env } },
      { command: "moon", args: ["run", "sdk-angular:build"], options: { cwd: repoRoot, env } },
    ]);
    expect(runCalls.filter((call) => call.args.includes("pack"))).toHaveLength(
      localRegistry.packageDirs.length,
    );
    expect(runCalls).toContainEqual({
      command: "node",
      args: ["apps/cli-journey-e2e/scripts/verify-tarballs.mjs", paths.tarballsDir],
      options: { cwd: repoRoot, env },
    });
    expect(runCalls).toContainEqual({
      command: "docker",
      args: [
        "compose",
        "--project-name",
        "zitadel-local-test",
        "--env-file",
        paths.composeEnvPath,
        "-f",
        join(repoRoot, "docker-compose.local.yaml"),
        "up",
        "-d",
        "verdaccio",
      ],
      options: { cwd: repoRoot, env },
    });
    expect(calls).toContainEqual({ type: "started" });
    expect(calls).toContainEqual({
      type: "wait",
      label: "Verdaccio",
      url: "http://127.0.0.1:51234/-/ping",
    });
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

function packageNameForDir(dir: string): string {
  if (dir === "apps/cli") {
    return "@zitadel/cli";
  }
  return `@zitadel/${basename(dir)}`;
}
