/**
 * Lints the OpenAPI spec the way `redocly lint --format=github-actions` does,
 * through the library the Redocly CLI is built on: the repo's redocly.yaml and
 * .redocly.lint-ignore.yaml apply, mistakes in redocly.yaml itself are warned
 * about, problems print as GitHub annotations, and any spec error fails the run,
 * as does an ignore entry that no longer suppresses a problem.
 */
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatProblems, getTotals, lint, lintConfig, loadConfig } from "@redocly/openapi-core";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const spec = resolve(repoRoot, "apps/api/api/openapi/openapi-spec.yaml");

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

// Each .redocly.lint-ignore.yaml entry is a named exception; one that no
// longer suppresses a problem was fixed, and is deleted so the file shrinks
// with the spec. Redocly itself never reports an unused entry.
const suppressed = new Set(
  problems
    .filter((p) => p.ignored)
    .map((p) => `${p.location[0].source.absoluteRef}\0${p.ruleId}\0${p.location[0].pointer}`),
);
let stale = 0;
for (const [file, rules] of Object.entries(config.ignore ?? {})) {
  for (const [ruleId, pointers] of Object.entries(rules)) {
    for (const pointer of pointers) {
      if (suppressed.has(`${file}\0${ruleId}\0${pointer}`)) continue;
      stale++;
      const where = `${relative(repoRoot, file)} ${ruleId} ${pointer}`;
      console.log(
        `::error file=.redocly.lint-ignore.yaml,title=Stale ignore entry::${where} suppresses no problem; delete the entry`,
      );
    }
  }
}
if (stale > 0) {
  console.log(`.redocly.lint-ignore.yaml: ${stale} entry(ies) suppress no problem`);
  process.exitCode = 1;
}
