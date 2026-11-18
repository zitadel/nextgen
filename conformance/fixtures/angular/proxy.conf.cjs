// zitadel-cli: managed-file v1
const { readFileSync, existsSync } = require("node:fs");

function loadEnvLocal() {
  if (!existsSync(".env.local")) return {};
  const out = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) {
      const raw = m[2].trim();
      const quoted = raw.match(/^(['"])(.*)\1\s*(?:#.*)?$/);
      out[m[1]] = quoted ? quoted[2] : raw.replace(/\s+#.*$/, "").trim();
    }
  }
  return out;
}

const env = loadEnvLocal();
const server = process.env.ZITADEL_URL ?? env.ZITADEL_URL;
const secret = process.env.ZITADEL_PROJECT_SECRET ?? env.ZITADEL_PROJECT_SECRET;
if (!server) {
  throw new Error("ZITADEL_URL is not set; add it to .env.local (zitadel setup writes it).");
}
if (!secret) {
  throw new Error("ZITADEL_PROJECT_SECRET is not set; add it to .env.local (zitadel setup writes it).");
}
const bearer = `Bearer ${secret}`;

/* zitadel:proxy:v3 */
function setBearer(proxyReq) {
  const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
  if (
    proxyReq.method === "POST" &&
    (pathname === "/sessions/exchange" || pathname === "/api/v1/sessions/exchange") &&
    !proxyReq.getHeader("authorization")
  ) {
    proxyReq.setHeader("authorization", bearer);
  }
}

/* zitadel:session-cookie:v2 */
// The browser keeps this app's session in a cookie named after its project,
// zitadel_session_<project id>, prefixed __Host- unless this dev server is
// plain http on a loopback host; the server takes it as __Host-zitadel_session
// (ADR 083). Without a project id, cookies pass through.
const projectId =
  process.env.ZITADEL_PROJECT_ID ?? (typeof env === "undefined" ? undefined : env.ZITADEL_PROJECT_ID);
const appCookieSuffix = projectId
  ? "_" +
    projectId.replace(/[^\w-]/gu, (char) =>
      Array.from(new TextEncoder().encode(char), (byte) =>
        "%" + byte.toString(16).toUpperCase().padStart(2, "0"),
      ).join(""),
    )
  : undefined;

function forwardSessionCookie(proxyReq, req) {
  if (!appCookieSuffix) {
    return;
  }
  const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim() ||
    ("encrypted" in req.socket && req.socket.encrypted ? "https" : "http");
  const host = String(req.headers["x-forwarded-host"] ?? "").split(",")[0]?.trim() || (req.headers.host ?? "");
  const secure =
    proto.toLowerCase() !== "http" ||
    !/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(host);
  const appCookie = (secure ? "__Host-zitadel_session" : "zitadel_session") + appCookieSuffix;
  const cookies = String(proxyReq.getHeader("cookie") ?? "")
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie !== "");
  const own = cookies.find(
    (cookie) => cookie.startsWith(appCookie + "=") && cookie.length > appCookie.length + 1,
  );
  const forwarded = cookies.filter((cookie) => !/^(?:__Host-)?(?:zitadel_session|__nextgen_session)(?:_[^=]*)?=/.test(cookie));
  if (own) {
    forwarded.push("__Host-zitadel_session" + own.slice(appCookie.length));
  }
  if (forwarded.length > 0) {
    proxyReq.setHeader("cookie", forwarded.join("; "));
  } else {
    proxyReq.removeHeader("cookie");
  }
}

function renameSessionCookie(proxyRes, req) {
  const setCookies = proxyRes.headers["set-cookie"];
  if (!appCookieSuffix || !setCookies) {
    return;
  }
  const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim() ||
    ("encrypted" in req.socket && req.socket.encrypted ? "https" : "http");
  const host = String(req.headers["x-forwarded-host"] ?? "").split(",")[0]?.trim() || (req.headers.host ?? "");
  const secure =
    proto.toLowerCase() !== "http" ||
    !/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(host);
  const appCookie = (secure ? "__Host-zitadel_session" : "zitadel_session") + appCookieSuffix;
  proxyRes.headers["set-cookie"] = setCookies.flatMap((setCookie) => {
    if (/^(?:__Host-)?zitadel_session=/.test(setCookie)) {
      const [pair = "", ...attributes] = setCookie.split(";");
      const expiry = attributes
        .map((attribute) => attribute.trim())
        .filter((attribute) => /^(?:max-age|expires)=/i.test(attribute));
      return [
        [
          appCookie + pair.slice(pair.indexOf("=")),
          "Path=/",
          ...expiry,
          "HttpOnly",
          "SameSite=Lax",
          ...(secure ? ["Secure"] : []),
        ].join("; "),
      ];
    }
    return /^(?:__Host-)?(?:zitadel_session|__nextgen_session)(?:_[^=]*)?=/.test(setCookie) ? [] : [setCookie];
  });
}

function stripPrefix(path) {
  return path.replace(/^\/__nextgen/, "").replace(/^(?!\/)/, "/");
}

module.exports = {
  "/__nextgen": {
    target: server,
    changeOrigin: true,
    xfwd: true,
    pathRewrite: stripPrefix,
    rewrite: stripPrefix,
    onProxyReq: (proxyReq, req) => {
      setBearer(proxyReq);
      forwardSessionCookie(proxyReq, req);
    },
    onProxyRes: renameSessionCookie,
    configure: (proxy) => {
      proxy.on("proxyReq", setBearer);
      proxy.on("proxyReq", forwardSessionCookie);
      proxy.on("proxyRes", renameSessionCookie);
    },
  },
};
