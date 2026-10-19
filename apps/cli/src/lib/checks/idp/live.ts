import { Check, type CheckResult, type Outcome } from "../check";
import type { IdpContext, LiveSignIn, SignInEvent, SignInPhase } from "./context";

const TIMED_OUT = Symbol("timed out");

/** What a sign-in is being followed through. */
type Watching = {
  readonly context: IdpContext;
  readonly live: LiveSignIn;
  readonly events: AsyncIterator<SignInEvent>;
  readonly timedOut: Promise<typeof TIMED_OUT>;
};

/** Which attempt is being followed, how far it got, and which others were already mentioned. */
type Progress = {
  readonly attempt: string | undefined;
  readonly last: SignInEvent | undefined;
  readonly ignored: ReadonlySet<string>;
};

const PHASES: Readonly<Record<SignInPhase, string>> = {
  ceremony_started: "sending the browser to the provider",
  callback_received: "the provider's redirect back",
  exchange_finished: "the code exchange",
  resolved: "matching the identity to a user",
  user_created: "creating the user",
  handed_off: "handing the sign-in over to the app",
};

const REASONS: Readonly<Record<string, string>> = {
  provider_denied: "the sign-in was declined at the provider",
  provider_error: "the provider answered with an error",
  discovery_failed: "the provider's discovery document could not be fetched",
  exchange_failed: "the provider refused the authorization code",
  id_token_invalid: "the provider's ID token did not verify",
  userinfo_failed: "the provider's user info could not be read",
  state_mismatch: "the redirect came back on another connection's path",
  no_code: "the redirect carried neither a code nor an error",
  connection_invalid: "the connection could not be served",
  secret_unavailable: "the client secret could not be read",
  subject_invalid: "the subject claim is missing or not usable",
  creation_disabled: "the connection does not create users and none is linked",
  claim_rejected: "a verified claim is refused by the user schema",
  unroutable: "the login flow does not route this outcome",
  user_invalid: "the claims do not satisfy the user schema",
  other_schema: "the identity belongs to a user of another schema",
  handoff_failed: "the sign-in could not be handed over to the app",
  internal: "the runtime failed",
};

const EVENTS = "Run zitadel events list and look for the auth.sso events of the attempt";

/** What to do about a failed attempt: one action, chosen by the side that failed and the reason. */
function recoveryFor(event: SignInEvent, context: IdpContext): string {
  const file = `.zitadel/idps/${context.slug}.json`;
  if (event.side === "provider") {
    const where = context.consoleUrl ?? "the provider's console";
    return `Check the client ID, the secret and the redirect URI ${context.callbackUri} at ${where}`;
  }
  switch (event.reason) {
    case "state_mismatch":
    case "no_code":
      return `Start again from ${context.live?.loginUrl}: the state is single-use and short-lived`;
    case "connection_invalid":
    case "subject_invalid":
      return `Fix ${file}, then run zitadel apply`;
    case "secret_unavailable":
      return `Make client_secret in ${file} name a secret project variable, then run zitadel apply`;
    case "creation_disabled":
      return `Set provisioning.creation in ${file}, or sign in with a user that is already linked`;
    case "claim_rejected":
    case "user_invalid":
      return `Fix claim_mapping and verified_claims in ${file}, or the matching rule in your user schema`;
    case "unroutable":
      return "Route sso_authenticated from the step that offers this provider in your login flow";
    default:
      return EVENTS;
  }
}

function failure(event: SignInEvent, context: IdpContext): Outcome {
  const phase = PHASES[event.phase];
  const reason = REASONS[event.reason ?? ""] ?? event.reason ?? "unknown reason";
  return {
    status: "fail",
    message: `Failed at ${phase}${event.side === undefined ? "" : ` (${event.side} side)`}: ${reason}`,
    recovery: recoveryFor(event, context),
  };
}

/**
 * A sign-in is complete once the attempt has been handed over to the app. Binding
 * the identity or creating its user comes first and can still be followed by a
 * handoff that fails, so neither is the end.
 */
function completes(event: SignInEvent): boolean {
  return event.status === "ok" && event.phase === "handed_off";
}

/**
 * Sends the developer through a real sign-in and follows the runtime's events
 * for it.
 *
 * It follows the first attempt it sees for the connection to its end — a
 * completed sign-in, a failure on the provider's side or the journey's, or the
 * timeout — and says so when another attempt starts meanwhile, without
 * following it. Attempts are matched by connection slug and by the moment
 * watching began, which is enough for one developer on a local runtime; a
 * nonce handed to the browser would be exact but needs a way to get it into a
 * flow the browser starts.
 *
 * The browser starts the flow, not the CLI, so it is not a dry run: a sign-in
 * that creates a user leaves that user behind.
 */
export class LiveSignInCheck extends Check<IdpContext> {
  // The event that an attempt began names no provider, so the first attempt seen is the one
  // followed; on a server where someone else logs in meanwhile, it can be theirs.
  readonly name = "sign-in";
  readonly title = "Live sign-in";

  async run(context: IdpContext, earlier: readonly CheckResult[]): Promise<Outcome> {
    const { live } = context;
    if (live === undefined) {
      return { status: "skipped", message: "Not run: a browser sign-in was not asked for" };
    }
    if (earlier.some((result) => result.status === "fail")) {
      return { status: "skipped", message: "Not run: fix the checks that failed first" };
    }

    const stop = new AbortController();
    try {
      const events = (await live.watch(stop.signal))[Symbol.asyncIterator]();
      live.say(`Sign in with ${context.slug}: ${live.loginUrl}`);
      await live.open(live.loginUrl);
      // The budget is for the person to sign in, so it starts once the baseline is read and
      // the page is open, not while the CLI is still getting ready.
      const timedOut = live
        .sleep(live.timeoutMs, stop.signal)
        .then((): typeof TIMED_OUT => TIMED_OUT);
      return await this.follow(
        { context, live, events, timedOut },
        { attempt: undefined, last: undefined, ignored: new Set() },
      );
    } finally {
      stop.abort();
    }
  }

  /** Reads events until the attempt being followed ends, or the clock runs out. */
  private async follow(watching: Watching, progress: Progress): Promise<Outcome> {
    const { context, live, events, timedOut } = watching;
    const next = await Promise.race([events.next(), timedOut]);
    if (next === TIMED_OUT || next.done) {
      return this.unfinished(progress.last);
    }
    const event = next.value;
    if (event.slug !== context.slug) {
      return this.follow(watching, progress);
    }
    // The start and the handoff of an attempt belong to every kind of sign-in, a password
    // login included. Only an exchange with this connection says an attempt is the one
    // being followed; until it does, the start is shown and anything else is not ours.
    if (progress.attempt === undefined && event.sso !== true) {
      if (event.phase === "ceremony_started") {
        live.say(`${PHASES[event.phase]}: ok`);
      }
      return this.follow(watching, progress);
    }
    const attempt = progress.attempt ?? event.flowId;
    if (event.flowId !== attempt) {
      if (!progress.ignored.has(event.flowId)) {
        live.say(`Ignoring another sign-in attempt (${event.flowId})`);
      }
      return this.follow(watching, {
        ...progress,
        attempt,
        ignored: new Set([...progress.ignored, event.flowId]),
      });
    }
    if (event.status === "failed") {
      return failure(event, context);
    }
    if (completes(event)) {
      return { status: "pass", message: `sign-in completed with ${context.slug}` };
    }
    live.say(`${PHASES[event.phase]}: ok`);
    return this.follow(watching, { ...progress, attempt, last: event });
  }

  /**
   * "No sign-in attempt seen" also covers a sign-in that failed before the person left
   * the login page: the server records no event for that, and the checks that run before
   * the live one are what catch its usual causes.
   */
  private unfinished(last: SignInEvent | undefined): Outcome {
    return {
      status: "fail",
      message:
        last === undefined
          ? "no sign-in attempt seen"
          : `The sign-in started but did not finish: the last thing seen was ${PHASES[last.phase]}`,
      recovery: EVENTS,
    };
  }
}
