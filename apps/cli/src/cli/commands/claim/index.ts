import { Flags } from "@oclif/core";
import pRetry, { AbortError } from "p-retry";
import { z } from "zod";

import { ClaimService } from "@/lib/backend";
import { EnvironmentValueMissingError, EnvironmentValueUnboundError } from "@/lib/environment";
import { getProjectClaimStatusQueryChallengeIdRegExp } from "@/lib/backend/schemas";
import { openInBrowser } from "@/lib/browser";
import { Claim as ClaimWindow } from "@/lib/claim";
import { ZitadelError } from "@/lib/errors";
import { announce, section, warnings } from "@/lib/ui";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult, Connection } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { reads, type Refused, whole } from "@/cli/core/flags";
import { relatedFlags } from "@/lib/suggestion/relations";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { ZitadelRuntime } from "@/lib/server";
import type { SuggestedCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { Project } from "@/lib/project";
import { Spelling } from "@/lib/suggestion";
import { ChangeCommand } from "@/cli/commands/bases";
import { Telemetered } from "@/cli/telemetry/telemetered";

/** How a value set in no source is refused when its environment has a project to add it to. */
const VALUE_MISSING_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How a value set in no source is refused when its environment has no project at all. */
const VALUE_MISSING_UNBOUND_REFUSAL = {
  message: "{message}",
  next: ["{next}"],
} as const satisfies Refusal;

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

const TIMEOUT = {
  schema: whole.pipe(z.number().min(TIMEOUT_MIN)),
  refusal: {
    message: "{value} is not a valid {input}",
    hint: "Use a whole number of 1 or more.",
  },
} as const satisfies Refused<number>;

/**
 * The challenge a `--no-wait` run returned, in the shape the claim contract
 * gives it. The id goes back to the platform and into the suggestions a run
 * makes, so it is refused on its way in rather than once something has been
 * asked or sent.
 */
/** How a link that died before the browser step finished is refused. */
const LINK_EXPIRED_REFUSAL = {
  message: "The link expired before the browser step finished",
  hint: "Links are valid for 10 minutes. Start a new one.",
  next: ["{claim}"],
} as const satisfies Refusal;

/** How a run that stopped waiting for the browser step is refused. */
const WAIT_STOPPED_REFUSAL = {
  message: "Stopped waiting for the browser step to finish",
  hint: "Links are valid for 10 minutes. Start a new one.",
  next: ["{claim}"],
} as const satisfies Refusal;

/**
 * How a project past its claim window is refused. Deliberately not the
 * retryable "start a new link" shape: a new challenge cannot fix a closed
 * window, so suggesting `claim` again would send the user in a circle.
 */
const WINDOW_CLOSED_REFUSAL = {
  message: `This project was not claimed within ${ClaimWindow.WINDOW_DAYS} days of creation, so it can no longer be claimed.`,
  hint: "The project still works for now, but it stays temporary and its data may be lost. To get a claimable project, run `zitadel setup` in a fresh directory (here it would just skip as already initialized) and claim the new one within the window.",
} as const satisfies Refusal;

const CHALLENGE_ID: Refused<string> = {
  schema: z.string().trim().regex(getProjectClaimStatusQueryChallengeIdRegExp),
  refusal: {
    message:
      "--challenge-id takes the challenge_id that the --no-wait run returned, which starts with ch_",
    next: [
      {
        id: "claim",
        flags: { noWait: true },
      },
    ],
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
export default class Claim extends Telemetered(ChangeCommand) {
  static override description =
    "Claim this project to make it permanent. Opens a browser to create an account or sign in.";
  static override group = CommandGroups.gettingStarted;
  static override readonly headline = "claim_outcome";
  static override groupOrder = 2;

  static override examples = [
    "<%= config.bin %> claim",
    "<%= config.bin %> claim --no-open",
    "<%= config.bin %> claim --timeout 120",
    "<%= config.bin %> claim --no-wait",
    "<%= config.bin %> claim --challenge-id ch_01J0Z9KX7Y0Q2Y7JX5M9K2YF3C",
  ];
  static override flags = relatedFlags(
    {
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
      }),
      "challenge-id": Flags.custom<string>({
        parse: reads(CHALLENGE_ID),
      })({
        description: "Wait for the link a --no-wait run printed, instead of creating a new one.",
      }),
    },
    { "no-wait": { exclusive: ["challenge-id", "timeout"] } },
  );

  /**
   * Says what the command would claim, without claiming it.
   *
   * A dry run writes nothing, a prompted answer's file included, so a missing
   * project id still fails naming the sources it consulted. `--dry-run` promises
   * to mutate neither files nor the platform, so it stops before the challenge
   * is minted: minting one is a platform write, and a developer who then
   * finished the browser step would really claim the project while this run
   * deliberately skipped recording it, so the local file and the platform would
   * disagree, which is worse than not previewing at all. There is nothing
   * further to preview anyway: the outcome of a claim is decided in a browser,
   * not by anything the CLI could compute.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The result of the dry run.
   */
  protected async preview({ flags }: Admitted<typeof Claim>): Promise<CommandResult> {
    const { startOver, projectId, localRecord } = await this.located(flags, undefined);

    if (localRecord && ClaimWindow.isAttached(localRecord.data)) {
      return this.alreadyClaimed({
        project_id: projectId,
        team_id: localRecord.data.team_id,
        claimed_at: localRecord.data.claimed_at,
      });
    }

    const action = flags.noWait
      ? "Create a link to claim this project"
      : flags.challengeId === undefined
        ? "Open a browser to claim this project"
        : "Wait for the link to be used to claim this project";
    this.annotate({ claim_outcome: "dry_run" });

    const would =
      localRecord && !flags.noWait
        ? `${action}, then record the owning team in .zitadel/secret.`
        : `${action}.`;

    const result = dryRunResult({
      verb: "claim",
      topic: "project",
      id: projectId,
      next:
        flags.challengeId === undefined
          ? startOver
          : this.suggest({
              id: "claim",
              flags: { challengeId: flags.challengeId },
            }),
    });

    return {
      ...result,
      data: {
        ...(result.data as object),
        project_id: projectId,
        would,
      },
      summary: {
        title: result.summary.title,
        sections: [],
        lines: [would],
      },
    };
  }

  /**
   * Claims the project.
   *
   * On a terminal a missing project id is asked for by `connect()`, as every
   * other project command does. A local record is authoritative enough to skip
   * the round trip: the platform enforces first-claim-wins anyway, so re-asking
   * could only ever return the same answer at the cost of a request, and an env
   * project with no matching local record falls through and lets the platform
   * answer.
   *
   * The link is always shown first, before anything is attempted: it is the
   * whole instruction on its own, so a launch that never happens (headless box,
   * no `xdg-open`, `--no-open`, an agent) needs no separate path. The URL
   * prints bare because it must never be split (clickability, the journey e2e
   * scrape), and what the person must act on while this command waits is written
   * as the command goes, to a pipe as to a terminal, so a script reading the
   * pipe can open the link before the claim completes. A server left on the
   * default public base advertises a claim page on a remote origin, the exact
   * confusion the warning names; cloud servers legitimately use a console
   * origin different from the API one, so only a loopback API paired with a
   * non-loopback claim page warns. Resuming with a challenge id mints nothing:
   * the link is already with whoever opens it, so that run only waits on it.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The result of the run.
   */
  protected async apply({ flags }: Admitted<typeof Claim>): Promise<CommandResult> {
    const prompted =
      this.environment.values.ZITADEL_PROJECT_ID === undefined && !this.nonInteractive
        ? await this.connect()
        : undefined;
    const { startOver, projectId, localRecord } = await this.located(flags, prompted);

    if (localRecord && ClaimWindow.isAttached(localRecord.data)) {
      return this.alreadyClaimed({
        project_id: projectId,
        team_id: localRecord.data.team_id,
        claimed_at: localRecord.data.claimed_at,
      });
    }

    const { client } = prompted ?? (await this.connect());
    const claimService = new ClaimService(client, projectId);

    if (flags.challengeId !== undefined) {
      return this.finished({
        claimService,
        projectId,
        startOver,
        localRecord,
        challengeId: flags.challengeId,
        deadline: claimDeadline({
          timeoutSeconds: flags.timeout,
          now: Date.now(),
        }),
        opened: undefined,
      });
    }

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
        this.annotate({ claim_outcome: "window_expired" });
        throw refusalError(WINDOW_CLOSED_REFUSAL, {});
      }
      case "started": {
        break;
      }
    }
    const { challenge } = started;

    const advertisesRemoteClaimPage =
      ZitadelRuntime.fromUrl(this.meta.source).isLoopback() &&
      !ZitadelRuntime.fromUrl(challenge.claim_url).isLoopback();
    if (advertisesRemoteClaimPage) {
      warnings.report(
        `The server at ${this.meta.source} advertised a claim page on ${new URL(challenge.claim_url).origin}. ` +
          "If you started that server yourself, set NEXTGEN_SERVER_PUBLIC_BASE to its reachable origin (e.g. http://localhost:8080).",
      );
    }

    announce("Finish in your browser");
    announce(
      "Create an account or sign in to claim your project, make it permanent and start collaborating.",
    );
    announce(escapeControlCharacters(challenge.claim_url));

    if (flags.noWait) {
      return this.linkIssued(projectId, challenge);
    }

    const skipLaunch = flags.noOpen || this.nonInteractive;
    const opened = skipLaunch ? false : (await openInBrowser(challenge.claim_url)).opened;
    if (!opened) {
      this.info("Open the link above to continue.");
    }

    return this.finished({
      claimService,
      projectId,
      startOver,
      localRecord,
      challengeId: challenge.challenge_id,
      deadline: claimDeadline({
        expiresAt: challenge.expires_at,
        timeoutSeconds: flags.timeout,
        now: Date.now(),
      }),
      opened,
    });
  }

  /**
   * Resolves what both a dry run and a claim start from: the project to claim,
   * its local record when the secret describes this very project, and the
   * command that hands a fresh link back when this one dies.
   *
   * The project to claim is the one the resolved environment points at, the same
   * project (and credential) `connect()` authenticates, so a `--env` or
   * `--env-file` claim targets that environment's project, never the fallback
   * `.zitadel/secret`. `.zitadel/secret` is a local cache of the claim, used
   * only when it records this very project; the durable record is the platform
   * grant (ADR 046). `startOver` is where a fresh link comes from when this one
   * dies: a run that is part of the two-step flow suggests the step that hands
   * the link back, so following the suggestion never blocks with the link out
   * of sight.
   *
   * @param flags - The flags the command accepts.
   * @param prompted - The connection that asked for a missing project id, if one was opened.
   * @returns The project id, its local record and the command to start over with.
   */
  private async located(flags: Admitted<typeof Claim>["flags"], prompted: Connection | undefined) {
    const startOver =
      flags.noWait || flags.challengeId !== undefined
        ? this.suggest({
            id: "claim",
            flags: { noWait: true },
          })
        : this.suggest({
            id: "claim",
            flags: { noOpen: flags.noOpen, timeout: flags.timeout },
          });
    try {
      const projectId = prompted?.projectId ?? this.environment.require("ZITADEL_PROJECT_ID");
      const localSecret = (await Project.at(this.cwd).hasSecret())
        ? await Project.at(this.cwd).secret()
        : undefined;
      const localRecord = localSecret?.data.project_id === projectId ? localSecret : undefined;

      return {
        startOver,
        projectId,
        localRecord,
      };
    } catch (error) {
      if (error instanceof EnvironmentValueUnboundError) {
        // Run in the directory this run addressed, which need not be the
        // shell's: `setup` and `env add` both write their files there.
        const elsewhere =
          this.cwd === process.cwd()
            ? {}
            : {
                cwd: this.cwd,
              };
        throw refusalError(
          VALUE_MISSING_UNBOUND_REFUSAL,
          {
            message: error.message,
          },
          {
            next:
              this.environment.name.value === "development"
                ? {
                    id: "setup",
                    flags: elsewhere,
                  }
                : {
                    id: "env:add",
                    args: {
                      name: this.environment.name.value,
                    },
                    flags: elsewhere,
                  },
          },
        );
      }
      if (error instanceof EnvironmentValueMissingError) {
        throw refusalError(VALUE_MISSING_REFUSAL, {
          message: error.message,
        });
      }
      throw error;
    }
  }

  /**
   * Waits on the link until the browser step lands, records the completed claim
   * and reports it.
   *
   * The completed claim is recorded only in a `.zitadel/secret` that is this
   * project's own record: writing it into a secret that describes a different
   * project would conflate environments, marking the fallback project claimed
   * when another was. An env-supplied project keeps no local cache; the
   * platform grant is the durable record, and a rerun resolves it through the
   * idempotent already-claimed response rather than a stale local one. The team
   * id stays out of the human output by design (it lives in the envelope and
   * `.zitadel/secret`); the user-facing outcome is permanence.
   *
   * @param wait - The link to wait on and where the claim is recorded.
   * @returns The result of the completed claim.
   */
  private async finished(wait: {
    claimService: ClaimService;
    projectId: string;
    startOver: SuggestedCommand;
    localRecord: Awaited<ReturnType<ReturnType<typeof Project.at>["secret"]>> | undefined;
    challengeId: string;
    deadline: number;
    opened: boolean | undefined;
  }): Promise<CommandResult> {
    const { claimService, projectId, startOver, localRecord, challengeId, deadline, opened } = wait;
    this.info("Waiting for the browser step to finish");

    const completed = await this.poll(claimService, challengeId, deadline, startOver);

    if (localRecord) {
      await localRecord
        .with({ claimed_at: completed.claimed_at, team_id: completed.team_id })
        .write();
    }
    this.info("Project claimed");

    this.annotate({
      claim_outcome: "completed",
      browser_opened: opened,
    });

    const title = "Your project is now permanent";

    return {
      status: "ok",
      data: {
        title,
        project_id: projectId,
        team_id: completed.team_id,
        claimed_at: completed.claimed_at,
        dashboard_url: completed.dashboard_url,
      },
      summary: {
        title,
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
    };
  }

  /**
   * Polls `claim/status` until the browser leg lands or the link dies.
   *
   * The two failure modes read the same to a user (the link no longer works,
   * start another one), so they share an error shape and differ only in
   * wording — a `410` means the platform expired it, a passed deadline means
   * we stopped waiting first. `startOver` is how this run gets a new link. It
   * never sleeps past the deadline: the last wait ends the retries.
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
          this.annotate({ poll_count: attempt });
          throw new AbortError(error instanceof Error ? error : new Error(String(error)));
        });
        switch (progress.outcome) {
          case "completed": {
            this.annotate({ poll_count: attempt });
            return progress.claim;
          }
          case "window-expired": {
            this.annotate({
              claim_outcome: "window_expired",
              poll_count: attempt,
            });
            throw new AbortError(refusalError(WINDOW_CLOSED_REFUSAL, {}));
          }
          case "expired": {
            this.annotate({
              claim_outcome: "expired",
              poll_count: attempt,
            });
            throw new AbortError(refusalError(LINK_EXPIRED_REFUSAL, {}, { claim: startOver }));
          }
          case "not-found": {
            this.annotate({
              claim_outcome: "not_found",
              poll_count: attempt,
            });
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
      this.annotate({
        claim_outcome: "timeout",
        poll_count: error.attempt,
      });
      throw refusalError(WAIT_STOPPED_REFUSAL, {}, { claim: startOver });
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
  ): CommandResult {
    this.annotate({ claim_outcome: "link_issued" });
    const wait = this.suggest({
      id: "claim",
      flags: { challengeId: challenge.challenge_id },
    });

    const title = "Open the link in a browser to make your project permanent";

    return {
      status: "ok",
      data: {
        title,
        project_id: projectId,
        claim_url: challenge.claim_url,
        challenge_id: challenge.challenge_id,
        expires_at: challenge.expires_at,
      },
      summary: {
        title,
        sections: [],
        next: [
          {
            text: "Wait for the browser step to finish with:",
            command: Spelling.at(this.cliVersion).normalizeCommand(wait),
          },
        ],
      },
      next: {
        actions: ["Wait for the browser step to finish with:"],
        commands: [wait],
      },
    };
  }

  /**
   * The idempotent outcome: the project already belongs to a team, whether we
   * learned that locally or from a `409`. Reported as a skip, not an error, so
   * re-running the command (or an agent retrying it) is a clean no-op. The
   * project's link is the platform's own when it gave one, else the server's
   * console, so a project claimed earlier still says where to manage it.
   */
  private alreadyClaimed(data: {
    project_id: string;
    team_id: string;
    claimed_at?: string;
    dashboard_url?: string;
  }): CommandResult {
    this.annotate({ claim_outcome: "already_claimed" });
    const title = "This project already belongs to a team";
    const consoleUrl =
      data.dashboard_url ??
      (URL.canParse(this.meta.source)
        ? ZitadelRuntime.fromUrl(this.meta.source).consoleUrl()
        : undefined);

    return {
      status: "skipped",
      reason: "already-claimed",
      data: {
        title,
        ...data,
        ...(consoleUrl === undefined ? {} : { console_url: consoleUrl }),
      },
      summary: {
        title,
        sections: [
          section(
            undefined,
            ["Team", escapeControlCharacters(data.team_id)],
            ...(consoleUrl === undefined
              ? []
              : [["Console", escapeControlCharacters(consoleUrl)] as const]),
          ),
        ],
      },
    };
  }
}
