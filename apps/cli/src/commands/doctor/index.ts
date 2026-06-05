import { Flags } from "@oclif/core";
import consola from "consola";

import { BaseCommand, type JsonEnvelope } from "../../lib/oclif";
import { ZitadelError } from "../../lib/errors";
import { createOrca } from "../../lib/orca";
import { SANITY_CHECKS, type CheckContext } from "./checks";

/**
 * `zitadel doctor` — verify generated files and local state.
 *
 * Runs every registered {@link SANITY_CHECKS} entry and emits the aggregate
 * result; if any check fails it throws `E_VALIDATION` carrying the full check
 * details. With `--fix`, each failing check first attempts its own repair (a
 * no-op for checks with no safe automatic remedy), then the battery re-runs.
 *
 * The `--fix` loop is best-effort: a repair that throws (e.g. a missing
 * prerequisite file the check itself would also flag) is logged at debug
 * level and skipped, not propagated — the post-fix re-verify still reports
 * whatever remains broken.
 */
export default class Doctor extends BaseCommand {
  static override description = "Verify generated files and local state.";
  static override flags = {
    fix: Flags.boolean({ description: "Re-apply missing managed files." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Doctor);
    await this.toMeta(flags);
    const { cwd, dryRun } = this.meta;
    const ctx: CheckContext = { cwd, orca: createOrca(), cliVersion: this.meta.cliVersion, dryRun };

    if (flags.fix) {
      const before = await Promise.all(SANITY_CHECKS.map((check) => check.run(ctx)));
      for (const [index, check] of SANITY_CHECKS.entries()) {
        if (before[index]?.status !== "fail") {
          continue;
        }
        try {
          await check.fix(ctx);
        } catch (error) {
          consola.debug(`doctor --fix: ${check.name} repair failed`, error);
        }
      }
    }

    const checks = await Promise.all(SANITY_CHECKS.map((check) => check.run(ctx)));
    const failed = checks.filter((check) => check.status === "fail");
    const data = {
      title: failed.length === 0 ? "Zitadel doctor passed." : "Zitadel doctor found issues.",
      ok: failed.length === 0,
      checks,
    };

    if (failed.length > 0) {
      throw new ZitadelError("E_VALIDATION", "Zitadel doctor found issues", {
        hint: "Run `npx @zitadel/cli@latest doctor --fix` to re-apply missing managed files.",
        details: data,
      });
    }

    return this.emit({ status: "ok", data });
  }
}
