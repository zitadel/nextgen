import type { SignInEvent, SignInPhase } from "./checks/idp";
import { isObject } from "./json";

/** The message the runtime writes every sign-in event with (`internal/instrumentation/ssoevent`). */
const MESSAGE = "sso attempt";

const PHASES: readonly string[] = [
  "ceremony_started",
  "callback_received",
  "exchange_finished",
  "resolved",
  "user_created",
];

/**
 * The event's fields from one log line. The runtime logs JSON or text, and its
 * logger nests a record's attributes under the stream it was written to
 * (`request.slug`, `service.slug`), so a JSON field may sit one level down and
 * a text key may carry a prefix.
 */
function fieldsOf(line: string): Record<string, unknown> | undefined {
  const start = line.indexOf("{");
  if (start !== -1) {
    try {
      const record: unknown = JSON.parse(line.slice(start));
      if (!isObject(record) || record.msg !== MESSAGE) {
        return undefined;
      }
      return "phase" in record
        ? record
        : (Object.values(record).find((value) => isObject(value) && "phase" in value) as
            | Record<string, unknown>
            | undefined);
    } catch {
      return undefined;
    }
  }
  if (!line.includes(MESSAGE)) {
    return undefined;
  }
  const fields: Record<string, unknown> = {};
  for (const [, key, value] of line.matchAll(
    /(?:^|\s)(?:[\w-]+\.)*(slug|flow_id|phase|status|result|reason|side)=("[^"]*"|\S*)/g,
  )) {
    fields[key as string] = (value as string).replace(/^"|"$/g, "");
  }
  return fields;
}

/** The sign-in event on `line`, or `undefined` for any other line. */
export function parseSignInEvent(line: string): SignInEvent | undefined {
  const fields = fieldsOf(line);
  if (fields === undefined) {
    return undefined;
  }
  const { slug, flow_id: flowId, phase, status, result, reason, side } = fields;
  if (
    typeof slug !== "string" ||
    typeof phase !== "string" ||
    !PHASES.includes(phase) ||
    (status !== "ok" && status !== "failed")
  ) {
    return undefined;
  }
  return {
    slug,
    flowId: typeof flowId === "string" ? flowId : "",
    phase: phase as SignInPhase,
    status,
    ...(typeof result === "string" && result !== "" ? { result } : {}),
    ...(typeof reason === "string" && reason !== "" ? { reason } : {}),
    ...(side === "provider" || side === "journey" ? { side } : {}),
  };
}

/**
 * Sign-in events as they are logged from now on. Whatever the log holds when
 * this is called is the baseline, taken at once, so an attempt made before is
 * never reported and one made right after is not missed; each poll then
 * yields the lines it has not seen. Matching on the log's own lines needs no
 * clock, and a line carries its timestamp, so two lines are never alike.
 */
export function watchSignInEvents(
  read: () => Promise<string>,
  sleep: (ms: number, signal: AbortSignal) => Promise<void>,
  pollMs: number,
  signal: AbortSignal,
): AsyncIterable<SignInEvent> {
  const baseline = read().then((log) => new Set(log.split("\n")));
  return (async function* () {
    const seen = await baseline;
    while (!signal.aborted) {
      await sleep(pollMs, signal);
      if (signal.aborted) {
        return;
      }
      for (const line of (await read()).split("\n")) {
        if (seen.has(line)) {
          continue;
        }
        seen.add(line);
        const event = parseSignInEvent(line);
        if (event !== undefined) {
          yield event;
        }
      }
    }
  })();
}
