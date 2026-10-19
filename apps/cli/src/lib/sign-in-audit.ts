import type { SignInEvent } from "./checks/idp";

/** The slice of an audit event, as `GET /events` serves it, that a sign-in is followed through. */
export type AuditEvent = {
  readonly id: string;
  readonly event_type: string;
  readonly entity_id?: string | null;
  readonly payload?: Readonly<Record<string, unknown>>;
};

/**
 * What each audit event type tells about a sign-in. The stream names no
 * connection and gives no reason, so a failure is told apart only by the step
 * it happened at.
 */
const MEANING: Readonly<Record<string, Pick<SignInEvent, "phase" | "status" | "reason" | "side">>> =
  {
    "auth.attempt.created": { phase: "ceremony_started", status: "ok" },
    "auth.sso.authorization.failed": {
      phase: "callback_received",
      status: "failed",
      reason: "provider_error",
      side: "provider",
    },
    "auth.sso.exchange.failed": {
      phase: "exchange_finished",
      status: "failed",
      reason: "exchange_failed",
    },
    "auth.sso.exchange.succeeded": { phase: "exchange_finished", status: "ok" },
    "idp.identity_link.created": { phase: "user_created", status: "ok" },
    "auth.attempt.handed_off": { phase: "handed_off", status: "ok" },
  };

/** The sign-in event an audit event stands for, or `undefined` for any other event. */
export function signInEventOf(event: AuditEvent, slug: string): SignInEvent | undefined {
  const meaning = MEANING[event.event_type];
  if (meaning === undefined) {
    return undefined;
  }
  const fromPayload = event.payload?.auth_attempt_id;
  return {
    slug,
    flowId: typeof fromPayload === "string" ? fromPayload : (event.entity_id ?? ""),
    ...meaning,
  };
}

/**
 * Sign-in events as the project's audit stream records them from now on. What
 * the stream holds when this is called is the baseline, and the promise
 * resolves only once it has been read; each poll then yields the events the
 * previous read did not hold. `list` returns the most recent events, oldest
 * first.
 */
export async function watchSignInAudit(
  list: () => Promise<readonly AuditEvent[]>,
  slug: string,
  sleep: (ms: number, signal: AbortSignal) => Promise<void>,
  pollMs: number,
  signal: AbortSignal,
): Promise<AsyncIterable<SignInEvent>> {
  const poll = async function* (previous: ReadonlySet<string>): AsyncGenerator<SignInEvent> {
    if (signal.aborted) {
      return;
    }
    await sleep(pollMs, signal);
    if (signal.aborted) {
      return;
    }
    const events = await list();
    yield* events
      .filter((event) => !previous.has(event.id))
      .flatMap((event) => signInEventOf(event, slug) ?? []);
    yield* poll(new Set(events.map((event) => event.id)));
  };
  return poll(new Set((await list()).map((event) => event.id)));
}
