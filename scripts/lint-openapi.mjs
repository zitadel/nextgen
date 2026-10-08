/**
 * Lints the OpenAPI spec the way `redocly lint --format=github-actions` does,
 * through the library the Redocly CLI is built on: the repo's redocly.yaml and
 * .redocly.lint-ignore.yaml apply, problems print as GitHub annotations, and
 * any error fails the run.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatProblems, getTotals, lint, loadConfig } from "@redocly/openapi-core";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const spec = resolve(repoRoot, "api/openapi/openapi-spec.yaml");

const config = await loadConfig({ configPath: resolve(repoRoot, "redocly.yaml") });
const problems = await lint({ ref: spec, config });
const totals = getTotals(problems);
formatProblems(problems, { format: "github-actions", totals });

console.log(
  `${spec}: ${totals.errors} error(s), ${totals.warnings} warning(s), ${totals.ignored} ignored`,
);
if (totals.errors > 0) process.exitCode = 1;
