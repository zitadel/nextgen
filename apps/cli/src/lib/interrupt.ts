import { ZitadelError } from "./errors";

/**
 * Ctrl-C for the running command.
 *
 * Node exits on SIGINT only while nothing listens for it, and a spinner does
 * listen — clack's stops its animation and returns — so a request stalled
 * behind one used to outlive the keypress. Instead the command listens for
 * itself: the first Ctrl-C aborts {@link interruptSignal}, which every platform
 * request is bound to, so a waiting request rejects with `E_CANCELLED` and the
 * command unwinds through its normal error path.
 *
 * Work that is not a request does not see the signal, so the first Ctrl-C also
 * arms a short grace: a command still running when it lapses exits 130. A
 * second Ctrl-C exits at once. A command with its own handler (`logs --follow`
 * stops following) finishes inside the grace and exits as it always did.
 */
const GRACE_MS = 1_000;

let controller = new AbortController();
let grace: NodeJS.Timeout | undefined;

/**
 * Aborted once Ctrl-C has been pressed in the current command, and stays
 * aborted, so a caller that swallows the first rejection cannot start another
 * request.
 */
export function interruptSignal(): AbortSignal {
  return controller.signal;
}

function onInterrupt(): void {
  if (controller.signal.aborted) {
    process.exit(130);
  }
  controller.abort(
    new ZitadelError("E_CANCELLED", "Cancelled", {
      hint: "The command was cancelled with Ctrl-C.",
    }),
  );
  grace = setTimeout(() => process.exit(130), GRACE_MS);
  grace.unref();
}

/** Starts listening as a command begins, with a signal of its own. */
export function listenForInterrupt(): void {
  stopListeningForInterrupt();
  controller = new AbortController();
  process.on("SIGINT", onInterrupt);
}

/**
 * Stops listening as the command ends. Only matters when commands share a
 * process, as specs do: the grace must not outlive the command that armed it.
 */
export function stopListeningForInterrupt(): void {
  process.off("SIGINT", onInterrupt);
  clearTimeout(grace);
  grace = undefined;
}
