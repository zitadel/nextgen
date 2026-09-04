import { CLAIM_WINDOW_DAYS, claimState, type ClaimState } from "../../../lib/claim-state";
import { readProjectServer, readZitadelConfig, readZitadelSecret } from "../../../lib/project";
import type { CheckContext, CheckOutcome, SanityCheck } from "./types";

/**
 * Reports whether the project is attached to a team, reading `claimed_at` and
 * `team_id` from `.zitadel/secret`.
 *
 * Always advisory, never a failure. An unattached project works exactly like an
 * attached one — same issuer, same users, same applications — so the only thing
 * missing is durability, which is the developer's call and not a defect. That
 * matters mechanically too: `doctor` turns any `fail` into a thrown
 * `E_VALIDATION`, so failing here would break every scripted `zitadel doctor`
 * against a project nobody had claimed yet.
 *
 * Implements {@link SanityCheck} directly rather than via the abstract base,
 * for the same reason `ManagedFilesCheck` does: the base's `verify`-throws
 * contract can only express pass/fail, and this check is only ever warn or
 * pass.
 */
export class ClaimCheck implements SanityCheck {
  readonly name = "claim";
  readonly path = ".zitadel/secret";

  async run(ctx: CheckContext): Promise<CheckOutcome> {
    let state: ClaimState;
    try {
      state = claimState({
        secret: await readZitadelSecret(ctx.cwd),
        // From `zitadel.json`, not the command's own source: `doctor` pins its
        // source to the local runtime URL, so asking it where the project lives
        // would report every project as local.
        server: readProjectServer(await readZitadelConfig(ctx.cwd)),
      });
    } catch {
      // A missing or unparseable secret/config is already reported, loudly and
      // with a repair path, by the `secret` and `config` checks. Implementing
      // `SanityCheck` directly means nothing wraps a throw here, so swallowing
      // it is what keeps a broken project reporting its real problem instead of
      // crashing the whole battery on a nudge.
      return {
        name: this.name,
        status: "pass",
        message: "Skipped: could not read the project files that record the owning team",
        path: this.path,
      };
    }

    if (state.kind === "detached") {
      return {
        name: this.name,
        status: "warn",
        message:
          "This project is temporary until you attach it to a team, and claiming is only " +
          `possible within ${CLAIM_WINDOW_DAYS} days of creation. Run \`zitadel claim\` ` +
          "to make it permanent; nothing about the project changes.",
        path: this.path,
      };
    }

    return {
      name: this.name,
      status: "pass",
      message:
        state.kind === "attached"
          ? `Project is attached to team ${state.team_id}`
          : // Local and self-hosted servers have no team to attach to, so the
            // check passes rather than warning about an impossible action.
            "Project is not on a server where teams apply",
      path: this.path,
    };
  }

  /**
   * Deliberately a no-op. `doctor --fix` calls `fix` on every non-passing
   * check, but claiming requires a human to sign in through a browser, so there
   * is nothing safe to automate here.
   */
  async fix(_ctx: CheckContext): Promise<void> {
    return;
  }
}
