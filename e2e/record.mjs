/**
 * Records the whole feature as one video: the CLI scaffolding a project, then
 * every login permutation driven in a real browser.
 *
 * Each segment is captured by Playwright as webm; `record.sh` stitches them.
 * The CLI segment is the real captured stdout, replayed in a terminal-styled
 * page so it can be watched rather than read.
 *
 * Every page the driver touches gets the demo chrome from `overlay.mjs`: a
 * pointer that follows the real mouse and a bar naming the origin. Without
 * them a recorded browser shows screens changing with nothing to explain why,
 * and the hop to the provider is indistinguishable from another app screen.
 */
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "playwright";

import { OVERLAY } from "./overlay.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const ROOT = arg("root");
const OUT = arg("out");
const SEGMENT = arg("segment");
const APP = arg("app", "http://localhost:4300");
const TITLE = arg("title", "");
const TRANSCRIPT = arg("transcript", "");
const IDP_PORT = arg("idp", "9100");
/**
 * The address the provider answers with.
 *
 * Unique per run by default. Reusing one across runs quietly changes which
 * journey a segment records -- the second run finds the account the first one
 * created and shows the conflict step under a title promising a fresh
 * sign-in. The conflict segment passes a fixed address on purpose.
 */
const EMAIL = arg("email", `demo-${Date.now()}@example.com`);
const SEED_EMAIL = arg("seed-email", "");

const VIEWPORT = { width: 1280, height: 860 };

/** A title card, so the video says what it is showing. */
const card = (heading, sub) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body{margin:0;height:100vh;display:grid;place-content:center;background:#0f0f11;
       font-family:ui-sans-serif,system-ui;color:#f4f4f6;text-align:center}
  h1{font-size:40px;margin:0 0 12px;font-weight:650}
  p{font-size:20px;margin:0;color:#a1a1aa}
</style></head><body><div><h1>${heading}</h1><p>${sub}</p></div></body></html>`;

/** The CLI transcript, typed out line by line. */
const terminal = (lines) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body{margin:0;background:#0b0b0d;color:#d4d4d8;font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;padding:28px}
  #t{white-space:pre-wrap}
  .c{color:#7dd3fc}
</style></head><body><div id="t"></div>
<script>
  const LINES = ${JSON.stringify(lines)};
  const el = document.getElementById("t");
  let i = 0;
  const tick = () => {
    if (i >= LINES.length) return;
    const line = LINES[i++];
    const div = document.createElement("div");
    if (line.startsWith("$ ")) div.className = "c";
    div.textContent = line;
    el.appendChild(div);
    window.scrollTo(0, document.body.scrollHeight);
    setTimeout(tick, line.startsWith("$ ") ? 420 : 70);
  };
  tick();
</script></body></html>`;

let served = "";
const server = createServer(async (req, res) => {
  if (req.url === "/components.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(await readFile(join(ROOT, "packages/components/dist/standalone.mjs")));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(served);
});
await new Promise((r) => server.listen(4497, r));

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: OUT, size: VIEWPORT },
});
// Applies to every navigation in the context, so the provider's own pages
// carry the pointer and the bar as well.
await ctx.addInitScript(OVERLAY);
const page = await ctx.newPage();

/** Where the pointer is, kept here so it survives a navigation. */
let at = { x: VIEWPORT.width / 2, y: VIEWPORT.height - 120 };

const caption = async (text) => {
  await page.evaluate((t) => window.__demoCaption?.(t), text).catch(() => {});
};

/** Walk the pointer there, so a click reads as a click and not a cut. */
async function moveTo(x, y) {
  const steps = 24;
  const from = at;
  for (let i = 1; i <= steps; i++) {
    // Ease out, so the pointer arrives the way a hand does.
    const t = 1 - (1 - i / steps) ** 3;
    await page.mouse.move(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
    await page.waitForTimeout(10);
  }
  at = { x, y };
  await page.waitForTimeout(260);
}

async function clickOn(locator, text) {
  if (text) await caption(text);
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${await locator.evaluate((e) => e.tagName).catch(() => "?")}`);
  await moveTo(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}

/** Put the pointer back after a navigation, which resets the injected page. */
async function settle(ms) {
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(ms);
}

/**
 * Describe the screen the flow came back to, read from the page rather than
 * assumed from the journey the segment set out to record.
 */
async function landing(page) {
  const heading = (await page.locator("h1, h2").first().textContent().catch(() => ""))?.trim();
  if (await page.locator('input[type="password"]').count()) {
    return `${heading} — the provider's email already has an account, so it asks to prove it`;
  }
  if (await page.locator('input[type="email"]').count()) {
    return `${heading} — the provider left something out, so the flow collects it`;
  }
  return `${heading} — signed in, no password ever typed`;
}

const showCard = async (heading, sub, ms = 1800) => {
  served = card(heading, sub);
  await page.goto("http://localhost:4497/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(ms);
};

if (SEGMENT === "cli") {
  const lines = (await readFile(TRANSCRIPT, "utf8")).split("\n");
  await showCard("Scaffolding a project", "zitadel setup --sso google", 2200);
  served = terminal(lines);
  await page.goto("http://localhost:4497/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(Math.min(60_000, 1500 + lines.length * 90));
} else {
  await showCard(TITLE, arg("subtitle", ""), 2200);
  await page.goto(APP, { waitUntil: "networkidle" });
  await settle(1400);

  const providers = page.locator("zl-sso-providers");
  if ((await providers.count()) === 0 && SEGMENT !== "control") {
    // A segment that expects a provider and finds none is recording the
    // wrong thing -- a stale bundle renders a perfectly ordinary login and
    // the resulting video argues the feature does not exist. Fail loudly.
    throw new Error(`${TITLE}: no provider rendered; the bundle or the project is wrong`);
  }
  if ((await providers.count()) === 0) {
    // The control: a project with no provider, to show nothing was added.
    await caption("no provider enabled — the login is exactly as it was");
    await settle(3000);
  } else {
    if (SEGMENT === "register") {
      await clickOn(
        page.locator('[data-testid="zitadel-action-register-link"]'),
        "the register screen offers it too",
      );
      await settle(1800);
    }
    if (SEGMENT === "conflict") {
      // Sign this address up with a password first, so the provider comes
      // back to an account that already exists.
      await caption("first, this address signs up with a password");
      await clickOn(page.locator('[data-testid="zitadel-action-register-link"]'), "");
      await settle(1200);
      const email = page.locator('input[type="email"]').first();
      await clickOn(email, "");
      await page.keyboard.type(EMAIL, { delay: 40 });
      await clickOn(page.locator('zl-button[action="submit"]').first(), "");
      await settle(1500);
      const pw = page.locator('input[type="password"]').first();
      await clickOn(pw, "");
      await page.keyboard.type("Sup3rSecret!23", { delay: 40 });
      await clickOn(page.locator('zl-button[action="submit"]').first(), "");
      await settle(2200);
      await caption("now the same person comes back through the provider");
      await page.goto(APP, { waitUntil: "networkidle" });
      await settle(1600);
    }
    if (SEGMENT === "email-fallback") {
      await clickOn(page.locator('zl-button[action="email_fallback"]'), "fall back to the email screen");
      await settle(1800);
    }

    await caption("this button is the whole feature — it leaves the app");
    await settle(1200);
    await clickOn(page.locator("zl-sso-providers zl-button").first(), "clicking Continue with Google");

    await page.waitForURL(new RegExp(`:${IDP_PORT}`), { timeout: 10_000 });
    await settle(900);
    await caption("you are now on the provider, not on the app");
    await settle(2600);
    await caption("choosing which account to hand back");
    const account = page.locator('[data-testid="mock-idp-email"]');
    await clickOn(account, "");
    await account.fill("");
    await page.keyboard.type(EMAIL, { delay: 45 });
    await settle(900);
    await clickOn(page.locator('[data-testid="mock-idp-continue"]'), "consenting, which redirects back");

    await page.waitForURL(new RegExp(`:${new URL(APP).port}`), { timeout: 10_000 });
    await settle(1800);
    // Say what the flow actually did. A fixed caption here is how the last
    // recording announced a sign-in over a screen asking for a password.
    await caption(await landing(page));
    await settle(2400);
  }
}

await ctx.close();
await browser.close();
server.close();
