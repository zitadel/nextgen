import type { Modifiers, Properties } from "mixpanel";

/**
 * A destination for telemetry events.
 *
 * A sink never throws and never rejects: a failed send is dropped, because
 * telemetry must not degrade the program it observes. Sends start at once and
 * run side by side; {@link TelemetrySink.flush} is how the caller waits for
 * the ones still in the air on its way out.
 */
export interface TelemetrySink {
  /** Sends one event. */
  track(event: string, payload: Properties): void;

  /** Writes the user's profile, where the destination has one. */
  profile(payload: Properties, modifiers: Modifiers): void;

  /** Resolves when every send so far is over, or after `timeoutMs`, whichever comes first. */
  flush(timeoutMs: number): Promise<void>;
}

/**
 * Writes one line of the `--debug` trace to stderr, and nothing without `--debug`.
 *
 * @param debug - Whether `--debug` is on.
 * @param line - Builds the line. It runs only when `debug` is on, so a payload
 * that cannot be serialised cannot fail a run that is not being traced.
 */
export function trace(debug: boolean, line: () => string): void {
  if (debug) {
    process.stderr.write(`[telemetry] ${line()}\n`);
  }
}
