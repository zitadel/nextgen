import vue from '@vitejs/plugin-vue'
import {defineConfig, loadEnv} from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],

  server: {
    port: 3212,
    strictPort: true,

    proxy: {
      '/__nextgen': /* zitadel:proxy:v4 */ {
        target: ((url) => {
          if (!URL.canParse(url) || !["http:", "https:"].includes(new URL(url).protocol)) {
            throw new Error(`ZITADEL_URL is not an http(s) URL: ${url}`);
          }
          return new URL(url).origin;
        })(loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_URL || "http://localhost:8312"),

        changeOrigin: true,
        xfwd: true,
        rewrite: (path) => path.replace(/^\/__nextgen/, "").replace(/^(?!\/)/, "/"),

        configure: (proxy) => {
          const secret = loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_PROJECT_SECRET;
          if (!secret) {
            throw new Error("ZITADEL_PROJECT_SECRET is not set; add it to .env.local (zitadel setup writes it).");
          }
          const bearer = `Bearer ${secret}`;
          proxy.on("proxyReq", (proxyReq) => {
            const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
            if (
              proxyReq.method === "POST" &&
              (pathname === "/sessions/exchange" || pathname === "/api/v1/sessions/exchange") &&
              !proxyReq.getHeader("authorization")
            ) {
              proxyReq.setHeader("authorization", bearer);
            }
          });
          /* zitadel:session-cookie:v2 */
          // The browser keeps this app's session in a cookie named after its project,
          // zitadel_session_<project id>, prefixed __Host- unless this dev server is
          // plain http on a loopback host; the server takes it as __Host-zitadel_session
          // (ADR 083). Without a project id, cookies pass through.
          const projectId = loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_PROJECT_ID;
          const appCookieSuffix = projectId
            ? "_" +
              projectId.replace(/[^\w-]/gu, (char) =>
                Array.from(new TextEncoder().encode(char), (byte) =>
                  "%" + byte.toString(16).toUpperCase().padStart(2, "0"),
                ).join(""),
              )
            : undefined;
          proxy.on("proxyReq", (proxyReq, req) => {
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
          });
          proxy.on("proxyRes", (proxyRes, req) => {
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
          });
        },
      },
    },
  },
})
