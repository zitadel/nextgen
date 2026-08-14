/**
 * Console runtime discovery (Console ADR 0004 §3).
 *
 * The embedded console is one build artifact serving every deployment, so
 * deployment facts are discovered at boot instead of baked in: the server
 * publishes a small public runtime-metadata document and the console fetches
 * it once before the router renders (`src/main.tsx`). Everything in the
 * document is public runtime metadata in the root ADR 005 sense — an enum
 * and project ids, never secrets or feature inventories (per-surface gating
 * rides effective permissions, ADR 0004 §5).
 *
 * Discovery has three outcomes, and ADR 0004 §3 keeps them distinct because
 * each asks a different thing of the operator:
 *
 * 1. **reachable and provisioned** — the document names a sign-in project;
 *    the console boots normally.
 * 2. **reachable and not provisioned** — a 2xx document without
 *    `console_project_id`; the login screen shows its `zitadel setup` hint.
 * 3. **unreachable, non-2xx, or unreadable** — {@link initRuntime} reports a
 *    {@link ConsoleRuntimeFailure} and `main.tsx` renders a retryable
 *    connectivity error. Guessing `standalone` here would report a server
 *    outage as "no project yet" and send an operator to run `zitadel setup`
 *    against a problem setup cannot fix.
 *
 * Builds that deliberately run without a runtime document — `vite preview`,
 * the api-mock dev loop — collapse state 3 into state 2 by opting in with
 * `VITE_CONSOLE_RUNTIME_FALLBACK`. That opt-in is the only path back to the
 * old silent fallback, and the embedded production build never sets it.
 */

/** The payload of `GET /console/runtime.json`, served by the Go mux. */
export interface ConsoleRuntime {
  /** `"platform"` (cloud portal) is future work; servers send `"standalone"` today. */
  mode: "platform" | "standalone";
  /**
   * The project used to sign in to the Console. Today this is the standalone
   * default discovered through the first-created/configured fallback retained
   * by ADR 0004 §2's cutover rule. The target in §3 is the reserved platform
   * project. It identifies the Console's sign-in identity plane, not the set
   * of customer projects that identity may manage. Absent while no project
   * exists yet; the login screen then shows its setup hint.
   */
  console_project_id?: string;
  /**
   * The default project's **publishable key** (root ADR 036): browser-safe
   * and origin-scoped by construction. The login widget sends it as the
   * bearer on public-plane calls — most importantly the handoff exchange,
   * the one sign-in step that requires a credential — so sign-in needs no
   * server-side secret injection.
   */
  publishable_key?: string;
}

/** Why discovery produced no document — ADR 0004 §3's third state. */
export interface ConsoleRuntimeFailure {
  /** The HTTP status, when the endpoint answered at all. */
  status?: number;
  /** Operator-facing clause, rendered into the connectivity error screen. */
  detail: string;
}

/** What {@link initRuntime} resolved to: a usable document, or why there is none. */
export type ConsoleRuntimeResult =
  | { ok: true; runtime: ConsoleRuntime }
  | { ok: false; failure: ConsoleRuntimeFailure };

/**
 * Absolute same-origin path, deliberately not under the console's BASE_URL:
 * the Go server serves it at the root mux (dev: proxied in
 * `vite.config.mts`), independent of where the SPA is mounted.
 */
export const RUNTIME_URL = "/console/runtime.json";

const FALLBACK: ConsoleRuntime = { mode: "standalone" };

let runtime: ConsoleRuntime = FALLBACK;
let settled: ConsoleRuntimeResult | undefined;
let pending: Promise<ConsoleRuntimeResult> | undefined;

/**
 * Fetches the runtime document once. Idempotent; concurrent and later calls
 * share the first result. Never throws — a failed discovery resolves to an
 * `ok: false` result the caller renders (see {@link retryRuntime}).
 */
export async function initRuntime(): Promise<ConsoleRuntimeResult> {
  if (settled) return settled;
  pending ??= discover()
    .then((result) => {
      settled = result;
      return result;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

/**
 * Re-runs discovery after a failure — what the connectivity error screen's
 * retry button calls. A document that already resolved is kept: it is a
 * per-boot fact, and re-reading it mid-session would swap the sign-in project
 * under a mounted router.
 */
export async function retryRuntime(): Promise<ConsoleRuntimeResult> {
  if (settled?.ok) return settled;
  settled = undefined;
  return initRuntime();
}

/**
 * The discovered runtime document. Falls back to the standalone shape before
 * discovery resolves and after it fails — in the failure case nothing renders
 * from it, because `main.tsx` shows the connectivity error instead of the app.
 */
export function getRuntime(): ConsoleRuntime {
  return runtime;
}

/**
 * The project the console operates on: the `VITE_CONSOLE_PROJECT_ID` dev
 * override when set (it must match the dev proxy's project secret),
 * otherwise the discovered `console_project_id` (ADR 0004 §3).
 */
export function getConsoleProjectId(): string {
  return import.meta.env.VITE_CONSOLE_PROJECT_ID || getRuntime().console_project_id || "";
}

/**
 * The discovered publishable key, or `undefined` when the server does not
 * serve one (older servers, no project yet). Without it the login widget's
 * handoff exchange falls back to the dev proxy's secret injection.
 */
export function getPublishableKey(): string | undefined {
  return getRuntime().publishable_key;
}

async function discover(): Promise<ConsoleRuntimeResult> {
  let response: Response;
  try {
    response = await fetch(RUNTIME_URL, { credentials: "same-origin" });
  } catch (cause) {
    return failed({ detail: `the request failed (${describeCause(cause)})` });
  }

  if (!response.ok) {
    return failed({ status: response.status, detail: `the server answered ${response.status}` });
  }

  let document: unknown;
  try {
    document = await response.json();
  } catch {
    return failed({ status: response.status, detail: "the response was not valid JSON" });
  }

  const parsed = parseRuntime(document);
  if (!parsed) {
    // A 2xx body the console cannot read is a broken server, not an
    // unprovisioned one — the same reason §3 refuses to guess a mode.
    return failed({ status: response.status, detail: "the response was not a runtime document" });
  }

  runtime = parsed;
  return { ok: true, runtime: parsed };
}

/**
 * Turns a discovery failure into a result. Honors the backend-less opt-in
 * (`VITE_CONSOLE_RUNTIME_FALLBACK`), which is the only way back to the
 * pre-§3 behavior of treating an absent document as `standalone` — and warns
 * when it fires, so a build carrying the flag by accident says so out loud.
 */
function failed(failure: ConsoleRuntimeFailure): ConsoleRuntimeResult {
  if (!runtimeFallbackEnabled()) return { ok: false, failure };
  console.warn(
    `[console] runtime discovery failed (${failure.detail}); VITE_CONSOLE_RUNTIME_FALLBACK is set, ` +
      `continuing with the built-in ${FALLBACK.mode} document.`,
  );
  runtime = FALLBACK;
  return { ok: true, runtime: FALLBACK };
}

function runtimeFallbackEnabled(): boolean {
  const flag = import.meta.env.VITE_CONSOLE_RUNTIME_FALLBACK;
  return flag !== undefined && flag !== "" && flag !== "0" && flag !== "false";
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function parseRuntime(doc: unknown): ConsoleRuntime | undefined {
  if (typeof doc !== "object" || doc === null) return undefined;
  const record = doc as Record<string, unknown>;
  if (record.mode !== "standalone" && record.mode !== "platform") return undefined;
  return {
    mode: record.mode,
    console_project_id: optionalString(record.console_project_id),
    publishable_key: optionalString(record.publishable_key),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Test-only: drop the cached document so specs can exercise `initRuntime` again. */
export function _resetRuntimeForTesting(): void {
  runtime = FALLBACK;
  settled = undefined;
  pending = undefined;
}
