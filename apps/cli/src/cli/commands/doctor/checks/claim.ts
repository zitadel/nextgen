import { Claim, type ClaimState } from "@/lib/claim";
import { isCancellation } from "@/lib/errors";
import { ZitadelRuntime } from "@/lib/server";

import type { CheckContext, CheckOutcome, SanityCheck } from "./types";
import { Project, type ProjectSecret } from "@/lib/project";

/**
 * What a project on a local or self-hosted server is told: it has no team to
 * attach to, so the check passes rather than warning about an impossible action.
 */
const NO_TEAMS_MESSAGE = "Project is not on a server where teams apply";

/**
 * Reports whether the project is attached to a team, reading `claimed_at` and
 * `team_id` from `.zitadel/secret`, and checking a record that says unclaimed
 * with the server ({@link Claim.confirmed}).
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

  /**
   * Reads the claim state and reports it as a pass or a warning.
   *
   * Unreadable project files skip the check rather than crash the battery on a
   * nudge ({@link ClaimCheck.read}). A team the server confirmed but the record
   * does not name warns with `details.recorded: false`, which `--fix` repairs
   * by writing it down. The window
   * classification travels in `details` so the doctor envelope's advisory can
   * switch to the same reconciliation wording; the claim command itself stays
   * suggested either way, since the local record may be stale and the server
   * answers authoritatively.
   *
   * @param ctx - The directory and suggestions the check runs with.
   * @returns The outcome of the check.
   */
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const read = await ClaimCheck.read(ctx);
    if (read === undefined) {
      return {
        name: this.name,
        status: "pass",
        message: "Skipped: could not read the project files that record the owning team",
        path: this.path,
      };
    }
    const { state } = read;

    if (state.kind === "attached" && state.recorded === false) {
      return {
        name: this.name,
        status: "warn",
        message: `Project is attached to team ${state.team_id}, but .zitadel/secret does not record it`,
        details: { recorded: false },
        path: this.path,
      };
    }

    if (state.kind === "detached") {
      const claim = ctx.suggest({ id: "claim" });
      const message = state.claimable
        ? `Claim your project within ${Claim.WINDOW_DAYS} days of creation to make it ` +
          "permanent and start collaborating with your team. Until then, your project " +
          `is temporary and its data may be lost. Run ${claim}.`
        : `The local record says this project's ${Claim.WINDOW_DAYS}-day claim window has ` +
          `closed. Run ${claim} to reconcile: a project claimed from another ` +
          "machine confirms its team, and one never claimed can no longer be claimed. " +
          `${ctx.suggest({
            id: "setup",
            flags: { cwd: Claim.FRESH_DIRECTORY },
          })} in a fresh directory gets you a new project you can claim.`;
      return {
        name: this.name,
        status: "warn",
        message,
        details: { claimable: state.claimable },
        path: this.path,
      };
    }

    return {
      name: this.name,
      status: "pass",
      message:
        state.kind === "attached"
          ? `Project is attached to team ${state.team_id}`
          : NO_TEAMS_MESSAGE,
      path: this.path,
    };
  }

  /**
   * Records in `.zitadel/secret` the owning team the server confirmed, when
   * the record names none: a project claimed from another machine, or a secret
   * restored from a backup. It writes what `zitadel claim` writes once a claim
   * completes, so `status` and `doctor` know the team offline afterwards.
   *
   * Claiming itself is not repaired: it needs a person to sign in through a
   * browser, so an unclaimed project is left as it is. A dry run plans only.
   *
   * @param ctx - The directory the check runs in, and whether to plan only.
   * @returns Once the record is written, or once there is nothing to write.
   */
  async fix(ctx: CheckContext): Promise<void> {
    if (ctx.dryRun) {
      return;
    }
    const read = await ClaimCheck.read(ctx);
    if (read === undefined || read.state.kind !== "attached" || read.state.recorded !== false) {
      return;
    }
    await read.secret
      .with({ claimed_at: read.state.claimed_at, team_id: read.state.team_id })
      .write();
  }

  /**
   * Reads the project's secret and its claim, confirmed with the server when
   * the record names no team.
   *
   * Whether the server is the cloud is read from `zitadel.json`, not the
   * command's own source: `doctor` pins its source to the local runtime URL, so
   * asking it where the project lives would report every project as local. A
   * missing or unparseable secret or config is already reported, loudly and
   * with a repair path, by the `secret` and `config` checks, so it reads as
   * nothing here; a cancelled run still stops.
   *
   * @param ctx - The directory and the run's signal.
   * @returns The secret and the claim, or nothing when the files cannot be read.
   * @throws {ZitadelError} `E_CANCELLED` when the run was cancelled.
   */
  private static async read(
    ctx: CheckContext,
  ): Promise<{ secret: ProjectSecret; state: ClaimState } | undefined> {
    try {
      const secret = await Project.at(ctx.cwd).secret();
      const server = (await Project.at(ctx.cwd).config()).server ?? ZitadelRuntime.DEFAULT;
      const state = await Claim.confirmed({
        secret: secret.data,
        server,
        cloud: ZitadelRuntime.fromUrl(server).isCloud(),
        signal: ctx.signal,
      });
      return { secret, state };
    } catch (error) {
      if (isCancellation(error)) {
        throw error;
      }
      return undefined;
    }
  }
}
