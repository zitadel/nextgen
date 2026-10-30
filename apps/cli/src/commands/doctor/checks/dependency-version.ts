import { readFile } from "node:fs/promises";
import { join } from "node:path";

import semver from "semver";

import { addExactCommandFor, detectPackageManager } from "../../../lib/package-manager";
import type { CheckContext, CheckOutcome, SanityCheck } from "./types";

/**
 * Verifies that exactly-pinned `@zitadel/*` dependencies match this CLI's own
 * version. The packages publish as one lockstep train, and the scaffold pins
 * the SDK at the CLI's version — but the CLI floats (`npx @zitadel/cli@latest`)
 * while the app's pin stays put, so a newer CLI can restore files or write
 * guidance that references SDK entry points the older pinned SDK does not
 * ship (e.g. a subpath export added a train later). A mismatch therefore
 * *warns* with the exact remedy instead of leaving the skew to surface as a
 * module-not-found in the app.
 *
 * Only exact semver pins are compared: ranges, dist-tags, and `file:`/
 * `workspace:` specifiers express a deliberate resolution choice the check
 * cannot second-guess.
 *
 * Implements {@link SanityCheck} directly: the abstract base's verify-throws
 * contract can only express pass/fail, and a version skew is advisory — the
 * app keeps working on its pinned train until the user upgrades.
 */
export class DependencyVersionCheck implements SanityCheck {
  readonly name = "dependency-version";
  readonly path = "package.json";

  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const base = { name: this.name, path: this.path };
    if (semver.valid(ctx.cliVersion) === null) {
      // A dev or placeholder CLI version has no train to compare against.
      return {
        ...base,
        status: "pass",
        message: `CLI version ${ctx.cliVersion} is not an exact release; skipping the pin comparison`,
      };
    }
    const exact = await exactZitadelPins(ctx.cwd);
    if (exact === undefined) {
      // A missing or unparsable package.json is the dependency check's
      // failure to report; double-flagging the same root cause helps nobody.
      return { ...base, status: "pass", message: "No package.json to compare pins against" };
    }
    const mismatched = exact.filter(([, version]) => !semver.eq(version, ctx.cliVersion));
    if (mismatched.length > 0) {
      // Repair with the project's own package manager and an exact-save flag:
      // a bare `npm install` would switch managers on a pnpm/yarn/bun project
      // and write a caret range — exactly the float this check ignores.
      const remedy = addExactCommandFor(
        await detectPackageManager(ctx.cwd),
        mismatched.map(([name]) => `${name}@${ctx.cliVersion}`),
      ).display;
      return {
        ...base,
        status: "warn",
        message:
          `${mismatched.map(([name, version]) => `${name}@${version}`).join(", ")} ` +
          `does not match this CLI's version (${ctx.cliVersion}); scaffolded files and ` +
          `guidance target the CLI's train — update with ${remedy}`,
        details: {
          mismatched: mismatched.map(([name, version]) => ({
            name,
            declared: version,
            expected: ctx.cliVersion,
          })),
          remedy_command: remedy,
        },
      };
    }
    return {
      ...base,
      status: "pass",
      message:
        exact.length > 0
          ? `Zitadel package pins match the CLI version (${exact.length} compared)`
          : "No exactly-pinned Zitadel packages to compare",
    };
  }

  /**
   * No auto-fix: repair's dependency op is deliberately additive-only (it
   * never rewrites a version the user declared), so the repair ships as the
   * package-manager-aware install command in `details.remedy_command` — the
   * doctor command surfaces it in the envelope's `next_commands` — with the
   * same command quoted in the warn message for human readers.
   */
  async fix(_ctx: CheckContext): Promise<void> {
    return;
  }
}

/**
 * The `@zitadel/*` dependencies `package.json` pins to an exact version, as
 * `[name, version]`, or undefined without a readable `package.json`. Ranges,
 * dist-tags and `file:`/`workspace:` specifiers are left out: they express a
 * resolution choice, not a train.
 */
export async function exactZitadelPins(cwd: string): Promise<Array<[string, string]> | undefined> {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as typeof pkg;
  } catch {
    return undefined;
  }
  return Object.entries({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) })
    .filter(([name]) => name.startsWith("@zitadel/"))
    .map(([name, version]): [string, string] => [name, version.trim()])
    .filter(([, version]) => semver.valid(version) !== null);
}
