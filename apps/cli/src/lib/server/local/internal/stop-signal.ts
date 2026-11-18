/**
 * A signal that aborts when the run is interrupted (its Ctrl-C) or the CLI is
 * asked to stop, for what runs until then, such as following a log. `dispose`
 * stops listening.
 *
 * @param interrupted - The run's Ctrl-C, already aborted if it was pressed
 *   before this began, so a keypress before the follower started still stops it.
 * @returns The signal, and how to stop listening.
 */
export function stopSignal(interrupted: AbortSignal): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };
  if (interrupted.aborted) {
    abort();
  } else {
    interrupted.addEventListener("abort", abort, { once: true });
  }
  process.once("SIGTERM", abort);
  return {
    signal: controller.signal,
    dispose: () => {
      interrupted.removeEventListener("abort", abort);
      process.off("SIGTERM", abort);
    },
  };
}
