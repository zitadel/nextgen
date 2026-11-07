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
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";

const repo = fileURLToPath(new URL("..", import.meta.url));
const roots = [];
const realPnpm = (process.env.PATH ?? "")
  .split(delimiter)
  .map((directory) => join(directory, "pnpm"))
  .find(existsSync);
function write(root, file, contents, mode) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), contents, { mode });
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nextgen-cloud-build-"));
  roots.push(root);
  for (const file of [
    "turbo.json",
    "apps/cloud/turbo.json",
    "vercel.json",
    "apps/cloud/build-launcher.sh",
    "apps/cloud/deploy.sh",
    "apps/cloud/install-go.sh",
    "apps/api/internal/build/info.go",
  ]) {
    write(root, file, readFileSync(join(repo, file)));
  }
  const { packageManager, scripts } = JSON.parse(readFileSync(join(repo, "package.json")));
  write(
    root,
    "package.json",
    JSON.stringify({
      name: "@zitadel/source",
      private: true,
      packageManager,
      scripts: { "install:cloud": scripts["install:cloud"] },
    }),
  );
  write(root, "pnpm-workspace.yaml", "packages:\n  - apps/*\n");
  write(
    root,
    "pnpm-lock.yaml",
    "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n  apps/cloud: {}\n  apps/server: {}\n",
  );
  const workspace = readFileSync(join(repo, "go.work"), "utf8");
  const version = workspace.match(/^go (.+)$/m)[1];
  write(
    root,
    "go.work",
    `go ${version}\n${workspace.match(/^toolchain .+$/m)[0]}\nuse ./apps/api\n`,
  );
  write(root, "go.work.sum", "");
  write(root, "apps/api/go.mod", `module github.com/zitadel/nextgen\ngo ${version}\n`);
  // A real executable and the real build metadata package, without a database.
  write(
    root,
    "apps/api/cmd/cloud-launcher/main.go",
    `package main
import ("fmt"; "os"; "time"; "github.com/zitadel/nextgen/internal/build")
var buildRef string
func main() {
  if len(os.Args) > 1 && os.Args[1] == "migrate" {
    f, err := os.OpenFile("calls", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
    if err != nil { panic(err) }; defer f.Close()
    fmt.Fprintln(f, "migrate"); return
  }
  fmt.Printf("%s\\n%s\\n%s\\n%s\\n", build.Version(), build.Commit(), build.Date().Format(time.RFC3339), buildRef)
}
`,
  );
  write(
    root,
    "apps/server/package.json",
    JSON.stringify({ name: "@zitadel/server", version: "0.1.0" }),
  );
  const cloud = JSON.parse(readFileSync(join(repo, "apps/cloud/package.json")));
  cloud.scripts.deploy = "echo deploy >> ../../calls && sh deploy.sh";
  write(root, "apps/cloud/package.json", JSON.stringify(cloud));
  write(root, ".gitignore", "node_modules\n.vercel\n.turbo\ndist\ncalls\n");
  // Skip installation in the fixture; use real pnpm, Turbo and Go for the build.
  write(
    root,
    "bin/pnpm",
    `#!${process.execPath}
if (process.argv[2] === 'install') process.exit(0);
const [command, ...prefix] = ${JSON.stringify(realPnpm ? [realPnpm] : ["corepack", "pnpm"])};
const result = require('node:child_process').spawnSync(command, [...prefix, ...process.argv.slice(2)], {env: process.env, stdio: 'inherit'});
process.exit(result.status ?? 1);
`,
    0o755,
  );
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
  symlinkSync(join(repo, "node_modules/.bin/turbo"), join(root, "node_modules/.bin/turbo"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

function run(root, overrides = {}) {
  let target;
  try {
    target = execFileSync("go", ["env", "GOOS", "GOARCH"], {
      encoding: "utf8",
      env: { ...process.env, GOTOOLCHAIN: "local" },
    });
  } catch (cause) {
    throw new Error("cloud-build.test.mjs requires Go on PATH; see CONTRIBUTING.md for setup.", {
      cause,
    });
  }
  const [goos, goarch] = target.trim().split("\n");
  const command = JSON.parse(readFileSync(join(root, "vercel.json"))).services.server.buildCommand;
  return execFileSync("sh", ["-c", command], {
    cwd: join(root, "apps/cloud"),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => ["HOME", "TMPDIR"].includes(key)),
      ),
      PATH: `${join(root, "bin")}${delimiter}${process.env.PATH ?? ""}`,
      TURBO_TELEMETRY_DISABLED: "1",
      CI: "true",
      VERCEL: "1",
      VERCEL_GIT_COMMIT_REF: "feature",
      VERCEL_GIT_COMMIT_SHA: "first",
      GOOS: goos,
      GOARCH: goarch,
      GOFLAGS: "-x",
      GOPROXY: "off",
      GOSUMDB: "off",
      GOTOOLCHAIN: "local",
      ...overrides,
    },
    stdio: "pipe",
  });
}
function metadata(root) {
  return execFileSync(join(root, "apps/cloud/dist/nextgen-launcher"), [], { encoding: "utf8" })
    .trim()
    .split("\n");
}

test("restored Go caches skip compilation, refresh metadata and still migrate and deploy", async () => {
  const first = fixture();
  write(first, ".vercel/cache/golang/obsolete", "old cache");
  write(first, "apps/api/.vercel/cache/golang/pkg/mod/obsolete", "old module");
  write(first, "apps/api/.vercel/cache/golang/go-build/obsolete", "old object");
  write(first, "apps/api/.vercel/cache/golang/bin/go", "preset toolchain");
  expect(run(first)).toMatch(/\/compile /);
  expect(metadata(first).slice(0, 2)).toEqual(["0.1.0+cloud", "first"]);
  expect(existsSync(join(first, ".vercel/cache/golang"))).toBe(false);
  expect(existsSync(join(first, "apps/api/.vercel/cache/golang/pkg/mod"))).toBe(false);
  expect(existsSync(join(first, "apps/api/.vercel/cache/golang/go-build"))).toBe(false);
  expect(readFileSync(join(first, "apps/api/.vercel/cache/golang/bin/go"), "utf8")).toBe(
    "preset toolchain",
  );
  expect(readFileSync(join(first, "calls"), "utf8")).toBe("migrate\ndeploy\n");

  await new Promise((resolve) => setTimeout(resolve, 1100));
  const next = fixture();
  cpSync(join(first, ".vercel/cache"), join(next, ".vercel/cache"), { recursive: true });
  const downloaded = ".vercel/cache/cloud-go/modules/cache/download/example.com/module/@v/v1.0.0";
  write(next, `${downloaded}.zip`, "redundant archive");
  write(next, `${downloaded}.ziphash`, "preserved checksum");
  const extracted = ".vercel/cache/cloud-go/modules/example.com/module@v1.0.0/module.go";
  write(next, extracted, "old extracted module");
  const log = run(next, { VERCEL_GIT_COMMIT_SHA: "docs-only-commit" });
  expect(log).not.toMatch(/\/compile /);
  expect(log).toMatch(/\/link /);
  expect(metadata(next).slice(0, 2)).toEqual(["0.1.0+cloud", "docs-only-commit"]);
  expect(Date.parse(metadata(next)[2])).toBeGreaterThan(Date.parse(metadata(first)[2]));
  expect(metadata(next)[3]).toBe("feature");
  expect(existsSync(join(next, `${downloaded}.zip`))).toBe(false);
  expect(existsSync(join(next, extracted))).toBe(true);
  expect(readFileSync(join(next, `${downloaded}.ziphash`), "utf8")).toBe("preserved checksum");
  expect(readFileSync(join(next, "calls"), "utf8")).toBe("migrate\ndeploy\n");
  // Identical Turbo inputs still execute both side effects on the next run.
  run(next);
  expect(readFileSync(join(next, "calls"), "utf8")).toBe("migrate\ndeploy\nmigrate\ndeploy\n");
  // A source edit really recompiles; keeping caches must not hide it.
  write(next, "apps/api/internal/build/extra.go", "package build\nconst changed = true\n");
  expect(run(next)).toMatch(/\/compile /);
  expect(readFileSync(join(next, "calls"), "utf8")).toBe(
    "migrate\ndeploy\nmigrate\ndeploy\nmigrate\ndeploy\n",
  );
  // A changed workspace dependency set drops obsolete modules, keeping compiled packages.
  write(next, "apps/other/go.mod", "module example.com/other\ngo 1.26.0\n");
  write(next, "go.work", `${readFileSync(join(next, "go.work"), "utf8")}use ./apps/other\n`);
  expect(run(next)).not.toMatch(/\/compile /);
  expect(existsSync(join(next, extracted))).toBe(false);
  expect(existsSync(join(next, `${downloaded}.ziphash`))).toBe(false);
}, 120_000);
