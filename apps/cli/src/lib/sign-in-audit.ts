import type { SignInEvent, SignInPhase } from "./checks/idp";

/** The slice of an audit event, as `GET /events` serves it, that a sign-in is followed through. */
export type AuditEvent = {
  readonly id: string;
  readonly event_type: string;
  readonly entity_id?: string | null;
  readonly payload?: Readonly<Record<string, unknown>>;
  /** When the event was recorded. */
  readonly occurred_at?: string | null;
};

/** One page of `GET /events`, newest first. */
export type AuditPage = {
  readonly data: readonly AuditEvent[];
  readonly next_page_token?: string | null;
};

/**
 * What an audit event type means for a sign-in, before its payload says more.
 * The start and the handoff of an attempt are shared by every kind of sign-in;
 * the rest are about an exchange with a named connection.
 */
const MEANING: Readonly<
  Record<string, Pick<SignInEvent, "phase" | "status"> & { readonly sso: boolean }>
> = {
  "auth.attempt.created": { phase: "ceremony_started", status: "ok", sso: false },
  "auth.attempt.handed_off": { phase: "handed_off", status: "ok", sso: false },
  "auth.sso.authorization.failed": { phase: "callback_received", status: "failed", sso: true },
  "auth.sso.exchange.failed": { phase: "exchange_finished", status: "failed", sso: true },
  "auth.sso.exchange.succeeded": { phase: "exchange_finished", status: "ok", sso: true },
};

/** The type of an SSO failure after the exchange, which names its own phase. */
const RESOLUTION_FAILED = "auth.sso.resolution.failed";

/** Every audit event type a sign-in is followed through, to ask the stream for nothing else. */
export const SIGN_IN_EVENT_TYPES: readonly string[] = [...Object.keys(MEANING), RESOLUTION_FAILED];

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
 * names no connection (the start of an attempt, its handoff) is taken for
 * `slug`'s, and says so by not being marked `sso`: the follower decides which
 * attempt it belongs to.
 */
export function signInEventOf(event: AuditEvent, slug: string): SignInEvent | undefined {
  const { payload } = event;
  const connection = text(payload?.connection_slug) || undefined;
  const failure = event.event_type === RESOLUTION_FAILED;
  const meaning = failure ? { status: "failed" as const, sso: true } : MEANING[event.event_type];
  const phase = failure ? text(payload?.phase) : MEANING[event.event_type]?.phase;
  if (meaning === undefined || phase === undefined || !PHASES.includes(phase)) {
    return undefined;
  }
  // An exchange with a connection is what ties an attempt to it, so it must say which
  // connection; an older server's payload without a slug could be any provider's.
  if (meaning.sso && connection === undefined) {
    return undefined;
  }
  const reason = text(payload?.reason);
  const side = text(payload?.side);
  return {
    // An event of another connection keeps its own, so the follower can tell that an attempt
    // it is following went on with a different provider.
    slug: connection ?? slug,
    flowId: text(payload?.auth_attempt_id) ?? event.entity_id ?? "",
    ...(meaning.sso ? { sso: true as const } : {}),
    phase: phase as SignInPhase,
    status: meaning.status,
    ...(typeof event.occurred_at === "string" ? { at: event.occurred_at } : {}),
    ...(reason === undefined ? {} : { reason }),
    ...(side === "provider" || side === "journey" ? { side } : {}),
  };
}

/** Reads in a row that may fail before the watcher gives up and says so. */
const MAX_CONSECUTIVE_FAILURES = 5;
/** How many pages one read follows back, so a busy project cannot make a poll unbounded. */
const MAX_PAGES = 10;

/**
 * The events recorded since `known`, oldest first. Pages are read newest first
 * until one holds an event already known, or the stream or `maxPages` runs
 * out, so more events than fit in one page between two reads are all seen.
 */
export async function readNewAuditEvents(
  fetchPage: (token: string | undefined) => Promise<AuditPage>,
  known: ReadonlySet<string>,
  maxPages: number,
): Promise<readonly AuditEvent[]> {
  const collect = async (
    token: string | undefined,
    pagesLeft: number,
    taken: readonly AuditEvent[],
  ): Promise<readonly AuditEvent[]> => {
    const page = await fetchPage(token);
    const fresh = page.data.filter((event) => !known.has(event.id));
    const all = [...taken, ...fresh];
    const reachedKnown = fresh.length < page.data.length;
    const next = page.next_page_token;
    return reachedKnown || !next || pagesLeft <= 1 ? all : collect(next, pagesLeft - 1, all);
  };
  return [...(await collect(undefined, maxPages, []))].reverse();
}

/**
 * Sign-in events as the project's audit stream records them from now on. The
 * newest page of the stream is the baseline, and the promise resolves only once
 * it has been read; each poll then yields what was recorded since, in order.
 */
export async function watchSignInAudit(
  fetchPage: (token: string | undefined) => Promise<AuditPage>,
  slug: string,
  sleep: (ms: number, signal: AbortSignal) => Promise<void>,
  pollMs: number,
  signal: AbortSignal,
): Promise<AsyncIterable<SignInEvent>> {
  const known = new Set<string>();
  const misses = { count: 0 };
  const poll = async function* (): AsyncGenerator<SignInEvent> {
    while (!signal.aborted) {
      await sleep(pollMs, signal);
      if (signal.aborted) {
        return;
      }
      const fresh = await readNewAuditEvents(fetchPage, known, MAX_PAGES).then(
        (events) => {
          misses.count = 0;
          return events;
        },
        (error: unknown) => {
          // One failed read is a blip while the person is mid sign-in; only a run of them
          // means the events cannot be read at all.
          misses.count += 1;
          if (misses.count >= MAX_CONSECUTIVE_FAILURES) {
            throw error;
          }
          return [];
        },
      );
      for (const event of fresh) {
        known.add(event.id);
      }
      yield* fresh.flatMap((event) => signInEventOf(event, slug) ?? []);
    }
  };
  const baseline = await readNewAuditEvents(fetchPage, new Set(), 1);
  for (const event of baseline) {
    known.add(event.id);
  }
  return poll();
}
