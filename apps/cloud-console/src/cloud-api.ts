import type { ErrorBody } from "@zitadel/cloud-functions/contract";

/**
 * The cloud's functions (`apps/cloud-functions`), on the console's own origin,
 * so the session cookie rides along and no CORS is involved (root ADR 083).
 * The console's dev server proxies the prefix to the functions' dev server
 * (`vite.ts`).
 */
export const CLOUD_API_BASE = "/cloud/api";

/** A refused or failed call, with the code the functions answered. */
export class CloudApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CloudApiError";
    this.status = status;
    this.code = code;
  }
}

export function cloudGet<T>(path: string): Promise<T> {
  return call<T>("GET", path);
}

/**
 * A call that changes something. JSON only: a cross-origin form cannot send
 * it, and the functions also refuse a foreign `Origin`.
 */
export function cloudSend<T>(method: "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  return call<T>(method, path, body ?? {});
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${CLOUD_API_BASE}${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const answer = (await response.json().catch(() => undefined)) as ErrorBody | undefined;
    throw new CloudApiError(
      response.status,
      answer?.error.code ?? "cloud.unavailable",
      answer?.error.message ?? `The cloud's functions answered ${response.status}.`,
    );
  }
  return (await response.json()) as T;
}
