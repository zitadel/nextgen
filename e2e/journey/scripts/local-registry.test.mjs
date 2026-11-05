import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, test } from "vitest";

// @boundaries-ignore root scripts/ belongs to the workspace root, which no package can depend on
import { APP_RELEASE_PACKAGES } from "../../../scripts/release-manifest.mjs";
import {
  localRegistryPaths,
  localRegistryPort,
  npmEnvironment,
  packageDirs,
  prepareLocalRegistry,
  startLocalRegistry,
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
      "building release npm tarballs for @zitadel/cli, @zitadel/server, @zitadel/server-linux-x64, @zitadel/server-linux-arm64, @zitadel/server-darwin-x64, @zitadel/server-darwin-arm64, @zitadel/server-win32-x64, @zitadel/api, @zitadel/config, @zitadel/components, @zitadel/sdk-core, @zitadel/sdk-next, @zitadel/sdk-nuxt, @zitadel/sdk-react, @zitadel/sdk-vue, @zitadel/sdk-angular, @zitadel/sdk-solid, @zitadel/sdk-svelte, @zitadel/sdk-qwik, @zitadel/sdk-sveltekit, @zitadel/sdk-solid-start, @zitadel/sdk-qwik-router, @zitadel/sdk-tanstack-start, @zitadel/testing",
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

test("builds and packs only what a generated app installs for the app package set", async () => {
  const repoRoot = await fixtureRepo();
  for (const pkg of APP_RELEASE_PACKAGES) {
    await mkdir(join(repoRoot, pkg.dir, "dist"), { recursive: true });
  }
  const workDir = await mkdtemp(join(tmpdir(), "zitadel-local-registry-"));
  tempDirs.push(workDir);
  const paths = localRegistryPaths(workDir);
  const env = { PATH: "/bin" };
  const runCalls = [];
  const packs = [];

  await prepareLocalRegistry({
    env,
    packageSet: "app",
    paths,
    registryPort: 51_234,
    registryUrl: "http://127.0.0.1:51234",
    repoRoot,
    run: async (command, args, options) => {
      runCalls.push({ command, args, options });
    },
    runCapture: async (command, args, options) => {
      packs.push({ command, args, options });
      return { stdout: "", stderr: "" };
    },
    startLocalRegistry: async () => ({ exitCode: null, logFile: paths.registryLogPath }),
    waitForHttp: async () => undefined,
    workDir,
  });

  // The packages' cached dev builds; no release:pack, no server binaries.
  assert.deepEqual(runCalls[0], {
    command: "moon",
    args: ["run", ...APP_RELEASE_PACKAGES.map((pkg) => `${pkg.moonProject}:build`)],
    options: { cwd: repoRoot, env },
  });
  assert.ok(!runCalls.some((call) => call.args.includes("release:pack")));
  assert.deepEqual(
    packs.map((call) => call.args[2]).sort(),
    APP_RELEASE_PACKAGES.map((pkg) => pkg.dir).sort(),
  );
  for (const call of packs) {
    assert.equal(call.command, "corepack");
    assert.deepEqual(call.args.slice(3), ["pack", "--pack-destination", paths.tarballsDir]);
    assert.equal(call.options.env, env);
  }
  assert.deepEqual(
    runCalls.find((call) => call.args[0] === "e2e/journey/scripts/verify-tarballs.mjs").args,
    ["e2e/journey/scripts/verify-tarballs.mjs", paths.tarballsDir, "--app-packages"],
  );
});

test("keeps a reused store's proxied packages and trusts their metadata for an hour", async () => {
  const repoRoot = await fixtureRepo();
  const workDir = await mkdtemp(join(tmpdir(), "zitadel-local-registry-"));
  const prebuiltTarballsDir = await mkdtemp(join(tmpdir(), "zitadel-prebuilt-tarballs-"));
  tempDirs.push(workDir, prebuiltTarballsDir);
  await fixtureTarballs(prebuiltTarballsDir);
  const paths = localRegistryPaths(workDir);
  // A store restored from CI's cache: a package an earlier run proxied from
  // npmjs, and the @zitadel packages it published.
  await mkdir(join(paths.storagePath, "next"), { recursive: true });
  await writeFile(join(paths.storagePath, "next", "package.json"), "{}\n");
  await mkdir(join(paths.storagePath, "@zitadel", "cli"), { recursive: true });
  await writeFile(join(paths.storagePath, "@zitadel", "cli", "package.json"), "{}\n");

  await prepareLocalRegistry({
    env: { PATH: "/bin" },
    paths,
    prebuiltTarballsDir,
    registryPort: 51_234,
    registryUrl: "http://127.0.0.1:51234",
    repoRoot,
    resetStorage: false,
    run: async () => undefined,
    startLocalRegistry: async () => ({ exitCode: null, logFile: paths.registryLogPath }),
    waitForHttp: async () => undefined,
    workDir,
  });

  assert.equal(await readFile(join(paths.storagePath, "next", "package.json"), "utf8"), "{}\n");
  await assert.rejects(stat(join(paths.storagePath, "@zitadel")), { code: "ENOENT" });
  // With Verdaccio's default maxage (2m), every restored packument would go
  // back to npmjs before it is served.
  const verdaccioConfig = await readFile(paths.verdaccioConfigPath, "utf8");
  assert.ok(
    verdaccioConfig.includes("  npmjs:\n    url: https://registry.npmjs.org/\n    maxage: 1h\n"),
    verdaccioConfig,
  );
});

test("refuses to start Verdaccio on a port something already serves", async () => {
  const server = createServer((_request, response) => response.end("{}"));
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const workDir = await mkdtemp(join(tmpdir(), "zitadel-local-registry-"));
  tempDirs.push(workDir);
  try {
    const { port } = server.address();
    await assert.rejects(
      startLocalRegistry({
        env: {},
        paths: localRegistryPaths(workDir),
        registryPort: port,
        repoRoot: workDir,
      }),
      new RegExp(`127\\.0\\.0\\.1:${port} is already in use`),
    );
    // Refused before anything was started or logged.
    await assert.rejects(stat(localRegistryPaths(workDir).registryLogPath), { code: "ENOENT" });
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
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
