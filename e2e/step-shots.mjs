/**
 * Renders the steps a live walk cannot reach yet — `sso-conflict` needs the
 * engine to fire `user_already_exists`, which `create_user_with_sso` would do
 * once wired. Drives the orchestrator's own render path with the step payload
 * the engine will send, so the screen is the real one, not a mock-up.
 */
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const ROOT = arg("root");
const OUT = arg("out");

const GOOGLE = { id: "google", name: "Google", template: "google" };

/** Steps exactly as `applySsoToFlow` writes them and the engine renders them. */
const STEPS = {
  "sso-conflict-both-methods": {
    name: "sso-conflict",
    texts: { title_key: "sso-conflict.title", description_key: "sso-conflict.description" },
    fields: [{ name: "password", type: "password", text_key: "sso-conflict.field.password", required: true }],
    actions: [
      { name: "submit", kind: "submit", primary: true, text_key: "sso-conflict.action.submit" },
      { name: "passkey", kind: "passkey", primary: false, text_key: "sso-conflict.action.passkey" },
      { name: "sign_in", kind: "navigate", primary: false, text_key: "sso-conflict.action.sign_in" },
    ],
    gates: {},
    sso_providers: [GOOGLE],
  },
  "sso-conflict-passwordless": {
    name: "sso-conflict",
    texts: { title_key: "sso-conflict.title", description_key: "sso-conflict.description" },
    fields: [],
    actions: [
      { name: "passkey", kind: "passkey", primary: false, text_key: "sso-conflict.action.passkey" },
      { name: "sign_in", kind: "navigate", primary: false, text_key: "sso-conflict.action.sign_in" },
    ],
    gates: {},
    sso_providers: [GOOGLE],
  },
  "register-sso": {
    name: "register-sso",
    texts: { title_key: "register-sso.title", description_key: "register-sso.description" },
    fields: [{ name: "email", type: "email", text_key: "register-sso.field.email", required: true, value: "sso-user@example.com" }],
    actions: [{ name: "submit", kind: "submit", primary: true, text_key: "register-sso.action.submit" }],
    gates: {},
  },
};

/**
 * The widget starts its own flow on connect. Rather than let that fail and
 * paint an error, the flow API is stubbed to answer with the step under test,
 * so the screen comes out of the orchestrator's real render path.
 */
const html = (step) => `<!doctype html>
<html><head><meta charset="utf-8">
<script>
  const STEP = ${JSON.stringify(step)};
  const body = { id: "flow_x", session_id: "s", session_token: "t", step: STEP, branding: {} };
  const real = window.fetch;
  window.fetch = (input, init) => {
    const url = String(typeof input === "string" ? input : input.url);
    if (url.includes("/flow")) {
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 201, headers: { "content-type": "application/json" },
      }));
    }
    return real(input, init);
  };
</script>
<script type="module" src="/components.js"></script>
<style>body{margin:0;background:#0f0f11}</style></head>
<body><zitadel-login project-id="p" proxy-path="/api" purpose="login" variant="page"></zitadel-login></body></html>`;

const server = createServer(async (req, res) => {
  if (req.url === "/components.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(await readFile(join(ROOT, "packages/components/dist/standalone.mjs")));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(globalThis.__page ?? "");
});
await new Promise((r) => server.listen(4498, r));

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 900, height: 700 } });
const page = await ctx.newPage();

for (const [name, step] of Object.entries(STEPS)) {
  globalThis.__page = html(step);
  await page.goto("http://localhost:4498/", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, `step-${name}.png`) });
  console.log("captured", name);
}

await browser.close();
server.close();
