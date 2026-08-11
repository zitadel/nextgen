import { readFile } from "node:fs/promises";
import { join } from "node:path";

import semver from "semver";

import type { CheckContext, CheckOutcome, SanityCheck } from "./types";

/**
 * Verifies that exactly-pinned `@zitadel/*` dependencies match this CLI's own
 * version. The packages publish as one lockstep train, and the scaffold pins
 * the SDK at the CLI's version — but the CLI floats (`npx @zitadel/cli@alpha`)
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
    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
      pkg = JSON.parse(await readFile(join(ctx.cwd, "package.json"), "utf8")) as typeof pkg;
    } catch {
      // A missing or unparsable package.json is the dependency check's
      // failure to report; double-flagging the same root cause helps nobody.
      return { ...base, status: "pass", message: "no package.json to compare pins against" };
    }
    const declared = Object.entries({
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    }).filter(([name]) => name.startsWith("@zitadel/"));
    const exact = declared.filter(([, version]) => semver.valid(version.trim()) !== null);
    const mismatched = exact.filter(
      ([, version]) => !semver.eq(version.trim(), ctx.cliVersion),
    );
    if (mismatched.length > 0) {
      const remedy = mismatched.map(([name]) => `${name}@${ctx.cliVersion}`).join(" ");
      return {
        ...base,
        status: "warn",
        message:
          `${mismatched.map(([name, version]) => `${name}@${version}`).join(", ")} ` +
          `does not match this CLI's version (${ctx.cliVersion}); scaffolded files and ` +
          `guidance target the CLI's train — update with e.g. \`npm install ${remedy}\``,
        details: {
          mismatched: mismatched.map(([name, version]) => ({
            name,
            declared: version,
            expected: ctx.cliVersion,
          })),
        },
      };
    }
    return {
      ...base,
      status: "pass",
      message:
        exact.length > 0
          ? `Zitadel package pins match the CLI version (${exact.length} compared)`
          : "no exactly-pinned Zitadel packages to compare",
    };
  }

  /**
   * No auto-fix: repair's dependency op is deliberately additive-only (it
   * never rewrites a version the user declared), so the warn message carries
   * the exact install command instead.
   */
  async fix(_ctx: CheckContext): Promise<void> {
    return;
  }
}
