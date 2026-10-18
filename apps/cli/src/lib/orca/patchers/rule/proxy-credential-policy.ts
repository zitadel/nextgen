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
 * A dev proxy that carries it has the current redaction; a generated one
 * without it was written by an earlier CLI and is upgraded in place.
 */
export const EXCHANGE_REDACTION_MARKER = "zitadel:proxy:exchange-redaction:v2";

/**
 * The name the redaction calls `node:zlib` by when it decodes a compressed
 * exchange answer, so the file around it imports (Vite) or requires (Angular)
 * the module under this name.
 */
export const EXCHANGE_REDACTION_ZLIB = "zitadelZlib";

/**
 * The functions a generated dev proxy uses to keep the session token out of
 * page JavaScript, each line indented by `indent`.
 *
 * `POST /sessions/exchange` answers with the session and its token, which the
 * backend also sets as the HttpOnly session cookie. Relayed verbatim, the body
 * would hand every script on the page the token HttpOnly keeps from it, and the
 * widget reads only the cookie. So the proxy asks the backend for an unencoded
 * (`identity`) exchange response, reads it, drops the credential fields, and
 * answers with the backend's status and headers (`Set-Cookie` included), a
 * recomputed `Content-Length` and no `Content-Encoding`.
 *
 * A backend, or an intermediary in front of it, may compress the answer anyway,
 * so a `gzip`, `deflate` or `br` body is decoded before it is read. One that
 * cannot be decoded is never relayed — the browser would decode it and see the
 * token — and is answered `502` instead, as is a successful answer that is not
 * JSON at all: a reader more lenient than the proxy might still find the token
 * in it. A JSON body that is not an object, or carries no credential field, and
 * an error answer that is not JSON, go out as they came. Every other
 * response streams through untouched. When the backend drops the connection
 * mid-answer, the browser's connection is closed too rather than left waiting.
 *
 * The proxy must run with `selfHandleResponse: true`, so `relayResponse` writes
 * every response itself. The field list mirrors `EXCHANGE_CREDENTIAL_FIELDS` in
 * `@zitadel/sdk-core/middleware`; it is inlined because a scaffolded app does
 * not depend on sdk-core.
 */
export function exchangeRedactionFunctions(indent: string, typed = false): string {
  const ty = (annotation: string): string => (typed ? annotation : "");
  return indented(
    `/* ${EXCHANGE_REDACTION_MARKER} */
// The exchange answers with the session token the backend also sets as an
// HttpOnly cookie. The browser gets the cookie only. The field list mirrors
// EXCHANGE_CREDENTIAL_FIELDS in @zitadel/sdk-core/middleware.
const EXCHANGE_CREDENTIAL_FIELDS = ["session_token"];
const EXCHANGE_DECODERS${ty(": Record<string, (body: Buffer) => Buffer>")} = {
  br: ${EXCHANGE_REDACTION_ZLIB}.brotliDecompressSync,
  deflate: ${EXCHANGE_REDACTION_ZLIB}.inflateSync,
  gzip: ${EXCHANGE_REDACTION_ZLIB}.gunzipSync,
  "x-gzip": ${EXCHANGE_REDACTION_ZLIB}.gunzipSync,
};

function isExchange(method${ty(": string | undefined")}, url${ty(": string | undefined")})${ty(": boolean")} {
  const pathname = new URL(url ?? "/", "http://zitadel.local").pathname;
  return method === "POST" && pathname.endsWith("/sessions/exchange");
}

function requestPlainExchange(proxyReq${ty(': import("node:http").ClientRequest')})${ty(": void")} {
  if (isExchange(proxyReq.method, proxyReq.path)) {
    proxyReq.setHeader("accept-encoding", "identity");
  }
}

function decodeExchange(body${ty(": Buffer")}, contentEncoding${ty(": string | string[] | undefined")})${ty(": Buffer")} {
  const codings = String(contentEncoding ?? "")
    .split(",")
    .map((coding) => coding.trim().toLowerCase())
    .filter((coding) => coding !== "" && coding !== "identity");
  return codings.reduceRight((decoded${ty(": Buffer")}, coding) => {
    if (!Object.hasOwn(EXCHANGE_DECODERS, coding)) {
      throw new Error(\`unsupported content-encoding \${coding}\`);
    }
    return EXCHANGE_DECODERS[coding](decoded);
  }, body);
}

function relayResponse(
  proxyRes${ty(': import("node:http").IncomingMessage')},
  req${ty(': import("node:http").IncomingMessage')},
  res${ty(': import("node:http").ServerResponse')},
)${ty(": void")} {
  const abandon = () => res.destroy();
  proxyRes.on("error", abandon);
  proxyRes.on("aborted", abandon);
  if (!isExchange(req.method, req.url)) {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res);
    return;
  }
  const chunks${ty(": Buffer[]")} = [];
  proxyRes.on("data", (chunk${ty(": Buffer")}) => chunks.push(chunk));
  proxyRes.on("end", () => {
    if (res.destroyed) {
      return;
    }
    const headers = { ...proxyRes.headers };
    let body${ty(": Buffer")};
    try {
      body = decodeExchange(Buffer.concat(chunks), headers["content-encoding"]);
    } catch {
      // Never relay a body the proxy could not read: the browser would decode
      // it, session token and all.
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("The session exchange answer could not be decoded.");
      return;
    }
    delete headers["content-encoding"];
    delete headers["transfer-encoding"];
    try {
      // A byte order mark is no part of the JSON, and a browser reads past it.
      const json = JSON.parse(body.toString("utf8").replace(/^\\uFEFF/, ""));
      const found = EXCHANGE_CREDENTIAL_FIELDS.filter((field) => Object.hasOwn(Object(json), field));
      if (found.length > 0 && !Array.isArray(json)) {
        for (const field of found) {
          delete json[field];
        }
        body = Buffer.from(JSON.stringify(json));
      }
    } catch {
      const status = proxyRes.statusCode ?? 502;
      if (status >= 200 && status < 300) {
        // A successful exchange is JSON. One the proxy cannot read may still
        // hold the token for a reader that can, so it is never relayed.
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end("The session exchange answer could not be read.");
        return;
      }
      // An error page, say. It carries no session token.
    }
    headers["content-length"] = String(body.length);
    res.writeHead(proxyRes.statusCode ?? 502, headers);
    res.end(body);
  });
}`,
    indent,
  );
}

/**
 * The redaction functions as the CLI emitted them before it decoded a
 * compressed exchange answer. It removed `Accept-Encoding`, which a server may
 * read as "any coding", and relayed a body it could not parse as it came, so a
 * compressed answer reached the browser with the token in it. Kept verbatim so
 * {@link upgradeExchangeRedaction} can recognise the CLI's own bytes.
 */
const LEGACY_EXCHANGE_REDACTION = `/* zitadel:proxy:exchange-redaction */
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
}`;

/** Escapes `text` for use as a literal inside a regular expression. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * {@link LEGACY_EXCHANGE_REDACTION} at any indent (captured as group 1), with
 * any line ending. Blank lines carry no indent, as a formatter leaves them.
 */
const LEGACY_EXCHANGE_REDACTION_PATTERN = new RegExp(
  `(^[\\t ]*)${LEGACY_EXCHANGE_REDACTION.split("\n")
    .map((line, index) => {
      if (index === 0) {
        return literal(line);
      }
      return line === "" ? "\\r?\\n" : `\\r?\\n\\1${literal(line)}`;
    })
    .join("")}`,
  "m",
);

/**
 * Replaces the CLI's own earlier redaction functions with the current ones,
 * at the indent and line ending they were written with. `current` renders the
 * replacement for an indent: the functions, plus whatever the file needs
 * alongside them. A file whose redaction was changed by hand is left alone.
 */
export function upgradeExchangeRedaction(
  source: string,
  current: (indent: string) => string,
): string {
  return source.replace(LEGACY_EXCHANGE_REDACTION_PATTERN, (legacy: string, indent: string) => {
    const eol = legacy.includes("\r\n") ? "\r\n" : "\n";
    return current(indent).replace(/\n/g, eol);
  });
}

/** A position in a parsed file, as the parser reports it: a 1-based line and a column. */
interface AstPosition {
  line: number;
  column: number;
}

/** The slice of a parsed (babel) node the entry lookup reads. */
export interface AstNode {
  type?: string;
  loc?: { start?: AstPosition; end?: AstPosition };
  properties?: AstNode[];
  key?: { type?: string; value?: unknown };
  value?: AstNode;
}

/**
 * The offset in `source` of a parser position. The parser reads the file with
 * its line endings normalised, so its own offsets drift by a byte for every
 * CRLF before the position; line and column do not.
 */
function offsetOf(source: string, position: AstPosition): number {
  let offset = 0;
  for (let line = 1; line < position.line; line += 1) {
    const next = source.indexOf("\n", offset);
    if (next === -1) {
      return source.length;
    }
    offset = next + 1;
  }
  return offset + position.column;
}

/** The span of a parsed node in `source`, or `undefined` when it carries no position. */
export function nodeRange(
  source: string,
  node: AstNode | undefined,
): { start: number; end: number } | undefined {
  if (!node?.loc?.start || !node.loc.end) {
    return undefined;
  }
  return { start: offsetOf(source, node.loc.start), end: offsetOf(source, node.loc.end) };
}

/**
 * The span of the `"/__nextgen": { ... }` property of a parsed proxy table
 * (key, any comment between key and value, and the object literal), or
 * `undefined` when the table has no such property with an object literal as
 * its value. Every check and rewrite of the generated entry stays inside this
 * span, so a sibling proxy, a comment or a string can never be mistaken for it.
 */
export function proxyEntryRange(
  source: string,
  table: AstNode | undefined,
): { start: number; end: number } | undefined {
  if (table?.type !== "ObjectExpression") {
    return undefined;
  }
  const property = table.properties?.find(
    (candidate) =>
      candidate.type === "ObjectProperty" &&
      candidate.key?.type === "StringLiteral" &&
      candidate.key.value === PROXY_PATH &&
      candidate.value?.type === "ObjectExpression",
  );
  const range = nodeRange(source, property);
  return range !== undefined && range.end > range.start ? range : undefined;
}

/**
 * Whether an entry's text hooks the proxy's responses itself (`proxyRes`,
 * `onProxyRes`), or rewrites the cookies it relays (`cookieDomainRewrite`,
 * `cookiePathRewrite`). The redaction takes over writing every response, so a
 * hook would run against headers already sent and the proxy's own cookie
 * rewriting would no longer apply; such an entry is left as it is, and `zitadel doctor` and `setup` say so. The
 * CLI's generated entries before the redaction had none.
 */
export function hasResponseHook(entry: string): boolean {
  return /proxyRes|cookie(?:Domain|Path)Rewrite/i.test(entry);
}

/** Whether `text` holds a generated redaction of any version; an older one is upgraded, not skipped. */
export function carriesGeneratedRedaction(text: string): boolean {
  return text.includes("zitadel:proxy:exchange-redaction");
}

/**
 * What to tell the developer when a managed `/__nextgen` entry was left
 * without the session-token redaction because of a response hook or cookie
 * rewrite of their own. The edit returns the file as it was, so without this
 * note `zitadel doctor` would read the wiring as applied while the exchange
 * answer still carries `session_token`.
 */
export function skippedRedactionNote(path: string): string {
  return `${path}: the ${PROXY_PATH} proxy entry has its own proxyRes hook or cookie rewrite, so the session-token redaction was not added and POST /sessions/exchange answers still carry session_token to the browser. Move the redaction into your own proxy hook (drop session_token from that answer's body) or remove the cookie rewrite and run zitadel doctor --fix.`;
}

function indented(code: string, indent: string): string {
  return code
    .split("\n")
    .map((line) => (line === "" ? line : `${indent}${line}`))
    .join("\n");
}
