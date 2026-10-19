/**
 * The session-cookie hooks of the dev proxies the CLI writes for the SPA
 * frameworks (ADR 073). The server sets and reads one session cookie,
 * `__nextgen_session`; a browser shares a host's cookies across every port, so
 * under that name alone an SPA on `localhost` and the Console of a local server
 * would keep their sessions in one slot and sign each other out. The hooks keep
 * the app's session in `__nextgen_session_<project id>` instead, the name the
 * server SDKs use (`sessionCookieName` in `@zitadel/sdk-core`):
 *
 * - on the way up, the app's cookie goes under the server's name, and every
 *   other session cookie stays back;
 * - on the way back, the server's `Set-Cookie` is renamed to the app's.
 *
 * Without a project id the cookies pass through unchanged. The code is plain
 * JavaScript so it runs in a `vite.config.*` and in Angular's CommonJS
 * `proxy.conf.cjs` alike.
 */

/** Marks a generated dev proxy that carries the session-cookie hooks. */
export const SESSION_COOKIE_MARKER = "zitadel:session-cookie:v1";

/** Says what the hooks do, above them in the generated proxy. */
const EXPLANATION = [
  `/* ${SESSION_COOKIE_MARKER} */`,
  "// The browser keeps this app's session in a cookie named after its project,",
  "// the server in __nextgen_session (ADR 073). Without a project id, cookies",
  "// pass through.",
];

/**
 * The hook functions. `appCookie` is the app's cookie name, or `undefined`
 * when no project is configured. `sessionCookieName` percent-encodes every
 * byte outside `[A-Za-z0-9_-]`, as sdk-core does.
 */
const FUNCTIONS = `function sessionCookieName(projectId) {
  const encode = (char) =>
    Array.from(new TextEncoder().encode(char), (byte) =>
      "%" + byte.toString(16).toUpperCase().padStart(2, "0"),
    ).join("");
  return "__nextgen_session_" + projectId.replace(/[^\\w-]/gu, encode);
}
function forwardSessionCookie(proxyReq, appCookie) {
  if (!appCookie) {
    return;
  }
  const cookies = String(proxyReq.getHeader("cookie") ?? "")
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie !== "");
  const own = cookies.find(
    (cookie) => cookie.startsWith(appCookie + "=") && cookie.length > appCookie.length + 1,
  );
  const forwarded = cookies.filter((cookie) => !/^__nextgen_session(?:_[^=]*)?=/.test(cookie));
  if (own) {
    forwarded.push("__nextgen_session" + own.slice(appCookie.length));
  }
  if (forwarded.length > 0) {
    proxyReq.setHeader("cookie", forwarded.join("; "));
  } else {
    proxyReq.removeHeader("cookie");
  }
}
function renameSessionCookie(proxyRes, appCookie) {
  const setCookies = proxyRes.headers["set-cookie"];
  if (appCookie && setCookies) {
    proxyRes.headers["set-cookie"] = setCookies.map((setCookie) =>
      setCookie.replace(/^__nextgen_session=/, appCookie + "="),
    );
  }
}`.split("\n");

/**
 * The hooks as statements of a Vite proxy entry's `configure(proxy)` body,
 * after its bearer hook. The project id comes from `.env.local` through Vite's
 * `loadEnv`, as the project secret does.
 */
export function viteSessionCookieStatements(): string[] {
  return [
    ...EXPLANATION,
    'const projectId = loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_PROJECT_ID;',
    "const appCookie = projectId ? sessionCookieName(projectId) : undefined;",
    'proxy.on("proxyReq", (proxyReq) => forwardSessionCookie(proxyReq, appCookie));',
    'proxy.on("proxyRes", (proxyRes) => renameSessionCookie(proxyRes, appCookie));',
    ...FUNCTIONS,
  ];
}

/**
 * The hooks as top-level statements of Angular's `proxy.conf.cjs`, after its
 * bearer hook. The project id comes from the environment, else from the
 * `.env.local` the file has already read into `env`.
 */
export function proxyConfSessionCookieStatements(): string[] {
  return [
    ...EXPLANATION,
    "const projectId = process.env.ZITADEL_PROJECT_ID ?? env.ZITADEL_PROJECT_ID;",
    "const appCookie = projectId ? sessionCookieName(projectId) : undefined;",
    "",
    ...FUNCTIONS.flatMap((line, index) =>
      index > 0 && line.startsWith("function ") ? ["", line] : [line],
    ),
  ];
}

/** `lines`, each indented by `indent` (blank lines stay blank), joined with `eol`. */
export function indented(lines: readonly string[], indent: string, eol = "\n"): string {
  return lines.map((line) => (line === "" ? "" : `${indent}${line}`)).join(eol);
}
