import { ZitadelError } from "./errors";

/**
 * Ctrl-C for requests to the platform.
 *
 * Node exits on SIGINT only while nothing listens for it. A spinner does
 * listen — clack's stops its animation and returns — so a request stalled
 * behind one used to outlive the keypress. While a request is in flight this
 * module holds its own listener and aborts the shared signal, so the request
 * rejects with `E_CANCELLED` and the command unwinds through its normal error
 * path instead of hanging.
 *
 * The listener exists only while a request is in flight. Outside one, Ctrl-C
 * means whatever it meant before: Node's default exit, or a command's own
 * handler (`logs --follow` stops following). The signal stays aborted for the
 * rest of the command once fired, so a caller that swallows the first
 * rejection cannot start another request — every later one fails the same way.
 */
let controller = new AbortController();
let inFlight = 0;

/**
 * The signal the current command's requests are bound to: aborted once Ctrl-C
 * has been pressed during one of them.
 */
export function interruptSignal(): AbortSignal {
  return controller.signal;
}

/**
 * Starts a fresh scope as a command begins, so a Ctrl-C belongs to the command
 * it was pressed in. Only matters when commands share a process, as specs do.
 */
export function resetInterrupt(): void {
  controller = new AbortController();
}

function onInterrupt(): void {
  controller.abort(
    new ZitadelError("E_CANCELLED", "Cancelled", {
      hint: "The request was cancelled with Ctrl-C before the server answered.",
    }),
  );
}

/** Runs `work` with Ctrl-C bound to {@link interruptSignal}. */
export async function interruptible<T>(work: () => Promise<T>): Promise<T> {
  if (inFlight === 0) {
    process.on("SIGINT", onInterrupt);
  }
  inFlight += 1;
  try {
    return await work();
  } finally {
    inFlight -= 1;
    if (inFlight === 0) {
      process.off("SIGINT", onInterrupt);
    }
  }
}
