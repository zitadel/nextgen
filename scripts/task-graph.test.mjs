import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { PUBLIC_RELEASE_PACKAGES, SERVER_PLATFORM_PACKAGES } from "./release-manifest.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const turbo = join(repo, "node_modules/.bin/turbo");
// The tasks CI runs: every `turbo run` list in the root `ci` script.
const gate = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"))
  .scripts.ci.split("&&")
  .flatMap(
    (command) =>
      command
        .trim()
        .match(/^turbo run (.+)$/)?.[1]
        .split(/\s+/) ?? [],
  )
  .filter((word) => !word.startsWith("--"));
let root;
let baseline;

function run(command, args, extraEnv = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      // Keep only system paths: caller runner state and framework variables
      // (including Vitest's NODE_ENV) must not influence the fixture's graph.
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          [
            "PATH",
            "HOME",
            "TMPDIR",
            "TMP",
            "TEMP",
            "SystemRoot",
            "COMSPEC",
            "PATHEXT",
            "USERPROFILE",
            "LOCALAPPDATA",
            "APPDATA",
          ].includes(key),
        ),
      ),
      CI: "",
      GITHUB_ACTIONS: "",
      TURBO_TELEMETRY_DISABLED: "1",
      TURBO_CACHE_DIR: join(root, ".turbo/cache"),
      TURBO_FORCE: "false",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function dry(extraEnv) {
  return new Map(
    JSON.parse(
      run(
        turbo,
        ["run", ...gate, "snapshot", "journey-local", "--dry=json", "--cache=local:rw"],
        extraEnv,
      ),
    ).tasks.map((task) => [task.taskId, task]),
  );
}

function write(file, content) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}

function changed(file, content, check) {
  const path = join(root, file);
  const original = existsSync(path) ? readFileSync(path) : undefined;
  try {
    write(file, content);
    return check();
  } finally {
    if (original === undefined) rmSync(path);
    else writeFileSync(path, original);
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "nextgen-task-graph-"));
  // Use the working copy's real graph, with tiny source fixtures. No installs,
  // application builds, network access, or mutations of the user's checkout.
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8" }).split(
    "\0",
  );
  for (const file of files) {
    if (
      !/(^|\/)(package\.json|turbo\.json|go\.mod|go\.sum)$/.test(file) &&
      ![
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "go.work",
        "go.work.sum",
        ".gitignore",
        ".nvmrc",
        ".npmrc",
        "biome.json",
        "tsconfig.base.json",
      ].includes(file)
    )
      continue;
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(join(repo, file), join(root, file));
  }
  for (const file of [
    "apps/api/internal/build/info.go",
    "apps/api/internal/build/info_test.go",
    "tools/bench/main.go",
    "tools/oidc-mock/main.go",
    "packages/go/api/client.go",
    "packages/go/api/client_test.go",
    "packages/config/defaults/defaults.go",
    "packages/design-tokens/tokens.go",
  ]) {
    write(file, "package main\n");
  }
  write("apps/api/internal/build/testdata/fixture.txt", "test fixture\n");
  for (const file of ["vitest.shared.mjs", "vitest.shared.d.mts"]) {
    write(
      `packages/vitest-config/${file}`,
      readFileSync(join(repo, "packages/vitest-config", file)),
    );
  }
  run("git", ["init", "-q", "-b", "main"]);
  run("git", ["add", "."]);
  run("git", [
    "-c",
    "user.name=Graph test",
    "-c",
    "user.email=graph@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "fixture",
  ]);
  baseline = dry();
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe.sequential("task graph cache and ordering contracts", () => {
  test("CI runs the typecheck-coverage, OpenAPI-rule and go.work checks", () => {
    // The baseline is what the root `ci` script runs: the root lint and test
    // reach them.
    for (const task of ["check-typecheck", "check-openapi-rules", "check-go-work"]) {
      expect(baseline.has(`//#${task}`), task).toBe(true);
      expect(baseline.get(`//#${task}`).command, task).not.toBe("<NONEXISTENT>");
    }
  });

  // Turbo keys a Go module's tasks, and every task that depends on a module's
  // `go-sources`, on `go version` and the effective `go env`. A GOENV file,
  // which no task's `env` lists, stands in for another host's target.
  test("cached Go results key on the target; stamped and stateful ones stay uncached", () => {
    const uncached = new Set([
      "@zitadel/server#build",
      "@zitadel/server#test:postgres",
      // The proof-of-work race run: a probe, never replayed.
      "@zitadel/server#test:pow",
      "//#check-go-work",
    ]);
    const goTasks = [...baseline.values()].filter(
      (task) =>
        /(^|&& )go /.test(task.command) ||
        /check-go-work|go-(format-check|lint|generate)\.mjs/.test(task.command),
    );
    expect(goTasks.length).toBeGreaterThan(15);
    for (const task of goTasks) {
      expect(task.resolvedTaskDefinition.cache, task.taskId).toBe(!uncached.has(task.taskId));
    }
    // The release binaries stamp the release version and the commit.
    for (const { packageName } of SERVER_PLATFORM_PACKAGES) {
      expect(baseline.get(`${packageName}#build-binary`).resolvedTaskDefinition.cache).toBe(false);
    }
    const goenvDir = mkdtempSync(join(tmpdir(), "nextgen-goenv-"));
    try {
      // A target other than the host's, whose default the key already holds.
      writeFileSync(
        join(goenvDir, "go.env"),
        `GOARCH=${process.arch === "arm64" ? "amd64" : "arm64"}\n`,
      );
      const other = dry({ GOENV: join(goenvDir, "go.env") });
      for (const task of goTasks.filter((task) => task.resolvedTaskDefinition.cache)) {
        expect(other.get(task.taskId).hash, task.taskId).not.toBe(task.hash);
      }
    } finally {
      rmSync(goenvDir, { recursive: true, force: true });
    }
  });

  // Generated files are committed: no task writes them during a run, so no
  // task waits for generation. `generate` rewrites them and is never cached;
  // `check-generate` only compares, and caches by its inputs and the Go
  // toolchain.
  test("no task depends on generation that writes committed files", () => {
    const { tasks } = JSON.parse(
      run(turbo, [
        "run",
        "generate",
        "check-generate",
        "--filter=@zitadel/server",
        "--filter=@zitadel/design-tokens",
        "--dry=json",
      ]),
    );
    for (const pkg of ["@zitadel/server", "@zitadel/design-tokens"]) {
      const task = (name) => tasks.find(({ taskId }) => taskId === `${pkg}#${name}`);
      expect(task("generate").resolvedTaskDefinition.cache, `${pkg}#generate`).toBe(false);
      expect(task("check-generate").resolvedTaskDefinition.cache, `${pkg}#check-generate`).toBe(
        true,
      );
    }
    for (const task of baseline.values()) {
      for (const dependency of task.dependencies) {
        expect(dependency, task.taskId).not.toMatch(/^@zitadel\/(server|design-tokens)#generate$/);
      }
    }
  });

  // Turbo's release graph has no second build: pack, snapshot and publish
  // depend on every public package's own build and on each server platform
  // package's binary, and so wait for no test (tools/release/turbo.json).
  test("turbo's release entry points pack the graph's builds and wait for no test", () => {
    for (const entry of ["pack", "snapshot", "publish"]) {
      const { tasks } = JSON.parse(
        run(turbo, ["run", entry, "--filter=@zitadel/release", "--dry=json"]),
      );
      const ids = new Set(tasks.map(({ taskId }) => taskId));
      // A package that ships dist/ is packed after its build; a server
      // platform package after its binary.
      for (const pkg of PUBLIC_RELEASE_PACKAGES) {
        const platform = SERVER_PLATFORM_PACKAGES.some(
          ({ packageName }) => packageName === pkg.name,
        );
        const { files = [] } = JSON.parse(
          readFileSync(join(repo, pkg.dir, "package.json"), "utf8"),
        );
        const build = platform ? "build-binary" : files.includes("dist") ? "build" : undefined;
        if (build)
          expect(ids.has(`${pkg.name}#${build}`), `${entry}: ${pkg.name}#${build}`).toBe(true);
      }
      for (const id of ids) {
        expect(id, entry).not.toMatch(/#(build-release|test|test[-:].+|vet|lint|typecheck)$/);
      }
    }
  });

  test("shared Vitest changes invalidate its readers without invalidating builds", () => {
    changed("packages/vitest-config/vitest.shared.mjs", "export const baseTest = {};\n", () => {
      const next = dry();
      for (const [id, task] of baseline) {
        if (task.task === "build" && task.command !== "<NONEXISTENT>")
          expect(next.get(id).hash, id).toBe(task.hash);
      }
      for (const id of [
        "//#test",
        "@zitadel/console#test",
        "@zitadel/cli#test",
        "@zitadel/sdk-core#test",
        "@zitadel/components#typecheck",
      ]) {
        expect(next.get(id).hash, id).not.toBe(baseline.get(id).hash);
      }
    });
  });

  // The builds that compile the server module: the server binary, the
  // benchmark harness (through its replace directive) and the cloud's
  // launcher.
  const serverBuilds = ["@zitadel/server#build", "bench#build", "@zitadel/cloud#build"];

  test("Go tests and independent modules do not invalidate production binaries", () => {
    for (const file of [
      "apps/api/internal/build/info_test.go",
      "apps/api/internal/build/testdata/fixture.txt",
    ]) {
      changed(file, "// changed test input\n", () => {
        const next = dry();
        for (const task of serverBuilds) {
          expect(next.get(task).hash, task).toBe(baseline.get(task).hash);
        }
        expect(next.get("@zitadel/server#test").hash).not.toBe(
          baseline.get("@zitadel/server#test").hash,
        );
        expect(next.get("@zitadel/e2e#journey-local").hash).toBe(
          baseline.get("@zitadel/e2e#journey-local").hash,
        );
      });
    }
    // The client module's tests are its own: the server compiles only its
    // non-test files, through the replace directive.
    changed("packages/go/api/client_test.go", "package main\n// changed test\n", () => {
      const next = dry();
      for (const task of ["@zitadel/server#check-generate", ...serverBuilds]) {
        expect(next.get(task).hash, task).toBe(baseline.get(task).hash);
      }
      expect(next.get("zitadel/v5#test").hash).not.toBe(baseline.get("zitadel/v5#test").hash);
    });
    changed("tools/oidc-mock/main.go", "package main\n// changed mock\n", () => {
      const next = dry();
      for (const task of serverBuilds) {
        expect(next.get(task).hash, task).toBe(baseline.get(task).hash);
      }
      expect(next.get("oidc-mock#build").hash).not.toBe(baseline.get("oidc-mock#build").hash);
    });
  });

  // Each journey depends on the builds of what it installs, not one pack of
  // every public package (e2e/turbo.json, frameworks.test.mjs).
  test("an SDK change reaches only the journeys that install that SDK", () => {
    changed("packages/sdk-svelte/src/lib/index.ts", "export {};\n", () => {
      const next = dry();
      const changedJourneys = [...next.values()]
        .filter(({ taskId }) => /^@zitadel\/e2e#journey:/.test(taskId))
        .filter(({ taskId, hash }) => hash !== baseline.get(taskId).hash)
        .map(({ taskId }) => taskId);
      expect(changedJourneys).toEqual(["@zitadel/e2e#journey:svelte"]);
    });
  });

  // The cached e2e lanes, the CI journeys and the kit's suite boot what a
  // switch replaces (another server binary, a server setting, a lane's port),
  // so their key holds the switches; the telemetry opt-outs change no result.
  test("a cached lane's key holds the switches that change what it tests", () => {
    const lanes = [...baseline.values()].filter(
      ({ taskId, command, resolvedTaskDefinition }) =>
        resolvedTaskDefinition.cache &&
        // Their input-only bases run nothing.
        command !== "<NONEXISTENT>" &&
        /^@zitadel\/(e2e#((console|demo)-|journey:)|testing#test:integration$)/.test(taskId),
    );
    expect(lanes.length).toBeGreaterThanOrEqual(21);
    const switched = dry({ ZITADEL_SERVER_BINARY: "/elsewhere/nextgen" });
    const optedOut = dry({ ZITADEL_TELEMETRY: "0", ZITADEL_TELEMETRY_ENV: "development" });
    for (const { taskId, hash } of lanes) {
      expect(switched.get(taskId).hash, taskId).not.toBe(hash);
      expect(optedOut.get(taskId).hash, taskId).toBe(hash);
    }
  });

  // A journey's key also holds the runner's own switches (another runtime,
  // image or tarball set), but not the work dir CI sets, so CI's runs and a
  // bare shell's share entries.
  test("a cached journey's key holds the runner's switches, not CI's work dir", () => {
    const journeys = [...baseline.values()].filter(
      ({ taskId, resolvedTaskDefinition }) =>
        resolvedTaskDefinition.cache && taskId.startsWith("@zitadel/e2e#journey:"),
    );
    expect(journeys.length).toBeGreaterThanOrEqual(13);
    const docker = dry({ JOURNEY_RUNTIME: "docker" });
    const ci = dry({
      JOURNEY_WORK_DIR: "/home/runner/work/_temp/ci-journey",
      TESTCONTAINERS_RYUK_DISABLED: "true",
    });
    for (const { taskId, hash } of journeys) {
      expect(docker.get(taskId).hash, taskId).not.toBe(hash);
      expect(ci.get(taskId).hash, taskId).toBe(hash);
    }
  });

  // Two suites read files outside their package that only their inputs can
  // name: frameworks.test.mjs derives each journey's edges from the manifests
  // of what it installs, and this file builds its fixture from every module's
  // go.mod.
  test("the graph's own tests rerun when a manifest or a go.mod they read changes", () => {
    const manifest = "packages/sdk-svelte/package.json";
    const described = {
      ...JSON.parse(readFileSync(join(root, manifest), "utf8")),
      description: "",
    };
    changed(manifest, JSON.stringify(described, null, 2), () => {
      expect(dry().get("@zitadel/e2e#test").hash).not.toBe(baseline.get("@zitadel/e2e#test").hash);
    });
    const module = "tools/bench/go.mod";
    changed(module, `${readFileSync(join(root, module), "utf8")}\n// changed\n`, () => {
      expect(dry().get("//#test").hash).not.toBe(baseline.get("//#test").hash);
    });
  });

  test("a module the server requires reaches its builds through the module graph", () => {
    // No input list names these modules: turbo follows go.work and the
    // server module's requires (`^go-sources`).
    for (const file of [
      "packages/go/api/client.go",
      "packages/config/defaults/defaults.go",
      "packages/design-tokens/tokens.go",
    ]) {
      changed(file, "package main\n// changed module source\n", () => {
        const next = dry();
        for (const task of serverBuilds) {
          expect(next.get(task).hash, `${file}: ${task}`).not.toBe(baseline.get(task).hash);
        }
        expect(next.get("oidc-mock#build").hash, file).toBe(baseline.get("oidc-mock#build").hash);
      });
    }
  });

  test("ignored files a build writes change no task's hash", () => {
    // A fresh checkout, as in CI, has none of them, so the run after a local
    // build would miss the cache and never share CI's entries.
    const generated = {
      // The Workflow routes cloud-functions' build writes, under a
      // `.gitignore` of their own that ignores itself.
      "apps/cloud-functions/app/.well-known/workflow/v1/.gitignore": "*",
      "apps/cloud-functions/app/.well-known/workflow/v1/flow/route.js": "export {};\n",
      "apps/demo-next/next-env.d.ts": '/// <reference types="next" />\n',
      // What the e2e lanes write beside their specs.
      "e2e/console/test-results/smoke/.last-run.json": "{}\n",
      "e2e/console/playwright-report/real/index.html": "<html></html>\n",
      "e2e/demo-next/test-results/mock/.last-run.json": "{}\n",
      "e2e/demo-next/playwright-report/real/index.html": "<html></html>\n",
      "e2e/demo-nuxt/test-results/mock/.last-run.json": "{}\n",
    };
    try {
      for (const [file, content] of Object.entries(generated)) write(file, content);
      const next = dry();
      const rehashed = [...baseline]
        .filter(([id, task]) => task.command !== "<NONEXISTENT>" && next.get(id).hash !== task.hash)
        .map(([id]) => id);
      expect(rehashed).toEqual([]);
    } finally {
      for (const file of Object.keys(generated)) rmSync(join(root, file), { force: true });
    }
  });

  for (const app of ["docs", "website"]) {
    test(`${app} dotenv changes invalidate its build`, () => {
      changed(`apps/${app}/.env.local`, "SAMPLE_RATE=one\n", () => {
        const first = dry().get(`@zitadel/${app}#build`).hash;
        write(`apps/${app}/.env.local`, "SAMPLE_RATE=two\n");
        expect(dry().get(`@zitadel/${app}#build`).hash).not.toBe(first);
      });
    });
  }
});
