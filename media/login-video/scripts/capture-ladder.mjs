// Screenshots a page of the running app in its current branding, for the brand ladder.
// usage: node capture-ladder.mjs <out.png> <path> [value...]
//   Types each value into the widget's inputs in order; the last one keeps focus.
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../e2e/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const [out, path = "/register", ...values] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
await page.locator("zitadel-login").first().waitFor();
await page.locator("zitadel-login input:not([type=hidden])").first().waitFor();
await page.waitForFunction(() => document.fonts.status === "loaded");
// the dev server's floating Next.js badge is not part of the app
await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
await page.waitForTimeout(800);
const inputs = page.locator("zitadel-login input:not([type=hidden])");
for (let i = 0; i < values.length; i++) {
  await inputs.nth(i).click();
  await page.keyboard.type(values[i]);
}
// typing can scroll a tall page; frame it from the top
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(350);
const broken = await page.evaluate(() =>
  [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src),
);
if (broken.length) console.log("images not loaded:", broken.join(" "));
await page.screenshot({ path: out, caret: "initial" });
console.log("captured", out, "inputs", await inputs.count());
await browser.close();
