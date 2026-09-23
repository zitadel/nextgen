/**
 * A stand-in for a scaffolded app, for driving the login components in a real
 * browser.
 *
 * Serves one page that mounts `<zitadel-login>` from the workspace build, and
 * proxies `/__nextgen/*` to the Zitadel server exactly as the dev proxy the
 * CLI patches into vite/next does — which is what makes the provider's
 * redirect URI (`<app origin>/__nextgen/idp/callback`) resolve.
 *
 *   node app-host.mjs --port 4300 --server http://localhost:8129 --project <id>
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const port = Number(arg("port", 4300));
const server = arg("server", "http://localhost:8129");
const projectId = arg("project", "");
const bundle = arg("bundle", "");

/**
 * The page a provider returns to carries `?flow=<id>`, which the widget
 * resumes instead of starting a new one — the same thing a scaffolded app's
 * login route would do.
 */
const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>Login harness</title>
<style>body{margin:0;font:16px system-ui;background:#0f0f11}</style>
<script type="module" src="/components.js"></script>
</head>
<body>
  <zitadel-login
    id="login"
    project-id="${projectId}"
    proxy-path="/__nextgen"
    purpose="login"
    variant="page"
  ></zitadel-login>
  <script>
    const resume = new URLSearchParams(location.search).get("flow");
    if (resume) document.getElementById("login").setAttribute("resume-flow-id", resume);
  </script>
</body></html>`;

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  if (url.pathname.startsWith("/__nextgen/")) {
    const target = new URL(server);
    // Strip our own prefix, exactly as the SDK middleware's proxyRequest does.
    target.pathname = url.pathname.slice("/__nextgen".length);
    target.search = url.search;
    const headers = { ...req.headers, host: target.host };
    const body =
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : await new Promise((resolve) => {
            const chunks = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => resolve(Buffer.concat(chunks)));
          });
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
    });
    const out = Object.fromEntries(upstream.headers.entries());
    // A 302 from the callback points back at this host; leave it untouched.
    res.writeHead(upstream.status, out);
    res.end(Buffer.from(await upstream.arrayBuffer()));
    return;
  }

  if (url.pathname === "/components.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(await readFile(bundle));
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
}).listen(port, () => console.log(`app host on http://localhost:${port} -> ${server}`));
