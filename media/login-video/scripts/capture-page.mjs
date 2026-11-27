// Screenshots one page of the running app at 1280x800 @2x.
// usage: node capture-page.mjs <out.png> <url> [full]
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../e2e/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const [out, url, full] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.fonts.status === "loaded");
// the dev server's floating Next.js badge is not part of the app
await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
await page.waitForTimeout(600);
await page.screenshot({ path: out, fullPage: full === "full" });
console.log("captured", out, await page.title());
await browser.close();
