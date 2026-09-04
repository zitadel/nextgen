import { setTimeout as sleep } from "node:timers/promises";

import { Flags } from "@oclif/core";
import { createZitadelClient } from "@zitadel/api/client";
import { ApiError } from "@zitadel/api/runtime/fetch";
import consola from "consola";

import { wrapForBox } from "../lib/box";
import { openInBrowser } from "../lib/browser";
import { CLAIM_WINDOW_DAYS, isAttached } from "../lib/claim-state";
import { ZitadelError } from "../lib/errors";
import { isObject } from "../lib/json";
import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { readZitadelSecret, writeZitadelSecret, type ZitadelSecret } from "../lib/project";

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
 * `zitadel claim` — attach this project to a team.
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
export default class Claim extends BaseCommand {
  static override description =
    "Attach this project to a team so it becomes permanent. Opens a browser to finish signing in.";

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

    const secret = await readZitadelSecret(cwd);
    // The local record is authoritative enough to skip the round trip: the
    // platform enforces first-claim-wins anyway, so re-asking could only ever
    // return the same answer at the cost of a request.
    if (isAttached(secret)) {
      return this.alreadyClaimed({
        project_id: secret.project_id,
        team_id: secret.team_id,
        claimed_at: secret.claimed_at,
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
          project_id: secret.project_id,
          would: "Open a browser to attach this project to a team, then record the team in .zitadel/secret.",
        },
        nextCommands: ["zitadel claim"],
      });
    }

    const client = createZitadelClient({
      baseUrl: this.meta.source,
      token: secret.project_secret,
    });

    let challenge;
    try {
      challenge = await client.initClaim(secret.project_id);
    } catch (error) {
      const claimed = alreadyClaimedDetails(error);
      if (claimed) {
        return this.alreadyClaimed({ project_id: secret.project_id, ...claimed });
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
      consola.warn(
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
      message: wrapForBox("Sign in at the link below to attach this project to your team."),
      style: { padding: 1, borderStyle: "rounded", borderColor: "cyan" },
    });
    consola.log(challenge.claim_url);

    const skipLaunch = flags["no-open"] || nonInteractive;
    const opened = skipLaunch ? false : (await openInBrowser(challenge.claim_url)).opened;
    if (!opened) {
      consola.info("Open the link above to continue.");
    }
    consola.start("Waiting for the browser step to finish");

    const completed = await this.poll(client, secret.project_id, challenge.challenge_id, deadline);

    const next: ZitadelSecret = {
      ...secret,
      claimed_at: completed.claimed_at,
      team_id: completed.team_id,
    };
    // Unconditional: `--dry-run` never reaches here (it returns above), so a
    // claim that got this far really happened on the platform and the local
    // record must follow it.
    await writeZitadelSecret(cwd, next);
    consola.success(`Project attached to team ${completed.team_id}`);

    this.recordTelemetry({ claim_outcome: "completed", browser_opened: opened });
    return this.emit({
      status: "ok",
      data: {
        title: "Zitadel project attached to a team.",
        project_id: secret.project_id,
        team_id: completed.team_id,
        claimed_at: completed.claimed_at,
        dashboard_url: completed.dashboard_url,
        next_actions: [`Manage the project at ${completed.dashboard_url}.`],
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
    client: ReturnType<typeof createZitadelClient>,
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
          throw expiredError("The link expired before the browser step finished.");
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
    throw expiredError("Stopped waiting for the browser step to finish.");
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

function expiredError(message: string): ZitadelError {
  return new ZitadelError("E_VALIDATION", message, {
    hint: "Links are valid for 10 minutes. Start a new one.",
    nextCommands: ["zitadel claim"],
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
    `This project was not attached to a team within ${CLAIM_WINDOW_DAYS} days of creation, so it can no longer be claimed.`,
    {
      hint: "The project itself keeps working. To get a claimable project, create a fresh one with `zitadel setup` and claim it within the window.",
    },
  );
}

/**
 * Loopback check on the URL's hostname: `localhost`, the whole `127.0.0.0/8`
 * block, or `[::1]` (how WHATWG URLs spell IPv6 loopback).
 */
function isLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "localhost" || hostname === "[::1]" || /^127(\.\d{1,3}){3}$/.test(hostname);
  } catch {
    return false;
  }
}
