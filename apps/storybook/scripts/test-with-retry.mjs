// Runs the Storybook Vitest browser suite, retrying the whole run on failure.
//
// `@storybook/addon-vitest` renders every story in real Chromium through
// `@vitest/browser`. On a loaded CI runner the browser intermittently fails to
// fetch the addon's setup module from Vitest's Vite server at startup —
//
//   TypeError: Failed to fetch dynamically imported module:
//     http://localhost:<port>/.../@storybook/addon-vitest/.../
//     setup-file-with-project-annotations.js
//
// — which aborts collection, so all story files report "0 test" and the task
// fails as a block. It is a harness/startup race, not a story regression: the
// same commit passes on the next run, and the suite passes locally. Because the
// failure happens at import/collection time, Vitest's per-test `retry` can't
// catch it, so we retry the whole run here instead. A genuine story failure
// reproduces on every attempt and still fails the task.
//
// Attempts are bounded; set STORYBOOK_TEST_ATTEMPTS to override (default 3).
import { spawnSync } from "node:child_process";

const attempts = Number(process.env.STORYBOOK_TEST_ATTEMPTS ?? "3");
const runArgs = ["run", "--project=storybook", ...process.argv.slice(2)];

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const result = spawnSync("vitest", runArgs, { stdio: "inherit" });

  if (result.status === 0) {
    process.exit(0);
  }

  // A signal (e.g. SIGINT) is the operator interrupting — don't swallow it.
  if (result.signal) {
    process.exit(1);
  }

  if (attempt < attempts) {
    console.warn(
      `\nstorybook:test attempt ${attempt}/${attempts} failed (exit ${result.status}); retrying…\n`,
    );
  } else {
    process.exit(result.status ?? 1);
  }
}
