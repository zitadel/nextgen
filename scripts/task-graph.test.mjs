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
import { parse, stringify } from "yaml";

const repo = fileURLToPath(new URL("..", import.meta.url));
const turbo = join(repo, "node_modules/.bin/turbo");
const moon = join(repo, "node_modules/.bin/moon");
const gate = [
  "lint",
  "typecheck",
  "build",
  "test",
  "check-typecheck",
  "check-openapi-rules",
  "check-adrs",
  "check-moon-graph",
];
let root;
let baseline;
let moonProjects;

function run(command, args) {
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
      MOON_FORCE: "false",
      MOON_BASE: "HEAD",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function dry() {
  return new Map(
    JSON.parse(
      run(turbo, ["run", ...gate, "snapshot", "journey-local", "--dry=json", "--cache=local:rw"]),
    ).tasks.map((task) => [task.taskId, task]),
  );
}

function moonAffected() {
  const { tasks } = JSON.parse(run(moon, ["query", "tasks", "--affected", "--downstream", "deep"]));
  return new Set(
    Object.entries(tasks).flatMap(([project, tasks]) =>
      Object.keys(tasks).map((task) => `${project}:${task}`),
    ),
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

function reaches(edges, from, target, seen = new Set()) {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (edges.get(from) ?? []).some((next) => reaches(edges, next, target, seen));
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
      !/(^|\/)(package\.json|turbo\.json|moon\.yml)$/.test(file) &&
      !/^\.moon\/.*\.yml$/.test(file) &&
      ![
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
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
  const workspace = parse(readFileSync(join(root, ".moon/workspace.yml"), "utf8"));
  delete workspace.remote;
  write(".moon/workspace.yml", stringify(workspace));
  for (const file of [
    "internal/build/info.go",
    "internal/build/info_test.go",
    "tools/bench/main.go",
    "tools/oidc-mock/main.go",
  ]) {
    write(file, "package main\n");
  }
  write("internal/build/testdata/fixture.txt", "test fixture\n");
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
  moonProjects = new Map(
    JSON.parse(run(moon, ["query", "projects"])).projects.map((project) => [project.id, project]),
  );
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe.sequential("task graph cache and ordering contracts", () => {
  test("both CI gates run the typecheck-coverage and OpenAPI-rule checks", () => {
    const ci = parse(readFileSync(join(repo, ".github/workflows/ci-turbo.yml"), "utf8"));
    const tasks = ci.jobs["gate-turbo"].env.GATE_TASKS.split(" ");
    const moonCI = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");
    for (const task of ["check-typecheck", "check-openapi-rules"]) {
      expect(tasks).toContain(task);
      expect(moonCI).toContain(`:${task}`);
      expect(baseline.get(`//#${task}`).command).not.toBe("<NONEXISTENT>");
    }
  });

  test("native Go results and Git-stamped binaries cannot restore another host or revision", () => {
    for (const project of ["server", "bench", "oidc-mock"]) {
      for (const task of ["build", "test", "vet", "format"]) {
        expect(baseline.get(`@zitadel/${project}#${task}`).resolvedTaskDefinition.cache).toBe(
          false,
        );
        expect(moonProjects.get(project).tasks[task].options.cache).toBe(false);
      }
    }
    // Generation depends on neither: go.mod pins its toolchain.
    const generation = ["generate", "check-generate", "check-generate-pruned"];
    const { tasks } = JSON.parse(
      run(turbo, ["run", ...generation, "--filter=@zitadel/server", "--dry=json"]),
    );
    for (const task of generation) {
      const turboTask = tasks.find(({ taskId }) => taskId === `@zitadel/server#${task}`);
      expect(turboTask.resolvedTaskDefinition.cache, task).toBe(true);
      expect(moonProjects.get("server").tasks[task].options.cache, task).toBe(true);
    }
  });

  test("release writes wait for the Go readers in both runners", () => {
    const edges = new Map([...baseline].map(([id, task]) => [id, task.dependencies]));
    for (const id of edges.keys()) {
      if (id.endsWith("#build-release")) {
        expect(reaches(edges, id, "@zitadel/server#test"), id).toBe(true);
      }
    }
    for (const entry of ["pack", "snapshot", "publish"]) {
      const graph = JSON.parse(run(moon, ["action-graph", `release:${entry}`, "--json"]));
      const ids = new Map(
        Object.entries(graph.data)
          .filter(([, node]) => node.action === "run-task")
          .map(([id, node]) => [Number(id), node.params.target]),
      );
      const waitsFor = new Map([...ids.values()].map((id) => [id, []]));
      for (const [from, to] of graph.graph.edges) {
        if (ids.has(from) && ids.has(to)) waitsFor.get(ids.get(from)).push(ids.get(to));
      }
      // Every Go task on the root module resolves the console's embed.
      const goReaders = [...waitsFor.keys()].filter((id) =>
        /^server:(?!openapi$|format$)/.test(id),
      );
      expect(goReaders.length > 0, entry).toBe(entry === "snapshot");
      for (const id of waitsFor.keys()) {
        if (id.endsWith(":build-release")) {
          for (const reader of goReaders) {
            expect(reaches(waitsFor, id, reader), `${entry}: ${id} -> ${reader}`).toBe(true);
          }
        }
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
      const affected = moonAffected();
      expect([...affected].filter((task) => task.endsWith(":build"))).toEqual([]);
      expect(affected.has("console:test")).toBe(true);
      expect(affected.has("components:typecheck")).toBe(true);
    });
    for (const project of moonProjects.values()) {
      const inputs = project.tasks.build?.inputFiles ?? {};
      expect(
        Object.keys(inputs).some((file) => file.startsWith("packages/vitest-config/")),
        project.id,
      ).toBe(false);
    }
  });

  test("Go tests and independent modules do not invalidate production binaries", () => {
    for (const file of ["internal/build/info_test.go", "internal/build/testdata/fixture.txt"]) {
      changed(file, "// changed test input\n", () => {
        const next = dry();
        for (const project of ["server", "bench", "cloud"]) {
          expect(next.get(`@zitadel/${project}#build`).hash).toBe(
            baseline.get(`@zitadel/${project}#build`).hash,
          );
        }
        expect(next.get("@zitadel/server#test").hash).not.toBe(
          baseline.get("@zitadel/server#test").hash,
        );
        expect(next.get("@zitadel/e2e#journey-local").hash).toBe(
          baseline.get("@zitadel/e2e#journey-local").hash,
        );
        const affected = moonAffected();
        expect(affected.has("server:build")).toBe(false);
        expect(affected.has("bench:build")).toBe(false);
        expect(affected.has("server:test")).toBe(true);
      });
    }
    changed("tools/oidc-mock/main.go", "package main\n// changed mock\n", () => {
      const next = dry();
      for (const project of ["server", "bench", "cloud"]) {
        expect(next.get(`@zitadel/${project}#build`).hash).toBe(
          baseline.get(`@zitadel/${project}#build`).hash,
        );
      }
      expect(next.get("@zitadel/oidc-mock#build").hash).not.toBe(
        baseline.get("@zitadel/oidc-mock#build").hash,
      );
      const affected = moonAffected();
      expect(affected.has("server:build")).toBe(false);
      expect(affected.has("bench:build")).toBe(false);
      expect(affected.has("oidc-mock:build")).toBe(true);
    });
  });

  for (const app of ["docs", "website"]) {
    test(`${app} dotenv changes invalidate Turbo and Moon builds`, () => {
      changed(`apps/${app}/.env.local`, "SAMPLE_RATE=one\n", () => {
        const first = dry().get(`@zitadel/${app}#build`).hash;
        write(`apps/${app}/.env.local`, "SAMPLE_RATE=two\n");
        expect(dry().get(`@zitadel/${app}#build`).hash).not.toBe(first);
      });
      // Execute the real Moon input configuration with a tiny stand-in for
      // Next.js: it reads the ignored file and emits one build artifact.
      const path = `apps/${app}/moon.yml`;
      const config = parse(readFileSync(join(root, path), "utf8"));
      Object.assign(config.tasks.build, {
        command: "node ../../scripts/read-env.mjs",
        deps: [],
        outputs: [".next/probe.txt"],
        options: { ...config.tasks.build.options, mergeArgs: "replace" },
      });
      write(
        "scripts/read-env.mjs",
        'import fs from "node:fs";fs.mkdirSync(".next",{recursive:true});fs.writeFileSync(".next/probe.txt",fs.readFileSync(".env.local"));',
      );
      changed(path, stringify(config), () => {
        changed(`apps/${app}/.env.local`, "one", () => {
          run(moon, ["run", `${app}:build`]);
          write(`apps/${app}/.env.local`, "two");
          run(moon, ["run", `${app}:build`]);
          expect(readFileSync(join(root, `apps/${app}/.next/probe.txt`), "utf8")).toBe("two");
        });
      });
      rmSync(join(root, "scripts/read-env.mjs"));
    });
  }
});
