// Drives the real scaffolded app's sign-up and saves a screenshot of every
// visible state, with the wall-clock time each state appeared.
// usage: node capture-signup.mjs <outDir> <email> <password> [baseUrl]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire(new URL("../../../e2e/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const [outDir, email, password, base = "http://localhost:3000"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
const page = await ctx.newPage();
const t0 = Date.now();
const shots = [];
let n = 0;
async function shot(label) {
  const file = `${String(n++).padStart(3, "0")}-${label}.png`;
  const at = (Date.now() - t0) / 1000;
  await page.screenshot({ path: `${outDir}/${file}`, caret: "initial" });
  shots.push({ file, label, at, url: page.url() });
}

await page.goto(`${base}/register`, { waitUntil: "networkidle" });
const emailBox = page.getByLabel("Email");
await emailBox.waitFor();
await emailBox.click();
await shot("register-empty");
for (const ch of email) {
  await page.keyboard.type(ch);
  await shot("email-typing");
}
const tClick1 = Date.now();
await page.keyboard.press("Enter");
await shot("email-submitted");
const pw = page.locator("input[type=password]");
await pw.waitFor();
const tPwShown = Date.now();
await pw.click();
await shot("password-empty");
await pw.fill(password);
await shot("password-filled");
const tClick2 = Date.now();
await page.keyboard.press("Enter");
await shot("signup-pending");
await page.waitForURL(/\/profile/, { timeout: 30000 });
await page.getByText("Signed in as").first().waitFor();
const tDone = Date.now();
await page.waitForTimeout(300);
await shot("profile");

writeFileSync(
  `${outDir}/timings.json`,
  JSON.stringify(
    {
      email_submit_to_password_step_s: (tPwShown - tClick1) / 1000,
      signup_submit_to_profile_s: (tDone - tClick2) / 1000,
      shots,
    },
    null,
    1,
  ),
);
console.log(
  "email->password",
  (tPwShown - tClick1) / 1000,
  "s; signup->profile",
  (tDone - tClick2) / 1000,
  "s;",
  shots.length,
  "shots",
);
await browser.close();
