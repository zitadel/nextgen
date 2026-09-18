import { ZitadelError } from "../errors";
import { isObject } from "../json";

/**
 * The small HTTP helpers the local-admin calls share. Every request here runs
 * against a server that already answered `/healthz`, so a stall means a wedged
 * server rather than a slow start — hence the bound, which keeps
 * `zitadel start` from hanging on a socket that accepts and never answers.
 */
const REQUEST_TIMEOUT_MS = 10_000;

export type JsonResponse = {
  ok: boolean;
  status: number;
  body: unknown;
  /** `Set-Cookie` values, for the flow's sealed state cookie and the session. */
  cookies: string[];
};

export async function fetchJson(url: string, init: RequestInit): Promise<JsonResponse> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return {
    ok: res.ok,
    status: res.status,
    body: await res.json().catch(() => undefined),
    cookies: res.headers.getSetCookie(),
  };
}

export async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<JsonResponse> {
  return fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** The fallback error for a response that carries no more specific reason. */
export function apiError(action: string, res: JsonResponse): ZitadelError {
  const message =
    isObject(res.body) && typeof res.body.message === "string"
      ? res.body.message
      : "unexpected response";
  return new ZitadelError(
    "E_AUTH",
    `Local admin ${action} failed (${String(res.status)}): ${message}`,
    { details: { status: res.status, body: res.body } },
  );
}
