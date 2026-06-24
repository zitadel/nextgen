import { resolveTelemetryToken } from "./config";

/**
 * Outcome of resolving whether telemetry may run for this invocation. `reason`
 * is a stable token (handy in tests and `--debug` logs) explaining the
 * decision; it is never sent anywhere.
 */
export type Consent = {
  readonly enabled: boolean;
  readonly reason:
    | "enabled"
    | "no-token"
    | "do-not-track"
    | "env-opt-out"
    | "flag-opt-out"
    | "test-runner";
  /** The resolved ingestion token, present only when `enabled` — so the caller never re-resolves it. */
  readonly token?: string;
};

/** Inputs that can disable telemetry, kept explicit so the matrix is testable. */
export type ConsentInput = {
  readonly env: NodeJS.ProcessEnv;
  /** The resolved `--telemetry/--no-telemetry` flag value (default true). */
  readonly flag?: boolean;
};

const DISABLED_VALUES = new Set(["0", "false", "off", "no"]);

/**
 * Resolve telemetry consent under an opt-out model: on by default, but any of
 * several explicit signals turns it off, in precedence order.
 *
 * 1. `--no-telemetry` on the command line — the most explicit, per-invocation.
 * 2. An automated test run (`VITEST`/`NODE_ENV=test`) — never emit synthetic
 *    traffic or pay the shutdown flush; spawned CLI subprocesses inherit it.
 * 3. `DO_NOT_TRACK` — the cross-tool standard (https://consoledonottrack.com);
 *    any value other than `0`/empty disables.
 * 4. `ZITADEL_TELEMETRY` set to a falsey token (`0`/`false`/`off`/`no`).
 * 5. No ingestion token configured for the active channel — nothing to send to,
 *    so telemetry is inert regardless of consent.
 *
 * Consent being enabled does not by itself send anything; the caller still
 * builds the client lazily and fails open on any transport error.
 */
export function resolveConsent(input: ConsentInput): Consent {
  if (input.flag === false) {
    return { enabled: false, reason: "flag-opt-out" };
  }

  if (input.env.VITEST || input.env.NODE_ENV === "test") {
    return { enabled: false, reason: "test-runner" };
  }

  const doNotTrack = input.env.DO_NOT_TRACK?.trim();
  if (doNotTrack && doNotTrack !== "0") {
    return { enabled: false, reason: "do-not-track" };
  }

  const explicit = input.env.ZITADEL_TELEMETRY?.trim().toLowerCase();
  if (explicit !== undefined && DISABLED_VALUES.has(explicit)) {
    return { enabled: false, reason: "env-opt-out" };
  }

  const token = resolveTelemetryToken(input.env);
  if (!token) {
    return { enabled: false, reason: "no-token" };
  }

  return { enabled: true, reason: "enabled", token };
}
