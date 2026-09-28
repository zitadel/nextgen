/**
 * Regression tests for the vacuous-typecheck classifier, run by the
 * `workspace:check-typecheck` task before the audit itself (node:test, no
 * dependencies). The classifier must judge every `&&` segment on its own —
 * a whole-command `--build` short-circuit once let a plain solution-style
 * segment hide behind a build segment.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { vacuousTscTargets } from "./check-typecheck-programs.mjs";

/** Treats exactly `tsconfig.json` as solution-style, everything else as real. */
const solutionIsDefault = (target) => target === "tsconfig.json";

test("plain tsc against a solution-style config is vacuous", () => {
  assert.deepEqual(vacuousTscTargets("tsc --noEmit -p tsconfig.json", solutionIsDefault), [
    "tsconfig.json",
  ]);
});

test("bare tsc loads ./tsconfig.json by default", () => {
  assert.deepEqual(vacuousTscTargets("tsc --noEmit", solutionIsDefault), ["tsconfig.json"]);
});

test("build mode walks references and is never vacuous", () => {
  assert.deepEqual(vacuousTscTargets("tsc --build tsconfig.json", solutionIsDefault), []);
  assert.deepEqual(vacuousTscTargets("tsc -b tsconfig.json", solutionIsDefault), []);
});

test("a plain solution-style segment cannot hide behind a build segment", () => {
  assert.deepEqual(
    vacuousTscTargets("tsc --build tsconfig.lib.json && tsc --noEmit -p tsconfig.json", solutionIsDefault),
    ["tsconfig.json"],
  );
});

test("plain tsc against real configs passes, in and out of chains", () => {
  assert.deepEqual(vacuousTscTargets("tsc --noEmit -p tsconfig.app.json", solutionIsDefault), []);
  assert.deepEqual(
    vacuousTscTargets(
      "tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.spec.json",
      solutionIsDefault,
    ),
    [],
  );
});

test("non-tsc segments and tool-owned programs are not tsc programs", () => {
  assert.deepEqual(
    vacuousTscTargets("corepack pnpm --filter @zitadel/api run generate && tsc --noEmit -p tsconfig.app.json", solutionIsDefault),
    [],
  );
  assert.deepEqual(vacuousTscTargets("svelte-check --tsconfig ./tsconfig.json", solutionIsDefault), []);
  assert.deepEqual(
    vacuousTscTargets("nuxt prepare && vue-tsc --noEmit -p .nuxt-typecheck/tsconfig.json", solutionIsDefault),
    [],
  );
});

test("every vacuous segment of a chain is reported", () => {
  assert.deepEqual(
    vacuousTscTargets("tsc --noEmit -p tsconfig.json && tsc --noEmit", solutionIsDefault),
    ["tsconfig.json", "tsconfig.json"],
  );
});
