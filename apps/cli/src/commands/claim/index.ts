import { Flags } from "@oclif/core";
import pRetry, { AbortError } from "p-retry";
import { z } from "zod";

import { ClaimService } from "@/lib/backend";
import { getClaimStatusQueryChallengeIdRegExp } from "@/lib/backend/schemas";
import { openInBrowser } from "@/lib/browser";
import { CLAIM_WINDOW_DAYS, isAttached } from "@/lib/claim-state";
import { requireValue } from "@/lib/environment";
import { ZitadelError } from "@/lib/errors";
import { log } from "@/lib/log";
import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { reads, type Refused, whole } from "@/lib/oclif/flags";
import { hasZitadelSecret, readZitadelSecret, writeZitadelSecret } from "@/lib/project";
import { normalizePublicCliCommand } from "@/lib/public-cli";
import { isLoopbackUrl } from "@/lib/server";
import { type SuggestedCommand, unscopedCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";

/**
 * Poll cadence while a human completes the browser step. Starts responsive so
 * a claim finished in a few seconds is reported almost immediately, then eases
 * off so a link left open for the full ten minutes costs a few hundred
 * requests rather than a few thousand.
 */
const INITIAL_POLL_MS = 1000;
const MAX_POLL_MS = 5000;
const POLL_BACKOFF_FACTOR = 1.5;

/** A status check that found the claim unfinished: the poll waits and asks again. */
class NotFinished extends Error {
  readonly attempt: number;

  constructor(attempt: number) {
    super("The claim is not finished");
    this.attempt = attempt;
  }
}

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
 * the loop running forever. So does a resumed wait (`--challenge-id`), which has
 * no `expires_at` to read because the status route does not repeat it; the
 * server's own `410` still ends that wait when the link really expires.
 * Exported so that fallback is testable without waiting out a real TTL.
 */
export function claimDeadline(input: {
  expiresAt?: string;
  timeoutSeconds?: number;
  now: number;
}): number {
  const parsed = input.expiresAt === undefined ? Number.NaN : Date.parse(input.expiresAt);
  const serverDeadline = Number.isNaN(parsed) ? input.now + FALLBACK_TTL_MS : parsed;
  if (input.timeoutSeconds === undefined) {
    return serverDeadline;
  }
  return Math.min(serverDeadline, input.now + input.timeoutSeconds * 1000);
}

/**
 * Seconds to wait for the browser step, which must be a whole number of at
 * least one: a fraction names no tick of the poll, and zero would wait for
 * nothing.
 */
const TIMEOUT_MIN = 1;

const TIMEOUT: Refused<number> = {
  schema: whole.pipe(z.number().min(TIMEOUT_MIN)),
  refusal: {
    message: "{value} is not a valid {input}",
    hint: "Use a whole number of 1 or more.",
  },
};

/**
 * The challenge a `--no-wait` run returned, in the shape the claim contract
 * gives it. The id goes back to the platform and into the suggestions a run
 * makes, so it is refused on its way in rather than once something has been
 * asked or sent.
 */
const CHALLENGE_ID: Refused<string> = {
  schema: z.string().trim().regex(getClaimStatusQueryChallengeIdRegExp),
  refusal: {
    message:
      "--challenge-id takes the challenge_id that the --no-wait run returned, which starts with ch_.",
    next: ["claim --no-wait"],
  },
};

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
 *
 * A caller that reads only the `--json` envelope cannot see the link while
 * the command blocks, and an agent has to hand that link to a person. So
 * `--no-wait` returns the link as the result, and `--challenge-id` resumes
 * waiting on it in a second run.
 */
export default class Claim extends EnvironmentCommand {
  static override description =
    "Claim this project to make it permanent. Opens a browser to create an account or sign in.";

  static override group = CommandGroups.gettingStarted;
  static override groupOrder = 4;

  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --no-open",
    "<%= config.bin %> <%= command.id %> --timeout 120",
    "<%= config.bin %> <%= command.id %> --no-wait",
    "<%= config.bin %> <%= command.id %> --challenge-id ch_01J0Z9KX7Y0Q2Y7JX5M9K2YF3C",
  ];
  static override flags = {
    "no-open": Flags.boolean({
      description: "Print the link instead of opening a browser.",
    }),
    timeout: Flags.custom<number>({
      parse: reads(TIMEOUT),
    })({
      min: TIMEOUT_MIN,
      description:
        "Seconds to wait for the browser step. Defaults to the link's own expiry (10 minutes).",
    }),
    "no-wait": Flags.boolean({
      description:
        "Print the link and exit, without opening a browser or waiting for the browser step. The result names the command that waits for it.",
      exclusive: ["challenge-id", "timeout"],
    }),
    "challenge-id": Flags.custom<string>({
      parse: reads(CHALLENGE_ID),
    })({
      description: "Wait for the link a --no-wait run printed, instead of creating a new one.",
    }),
  };

  protected async execute({ flags }: Admitted<typeof Claim>): Promise<JsonEnvelope> {
    // Where a fresh link comes from when this one dies: a run that is part of
    // the two-step flow suggests the step that hands the link back, so
    // following the suggestion never blocks with the link out of sight.
    const startOver = this.suggest(
      flags.noWait || flags.challengeId !== undefined ? "claim --no-wait" : "claim",
    );

    // The project to claim is the one the resolved environment points at — the
    // same project (and credential) `connect()` authenticates — so a
    // `--env`/`--env-file` claim targets that environment's project, never the
    // fallback `.zitadel/secret`.
    // On a terminal a missing project id is asked for by `connect()`, as every
    // other project command does. A dry run writes nothing, a prompted answer's
    // file included, so it still fails naming the sources it consulted.
    const prompted =
      this.environment.values.ZITADEL_PROJECT_ID === undefined &&
      !this.dryRun &&
      !this.nonInteractive
        ? await this.connect()
        : undefined;
    const projectId = prompted?.projectId ?? requireValue(this.environment, "ZITADEL_PROJECT_ID");
    // `.zitadel/secret` is only the place a completed claim is recorded, and
    // only when it is this very project's record. An env file can supply a
    // different project, so the legacy secret is neither required nor touched
    // then — the durable record is the platform grant (ADR 046), and the local
    // cache must not claim a project it does not describe.
    const localSecret = (await hasZitadelSecret(this.cwd))
      ? await readZitadelSecret(this.cwd)
      : undefined;
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
    if (this.dryRun) {
      const action = flags.noWait
        ? "Create a link to claim this project"
        : flags.challengeId === undefined
          ? "Open a browser to claim this project"
          : "Wait for the link to be used to claim this project";
      this.recordTelemetry({ claim_outcome: "dry_run" });

      const would =
        localRecord && !flags.noWait
          ? `${action}, then record the owning team in .zitadel/secret.`
          : `${action}.`;

      return this.emit({
        status: "ok",
        data: {
          dry_run: true,
          title: "Nothing was claimed (dry run)",
          project_id: projectId,
          would,
        },
        summary: {
          title: "Nothing was claimed (dry run)",
          sections: [],
          lines: [would],
        },
        next: {
          commands: [
            flags.challengeId === undefined
              ? startOver
              : this.suggest(`claim --challenge-id ${flags.challengeId}`),
          ],
        },
      });
    }

    const { client } = prompted ?? (await this.connect());
    const claimService = new ClaimService(client, projectId);

    // Set by whichever branch runs: minting a link has early returns and prompts
    // in the middle, so it cannot be one expression.
    let waitFor: { challengeId: string; deadline: number };
    let opened: boolean | undefined;
    if (flags.challengeId === undefined) {
      const started = await claimService.start();
      switch (started.outcome) {
        case "already-claimed": {
          return this.alreadyClaimed({
            project_id: projectId,
            team_id: started.teamId,
            dashboard_url: started.dashboardUrl,
          });
        }
        case "window-expired": {
          this.recordTelemetry({ claim_outcome: "window_expired" });
          throw claimWindowExpiredError(this.cliVersion);
        }
        case "started": {
          break;
        }
      }
      const { challenge } = started;

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
      // The URL prints bare: it must never be split (clickability, the journey e2e scrape).
      this.ui.note("Finish in your browser", [
        "Create an account or sign in to claim your project, make it permanent and start collaborating.",
      ]);
      log.plain(escapeControlCharacters(challenge.claim_url));

      if (flags.noWait) {
        return this.linkIssued(projectId, challenge);
      }

      const skipLaunch = flags.noOpen || this.nonInteractive;
      opened = skipLaunch ? false : (await openInBrowser(challenge.claim_url)).opened;
      if (!opened) {
        log.info("Open the link above to continue.");
      }
      waitFor = {
        challengeId: challenge.challenge_id,
        deadline: claimDeadline({
          expiresAt: challenge.expires_at,
          timeoutSeconds: flags.timeout,
          now: Date.now(),
        }),
      };
    } else {
      // Resuming mints nothing: the link is already with whoever opens it, so
      // this run only waits on it.
      waitFor = {
        challengeId: flags.challengeId,
        deadline: claimDeadline({ timeoutSeconds: flags.timeout, now: Date.now() }),
      };
    }
    log.start("Waiting for the browser step to finish");

    const completed = await this.poll(
      claimService,
      waitFor.challengeId,
      waitFor.deadline,
      startOver,
    );

    // Record the completed claim only in a `.zitadel/secret` that is this
    // project's own record: writing it into a secret that describes a different
    // project would conflate environments, marking the fallback project claimed
    // when another was. An env-supplied project keeps no local cache — the
    // platform grant is the durable record, and a rerun resolves it through the
    // idempotent already-claimed response rather than a stale local one.
    if (localRecord) {
      await writeZitadelSecret(this.cwd, {
        ...localRecord,
        claimed_at: completed.claimed_at,
        team_id: completed.team_id,
      });
    }
    // The team id stays out of the human output by design (it lives in the
    // envelope and .zitadel/secret); the user-facing outcome is permanence.
    log.done("Project claimed");

    this.recordTelemetry({ claim_outcome: "completed", browser_opened: opened });

    return this.emit({
      status: "ok",
      data: {
        title: "Your project is now permanent",
        project_id: projectId,
        team_id: completed.team_id,
        claimed_at: completed.claimed_at,
        dashboard_url: completed.dashboard_url,
      },
      summary: {
        title: "Your project is now permanent",
        sections: [],
        next: [
          {
            text: "Manage your project and collaborate in the Console:",
            command: escapeControlCharacters(completed.dashboard_url),
          },
        ],
      },
      next: {
        actions: ["Manage your project and collaborate in the Console:", completed.dashboard_url],
      },
    });
  }

  /**
   * Polls `claim/status` until the browser leg lands or the link dies.
   *
   * The two failure modes read the same to a user (the link no longer works,
   * start another one), so they share an error shape and differ only in
   * wording — a `410` means the platform expired it, a passed deadline means
   * we stopped waiting first. `startOver` is how this run gets a new link.
   */
  private async poll(
    claimService: ClaimService,
    challengeId: string,
    deadline: number,
    startOver: SuggestedCommand,
  ): Promise<{ team_id: string; claimed_at: string; dashboard_url: string }> {
    return pRetry(
      async (attempt) => {
        const isExpired = Date.now() >= deadline;

        if (isExpired) {
          throw new NotFinished(attempt - 1);
        }

        const progress = await claimService.status(challengeId).catch((error: unknown) => {
          this.recordTelemetry({ poll_count: attempt });
          throw new AbortError(error instanceof Error ? error : new Error(String(error)));
        });
        switch (progress.outcome) {
          case "completed": {
            this.recordTelemetry({ poll_count: attempt });
            return progress.claim;
          }
          case "window-expired": {
            this.recordTelemetry({ claim_outcome: "window_expired", poll_count: attempt });
            throw new AbortError(claimWindowExpiredError(this.cliVersion));
          }
          case "expired": {
            this.recordTelemetry({ claim_outcome: "expired", poll_count: attempt });
            throw new AbortError(
              expiredError("The link expired before the browser step finished.", startOver),
            );
          }
          case "not-found": {
            this.recordTelemetry({ claim_outcome: "not_found", poll_count: attempt });
            throw new AbortError(
              new ZitadelError(
                "E_NOT_FOUND",
                "This project has no claim link with that challenge id.",
                {
                  hint: "Start a new link.",
                  nextCommands: [startOver],
                },
              ),
            );
          }
          case "pending": {
            throw new NotFinished(attempt);
          }
        }
      },
      {
        // Never sleeps past the deadline: the last wait ends the retries.
        maxRetryTime: Math.max(deadline - Date.now(), 0),
        retries: Number.POSITIVE_INFINITY,
        minTimeout: INITIAL_POLL_MS,
        maxTimeout: MAX_POLL_MS,
        factor: POLL_BACKOFF_FACTOR,
        randomize: false,
        signal: this.signal,
      },
    ).catch((error: unknown) => {
      if (!(error instanceof NotFinished)) {
        throw error;
      }
      this.recordTelemetry({ claim_outcome: "timeout", poll_count: error.attempt });
      throw expiredError("Stopped waiting for the browser step to finish.", startOver);
    });
  }

  /**
   * The `--no-wait` result: the link a person has to open, and the command
   * that waits for them to finish. Nothing is claimed yet, so nothing is
   * recorded in `.zitadel/secret`.
   */
  private linkIssued(
    projectId: string,
    challenge: { claim_url: string; challenge_id: string; expires_at: string },
  ): JsonEnvelope {
    this.recordTelemetry({ claim_outcome: "link_issued" });
    const wait = this.suggest(`claim --challenge-id ${challenge.challenge_id}`);

    return this.emit({
      status: "ok",
      data: {
        title: "Open the link in a browser to make your project permanent",
        project_id: projectId,
        claim_url: challenge.claim_url,
        challenge_id: challenge.challenge_id,
        expires_at: challenge.expires_at,
      },
      summary: {
        title: "Open the link in a browser to make your project permanent",
        sections: [],
        next: [
          {
            text: "Wait for the browser step to finish with:",
            command: normalizePublicCliCommand(wait, this.cliVersion),
          },
        ],
      },
      next: {
        actions: ["Wait for the browser step to finish with:"],
        commands: [wait],
      },
    });
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
    log.info(`This project already belongs to team ${escapeControlCharacters(data.team_id)}.`);

    return this.emit({
      status: "skipped",
      reason: "already-claimed",
      data: {
        title: "This project already belongs to a team",
        ...data,
      },
      summary: {
        title: "This project already belongs to a team",
        sections: [],
      },
    });
  }
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
function claimWindowExpiredError(cliVersion: string): ZitadelError {
  return new ZitadelError(
    "E_VALIDATION",
    `This project was not claimed within ${CLAIM_WINDOW_DAYS} days of creation, so it can no longer be claimed.`,
    {
      hint: `The project still works for now, but it stays temporary and its data may be lost. To get a claimable project, run ${unscopedCommand("setup", cliVersion)} in a fresh directory (here it would just skip as already initialized) and claim the new one within the window.`,
    },
  );
}
