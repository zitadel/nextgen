import { describe, expect, it } from "vitest";

import {
  checkProject,
  checkWorkspace,
  leavesPackage,
  projectIds,
  startsPackageManager,
  unsupportedSyntax,
} from "./check-package-scripts.mjs";

describe("package-script contract", () => {
  it("holds for every workspace package", () => {
    expect(checkWorkspace()).toEqual([]);
  });

  it("accepts a package chaining its own scripts", () => {
    expect(
      checkProject("apps/x", {
        prebuild: "node --run sync",
        build: "tsdown",
        sync: "node scripts/sync.mjs",
        "test:all": "node --run sync && vitest run",
        lint: "node --run build && biome check .",
      }),
    ).toEqual([]);
  });

  it("rejects a script that starts pnpm", () => {
    expect(checkProject("apps/x", { "test:all": "pnpm run test" })).toEqual([
      'apps/x: script "test:all" starts a package manager or moon: pnpm run test',
    ]);
  });

  it("rejects a script that starts moon", () => {
    expect(checkProject(".", { docs: "moon run docs:dev" })).toEqual([
      '.: script "docs" starts a package manager or moon: moon run docs:dev',
    ]);
  });

  it("rejects a script that does another package's work", () => {
    expect(
      checkProject("apps/x", {
        "build:vercel": "cd ../../packages/api && node --run build && cd - && tsdown",
      }),
    ).toEqual([
      'apps/x: script "build:vercel" changes into another directory; order other packages\' work with moon deps',
    ]);
  });

  it.each([
    "pnpm test",
    "pnpm --silent run test",
    "pnpm install",
    "pnpm dlx tool",
    "corepack pnpm run build",
    "npm run build",
    "npx vitest",
    "tsdown && pnpm run test",
    "CI=1 pnpm test",
    "env CI=1 pnpm run test",
    "env -u CI pnpm run test",
    "env -u CI -u VERCEL -- pnpm install",
    'echo "$(pnpm run test)"',
    "echo $(pnpm test)",
    "echo `pnpm test`",
    'echo "`npm run build`"',
    '"pnpm" run test',
    "'pnpm' run test",
    "if true; then pnpm run test; fi",
    "env -S 'pnpm run test'",
    "vitest run\npnpm run test",
    "/usr/local/bin/pnpm run test",
    "{ pnpm run test; }",
    `echo "version='$(pnpm test)'"`,
    'echo "$(echo $(pnpm test))"',
    "sh -c 'pnpm run test'",
    'bash -c "npm run build"',
    "sh -lc 'pnpm run test'",
    "bash -ec 'pnpm install'",
    "/usr/bin/env pnpm run test",
    "/usr/bin/env CI=1 npm run build",
    "2>/dev/null pnpm run test",
    "> out.log pnpm run test",
    "vitest run 2> err.log && pnpm test",
    "2>&1 pnpm run test",
    "2>&1 corepack pnpm run test",
    "&> out.log pnpm install",
    "exec -- pnpm run build",
    "command -- pnpm run build",
    "nohup -- npm start",
    "time -p pnpm test",
    "command -p pnpm test",
    "exec -a name -- pnpm run build",
    "pnpm.cmd run build",
    "npm.cmd run build",
    '"C:\\tools\\PNPM.EXE" install',
    "pnpm>out.log test",
    "vitest run && pnpm>>out.log install",
    "pnpm&>out.log run test",
    "pnpm&>>out.log run test",
    "command time -f %E pnpm run test",
    "time -o timing.txt pnpm install",
    "time --format=%E pnpm test",
    "pnpx tsdown",
    "bunx vitest",
    "bun run test",
    "moon run api:build",
    "env -P /usr/bin pnpm test",
    "node node_modules/pnpm/bin/pnpm.cjs run test",
    'node "C:\\tools\\node_modules\\npm\\bin\\npm-cli.js" run build',
    "node --import tsx node_modules/@moonrepo/cli/moon.js run api:build",
    'node "$npm_execpath" install',
    "node $npm_execpath run build",
  ])("detects a package manager in %s", (body) => {
    expect(startsPackageManager(body)).toBe(true);
  });

  it.each([
    "vitest run",
    "tsc --noEmit && tsc --noEmit -p tsconfig.spec.json",
    "node scripts/doctor.mjs",
    "node -e \"console.log('use pnpm')\"",
    "echo 'run npm install yourself'",
    "NEXTGEN_NUXT_BUILD_DIR=.nuxt nuxt prepare && vue-tsc --noEmit",
    "env CI=1 vitest run",
    "env -u CI node scripts/run-local.mjs",
    "echo '$(pnpm run test)'",
    'echo "\\$(pnpm run test)"',
    'echo "$(node scripts/version.mjs)"',
    'echo "pnpm run test"',
    "if true; then vitest run; fi",
    "env -S 'vitest run'",
    "vitest run\ntsc --noEmit",
    "echo '\"$(pnpm test)\"'",
    "sh -c 'vitest run'",
    "bash scripts/run.sh",
    "node tools/build.mjs --run build",
    "node --no-warnings tools/build.mjs",
    "sh -lc 'vitest run'",
    "/usr/bin/env node scripts/doctor.mjs",
    "node scripts/pnpm-audit.mjs",
    "env -P /usr/bin vitest run",
    "node --run build",
    "node --run=build",
    "node --no-warnings --run build",
    "node --require ./setup.cjs --run build",
    "node.exe --run build",
    "node --run sync-schemas && vitest run",
  ])("does not flag %s", (body) => {
    expect(startsPackageManager(body)).toBe(false);
  });

  it("names projects with forward slashes on every platform", () => {
    const ids = projectIds();
    expect(ids).toContain("apps/cli");
    expect(ids).toContain(".");
    expect(ids.filter((id) => id.includes("\\"))).toEqual([]);
  });

  it.each([
    [`echo "$(printf '%s' ')'; pnpm test)"`, "command substitution"],
    ["echo `date`", "command substitution"],
    ["eval 'pnpm run test'", "`eval`"],
    ["source ./env.sh && vitest run", "`source`"],
    [". ./env.sh && vitest run", "`.`"],
    ["sh -c 'vitest run'", "an inline `sh -c` script"],
    ["bash -lc 'pnpm test'", "an inline `bash -c` script"],
    ['PM=pnpm; "$PM" run test', "a variable in the command position"],
    ["$TOOL run build", "a variable in the command position"],
    ["trap 'pnpm run test' EXIT", "`trap`"],
    ["coproc pnpm run test", "`coproc`"],
    ["timeout 30s pnpm run test", "the command wrapper `timeout`"],
    ["timeout 5 vitest run", "the command wrapper `timeout`"],
    ["xargs -n1 pnpm add < deps.txt", "the command wrapper `xargs`"],
    ["nice -n 10 npm run build", "the command wrapper `nice`"],
    ["cmd /c pnpm run test", "the Windows shell `cmd`"],
    ['powershell -Command "pnpm run test"', "the Windows shell `powershell`"],
    ["pwsh -c 'pnpm run test'", "the Windows shell `pwsh`"],
    ["fish -c 'pnpm run test'", "an inline `fish -c` script"],
    ["ksh -c 'npm run build'", "an inline `ksh -c` script"],
    ["tcsh -c 'pnpm test'", "an inline `tcsh -c` script"],
    ["busybox sh -c 'pnpm run test'", "the command wrapper `busybox`"],
    ["cross-env CI=1 vitest run", "the command wrapper `cross-env`"],
    ["dotenv -- pnpm run test", "the command wrapper `dotenv`"],
    ["run-s build test", "the command wrapper `run-s`"],
    ["npm-run-all build test", "the command wrapper `npm-run-all`"],
    ['concurrently "vite" "tsc --watch"', "the command wrapper `concurrently`"],
    ["builtin eval 'pnpm i'", "`eval`"],
    ["builtin source ./x.sh", "`source`"],
    ["devbox run -- pnpm install", "the command wrapper `devbox`"],
    ["proto run pnpm", "the command wrapper `proto`"],
  ])("rejects unsupported syntax in %s", (body, reason) => {
    expect(unsupportedSyntax(body)).toBe(reason);
  });

  it.each([
    "vitest run",
    "echo '$(not run)' && vitest run",
    "tsx --conditions=@zitadel/source scripts/dev-real.mts",
    "vitest run > out.log 2>&1",
    "bash scripts/run.sh",
    "vitest run --reporter=$REPORTER",
    "echo 'costs $5' && vitest run",
    "2>&1 vitest run",
    "exec -- vitest run",
    "command -- tsc --noEmit",
    "time -p vitest run",
    "command -p tsc --noEmit",
    "node.exe scripts/doctor.mjs",
    "vitest run>out.log",
    "vitest run&>out.log",
    "tsc --noEmit &>> tsc.log",
    "command time -f %E vitest run",
    "echo 'a>b' && vitest run",
    "vitest run --testNamePattern 'npm run build'",
    "playwright test --grep 'pnpm install'",
  ])("allows plain commands like %s", (body) => {
    expect(unsupportedSyntax(body)).toBeNull();
  });

  it("reports unsupported syntax as a contract violation", () => {
    expect(checkProject("apps/x", { test: "eval 'vitest run'" })).toEqual([
      'apps/x: script "test" uses `eval`; keep scripts to plain commands',
    ]);
  });

  it.each([
    "cd ../api && node --run build",
    "cd .. && vitest run",
    "cd ../../packages/config && tsdown",
    "cd /tmp && vitest run",
    "cd ~/src && vitest run",
    "cd $DIR && vitest run",
    "cd",
    "cd -P ../api && tsdown",
    "cd scripts/../../api && tsdown",
    "pushd ../api && tsdown",
    "tsdown && (cd ../api && tsdown)",
    "env -C ../api tsdown",
    "env --chdir=../api tsdown",
    "env CI=1 -C /tmp vitest run",
    "env -u FOO -C ../api tsdown",
    "env -P /usr/bin -C ../api tsdown",
    "env -C../api tsdown",
    "builtin cd ../api && tsdown",
    "CDPATH=../../packages cd api && tsdown",
    "pushd -n ../api && tsdown",
    'cd "C:\\work\\api" && tsdown',
  ])("detects leaving the package in %s", (body) => {
    expect(leavesPackage(body)).toBe(true);
  });

  it.each([
    "vitest run",
    "cd scripts && node build.mjs",
    "cd src/generated && tsc",
    "tsc -p ../../tsconfig.base.json",
    "env -C dist node server.mjs",
    "echo 'cd ../api'",
    "vitest run --dir ../shared",
  ])("allows staying in the package in %s", (body) => {
    expect(leavesPackage(body)).toBe(false);
  });
});
