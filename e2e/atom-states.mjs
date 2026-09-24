/**
 * Renders every state of the provider button that does not need a server:
 * vendor combinations, the no-mark fallback, a long tenant-authored name,
 * the disabled state, and each shipped branding design with providers.
 *
 * Writes one PNG per state so they can be looked at rather than described.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const ROOT = process.argv[process.argv.indexOf("--root") + 1];
const OUT = process.argv[process.argv.indexOf("--out") + 1];
const BUNDLE = join(ROOT, "packages/components/dist/standalone.mjs");
// The atoms are built on design tokens; without them every background,
// radius and gap collapses and the shots would flatter nothing.
const TOKENS = join(ROOT, "packages/design-tokens/src/generated/tokens.css");

const GOOGLE = { id: "google", name: "Google", template: "google" };
const GITHUB = { id: "github", name: "GitHub", template: "github" };
const ACME = { id: "acme-sso", name: "Acme SSO", template: "oidc-generic" };
const LONG = {
  id: "contoso",
  name: "Contoso Corporation Enterprise Single Sign-On",
  template: "oidc-generic",
};

/** One card on a login-ish background, so the shots read like the real screen. */
const page = (body, width = 420) => `<!doctype html>
<html><head><meta charset="utf-8">
<script type="module" src="/components.js"></script>
<link rel="stylesheet" href="/tokens.css">
<style>
  body { margin:0; background:#0f0f11; display:grid; place-items:center; min-height:100vh; }
  .card { width:${width}px; padding:28px; background:#18181b; border-radius:14px;
          font-family:system-ui; color:#f4f4f6; }
  h2 { font-size:15px; margin:0 0 14px; font-weight:600; color:#a1a1aa; }
</style></head>
<body><div class="card">${body}</div></body></html>`;

const providers = (list, attrs = "") =>
  `<zl-sso-providers providers='${JSON.stringify(list)}' label-format="Continue with {name}" ${attrs}></zl-sso-providers>`;

const STATES = [
  ["01-single-google", page(`<h2>One provider</h2>${providers([GOOGLE], 'divider-label="or"')}`)],
  ["02-two-providers", page(`<h2>Two providers</h2>${providers([GOOGLE, GITHUB], 'divider-label="or"')}`)],
  ["03-three-with-unbranded", page(`<h2>Three, one with no mark</h2>${providers([GOOGLE, GITHUB, ACME], 'divider-label="or"')}`)],
  ["04-no-brand-mark", page(`<h2>Template with no mark — labelled, not mislabelled</h2>${providers([ACME], 'divider-label="or"')}`)],
  ["05-long-vendor-name", page(`<h2>Long tenant-authored name — must not overflow</h2>${providers([LONG], 'divider-label="or"')}`)],
  ["06-no-divider", page(`<h2>No divider</h2>${providers([GOOGLE])}`)],
  ["07-disabled", page(`<h2>Disabled while the step submits</h2>${providers([GOOGLE, GITHUB], 'divider-label="or" disabled')}`)],
  ["08-empty", page(`<h2>No providers — renders nothing at all</h2>${providers([], 'divider-label="or"')}<p style="color:#71717a;font-size:13px">(nothing above this line)</p>`)],
  ["09-narrow-mobile", page(`<h2>Narrow (mobile)</h2>${providers([GOOGLE, LONG], 'divider-label="or"')}`, 300)],
];

const server = createServer(async (req, res) => {
  if (req.url === "/tokens.css") {
    res.writeHead(200, { "content-type": "text/css" });
    res.end(await readFile(TOKENS));
    return;
  }
  if (req.url === "/components.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(await readFile(BUNDLE));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(globalThis.__html ?? "");
});
await new Promise((r) => server.listen(4499, r));

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const tab = await ctx.newPage();

for (const [name, html] of STATES) {
  globalThis.__html = html;
  await tab.goto("http://localhost:4499/", { waitUntil: "networkidle" });
  await tab.waitForTimeout(250);
  await tab.locator(".card").screenshot({ path: join(OUT, `${name}.png`) });
  console.log("captured", name);
}

await browser.close();
server.close();
