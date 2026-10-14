import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, test } from "vitest";

import {
  localRegistryPaths,
  localRegistryPort,
  npmEnvironment,
  packageDirs,
  prepareLocalRegistry,
} from "./local-registry.mjs";

const tempDirs = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("prepares local package tarballs and publishes them to Verdaccio", async () => {
  const repoRoot = await fixtureRepo();
  const workDir = await mkdtemp(join(tmpdir(), "zitadel-local-registry-"));
  tempDirs.push(workDir);
  const paths = localRegistryPaths(workDir);
  const calls = [];
  const logs = [];
  const env = { PATH: "/bin" };
  const registry = { exitCode: null, logFile: paths.registryLogPath };

  const result = await prepareLocalRegistry({
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

  assert.ok(
    logs.includes(
      "building release npm tarballs for @zitadel/cli, @zitadel/server, @zitadel/server-linux-x64, @zitadel/server-linux-arm64, @zitadel/server-darwin-x64, @zitadel/server-darwin-arm64, @zitadel/server-win32-x64, @zitadel/api, @zitadel/config, @zitadel/components, @zitadel/sdk-core, @zitadel/sdk-next, @zitadel/sdk-nuxt, @zitadel/sdk-react, @zitadel/sdk-vue, @zitadel/sdk-angular, @zitadel/sdk-solid, @zitadel/sdk-svelte, @zitadel/sdk-qwik, @zitadel/testing",
    ),
    logs.join("\n"),
  );
  assert.ok(
    (await readFile(paths.npmrcPath, "utf8")).includes(
      "//127.0.0.1:51234/:_authToken=journey-token",
    ),
  );
  const verdaccioConfig = await readFile(paths.verdaccioConfigPath, "utf8");
  assert.ok(verdaccioConfig.includes("'@zitadel/*'"));
  assert.ok(verdaccioConfig.includes(paths.storagePath));
  assert.ok(verdaccioConfig.includes("max_body_size: 200mb"));

  const runCalls = calls.filter((call) => "command" in call);
  assert.deepEqual(runCalls[0], {
    command: "moon",
    args: ["run", "release:pack"],
    options: { cwd: repoRoot, env },
  });
  // The registry carries exactly the release tarball set, verified strictly.
  assert.deepEqual(
    runCalls.find((call) => call.args[0] === "e2e/journey/scripts/verify-tarballs.mjs"),
    {
      command: "node",
      args: ["e2e/journey/scripts/verify-tarballs.mjs", paths.tarballsDir],
      options: { cwd: repoRoot, env },
    },
  );
  assert.deepEqual(
    calls.find((call) => call.type === "start-registry"),
    { type: "start-registry", port: 51_234 },
  );
  assert.ok(calls.some((call) => call.type === "started"));
  assert.deepEqual(
    calls.find((call) => call.type === "wait"),
    { type: "wait", label: "Verdaccio", url: "http://127.0.0.1:51234/-/ping" },
  );
  assert.equal(result.registry, registry);
  const publish = runCalls.at(-1);
  assert.equal(publish.command, "node");
  assert.deepEqual(publish.args, ["e2e/journey/scripts/publish-tarballs.mjs", paths.tarballsDir]);
  assert.equal(publish.options.cwd, repoRoot);
  assert.equal(publish.options.env.JOURNEY_REGISTRY_URL, "http://127.0.0.1:51234");
  assert.equal(publish.options.env.NPM_CONFIG_USERCONFIG, paths.npmrcPath);
  assert.equal(publish.options.env.PATH, "/bin");
  assert.equal(result.env.NPM_CONFIG_USERCONFIG, paths.npmrcPath);
  assert.equal(result.env.PATH, "/bin");
  assert.equal(result.env.npm_config_registry, "http://127.0.0.1:51234");
});

test("scrubs inherited npm config before pointing installs at the local registry", () => {
  assert.deepEqual(
    npmEnvironment(
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
    {
      NPM_CONFIG_USERCONFIG: "/tmp/verdaccio.npmrc",
      PATH: "/bin",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_registry: "http://127.0.0.1:51234",
      npm_config_yes: "true",
    },
  );
});

test("uses prebuilt tarballs without rebuilding release packages", async () => {
  const repoRoot = await fixtureRepo();
  const workDir = await mkdtemp(join(tmpdir(), "zitadel-local-registry-"));
  const prebuiltTarballsDir = await mkdtemp(join(tmpdir(), "zitadel-prebuilt-tarballs-"));
  tempDirs.push(workDir, prebuiltTarballsDir);
  const paths = localRegistryPaths(workDir);
  const calls = [];
  const logs = [];
  const env = { PATH: "/bin" };
  const registry = { exitCode: null, logFile: paths.registryLogPath };
  await fixtureTarballs(prebuiltTarballsDir);

  await prepareLocalRegistry({
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

  assert.ok(
    logs.includes(`using prebuilt release npm tarballs from ${prebuiltTarballsDir}`),
    logs.join("\n"),
  );
  const runCalls = calls.filter((call) => "command" in call);
  assert.ok(
    !runCalls.some((call) => call.command === "moon" && call.args.join(" ") === "run release:pack"),
  );
  // Prebuilt release tarballs already carry the full public set (including
  // @zitadel/testing), so no build runs — verification comes first.
  assert.deepEqual(runCalls[0], {
    command: "node",
    args: ["e2e/journey/scripts/verify-tarballs.mjs", paths.tarballsDir],
    options: { cwd: repoRoot, env },
  });
  assert.equal(
    await readFile(join(paths.tarballsDir, "zitadel-cli-0.1.0-alpha.5.tgz"), "utf8"),
    "@zitadel/cli\n",
  );
});

test("validates explicit local registry ports and derives stable defaults", () => {
  assert.equal(localRegistryPort("/repo", { ZITADEL_CLI_LOCAL_REGISTRY_PORT: "51234" }), 51_234);
  assert.throws(
    () => localRegistryPort("/repo", { ZITADEL_CLI_LOCAL_REGISTRY_PORT: "nope" }),
    /ZITADEL_CLI_LOCAL_REGISTRY_PORT must be a TCP port/,
  );

  const port = localRegistryPort("/repo", {});
  assert.ok(port >= 54_873 && port <= 64_872, `port ${port} outside the derived range`);
  assert.equal(localRegistryPort("/repo", {}), port);
});

async function fixtureRepo() {
  const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-local-registry-repo-"));
  tempDirs.push(repoRoot);

  for (const dir of packageDirs) {
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

async function fixtureReleaseTarballs(repoRoot) {
  const outDir = join(repoRoot, "dist", "release", "0.1.0-alpha.5", "npm");
  await fixtureTarballs(outDir);
}

async function fixtureTarballs(outDir) {
  await mkdir(outDir, { recursive: true });
  for (const dir of packageDirs) {
    const name = packageNameForDir(dir);
    const fileName = `${name.replace("@", "").replace("/", "-")}-0.1.0-alpha.5.tgz`;
    await writeFile(join(outDir, fileName), `${name}\n`);
  }
}

function packageNameForDir(dir) {
  if (dir === "apps/cli") {
    return "@zitadel/cli";
  }
  return `@zitadel/${basename(dir)}`;
}
