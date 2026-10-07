import { describe, expect, it } from "vitest";

import { checkProject, checkWorkspace, startsPackageManager } from "./check-package-scripts.mjs";

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
    "node --run build",
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
  ])("does not flag %s", (body) => {
    expect(startsPackageManager(body)).toBe(false);
  });

  it("rejects a task whose same-named script is missing", () => {
    expect(checkProject("apps/x", {}, { build: { command: "corepack pnpm run build" } })).toEqual([
      'apps/x: task "build" runs a script "build" that does not exist',
    ]);
  });
});
