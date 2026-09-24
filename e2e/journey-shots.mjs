/**
 * Walks the real sign-in journey against the running stack and writes one PNG
 * per screen, for both shipped presets and for a project with no provider.
 *
 *   node journey-shots.mjs --out <dir> --label password-first
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const OUT = arg("out");
const LABEL = arg("label", "run");
const APP = arg("app", "http://localhost:4300");

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 900, height: 760 } });
const page = await ctx.newPage();
let step = 0;
const shot = async (name) => {
  step += 1;
  const file = join(OUT, `${LABEL}-${String(step).padStart(2, "0")}-${name}.png`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: file });
  console.log("captured", file.split("/").pop());
};

await page.goto(APP, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot("login");

const google = page.locator('zitadel-login').locator('zl-sso-providers').first();
const hasProvider = (await google.count()) > 0;
if (!hasProvider) {
  console.log("no providers offered — stopping after the login shot");
  await browser.close();
  process.exit(0);
}

// The register screen carries the button too.
const registerLink = page.locator('[data-testid="zitadel-action-register-link"]');
if (await registerLink.count()) {
  await registerLink.click();
  await page.waitForTimeout(700);
  await shot("register");
  await page.goBack().catch(() => {});
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
}

// Choose the provider: this leaves for the mock IdP.
await page.locator("zl-sso-providers zl-button").first().click();
await page.waitForURL(/9100/, { timeout: 8000 });
await shot("provider");

await page.locator('[data-testid="mock-idp-continue"]').click();
await page.waitForURL(new RegExp(new URL(APP).port), { timeout: 8000 });
await page.waitForTimeout(900);
await shot("after-callback");

// Submitting is where the unwired create_user_with_sso surfaces.
const create = page.locator('zl-button[data-testid^="zitadel-action-"]').first();
if (await create.count()) {
  await create.click();
  await page.waitForTimeout(900);
  await shot("create-account-submitted");
}

await browser.close();
