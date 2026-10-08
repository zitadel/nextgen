/**
 * Silence Lit's "Lit is in dev mode" notice when the components run under a
 * test runner.
 *
 * Any toolchain that resolves the `development` export condition (Vitest,
 * Storybook, `next dev`) loads Lit's dev build, which prints that notice once
 * per module graph. A test run builds a fresh graph per spec file or page, so
 * the notice repeats hundreds of times in CI and buries real output. Outside a
 * test run it is left alone: a developer running the components in their own
 * dev server still sees it.
 *
 * Lit checks `globalThis.litIssuedWarnings` for a warning code before printing
 * and queues the notice in a microtask as soon as `lit-html` evaluates. A module
 * runner that awaits each import (Vitest's) drains that microtask before the
 * next import starts, so this module has to run before Lit does. It is wired in
 * at the package edges, not per atom:
 *
 * - the public entries (`index.ts`, `atoms/index.ts`, `orchestrator/index.ts`)
 *   import it first, and tsdown builds it as its own file so the dist chunks
 *   import it ahead of their hoisted `import "lit"`;
 * - this package's own specs, which import atoms directly, load it as a Vitest
 *   setup file.
 *
 * Only the `dev-mode` code is silenced; Lit's other dev warnings (e.g.
 * `multiple-versions`, `class-field-shadowing`) point at real bugs and keep
 * printing.
 */

type LitGlobal = typeof globalThis & {
  litIssuedWarnings?: Set<string>;
  process?: { env?: Record<string, string | undefined> };
};

const scope = globalThis as LitGlobal;
const env = scope.process?.env;

/**
 * A test run is a Node test runner (Vitest sets `VITEST` and
 * `NODE_ENV=test`) or a browser under automation (Playwright, which drives
 * the Vitest browser projects, Storybook tests and the e2e suites, sets
 * `navigator.webdriver`). `process` is read off `globalThis` so bundlers
 * leave the lookup alone.
 */
const underTest =
  env?.VITEST !== undefined || env?.NODE_ENV === "test" || scope.navigator?.webdriver === true;

if (underTest) {
  scope.litIssuedWarnings ??= new Set();
  scope.litIssuedWarnings.add("dev-mode");
}
