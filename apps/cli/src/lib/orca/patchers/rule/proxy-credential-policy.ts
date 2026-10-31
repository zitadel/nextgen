import { API_PREFIX } from "@zitadel/api/runtime/base-url";

import { ZitadelError } from "../../../errors";
import { PROXY_PATH } from "./proxy";

/**
 * Marker emitted with the exchange-only credential policy. Its v3 also attaches
 * the secret to the exchange under the API prefix (ADR 077).
 */
export const PROXY_CREDENTIAL_POLICY_MARKER = "zitadel:proxy:v3";

/** The marker of the exchange-only policy as it was before it knew the API prefix. */
export const PROXY_CREDENTIAL_POLICY_V2_MARKER = "zitadel:proxy:v2";

/** Whether `source` carries the credential-policy marker of either version. */
export function hasProxyCredentialPolicyMarker(source: string): boolean {
  return (
    source.includes(PROXY_CREDENTIAL_POLICY_MARKER) ||
    source.includes(PROXY_CREDENTIAL_POLICY_V2_MARKER)
  );
}

/**
 * The generated proxies' path check: the exchange with and without the API
 * prefix, since the server answers both until 1.0.0 and an app's packages may
 * call either.
 */
export const EXCHANGE_PATH_CHECK = `(pathname === "/sessions/exchange" || pathname === "${API_PREFIX}/sessions/exchange")`;

/** The path check of a v2 proxy, which knew only the unprefixed exchange. */
export const V2_EXCHANGE_PATH_CHECK = 'pathname === "/sessions/exchange"';

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
      hint: `Review the proxy manually: restrict the bearer to the exact POST /sessions/exchange or ${API_PREFIX}/sessions/exchange pathname and preserve caller-provided authorization.`,
    },
  );
}

/** `code` without whitespace, with double quotes, so a formatter's layout compares equal. */
function normalized(code: string): string {
  return code.replace(/\s+/g, "").replace(/'/g, '"');
}

/** The terms of the conditions a guard may be built from, normalized. */
const POST_TERM = 'proxyReq.method==="POST"';
const NO_OVERWRITE_TERM = '!proxyReq.getHeader("authorization")';
const PATH_TERMS = new Set([
  normalized(V2_EXCHANGE_PATH_CHECK),
  normalized(EXCHANGE_PATH_CHECK),
  normalized(
    `(pathname === "${API_PREFIX}/sessions/exchange" || pathname === "/sessions/exchange")`,
  ),
]);

/** `condition`'s terms joined by `&&` outside any parentheses. */
function andTerms(condition: string): string[] {
  const terms: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < condition.length; index++) {
    const char = condition[index];
    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
    } else if (depth === 0 && condition.startsWith("&&", index)) {
      terms.push(condition.slice(start, index));
      start = index + 2;
      index++;
    }
  }
  terms.push(condition.slice(start));
  return terms;
}

/**
 * Whether an `if` condition holds the bearer to the exchange: exactly the POST
 * check, the path check (the exchange, or both its spellings joined by `||`)
 * and the no-overwrite check, in any order. Anything more could widen it, as
 * `… || true` would, so it does not qualify.
 */
function isExchangeOnlyCondition(condition: string): boolean {
  const terms = andTerms(normalized(condition));
  return (
    terms.length === 3 &&
    terms.includes(POST_TERM) &&
    terms.includes(NO_OVERWRITE_TERM) &&
    terms.some((term) => PATH_TERMS.has(term))
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
    const [whole = "", condition = "", body = ""] = match;
    if (
      !isExchangeOnlyCondition(condition) ||
      !/proxyReq\s*\.\s*setHeader\s*\(\s*["']authorization["']\s*,/i.test(body)
    ) {
      continue;
    }

    const bodyOffset = whole.lastIndexOf(body);
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
