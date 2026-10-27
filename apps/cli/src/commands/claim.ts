import { setTimeout as sleep } from "node:timers/promises";

import { Flags } from "@oclif/core";
import { ApiError } from "@zitadel/api/runtime/fetch";
import consola from "consola";

import type { ZitadelClient } from "../lib/api-client";
import { wrapForBox } from "../lib/box";
import { openInBrowser } from "../lib/browser";
import { CLAIM_WINDOW_DAYS, isAttached } from "../lib/claim-state";
import { requireValue } from "../lib/environment";
import { ZitadelError } from "../lib/errors";
import { isObject } from "../lib/json";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../lib/oclif";
import { hasZitadelSecret, readZitadelSecret, writeZitadelSecret } from "../lib/project";
import { isLoopbackUrl } from "../lib/server";
import { reportWarning } from "../lib/warnings";
import type { SuggestedCommand } from "../lib/suggestion";

/**
 * Poll cadence while a human completes the browser step. Starts responsive so
 * a claim finished in a few seconds is reported almost immediately, then eases
 * off so a link left open for the full ten minutes costs a few hundred
 * requests rather than a few thousand.
 */
const INITIAL_POLL_MS = 1000;
const MAX_POLL_MS = 5000;
const POLL_BACKOFF_FACTOR = 1.5;

/**
 * Backstop for the poll deadline, used only when the server's own `expires_at`
 * cannot be parsed. The challenge TTL is the platform's to decide (ADR 046) and
 * the response carries it, so this is never the normal path — but without it a
 * malformed or misrouted response would leave the loop with no deadline at all
 * and the CLI polling forever. Matches the TTL the ADR documents.
 */
const FALLBACK_TTL_MS = 10 * 60 * 1000;

/**
 * When to stop polling: the earlier of the server's own expiry and any
 * `--timeout` the caller set.
 *
 * Trusts `expires_at` rather than assuming the TTL, because the contract
 * documents it as the authority and the CLI should not go stale if the platform
 * ever retunes it. An unparseable value falls back to {@link FALLBACK_TTL_MS}
 * rather than to no deadline: a malformed or misrouted response must not leave
 * the loop running forever. Exported so that fallback is testable without
 * waiting out a real TTL.
 */
export function claimDeadline(input: {
  expiresAt: string;
  timeoutSeconds?: number;
  now: number;
}): number {
  const parsed = Date.parse(input.expiresAt);
  const serverDeadline = Number.isNaN(parsed) ? input.now + FALLBACK_TTL_MS : parsed;
  if (input.timeoutSeconds === undefined) {
    return serverDeadline;
  }
  return Math.min(serverDeadline, input.now + input.timeoutSeconds * 1000);
}

/**
 * `zitadel claim` — claim this project for a team to make it permanent.
 *
 * Shaped like the device-authorization grant (ADR 046): the CLI mints a
 * challenge with the project secret, hands a URL to a browser, and polls until
 * the human finishes. The project secret never leaves the machine and the
 * browser only ever sees the challenge id.
 *
 * The command blocks for as long as the link is valid. That is the point: the
 * developer is looking at the terminal, finishes in the browser, and comes
 * back to a terminal that already knows. Nothing about the project changes —
 * the issuer, users, and applications keep working exactly as before, so this
 * is purely additive.
 */
export default class Claim extends EnvironmentCommand {
  static override description =
    "Claim this project to make it permanent. Opens a browser to create an account or sign in.";

  static override heading = "Claiming the project";

  static override wizard = true;
  static override group = CommandGroups.gettingStarted;
  static override groupOrder = 4;

  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --no-open",
    "<%= config.bin %> <%= command.id %> --timeout 120",
  ];

  static override flags = {
    "no-open": Flags.boolean({
      description: "Print the link instead of opening a browser.",
    }),
    timeout: Flags.integer({
      min: 1,
      description:
        "Seconds to wait for the browser step. Defaults to the link's own expiry (10 minutes).",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Claim);
    await this.toMeta(flags);
    const { cwd, dryRun, nonInteractive } = this.meta;

    // The project to claim is the one the resolved environment points at — the
    // same project (and credential) `connect()` authenticates — so a
    // `--env`/`--env-file` claim targets that environment's project, never the
    // fallback `.zitadel/secret`.
    // On a terminal a missing project id is asked for by `connect()`, as every
    // other project command does. A dry run writes nothing, a prompted answer's
    // file included, so it still fails naming the sources it consulted.
    const prompted =
      this.environment.values.ZITADEL_PROJECT_ID === undefined && !dryRun && !nonInteractive
        ? await this.connect()
        : undefined;
    const projectId = prompted?.projectId ?? requireValue(this.environment, "ZITADEL_PROJECT_ID");
    // `.zitadel/secret` is only the place a completed claim is recorded, and
    // only when it is this very project's record. An env file can supply a
    // different project, so the legacy secret is neither required nor touched
    // then — the durable record is the platform grant (ADR 046), and the local
    // cache must not claim a project it does not describe.
    const localSecret = (await hasZitadelSecret(cwd)) ? await readZitadelSecret(cwd) : undefined;
    const localRecord = localSecret?.project_id === projectId ? localSecret : undefined;

    // The local record is authoritative enough to skip the round trip: the
    // platform enforces first-claim-wins anyway, so re-asking could only ever
    // return the same answer at the cost of a request. An env project with no
    // matching local record falls through and lets the platform answer.
    if (localRecord && isAttached(localRecord)) {
      return this.alreadyClaimed({
        project_id: projectId,
        team_id: localRecord.team_id,
        claimed_at: localRecord.claimed_at,
      });
    }

    // `--dry-run` promises to mutate neither files nor the platform, so it has
    // to stop before `initClaim`: minting a challenge is a platform write, and
    // a developer who then finished the browser step would really claim the
    // project while this run deliberately skipped recording it — the local file
    // and the platform would disagree, which is worse than not previewing at
    // all. There is nothing further to preview here anyway: the outcome of a
    // claim is decided in a browser, not by anything the CLI could compute.
    if (dryRun) {
      this.recordTelemetry({ claim_outcome: "dry_run" });
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: {
          title: "Zitadel claim was not started.",
          project_id: projectId,
          would: localRecord
            ? "Open a browser to claim this project, then record the owning team in .zitadel/secret."
            : "Open a browser to claim this project.",
        },
        nextCommands: [this.suggest("claim")],
      });
    }

    const { client } = prompted ?? (await this.connect());

    let challenge: Awaited<ReturnType<typeof client.initClaim>>;
    try {
      challenge = await client.initClaim(projectId);
    } catch (error) {
      const claimed = alreadyClaimedDetails(error);
      if (claimed) {
        return this.alreadyClaimed({ project_id: projectId, ...claimed });
      }
      if (isClaimWindowExpired(error)) {
        this.recordTelemetry({ claim_outcome: "window_expired" });
        throw claimWindowExpiredError();
      }
      throw error;
    }

    const deadline = claimDeadline({
      expiresAt: challenge.expires_at,
      timeoutSeconds: flags.timeout,
      now: Date.now(),
    });

    // A local server left on the default public base advertises a claim page
    // on a remote origin — the exact confusion this warning names. Cloud
    // servers legitimately use a console origin different from the API one,
    // so only a loopback API paired with a non-loopback claim page warns.
    if (isLoopbackUrl(this.meta.source) && !isLoopbackUrl(challenge.claim_url)) {
      reportWarning(
        `The server at ${this.meta.source} advertised a claim page on ${new URL(challenge.claim_url).origin}. ` +
          "If you started that server yourself, set NEXTGEN_SERVER_PUBLIC_BASE to its reachable origin (e.g. http://localhost:8080).",
      );
    }

    // Always show the link first, before attempting anything: it is the whole
    // instruction on its own, so a launch that never happens (headless box,
    // no `xdg-open`, `--no-open`, an agent) needs no separate path.
    //
    // The URL prints as a bare line under the frame rather than inside it:
    // it must never be split (clickability, and the journey e2e scrape reads
    // it out of the narration), and consola pads every box line to the
    // longest one, so a ~110-character URL inside the box would re-break the
    // frame on any terminal narrower than the URL itself. `wrapForBox` keeps
    // the frame's own content inside the terminal width.
    consola.box({
      title: "Finish in your browser",
      message: wrapForBox(
        "Create an account or sign in to claim your project, make it permanent and start collaborating.",
      ),
      style: { padding: 1, borderStyle: "rounded", borderColor: "cyan" },
    });
    consola.log(challenge.claim_url);

    const skipLaunch = flags["no-open"] || nonInteractive;
    const opened = skipLaunch ? false : (await openInBrowser(challenge.claim_url)).opened;
    if (!opened) {
      consola.info("Open the link above to continue.");
    }
    consola.start("Waiting for the browser step to finish");

    const completed = await this.poll(client, projectId, challenge.challenge_id, deadline);

    // Record the completed claim only in a `.zitadel/secret` that is this
    // project's own record: writing it into a secret that describes a different
    // project would conflate environments, marking the fallback project claimed
    // when another was. An env-supplied project keeps no local cache — the
    // platform grant is the durable record, and a rerun resolves it through the
    // idempotent already-claimed response rather than a stale local one.
    if (localRecord) {
      await writeZitadelSecret(cwd, {
        ...localRecord,
        claimed_at: completed.claimed_at,
        team_id: completed.team_id,
      });
    }
    // The team id stays out of the human output by design (it lives in the
    // envelope and .zitadel/secret); the user-facing outcome is permanence.
    consola.success("Project claimed");

    this.recordTelemetry({ claim_outcome: "completed", browser_opened: opened });
    return this.emit({
      status: "ok",
      data: {
        title: "Your project is now permanent.",
        project_id: projectId,
        team_id: completed.team_id,
        claimed_at: completed.claimed_at,
        dashboard_url: completed.dashboard_url,
        // Two entries so the pretty renderer puts the URL on its own line.
        next_actions: [
          "Manage your project and collaborate in the Console:",
          completed.dashboard_url,
        ],
      },
    });
  }

  /**
   * Polls `claim/status` until the browser leg lands or the link dies.
   *
   * The two failure modes read the same to a user (the link no longer works,
   * start another one), so they share an error shape and differ only in
   * wording — a `410` means the platform expired it, a passed deadline means
   * we stopped waiting first.
   */
  private async poll(
    client: ZitadelClient,
    projectId: string,
    challengeId: string,
    deadline: number,
  ): Promise<{ team_id: string; claimed_at: string; dashboard_url: string }> {
    let interval = INITIAL_POLL_MS;
    let polls = 0;

    while (Date.now() < deadline) {
      polls += 1;
      try {
        const status = await client.getClaimStatus(projectId, { challenge_id: challengeId });
        if (status.status === "completed") {
          this.recordTelemetry({ poll_count: polls });
          return status;
        }
      } catch (error) {
        // The window can close between init and poll (a challenge minted in
        // the window's last minutes); the status route reports that as its
        // own 410 code, and it must not read as the retryable link expiry.
        if (isClaimWindowExpired(error)) {
          this.recordTelemetry({ claim_outcome: "window_expired", poll_count: polls });
          throw claimWindowExpiredError();
        }
        if (error instanceof ApiError && error.status === 410) {
          this.recordTelemetry({ claim_outcome: "expired", poll_count: polls });
          throw expiredError(
            "The link expired before the browser step finished.",
            this.suggest("claim"),
          );
        }
        if (error instanceof ApiError && error.status === 429) {
          // Polled too eagerly. Back off to the ceiling immediately rather
          // than easing towards it, so a rate limit is never compounded.
          interval = MAX_POLL_MS;
        } else {
          this.recordTelemetry({ poll_count: polls });
          throw error;
        }
      }

      // Never sleep past the deadline: the last wait should end the loop, not
      // overshoot it by up to a full interval.
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }
      await sleep(Math.min(interval, remaining));
      interval = Math.min(interval * POLL_BACKOFF_FACTOR, MAX_POLL_MS);
    }

    this.recordTelemetry({ claim_outcome: "timeout", poll_count: polls });
    throw expiredError("Stopped waiting for the browser step to finish.", this.suggest("claim"));
  }

  /**
   * The idempotent outcome: the project already belongs to a team, whether we
   * learned that locally or from a `409`. Reported as a skip, not an error, so
   * re-running the command (or an agent retrying it) is a clean no-op.
   */
  private alreadyClaimed(data: {
    project_id: string;
    team_id: string;
    claimed_at?: string;
    dashboard_url?: string;
  }): JsonEnvelope {
    this.recordTelemetry({ claim_outcome: "already_claimed" });
    consola.info(`This project already belongs to team ${data.team_id}.`);
    return this.emit({
      status: "skipped",
      reason: "already-claimed",
      data: { title: "Zitadel project already belongs to a team.", ...data },
    });
  }
}

/**
 * Extracts the owning team from a `409 proj.already_claimed` envelope. Reads
 * the body defensively rather than casting to the generated type: this is the
 * one place a malformed error body would otherwise turn a clean skip into a
 * crash.
 */
function alreadyClaimedDetails(
  error: unknown,
): { team_id: string; dashboard_url?: string } | undefined {
  if (!(error instanceof ApiError) || error.status !== 409 || !isObject(error.body)) {
    return undefined;
  }
  const details = error.body.details;
  if (!isObject(details) || typeof details.team_id !== "string") {
    return undefined;
  }
  return {
    team_id: details.team_id,
    dashboard_url: typeof details.dashboard_url === "string" ? details.dashboard_url : undefined,
  };
}

/**
 * A `410 proj.claim_window_expired` from `claim/init`: the project outlived
 * domain.ClaimWindow before anyone claimed it. Distinct from the plain 410 the
 * poll maps to "the link expired", which a new link fixes; this one nothing
 * fixes.
 */
function isClaimWindowExpired(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 410 &&
    isObject(error.body) &&
    error.body.code === "proj.claim_window_expired"
  );
}

function expiredError(message: string, claimAgain: SuggestedCommand): ZitadelError {
  return new ZitadelError("E_VALIDATION", message, {
    hint: "Links are valid for 10 minutes. Start a new one.",
    nextCommands: [claimAgain],
  });
}

/**
 * Deliberately not the retryable "start a new link" shape: a new challenge
 * cannot fix a closed window, so suggesting `claim` again would send the
 * user in a circle.
 */
function claimWindowExpiredError(): ZitadelError {
  return new ZitadelError(
    "E_VALIDATION",
    `This project was not claimed within ${CLAIM_WINDOW_DAYS} days of creation, so it can no longer be claimed`,
    {
      hint: "The project still works for now, but it stays temporary and its data may be lost. To get a claimable project, run `zitadel setup` in a fresh directory (here it would just skip as already initialized) and claim the new one within the window.",
    },
  );
}
