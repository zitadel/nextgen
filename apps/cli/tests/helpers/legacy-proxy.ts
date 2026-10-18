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
  /^(?:import zitadelZlib from "node:zlib";\n\n?|const zitadelZlib = require\("node:zlib"\);\n\n)/m;

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

/**
 * A Vite config holding the dev proxy as an earlier CLI wrote it, before it
 * kept the session token out of the browser, with a response hook of the
 * developer's own added: the redaction cannot be migrated into it.
 */
export const UNREDACTED_VITE_CONFIG_WITH_RESPONSE_HOOK = `import { defineConfig, loadEnv } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/__nextgen": /* zitadel:proxy:v2 */ {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        xfwd: true,
        rewrite: (path) => path.replace(/^\\/__nextgen/, "").replace(/^(?!\\/)/, "/"),
        configure: (proxy) => {
          const secret = loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_PROJECT_SECRET;
          if (!secret) {
            throw new Error("ZITADEL_PROJECT_SECRET is not set; add it to .env.local (zitadel setup writes it).");
          }
          const bearer = \`Bearer \${secret}\`;
          proxy.on("proxyReq", (proxyReq) => {
            const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
            if (
              proxyReq.method === "POST" &&
              pathname === "/sessions/exchange" &&
              !proxyReq.getHeader("authorization")
            ) {
              proxyReq.setHeader("authorization", bearer);
            }
          });
          proxy.on("proxyRes", (proxyRes) => {
            delete proxyRes.headers["x-powered-by"];
          });
        },
      },
    },
  },
});
`;

/**
 * The Angular proxy's request hook as earlier CLIs wrote it, calling the
 * helper with the outgoing request alone. The current helper also records the
 * incoming request, so a hook left like this hands it none.
 */
export function withFirstAngularRequestHook(current: string): string {
  const legacy = current.replace(
    "onProxyReq: (proxyReq, req) => {\n      setBearer(proxyReq);\n      requestPlainExchange(proxyReq, req);",
    "onProxyReq: (proxyReq) => {\n      setBearer(proxyReq);\n      requestPlainExchange(proxyReq);",
  );
  if (legacy === current) {
    throw new Error("expected the current request hook in the generated Angular proxy");
  }
  return legacy;
}
