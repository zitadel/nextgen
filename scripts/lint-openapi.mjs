/**
 * Lints the OpenAPI spec the way `redocly lint --format=github-actions` does,
 * through the library the Redocly CLI is built on: the repo's redocly.yaml and
 * .redocly.lint-ignore.yaml apply, mistakes in redocly.yaml itself are warned
 * about, problems print as GitHub annotations, and any spec error fails the run.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatProblems, getTotals, lint, lintConfig, loadConfig } from "@redocly/openapi-core";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const spec = resolve(repoRoot, "api/openapi/openapi-spec.yaml");

const config = await loadConfig({ configPath: resolve(repoRoot, "redocly.yaml") });

// A typo in redocly.yaml (an unknown rule, a misspelled key) would otherwise
// switch a check off silently. Warnings only, as the CLI reports them.
const configProblems = await lintConfig({ config, severity: "warn" });
formatProblems(configProblems, { format: "github-actions", totals: getTotals(configProblems) });

const problems = await lint({ ref: spec, config });
const totals = getTotals(problems);
formatProblems(problems, { format: "github-actions", totals });

console.log(
  `${spec}: ${totals.errors} error(s), ${totals.warnings} warning(s), ${totals.ignored} ignored`,
);
if (totals.errors > 0) process.exitCode = 1;
