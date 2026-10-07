import { describe, expect, it } from "vitest";

import {
  checkProject,
  checkWorkspace,
  projectIds,
  startsPackageManager,
  unsupportedSyntax,
} from "./check-package-scripts.mjs";

describe("package-script contract", () => {
  it("holds for every workspace package", () => {
    expect(checkWorkspace()).toEqual([]);
  });

  it("accepts a script run by its same-named moon task", () => {
    expect(
      checkProject("apps/x", { test: "vitest run" }, { test: { command: "corepack pnpm run test" } }),
    ).toEqual([]);
  });

  it("rejects a script that starts pnpm", () => {
    expect(
      checkProject(
        "apps/x",
        { "test-all": "pnpm run test" },
        { "test-all": { command: "corepack pnpm run test-all" } },
      ),
    ).toEqual(['apps/x: script "test-all" starts a package manager: pnpm run test']);
  });

  it("rejects a pre/post hook", () => {
    const problems = checkProject(
      "apps/x",
      { build: "tsdown", prebuild: "node sync.mjs" },
      {
        build: { command: "corepack pnpm run build" },
        prebuild: { command: "corepack pnpm run prebuild" },
      },
    );
    expect(problems).toContain('apps/x: script "prebuild" is a pre/post hook; order work with moon deps');
  });

  it("rejects a script without a task, and a task inlining its command", () => {
    expect(
      checkProject("apps/x", { lint: "oxlint ." }, { build: { command: "corepack pnpm exec tsdown" } }),
    ).toEqual([
      'apps/x: script "lint" has no moon task of the same name',
      'apps/x: task "build" must run `corepack pnpm run build`, not: corepack pnpm exec tsdown',
    ]);
  });

  it("rejects a script name moon cannot use as a task id", () => {
    expect(
      checkProject("apps/x", { "dev:real": "tsx dev.ts" }, { "dev:real": { command: "x" } }),
    ).toContain('apps/x: script "dev:real" must be kebab-case (moon task ids cannot contain ":")');
  });

  it("does not treat preview as a hook without a view script", () => {
    expect(
      checkProject("apps/x", { preview: "vite preview" }, { preview: { command: "corepack pnpm run preview" } }),
    ).toEqual([]);
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
    "node --run build",
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
    "echo \"$(echo $(pnpm test))\"",
    "sh -c 'pnpm run test'",
    'bash -c "npm run build"',
    "sh -lc 'pnpm run test'",
    "bash -ec 'pnpm install'",
    "node --run=build",
    "node --no-warnings --run build",
    "node --require ./setup.cjs --run build",
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
    "node.exe --run build",
    '"C:\\tools\\PNPM.EXE" install',
    "pnpm>out.log test",
    "vitest run && pnpm>>out.log install",
  ])("detects a package manager in %s", (body) => {
    expect(startsPackageManager(body)).toBe(true);
  });

  it.each([
    "vitest run",
    "tsc --noEmit && tsc --noEmit -p tsconfig.spec.json",
    "node scripts/doctor.mjs",
    'node -e "console.log(\'use pnpm\')"',
    "echo 'run npm install yourself'",
    "NEXTGEN_NUXT_BUILD_DIR=.nuxt nuxt prepare && vue-tsc --noEmit",
    "env CI=1 vitest run",
    "env -u CI node scripts/run-local.mjs",
    "echo '$(pnpm run test)'",
    'echo "\\$(pnpm run test)"',
    "echo \"$(node scripts/version.mjs)\"",
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
  ])("does not flag %s", (body) => {
    expect(startsPackageManager(body)).toBe(false);
  });

  it("rejects a task whose same-named script is missing", () => {
    expect(checkProject("apps/x", {}, { build: { command: "corepack pnpm run build" } })).toEqual([
      'apps/x: task "build" runs a script "build" that does not exist',
    ]);
  });

  it("names projects with forward slashes on every platform", () => {
    const ids = projectIds();
    expect(ids).toContain("apps/cli");
    expect(ids).not.toContain("apps/server");
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
    ["timeout 30s pnpm run test", "the command wrapper `timeout`"],
    ["timeout 5 vitest run", "the command wrapper `timeout`"],
    ["xargs -n1 pnpm add < deps.txt", "the command wrapper `xargs`"],
    ["nice -n 10 npm run build", "the command wrapper `nice`"],
    ["cmd /c pnpm run test", "the Windows shell `cmd`"],
    ['powershell -Command "pnpm run test"', "the Windows shell `powershell`"],
    ["pwsh -c 'pnpm run test'", "the Windows shell `pwsh`"],
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
    "echo 'a>b' && vitest run",
  ])("allows plain commands like %s", (body) => {
    expect(unsupportedSyntax(body)).toBeNull();
  });

  it("reports unsupported syntax as a contract violation", () => {
    expect(
      checkProject("apps/x", { test: "eval 'vitest run'" }, { test: { command: "corepack pnpm run test" } }),
    ).toEqual(['apps/x: script "test" uses `eval`; keep scripts to plain commands']);
  });
});
