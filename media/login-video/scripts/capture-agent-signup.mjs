// Signs up on the agent-built app's own register page (email, given and family
// name, then a password) and saves a screenshot of each state, then the app's
// home page signed in. The password is generated and never printed.
// usage: node capture-agent-signup.mjs <outDir> <email> <given> <family> [baseUrl]
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire(new URL("../../../e2e/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const [outDir, email, given, family, base = "http://localhost:3000"] = process.argv.slice(2);
const password = `${randomBytes(12).toString("base64url")}-Aa1`;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
const hideBadge = () =>
  page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
const t0 = Date.now();
const shots = [];
let n = 0;
async function shot(label) {
  const file = `${String(n++).padStart(3, "0")}-${label}.png`;
  await hideBadge();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${outDir}/${file}`, caret: "initial" });
  shots.push({ file, label, at: (Date.now() - t0) / 1000, url: page.url() });
}

await page.goto(`${base}/register`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.fonts.status === "loaded");
const emailBox = page.getByLabel("Email");
await emailBox.waitFor();
await page.waitForTimeout(500);
await shot("register-empty");
await emailBox.click();
const half = Math.ceil(email.length / 2);
await page.keyboard.type(email.slice(0, half));
await shot("email-half");
await page.keyboard.type(email.slice(half));
await shot("email");
await page.getByLabel("Given name").click();
await page.keyboard.type(given);
await shot("given");
await page.getByLabel("Family name").click();
await page.keyboard.type(family);
await shot("family");
const tSubmit1 = Date.now();
await page.keyboard.press("Enter");
const pw = page.locator("input[type=password]");
await pw.waitFor();
const tPw = Date.now();
await page.waitForTimeout(300);
await pw.click();
await shot("password-empty");
await pw.fill(password);
await shot("password-filled");
const tSubmit2 = Date.now();
await page.keyboard.press("Enter");
await shot("signup-pending");
await page.waitForURL(/\/profile/, { timeout: 30000 });
const tDone = Date.now();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(500);
await shot("profile");
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot("home-signed-in");

writeFileSync(
  `${outDir}/timings.json`,
  JSON.stringify(
    {
      details_to_password_step_s: (tPw - tSubmit1) / 1000,
      signup_to_profile_s: (tDone - tSubmit2) / 1000,
      shots,
    },
    null,
    1,
  ),
);
console.log(
  "details->password",
  (tPw - tSubmit1) / 1000,
  "s; signup->profile",
  (tDone - tSubmit2) / 1000,
  "s;",
  shots.length,
  "shots",
);
await browser.close();
