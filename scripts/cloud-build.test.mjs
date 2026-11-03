import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";

const repo = fileURLToPath(new URL("..", import.meta.url));
const roots = [];
const realPnpm = execFileSync("sh", ["-c", "command -v pnpm"], { encoding: "utf8" }).trim();
const realGo = join(execFileSync("go", ["env", "GOROOT"], { encoding: "utf8" }).trim(), "bin/go");
function temporary() {
  const root = mkdtempSync(join(tmpdir(), "nextgen-cloud-build-"));
  roots.push(root);
  return root;
}
function write(root, file, contents, mode) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), contents, { mode });
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = temporary();
  for (const file of [
    "turbo.json",
    "apps/cloud/turbo.json",
    "vercel.json",
    "apps/cloud/build-launcher.sh",
    "apps/cloud/deploy.sh",
  ]) {
    write(root, file, readFileSync(join(repo, file)));
  }
  write(
    root,
    "package.json",
    JSON.stringify({ name: "fixture", private: true, packageManager: "pnpm@12.14.0" }),
  );
  write(root, "pnpm-workspace.yaml", "packages:\n  - apps/*\n  - packages/*\n");
  write(
    root,
    "pnpm-lock.yaml",
    "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n  apps/cloud: {}\n  apps/server: {}\n",
  );
  write(
    root,
    "go.work",
    "go 1.26.0\ntoolchain go1.26.9\nuse (\n ./apps/api\n ./packages/defaults\n)\n",
  );
  write(root, "go.work.sum", "");
  write(
    root,
    "apps/api/go.mod",
    "module example.com/nextgen\ngo 1.26.0\nrequire example.com/defaults v0.0.0\nreplace example.com/defaults => ../../packages/defaults\n",
  );
  write(root, "apps/api/main.go", "package main\n");
  write(root, "packages/defaults/go.mod", "module example.com/defaults\ngo 1.26.0\n");
  write(root, "packages/defaults/defaults.go", "package defaults\n");
  write(
    root,
    "apps/server/package.json",
    JSON.stringify({ name: "@zitadel/server", version: "0.1.0" }),
  );
  const cloud = JSON.parse(readFileSync(join(repo, "apps/cloud/package.json")));
  // Real build/deploy scripts; the fixture records side effects without a database.
  cloud.scripts.migrate = "node record.mjs migrate";
  cloud.scripts.deploy = "node record.mjs deploy && sh deploy.sh";
  write(root, "apps/cloud/package.json", JSON.stringify(cloud));
  write(
    root,
    "apps/cloud/record.mjs",
    'import {appendFileSync} from "node:fs"; appendFileSync("../../calls", process.argv[2]+"\\n");',
  );
  write(root, ".gitignore", "node_modules\n.vercel\n.turbo\ndist\ncalls\ncompiled\n");
  // The real shell script calls this compiler double. It captures its
  // effective target/flags and writes caches and a stand-in function binary.
  write(
    root,
    "bin/go",
    `#!${process.execPath}
const fs = require('node:fs');
if (process.argv[2] !== 'build' && !(process.argv[2] === 'env' && process.argv[3] === 'GOCACHE')) {
  const result = require('node:child_process').spawnSync(${JSON.stringify(realGo)}, process.argv.slice(2), {env: {...process.env, GOTOOLCHAIN: 'local'}, stdio: 'inherit'});
  process.exit(result.status ?? 1);
}
if (process.argv[2] === 'env') { console.log(process.env.GOCACHE); process.exit(0); }
const output = process.argv[process.argv.indexOf('-o') + 1];
fs.writeFileSync(output, JSON.stringify({ args: process.argv.slice(2), target: [process.env.GOOS, process.env.GOARCH, process.env.GOAMD64, process.env.CGO_ENABLED], toolchain: process.env.GOTOOLCHAIN, goenv: process.env.GOENV, commit: process.env.VERCEL_GIT_COMMIT_SHA }));
fs.mkdirSync(process.env.GOCACHE, {recursive: true});
fs.mkdirSync(process.env.GOMODCACHE, {recursive: true});
fs.writeFileSync(process.env.GOCACHE+'/object', 'compiled');
fs.writeFileSync(process.env.GOMODCACHE+'/module', 'dependency');
fs.appendFileSync('../../compiled', 'build\\n');
`,
    0o755,
  );
  // Skip the dependency install; Turbo still uses pnpm to run the real scripts.
  write(
    root,
    "bin/pnpm",
    `#!${process.execPath}
if (process.argv[2] === 'install') process.exit(0);
const result = require('node:child_process').spawnSync(${JSON.stringify(realPnpm)}, process.argv.slice(2), {env: process.env, stdio: 'inherit'});
process.exit(result.status ?? 1);
`,
    0o755,
  );
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
  symlinkSync(join(repo, "node_modules/.bin/turbo"), join(root, "node_modules/.bin/turbo"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

function env(root, overrides = {}) {
  return {
    PATH: `${join(root, "bin")}:${process.env.PATH}`,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    TURBO_TELEMETRY_DISABLED: "1",
    CI: "true",
    VERCEL: "1",
    VERCEL_GIT_COMMIT_REF: "feature",
    VERCEL_GIT_COMMIT_SHA: "first",
    VERCEL_OUTPUT_FILE: join(root, "function"),
    ...overrides,
  };
}
function run(root, overrides = {}) {
  const command = JSON.parse(readFileSync(join(root, "vercel.json"))).services.server.buildCommand;
  return execFileSync("sh", ["-c", command], {
    cwd: join(root, "apps/api"),
    env: env(root, overrides),
    encoding: "utf8",
    stdio: "pipe",
  });
}
function hash(root, overrides = {}) {
  const result = JSON.parse(
    execFileSync(
      join(repo, "node_modules/.bin/turbo"),
      ["run", "deploy", "--filter=@zitadel/cloud", "--dry=json"],
      { cwd: root, env: env(root, overrides), encoding: "utf8", stdio: "pipe" },
    ),
  );
  return result.tasks.find((task) => task.taskId === "@zitadel/cloud#build").hash;
}

test("a fresh checkout restores the launcher, while migration and deployment run every time", () => {
  const first = fixture();
  write(first, ".vercel/cache/golang/obsolete", "old cache");
  write(first, "apps/api/.vercel/cache/golang/pkg/mod/obsolete", "old module");
  write(first, "apps/api/.vercel/cache/golang/go-build/obsolete", "old object");
  write(first, "apps/api/.vercel/cache/golang/bin/go", "preset toolchain");
  run(first);
  expect(existsSync(join(first, ".vercel/cache/golang"))).toBe(false);
  expect(existsSync(join(first, "apps/api/.vercel/cache/golang/pkg/mod"))).toBe(false);
  expect(existsSync(join(first, "apps/api/.vercel/cache/golang/go-build"))).toBe(false);
  expect(readFileSync(join(first, "apps/api/.vercel/cache/golang/bin/go"), "utf8")).toBe(
    "preset toolchain",
  );
  const binary = readFileSync(join(first, "function"), "utf8");
  const compiled = JSON.parse(binary);
  expect(compiled.target).toEqual(["linux", "amd64", "v1", "0"]);
  expect(compiled.toolchain).toBe("go1.26.9");
  expect(compiled.goenv).toBe("off");
  expect(compiled.args).toContain("-buildvcs=false");
  expect(compiled.args).toContain("noconsole");
  expect(readFileSync(join(first, "calls"), "utf8")).toBe("migrate\ndeploy\n");

  const next = fixture();
  cpSync(join(first, ".vercel/cache"), join(next, ".vercel/cache"), { recursive: true });
  expect(
    run(next, { VERCEL_GIT_COMMIT_SHA: "docs-only-commit", TURBO_CACHE: "remote:rw" }),
  ).toContain("cache hit");
  expect(existsSync(join(next, "compiled"))).toBe(false);
  expect(readFileSync(join(next, "function"), "utf8")).toBe(binary);
  expect(readFileSync(join(next, "calls"), "utf8")).toBe("migrate\ndeploy\n");
  expect(readFileSync(join(next, ".vercel/cache/cloud-go/build/object"), "utf8")).toBe("compiled");
  run(next);
  expect(readFileSync(join(next, "calls"), "utf8")).toBe("migrate\ndeploy\nmigrate\ndeploy\n");
  write(next, "apps/api/main.go", "package main\n// changed source\n");
  run(next);
  expect(readFileSync(join(next, "compiled"), "utf8")).toBe("build\n");
});

test("only relevant source, toolchain, compiler options and branch changes invalidate the launcher", () => {
  const root = fixture();
  const original = hash(root);
  for (const overrides of [
    { VERCEL_GIT_COMMIT_REF: "another-branch" },
    { GOFLAGS: "-race" },
    { GOEXPERIMENT: "loopvar" },
  ]) {
    expect(hash(root, overrides)).not.toBe(original);
  }
  expect(
    hash(root, {
      VERCEL_GIT_COMMIT_SHA: "another-commit",
      CLOUD_DATABASE_URL: "new-secret",
      VERCEL_DEPLOYMENT_ID: "new-deployment",
    }),
  ).toBe(original);
  for (const file of [
    "apps/api/README.md",
    "apps/api/other_test.go",
    "apps/api/.vercel/cache/golang/bin/go",
    "apps/cloud/deploy.sh",
    "apps/docs/page.mdx",
  ]) {
    const previous = existsSync(join(root, file)) ? readFileSync(join(root, file)) : undefined;
    write(root, file, "irrelevant change");
    expect(hash(root), file).toBe(original);
    if (previous) write(root, file, previous);
    else rmSync(join(root, file));
  }
  for (const file of [
    "apps/api/main.go",
    "packages/defaults/defaults.go",
    "apps/cloud/build-launcher.sh",
    "go.work",
    "go.work.sum",
    "apps/server/package.json",
  ]) {
    const previous = readFileSync(join(root, file), "utf8");
    const changed =
      file === "go.work"
        ? previous.replace("go1.26.9", "go1.26.8")
        : file.endsWith("package.json")
          ? previous.replace("0.1.0", "0.1.1")
          : `${previous}\n// changed\n`;
    write(root, file, changed);
    expect(hash(root), file).not.toBe(original);
    write(root, file, previous);
  }
});
