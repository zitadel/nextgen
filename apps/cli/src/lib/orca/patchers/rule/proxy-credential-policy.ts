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
    const [whole = "", condition = "", body = ""] = match;
    if (
      !/proxyReq\s*\.\s*method\s*===\s*["']POST["']/i.test(condition) ||
      !/pathname\s*===\s*["']\/sessions\/exchange["']/i.test(condition) ||
      !/!\s*proxyReq\s*\.\s*getHeader\s*\(\s*["']authorization["']\s*\)/i.test(condition) ||
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

/**
 * Marks the generated code that keeps the session token out of the browser.
 * A dev proxy that carries it has the redaction; a generated one without it
 * was written before the redaction existed and is upgraded in place.
 */
export const EXCHANGE_REDACTION_MARKER = "zitadel:proxy:exchange-redaction";

/**
 * The functions a generated dev proxy uses to keep the session token out of
 * page JavaScript, each line indented by `indent`.
 *
 * `POST /sessions/exchange` answers with the session and its token, which the
 * backend also sets as the HttpOnly session cookie. Relayed verbatim, the body
 * would hand every script on the page the token HttpOnly keeps from it, and the
 * widget reads only the cookie. So the proxy asks the backend for an unencoded
 * exchange response, reads it, drops the credential fields, and answers with
 * the backend's status and headers (`Set-Cookie` included), a recomputed
 * `Content-Length` and no `Content-Encoding`. A body that is not a JSON object,
 * or carries no credential field, goes out exactly as it came. Every other
 * response streams through untouched.
 *
 * The proxy must run with `selfHandleResponse: true`, so `relayResponse` writes
 * every response itself. The field list mirrors `EXCHANGE_CREDENTIAL_FIELDS` in
 * `@zitadel/sdk-core/middleware`; it is inlined because a scaffolded app does
 * not depend on sdk-core.
 */
export function exchangeRedactionFunctions(indent: string): string {
  return `/* ${EXCHANGE_REDACTION_MARKER} */
// The exchange answers with the session token the backend also sets as an
// HttpOnly cookie. The browser gets the cookie only. The field list mirrors
// EXCHANGE_CREDENTIAL_FIELDS in @zitadel/sdk-core/middleware.
const EXCHANGE_CREDENTIAL_FIELDS = ["session_token"];

function isExchange(method, url) {
  const pathname = new URL(url ?? "/", "http://zitadel.local").pathname;
  return method === "POST" && pathname.endsWith("/sessions/exchange");
}

function requestPlainExchange(proxyReq) {
  if (isExchange(proxyReq.method, proxyReq.path)) {
    proxyReq.removeHeader("accept-encoding");
  }
}

function relayResponse(proxyRes, req, res) {
  if (!isExchange(req.method, req.url)) {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res);
    return;
  }
  const chunks = [];
  proxyRes.on("data", (chunk) => chunks.push(chunk));
  proxyRes.on("end", () => {
    let body = Buffer.concat(chunks);
    const headers = { ...proxyRes.headers };
    try {
      const json = JSON.parse(body.toString("utf8"));
      const found = EXCHANGE_CREDENTIAL_FIELDS.filter((field) => Object.hasOwn(Object(json), field));
      if (found.length > 0 && !Array.isArray(json)) {
        for (const field of found) {
          delete json[field];
        }
        body = Buffer.from(JSON.stringify(json));
        delete headers["content-encoding"];
        delete headers["transfer-encoding"];
        headers["content-length"] = String(body.length);
      }
    } catch {
      // Not JSON: an error page, say. It carries no session token.
    }
    res.writeHead(proxyRes.statusCode ?? 502, headers);
    res.end(body);
  });
}`
    .split("\n")
    .map((line) => (line === "" ? line : `${indent}${line}`))
    .join("\n");
}
