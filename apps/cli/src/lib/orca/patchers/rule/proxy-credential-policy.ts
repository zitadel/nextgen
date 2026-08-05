import { ZitadelError } from "../../../errors";
import { PROXY_PATH } from "./proxy";

/** Marker emitted after the exchange-only credential policy was introduced. */
export const PROXY_CREDENTIAL_POLICY_MARKER = "zitadel:proxy:v2";

/**
 * Rejects a browser-reachable proxy that still appears to attach the project
 * secret without the complete exchange-only guard. Known generated legacy
 * bytes are migrated before this runs; anything else stays user-owned and is
 * surfaced for manual review instead of being silently counted as healthy by
 * `zitadel doctor`.
 */
export function assertNoUnreviewedProjectSecretProxy(source: string, label: string): void {
  if (
    !source.includes(PROXY_PATH) ||
    !source.includes("ZITADEL_PROJECT_SECRET") ||
    !/authorization/i.test(source) ||
    hasExchangeOnlyGuard(source)
  ) {
    return;
  }

  throw new ZitadelError(
    "E_VALIDATION",
    `${label} may forward ZITADEL_PROJECT_SECRET outside POST /sessions/exchange`,
    {
      hint: "Review the proxy manually: restrict the bearer to the exact POST /sessions/exchange pathname and preserve caller-provided authorization.",
    },
  );
}

function hasExchangeOnlyGuard(source: string): boolean {
  const authorizationSetter = /proxyReq\s*\.\s*setHeader\s*\(\s*["']authorization["']\s*,/gi;
  const setterOffsets = [...source.matchAll(authorizationSetter)].map((match) => match.index);
  if (setterOffsets.length === 0) {
    return false;
  }

  const safeBodyRanges: Array<Readonly<{ start: number; end: number }>> = [];
  const ifBlock = /if\s*\(([\s\S]*?)\)\s*\{([\s\S]*?)\}/g;
  for (const match of source.matchAll(ifBlock)) {
    const condition = match[1];
    const body = match[2];
    if (
      !/proxyReq\s*\.\s*method\s*===\s*["']POST["']/i.test(condition) ||
      !/pathname\s*===\s*["']\/sessions\/exchange["']/i.test(condition) ||
      !/!\s*proxyReq\s*\.\s*getHeader\s*\(\s*["']authorization["']\s*\)/i.test(condition) ||
      !/proxyReq\s*\.\s*setHeader\s*\(\s*["']authorization["']\s*,/i.test(body)
    ) {
      continue;
    }

    const bodyOffset = match[0].lastIndexOf(body);
    const start = match.index + bodyOffset;
    safeBodyRanges.push({ start, end: start + body.length });
  }

  // Every project-secret authorization write must live inside the same exact
  // method/path/no-overwrite guard. A decoy guard next to an unconditional
  // write must not make doctor report the file as healthy.
  return setterOffsets.every((offset) =>
    safeBodyRanges.some(({ start, end }) => offset >= start && offset < end),
  );
}
