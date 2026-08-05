/**
 * Console runtime discovery (Console ADR 0004 §2).
 *
 * The embedded console is one build artifact serving every deployment, so
 * deployment facts are discovered at boot instead of baked in: the server
 * publishes a small public runtime-metadata document and the console fetches
 * it once before the router renders (`src/main.tsx`). Everything in the
 * document is public runtime metadata in the root ADR 005 sense — an enum
 * and project ids, never secrets or feature inventories (per-surface gating
 * rides effective permissions, ADR 0004 §4).
 *
 * A fetch failure — including `vite preview`, which proxies nothing — falls
 * back to `standalone` with no ids, so a broken endpoint degrades to the
 * smallest surface, never to an accidental portal.
 */

/** The payload of `GET /console/runtime.json`, served by the Go mux. */
export interface ConsoleRuntime {
  /** `"platform"` (cloud portal) is future work; servers send `"standalone"` today. */
  mode: "platform" | "standalone";
  /**
   * The one project the console signs into and manages: in standalone the
   * deployment's single tracked project — first-created (by `zitadel
   * setup`) or the configured pin; in future platform mode, the platform
   * project. Absent while no project exists yet; the login screen then
   * shows its setup hint.
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

/**
 * Absolute same-origin path, deliberately not under the console's BASE_URL:
 * the Go server serves it at the root mux (dev: proxied in
 * `vite.config.mts`), independent of where the SPA is mounted.
 */
export const RUNTIME_URL = "/console/runtime.json";

const FALLBACK: ConsoleRuntime = { mode: "standalone" };

let runtime: ConsoleRuntime = FALLBACK;
let initialized = false;

/**
 * Fetches the runtime document once. Idempotent; later calls return the
 * cached result. Never throws — any failure resolves to the standalone
 * fallback.
 */
export async function initRuntime(): Promise<ConsoleRuntime> {
  if (initialized) return runtime;
  initialized = true;
  try {
    const response = await fetch(RUNTIME_URL, { credentials: "same-origin" });
    if (response.ok) {
      runtime = parseRuntime(await response.json()) ?? FALLBACK;
    }
  } catch {
    // Unreachable endpoint (preview builds, dev without a backend) — keep
    // the standalone fallback.
  }
  return runtime;
}

/** The discovered runtime document (fallback until {@link initRuntime} resolves). */
export function getRuntime(): ConsoleRuntime {
  return runtime;
}

/**
 * The project the console operates on: the `VITE_CONSOLE_PROJECT_ID` dev
 * override when set (it must match the dev proxy's project secret),
 * otherwise the discovered `console_project_id` (ADR 0004 §5).
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
  initialized = false;
}
