import type { FlagVariable } from "../oclif/types";

/**
 * Outcome of resolving whether telemetry may run for this invocation. `reason`
 * is a stable token (handy in tests and `--debug` logs) explaining the
 * decision; it is never sent anywhere.
 */
export type Consent = {
  readonly enabled: boolean;
  readonly reason: "enabled" | "do-not-track" | "env-opt-out" | "flag-opt-out" | "test-runner";
};

/** Inputs that can disable telemetry, kept explicit so the matrix is testable. */
export type ConsentInput = {
  readonly env: NodeJS.ProcessEnv;
  /** The resolved `--telemetry/--no-telemetry` flag value (default true). */
  readonly flag?: boolean;
};

/** The cross-tool opt-out. */
export const DO_NOT_TRACK: FlagVariable = {
  name: "DO_NOT_TRACK",
  flag: "telemetry",
  description:
    "Any value but `0` or an empty one turns telemetry off (https://consoledonottrack.com).",
  precedence: "Turns telemetry off even with `--telemetry`.",
};

/** The values of {@link ZITADEL_TELEMETRY}, trimmed and lowercased, that turn telemetry off. */
const DISABLED_VALUES = new Set(["", "0", "false", "off", "no"]);

/** The CLI's own opt-out. */
export const ZITADEL_TELEMETRY: FlagVariable = {
  name: "ZITADEL_TELEMETRY",
  flag: "telemetry",
  description: `An empty value or one of ${[...DISABLED_VALUES]
    .filter((value) => value !== "")
    .map((value) => `\`${value}\``)
    .join(", ")} turns telemetry off.`,
  precedence: "Turns telemetry off even with `--telemetry`.",
};

/**
 * Resolve telemetry consent under an opt-out model: on by default, but any of
 * several explicit signals turns it off, in precedence order.
 *
 * 1. `--no-telemetry` on the command line — the most explicit, per-invocation.
 * 2. `DO_NOT_TRACK` — the cross-tool standard (https://consoledonottrack.com);
 *    any value other than `0`/empty disables.
 * 3. `ZITADEL_TELEMETRY` set to a falsey token (`0`/`false`/`off`/`no`).
 * 4. An automated test run (`VITEST`/`NODE_ENV=test`) — never emit synthetic
 *    traffic or pay the shutdown flush; spawned CLI subprocesses inherit it.
 *
 * The user's own choices (1–3) come first so `reason` reports them even in a
 * test shell: the user agent reads it to decide whether to describe the
 * user's environment.
 *
 * Consent being enabled does not by itself send anything; the caller still
 * needs somewhere to send (a Mixpanel token or the Vercel copy) and fails open
 * on any transport error.
 */
export function resolveConsent(input: ConsentInput): Consent {
  if (input.flag === false) {
    return { enabled: false, reason: "flag-opt-out" };
  }

  const doNotTrack = input.env[DO_NOT_TRACK.name]?.trim();
  if (doNotTrack && doNotTrack !== "0") {
    return { enabled: false, reason: "do-not-track" };
  }

  const explicit = input.env[ZITADEL_TELEMETRY.name]?.trim().toLowerCase();
  if (explicit !== undefined && DISABLED_VALUES.has(explicit)) {
    return { enabled: false, reason: "env-opt-out" };
  }

  if (input.env.VITEST || input.env.NODE_ENV === "test") {
    return { enabled: false, reason: "test-runner" };
  }

  return { enabled: true, reason: "enabled" };
}
