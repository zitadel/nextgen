import type { SignInEvent, SignInPhase } from "./checks/idp";

/** The slice of an audit event, as `GET /events` serves it, that a sign-in is followed through. */
export type AuditEvent = {
  readonly id: string;
  readonly event_type: string;
  readonly entity_id?: string | null;
  readonly payload?: Readonly<Record<string, unknown>>;
};

/** What an audit event type means for a sign-in, before its payload says more. */
const MEANING: Readonly<Record<string, Pick<SignInEvent, "phase" | "status">>> = {
  "auth.attempt.created": { phase: "ceremony_started", status: "ok" },
  "auth.sso.authorization.failed": { phase: "callback_received", status: "failed" },
  "auth.sso.exchange.failed": { phase: "exchange_finished", status: "failed" },
  "auth.sso.exchange.succeeded": { phase: "exchange_finished", status: "ok" },
  "idp.identity_link.created": { phase: "user_created", status: "ok" },
  "auth.attempt.handed_off": { phase: "handed_off", status: "ok" },
};

const PHASES: readonly string[] = [
  "ceremony_started",
  "callback_received",
  "exchange_finished",
  "resolved",
  "user_created",
  "handed_off",
];

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/**
 * The sign-in event an audit event stands for, or `undefined` when it is not
 * about a sign-in or is about another connection than `slug`. An event that
 * names no connection (the start of an attempt, its handoff, a link) is taken
 * for `slug`'s: the attempt it belongs to is what the caller follows.
 */
export function signInEventOf(event: AuditEvent, slug: string): SignInEvent | undefined {
  const { payload } = event;
  const connection = text(payload?.connection_slug);
  if (connection !== undefined && connection !== slug) {
    return undefined;
  }
  const failure = event.event_type === "auth.sso.resolution.failed";
  const phase = failure ? text(payload?.phase) : MEANING[event.event_type]?.phase;
  const meaning = failure ? { status: "failed" as const } : MEANING[event.event_type];
  if (meaning === undefined || phase === undefined || !PHASES.includes(phase)) {
    return undefined;
  }
  const reason = text(payload?.reason);
  const side = text(payload?.side);
  return {
    slug,
    flowId: text(payload?.auth_attempt_id) ?? event.entity_id ?? "",
    phase: phase as SignInPhase,
    status: meaning.status,
    ...(reason === undefined ? {} : { reason }),
    ...(side === "provider" || side === "journey" ? { side } : {}),
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
