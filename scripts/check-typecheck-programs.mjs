/**
 * Guards every project's `typecheck` task against the vacuous-program trap.
 *
 * A solution-style tsconfig (`"files": []` + `"references"`, no `include`)
 * describes no inputs of its own, and NON-BUILD `tsc --noEmit` ignores
 * project references entirely — so `tsc --noEmit -p <solution.json>` checks
 * an empty program and exits green no matter what the code says. Eleven
 * package typechecks shipped that way before 2026-08-02 (probe-verified:
 * a file with a hard type error passed). Build mode (`tsc --build`) is the
 * form that actually walks the references.
 *
 * This check re-derives the audit statically: for every moon `typecheck`
 * task it resolves the command (inlined or via the package's `typecheck`
 * script), finds the tsconfig the command loads, and fails when a
 * solution-style config is checked without `--build`. Tools that own their
 * own program discovery (`vue-tsc` behind `nuxt prepare`, `svelte-check`)
 * pass, as do commands pointed at real configs with `include`/`files`.
 *
 * KNOWN_VACUOUS lists the projects still carrying the trap on purpose —
 * their real programs do not compile yet (latent errors plus the
 * `@zitadel/source`-condition/module-settings mismatch described in the
 * follow-up issue). Shrink this list; never grow it.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Projects whose typecheck is known-vacuous, pending the follow-up fix. */
const KNOWN_VACUOUS = new Set(["apps/cli", "packages/sdk-core"]);

function stripJsonComments(text) {
  return text.replace(/^\s*\/\/.*$/gm, "");
}

function readJson(path) {
  return JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
}

function projectDirs() {
  const dirs = [];
  for (const root of ["apps", "packages"]) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(root, entry.name, "moon.yml"))) {
        dirs.push(join(root, entry.name));
      }
    }
  }
  return dirs;
}

/** The command moon's `typecheck` task runs, with `pnpm run typecheck` resolved. */
function typecheckCommand(dir) {
  const moon = readFileSync(join(dir, "moon.yml"), "utf8");
  const match = moon.match(/^ {2}typecheck:\n(?: {4}.*\n)*/m);
  if (!match) return null;
  const command = match[0].match(/^ {4}command: "([^"]+)"/m)?.[1];
  if (!command) return null;
  if (!/pnpm run typecheck/.test(command)) return command;
  const pkg = readJson(join(dir, "package.json"));
  return pkg.scripts?.typecheck ?? null;
}

function isSolutionStyle(configPath) {
  if (!existsSync(configPath)) return false;
  const config = readJson(configPath);
  const noInputs =
    Array.isArray(config.files) &&
    config.files.length === 0 &&
    (config.include === undefined || config.include.length === 0);
  return noInputs && Array.isArray(config.references) && config.references.length > 0;
}

/**
 * The solution-style tsconfig targets a command's PLAIN (non-build) tsc
 * segments would load. Classified per `&&` segment: build-mode segments walk
 * references and are fine, but a plain segment beside them is dead weight
 * that reads as coverage, so it is still flagged — a whole-command `--build`
 * short-circuit once let `tsc --build a && tsc --noEmit -p solution.json`
 * pass. Tools that own their program discovery (vue-tsc behind
 * `nuxt prepare`, svelte-check) are not `tsc -p` programs.
 *
 * `isSolutionStyleTarget` is injected so the regression test can classify
 * commands without touching the filesystem.
 */
export function vacuousTscTargets(command, isSolutionStyleTarget) {
  if (/vue-tsc|svelte-check/.test(command)) return [];
  const targets = [];
  for (const segment of command.split("&&").map((part) => part.trim())) {
    if (!/(^|\s)tsc(\s|$)/.test(segment)) continue;
    if (/--build\b|(^|\s)-b\b/.test(segment)) continue;
    const target = segment.match(/-p\s+(\S+)/)?.[1] ?? "tsconfig.json";
    if (isSolutionStyleTarget(target)) targets.push(target);
  }
  return targets;
}

function main() {
  const failures = [];
  const staleAllowlist = [];

  for (const dir of projectDirs()) {
    const command = typecheckCommand(dir);
    if (!command) continue;

    const vacuousTargets = vacuousTscTargets(command, (target) =>
      isSolutionStyle(join(dir, target)),
    );
    if (vacuousTargets.length === 0) {
      if (KNOWN_VACUOUS.has(dir)) staleAllowlist.push(dir);
      continue;
    }
    if (KNOWN_VACUOUS.has(dir)) continue;
    failures.push(
      `${dir}: typecheck runs "${command}", and its tsc segment targeting solution-style ` +
        `${vacuousTargets.join(", ")} checks nothing — non-build tsc ignores references. ` +
        `Use "tsc --build tsconfig.json" for that segment.`,
    );
  }

  if (staleAllowlist.length > 0) {
    failures.push(
      `KNOWN_VACUOUS is stale — these projects now check a real program; remove them from the ` +
        `allowlist in scripts/check-typecheck-programs.mjs: ${staleAllowlist.join(", ")}`,
    );
  }

  if (failures.length > 0) {
    console.error("Vacuous typecheck programs detected:\n");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(
    "All typecheck tasks target real programs (allowlisted: %s).",
    [...KNOWN_VACUOUS].join(", ") || "none",
  );
}

// Importable for the regression test; audits only when invoked directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
