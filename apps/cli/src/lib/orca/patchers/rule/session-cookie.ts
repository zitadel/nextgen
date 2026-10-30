/**
 * The session-cookie hooks of the dev proxies the CLI writes for the SPA
 * frameworks (ADR 073, ADR 083). The server sets one session cookie,
 * `__Host-zitadel_session`, or `zitadel_session` over plain http to a loopback
 * host, and reads it as `__Host-zitadel_session`; a browser shares a host's
 * cookies across every port, so under that name alone an SPA on `localhost`
 * and the Console of a local server would keep their sessions in one slot and
 * sign each other out. The hooks keep the app's session in
 * `zitadel_session_<project id>` on a dev server reached over plain http to a
 * loopback host, and in `__Host-zitadel_session_<project id>` on any other,
 * the names the server SDKs use (`sessionCookieName` in `@zitadel/sdk-core`):
 *
 * - on the way up, the app's cookie goes once, under the server's
 *   `__Host-zitadel_session`, and every other session cookie stays back, those
 *   from before ADR 083 included;
 * - on the way back, the server's `Set-Cookie`, under either name, becomes the
 *   app's: its value and expiry with `Path=/`, `HttpOnly`, `SameSite=Lax`, and
 *   `Secure` unless the dev server is loopback http. A `Set-Cookie` of any
 *   other session cookie is dropped.
 *
 * The dev server's scheme is the first `X-Forwarded-Proto` (the entry's `xfwd`
 * sets it), else its own connection's, and its host the first
 * `X-Forwarded-Host`, else `Host`: the rule of `secureFor` in sdk-core.
 *
 * Without a project id the cookies pass through unchanged. The code is plain
 * JavaScript, so it runs in a `vite.config.*` and in Angular's CommonJS
 * `proxy.conf.cjs` alike, and in a `vite.config.ts` it type-checks under
 * `strict`: every parameter is one Vite's `configure(proxy)` typing reaches.
 */

/** Marks a generated dev proxy that carries the session-cookie hooks. */
export const SESSION_COOKIE_MARKER = "zitadel:session-cookie:v2";

/**
 * Marks the hooks the CLI wrote before ADR 083, which name the
 * `__nextgen_session` cookies. The doctor fails on them, and `doctor --fix`
 * replaces them where they are as the CLI wrote them.
 */
export const SESSION_COOKIE_MARKER_V1 = "zitadel:session-cookie:v1";

/** Says what the hooks do, above them in the generated proxy. */
const EXPLANATION = [
  `/* ${SESSION_COOKIE_MARKER} */`,
  "// The browser keeps this app's session in a cookie named after its project,",
  "// zitadel_session_<project id>, prefixed __Host- unless this dev server is",
  "// plain http on a loopback host; the server takes it as __Host-zitadel_session",
  "// (ADR 083). Without a project id, cookies pass through.",
];

/**
 * `appCookieSuffix`, what the app's cookie name adds for `projectId`, or
 * `undefined` without one. It percent-encodes every byte outside
 * `[A-Za-z0-9_-]`, as `sessionCookieName` in sdk-core does.
 */
const APP_COOKIE_SUFFIX = [
  "const appCookieSuffix = projectId",
  '  ? "_" +',
  "    projectId.replace(/[^\\w-]/gu, (char) =>",
  "      Array.from(new TextEncoder().encode(char), (byte) =>",
  '        "%" + byte.toString(16).toUpperCase().padStart(2, "0"),',
  '      ).join(""),',
  "    )",
  "  : undefined;",
];

/**
 * `secure` and `appCookie` for the browser's request `req`: the app's cookie
 * carries the prefix and `Secure` unless the dev server was reached over plain
 * http to a loopback host.
 */
const APP_COOKIE = [
  'const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim() ||',
  '  ("encrypted" in req.socket && req.socket.encrypted ? "https" : "http");',
  'const host = String(req.headers["x-forwarded-host"] ?? "").split(",")[0]?.trim() || (req.headers.host ?? "");',
  "const secure =",
  '  proto.toLowerCase() !== "http" ||',
  "  !/^(?:localhost|127(?:\\.\\d{1,3}){3}|\\[::1\\])(?::\\d+)?$/i.test(host);",
  'const appCookie = (secure ? "__Host-zitadel_session" : "zitadel_session") + appCookieSuffix;',
];

/** Matches a cookie of any session cookie family, the server's or an app's, on either transport or from before ADR 083. */
const ANY_SESSION_COOKIE = "/^(?:__Host-)?(?:zitadel_session|__nextgen_session)(?:_[^=]*)?=/";

/** The request hook's body, on `proxyReq`: only the app's cookie goes up, under the server's name. */
const FORWARD_BODY = [
  "if (!appCookieSuffix) {",
  "  return;",
  "}",
  ...APP_COOKIE,
  'const cookies = String(proxyReq.getHeader("cookie") ?? "")',
  '  .split(";")',
  "  .map((cookie) => cookie.trim())",
  '  .filter((cookie) => cookie !== "");',
  "const own = cookies.find(",
  '  (cookie) => cookie.startsWith(appCookie + "=") && cookie.length > appCookie.length + 1,',
  ");",
  `const forwarded = cookies.filter((cookie) => !${ANY_SESSION_COOKIE}.test(cookie));`,
  "if (own) {",
  '  forwarded.push("__Host-zitadel_session" + own.slice(appCookie.length));',
  "}",
  "if (forwarded.length > 0) {",
  '  proxyReq.setHeader("cookie", forwarded.join("; "));',
  "} else {",
  '  proxyReq.removeHeader("cookie");',
  "}",
];

/**
 * The response hook's body, on `proxyRes`: the server's `Set-Cookie` comes back
 * as the app's, and one of any other session cookie not at all.
 */
const RENAME_BODY = [
  'const setCookies = proxyRes.headers["set-cookie"];',
  "if (!appCookieSuffix || !setCookies) {",
  "  return;",
  "}",
  ...APP_COOKIE,
  'proxyRes.headers["set-cookie"] = setCookies.flatMap((setCookie) => {',
  "  if (/^(?:__Host-)?zitadel_session=/.test(setCookie)) {",
  '    const [pair = "", ...attributes] = setCookie.split(";");',
  "    const expiry = attributes",
  "      .map((attribute) => attribute.trim())",
  "      .filter((attribute) => /^(?:max-age|expires)=/i.test(attribute));",
  "    return [",
  "      [",
  '        appCookie + pair.slice(pair.indexOf("=")),',
  '        "Path=/",',
  "        ...expiry,",
  '        "HttpOnly",',
  '        "SameSite=Lax",',
  '        ...(secure ? ["Secure"] : []),',
  '      ].join("; "),',
  "    ];",
  "  }",
  `  return ${ANY_SESSION_COOKIE}.test(setCookie) ? [] : [setCookie];`,
  "});",
];

/** `lines`, each indented by two more spaces. */
function nested(lines: readonly string[]): string[] {
  return lines.map((line) => (line === "" ? "" : `  ${line}`));
}

/** How the Vite proxy entry reads the project id: from `.env.local` through Vite's `loadEnv`. */
const VITE_PROJECT_ID =
  'const projectId = loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_PROJECT_ID;';

/**
 * The hooks as statements of a Vite proxy entry's `configure(proxy)` body,
 * after its bearer hook. The project id comes from `.env.local` through Vite's
 * `loadEnv`, as the project secret does. The hooks are the listeners
 * themselves, not functions they call, so Vite's types reach `proxyReq`,
 * `proxyRes` and `req`, and a strict `vite.config.ts` type-checks.
 */
export function viteSessionCookieStatements(): string[] {
  return [
    ...EXPLANATION,
    VITE_PROJECT_ID,
    ...APP_COOKIE_SUFFIX,
    'proxy.on("proxyReq", (proxyReq, req) => {',
    ...nested(FORWARD_BODY),
    "});",
    'proxy.on("proxyRes", (proxyRes, req) => {',
    ...nested(RENAME_BODY),
    "});",
  ];
}

/** How Angular's `proxy.conf.cjs` reads the project id: from the environment, else `.env.local`. */
const PROXY_CONF_PROJECT_ID = [
  "const projectId =",
  '  process.env.ZITADEL_PROJECT_ID ?? (typeof env === "undefined" ? undefined : env.ZITADEL_PROJECT_ID);',
];

/**
 * The hooks as top-level statements of Angular's `proxy.conf.cjs`, after its
 * bearer hook: the functions its entry attaches as `onProxyReq`/`onProxyRes`
 * and in `configure`. The project id comes from the environment, else from the
 * `.env.local` the file has already read into `env`; a managed file from
 * before it read `.env.local` has no `env`, and then only the environment
 * names the project.
 */
export function proxyConfSessionCookieStatements(): string[] {
  return [
    ...EXPLANATION,
    ...PROXY_CONF_PROJECT_ID,
    ...APP_COOKIE_SUFFIX,
    "",
    "function forwardSessionCookie(proxyReq, req) {",
    ...nested(FORWARD_BODY),
    "}",
    "",
    "function renameSessionCookie(proxyRes, req) {",
    ...nested(RENAME_BODY),
    "}",
  ];
}

// ─── The hooks before ADR 083 ────────────────────────────────────────────────
// What the CLI wrote under SESSION_COOKIE_MARKER_V1, kept only to recognize it
// so that `doctor --fix` can replace it.

const EXPLANATION_V1 = [
  `/* ${SESSION_COOKIE_MARKER_V1} */`,
  "// The browser keeps this app's session in a cookie named after its project,",
  "// the server in __nextgen_session (ADR 073). Without a project id, cookies",
  "// pass through.",
];

const APP_COOKIE_V1 = [
  "const appCookie = projectId",
  '  ? "__nextgen_session_" +',
  "    projectId.replace(/[^\\w-]/gu, (char) =>",
  "      Array.from(new TextEncoder().encode(char), (byte) =>",
  '        "%" + byte.toString(16).toUpperCase().padStart(2, "0"),',
  '      ).join(""),',
  "    )",
  "  : undefined;",
];

const FORWARD_BODY_V1 = [
  "if (!appCookie) {",
  "  return;",
  "}",
  'const cookies = String(proxyReq.getHeader("cookie") ?? "")',
  '  .split(";")',
  "  .map((cookie) => cookie.trim())",
  '  .filter((cookie) => cookie !== "");',
  "const own = cookies.find(",
  '  (cookie) => cookie.startsWith(appCookie + "=") && cookie.length > appCookie.length + 1,',
  ");",
  "const forwarded = cookies.filter((cookie) => !/^__nextgen_session(?:_[^=]*)?=/.test(cookie));",
  "if (own) {",
  '  forwarded.push("__nextgen_session" + own.slice(appCookie.length));',
  "}",
  "if (forwarded.length > 0) {",
  '  proxyReq.setHeader("cookie", forwarded.join("; "));',
  "} else {",
  '  proxyReq.removeHeader("cookie");',
  "}",
];

const RENAME_BODY_V1 = [
  'const setCookies = proxyRes.headers["set-cookie"];',
  "if (appCookie && setCookies) {",
  '  proxyRes.headers["set-cookie"] = setCookies.map((setCookie) =>',
  '    setCookie.replace(/^__nextgen_session=/, appCookie + "="),',
  "  );",
  "}",
];

/** The statements {@link viteSessionCookieStatements} produced before ADR 083. */
export function viteSessionCookieStatementsV1(): string[] {
  return [
    ...EXPLANATION_V1,
    VITE_PROJECT_ID,
    ...APP_COOKIE_V1,
    'proxy.on("proxyReq", (proxyReq) => {',
    ...nested(FORWARD_BODY_V1),
    "});",
    'proxy.on("proxyRes", (proxyRes) => {',
    ...nested(RENAME_BODY_V1),
    "});",
  ];
}

/** The statements {@link proxyConfSessionCookieStatements} produced before ADR 083. */
export function proxyConfSessionCookieStatementsV1(): string[] {
  return [
    ...EXPLANATION_V1,
    ...PROXY_CONF_PROJECT_ID,
    ...APP_COOKIE_V1,
    "",
    "function forwardSessionCookie(proxyReq) {",
    ...nested(FORWARD_BODY_V1),
    "}",
    "",
    "function renameSessionCookie(proxyRes) {",
    ...nested(RENAME_BODY_V1),
    "}",
  ];
}

/** `lines`, each indented by `indent` (blank lines stay blank), joined with `eol`. */
export function indented(lines: readonly string[], indent: string, eol = "\n"): string {
  return lines.map((line) => (line === "" ? "" : `${indent}${line}`)).join(eol);
}
