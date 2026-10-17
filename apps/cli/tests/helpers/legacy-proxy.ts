/**
 * The session-token redaction as earlier CLIs wrote it into a dev proxy: it
 * removed `Accept-Encoding` and relayed a body it could not parse as it came,
 * so a compressed exchange answer reached the browser with the token in it.
 */
const FIRST_REDACTION = `/* zitadel:proxy:exchange-redaction */
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

/** The current redaction, at any indent (group 1), up to the end of `relayResponse`. */
const CURRENT_REDACTION =
  /^([\t ]*)\/\* zitadel:proxy:exchange-redaction:v2 \*\/\n[\s\S]*?\n\1 {2}\}\);\n\1\}/m;

/** The `node:zlib` import (Vite) or require (Angular) the current redaction needs. */
const ZLIB_BINDING =
  /^(?:import zlib from "node:zlib";\n\n?|const zlib = require\("node:zlib"\);\n\n)/m;

/**
 * A dev proxy the CLI generates now, as an earlier CLI wrote it: the first
 * redaction in place of the current one, and no `node:zlib` binding.
 */
export function withFirstRedaction(current: string): string {
  const legacy = current
    .replace(ZLIB_BINDING, "")
    .replace(CURRENT_REDACTION, (_block, indent: string) =>
      FIRST_REDACTION.split("\n")
        .map((line) => (line === "" ? line : `${indent}${line}`))
        .join("\n"),
    );
  if (!legacy.includes(FIRST_REDACTION.split("\n")[0] ?? "") || legacy.includes("node:zlib")) {
    throw new Error("expected the current exchange redaction in the generated proxy");
  }
  return legacy;
}
