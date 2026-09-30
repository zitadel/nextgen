/**
 * Captures every console screen in both themes at a desktop and a phone width,
 * and writes a contact sheet that lays the four variants side by side — review
 * material for designers, who otherwise have to run the console to see a PR.
 *
 * Runs against a console you already have up, so it shows your working tree:
 *
 *   moon run console:dev-real                                   # terminal 1
 *   corepack pnpm --filter @zitadel/console-e2e exec tsx \
 *     scripts/screenshot-grid.mts                                # terminal 2
 *
 * Then open `test-output/screenshots/index.html`. Detail screens are captured
 * on the first row of their list, so what they show is whatever the instance
 * holds; `dev-real` seeds enough for every screen to have content.
 *
 * Environment (all optional, same defaults as dev-real):
 *   CONSOLE_DEV_ORIGIN    console dev server, default http://localhost:5174
 *   CONSOLE_DEV_EMAIL     sign-in, default dev@zitadel.local
 *   CONSOLE_DEV_PASSWORD  sign-in, default Console-dev-1
 *   SCREENSHOT_DIR        output, default test-output/screenshots
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { type Browser, type Page, chromium } from "@playwright/test";

const origin = process.env.CONSOLE_DEV_ORIGIN ?? "http://localhost:5174";
const user = {
  email: process.env.CONSOLE_DEV_EMAIL ?? "dev@zitadel.local",
  password: process.env.CONSOLE_DEV_PASSWORD ?? "Console-dev-1",
};
const outDir = resolve(
  process.env.SCREENSHOT_DIR ?? join(import.meta.dirname, "..", "test-output", "screenshots"),
);

const THEMES = ["light", "dark"] as const;
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

/** A screen to capture: a path, or a detail screen found from its list's first row. */
type Screen = {
  name: string;
  path: string;
  /** Opens the list at `path`, then the first row whose link starts with this. */
  firstRow?: string;
  /** A tab to switch to once the screen has loaded. */
  tab?: string;
};

const SCREENS: Screen[] = [
  { name: "Projects", path: "/projects" },
  { name: "Project settings", path: "/project" },
  { name: "Teams", path: "/teams" },
  { name: "Team detail", path: "/teams", firstRow: "/teams/" },
  { name: "Users", path: "/users" },
  { name: "User detail", path: "/users", firstRow: "/users/" },
  { name: "User detail — Authentication", path: "/users", firstRow: "/users/", tab: "Authentication" },
  { name: "Login flows", path: "/flow-definitions" },
  { name: "Login flow detail", path: "/flow-definitions", firstRow: "/flow-definitions/" },
  { name: "Branding", path: "/branding" },
  { name: "User schemas", path: "/schemas" },
  { name: "User schema detail", path: "/schemas", firstRow: "/schemas/" },
  { name: "Settings", path: "/settings" },
];

/** The dev-real sign-in: default-login's identifier step, then its password step. */
async function signIn(page: Page): Promise<string> {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email").fill(user.email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
  // The sign-in ends in a full-document navigation; the shell's nav rendering
  // is what says it has landed (see src-real/support.ts).
  await page.getByRole("navigation", { name: "Primary" }).waitFor();
  // The `_authed` layout retains the selected project in the query.
  await page.waitForURL((url) => url.searchParams.has("project"));
  const project = new URL(page.url()).searchParams.get("project");
  if (!project) throw new Error("signed in, but no project was selected");
  return project;
}

/**
 * Waits for a screen to settle: its heading painted and no loading placeholder
 * left. The heading follows the route loader; the placeholders are the chrome
 * that loads beside it (the project pill) and any section still fetching.
 */
async function settle(page: Page): Promise<void> {
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await page.locator('[data-slot="skeleton"]').first().waitFor({ state: "detached" });
  // Fonts swap in after first paint and move every baseline.
  await page.evaluate(() => document.fonts.ready);
}

/** Resolves each screen to a concrete URL once, so every variant shows the same record. */
async function resolveUrls(page: Page, project: string): Promise<Map<Screen, string>> {
  const urls = new Map<Screen, string>();
  for (const screen of SCREENS) {
    const list = `${origin}${screen.path}?project=${encodeURIComponent(project)}`;
    if (!screen.firstRow) {
      urls.set(screen, list);
      continue;
    }
    await page.goto(list);
    await settle(page);
    const href = await page
      .locator(`main a[href^="${screen.firstRow}"]`)
      .first()
      .getAttribute("href", { timeout: 5_000 })
      .catch(() => null);
    if (!href) {
      console.warn(`  skipped ${screen.name}: its list has no rows`);
      continue;
    }
    urls.set(screen, new URL(href, origin).toString());
  }
  return urls;
}

function fileName(screen: Screen, theme: string, viewport: string): string {
  const slug = screen.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug}.${theme}.${viewport}.png`;
}

async function capture(browser: Browser, urls: Map<Screen, string>, storage: string) {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        colorScheme: theme,
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
        storageState: storage,
      });
      const page = await context.newPage();
      for (const [screen, url] of urls) {
        await page.goto(url);
        await settle(page);
        if (screen.tab) {
          await page.getByRole("tab", { name: screen.tab }).click();
          await page.getByRole("tab", { name: screen.tab, selected: true }).waitFor();
          await settle(page);
        }
        await page.screenshot({
          path: join(outDir, fileName(screen, theme, viewport.name)),
          fullPage: true,
          animations: "disabled",
          caret: "hide",
        });
        console.log(`  ${theme.padEnd(5)} ${viewport.name.padEnd(7)} ${screen.name}`);
      }
      await context.close();
    }
  }
}

function contactSheet(urls: Map<Screen, string>): string {
  const escape = (text: string) =>
    text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
  const rows = [...urls.keys()]
    .map((screen) => {
      const cells = THEMES.flatMap((theme) =>
        VIEWPORTS.map((viewport) => {
          const file = fileName(screen, theme, viewport.name);
          return `<figure class="${viewport.name}"><a href="${file}"><img src="${file}" alt="${escape(`${screen.name}, ${theme}, ${viewport.name}`)}" loading="lazy"></a><figcaption>${theme} · ${viewport.name}</figcaption></figure>`;
        }),
      ).join("");
      return `<section><h2>${escape(screen.name)}</h2><div class="row">${cells}</div></section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Console screens</title>
<style>
  :root { color-scheme: light dark; --bg: #fafafa; --fg: #18181b; --muted: #71717a; --line: #e4e4e7; }
  @media (prefers-color-scheme: dark) { :root { --bg: #09090b; --fg: #fafafa; --muted: #a1a1aa; --line: #27272a; } }
  body { margin: 0; padding: 24px 16px 64px; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { color: var(--muted); margin: 0 0 32px; }
  section { border-top: 1px solid var(--line); padding: 24px 0; }
  h2 { font-size: 15px; margin: 0 0 12px; }
  .row { display: flex; gap: 16px; overflow-x: auto; align-items: flex-start; }
  figure { margin: 0; flex: none; }
  figure.desktop { width: 480px; }
  figure.phone { width: 160px; }
  img { width: 100%; display: block; border: 1px solid var(--line); border-radius: 6px; }
  figcaption { color: var(--muted); font-size: 12px; margin-top: 6px; }
</style>
<h1>Console screens</h1>
<p>Captured ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from ${escape(origin)}. Light and dark, at 1440px and 390px. Click a shot for full size.</p>
${rows}
</html>
`;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  const signInContext = await browser.newContext();
  const page = await signInContext.newPage();
  console.log(`signing in to ${origin} as ${user.email}`);
  const project = await signIn(page);
  const storage = join(outDir, ".session.json");
  await signInContext.storageState({ path: storage });

  console.log(`resolving screens in ${project}`);
  const urls = await resolveUrls(page, project);
  await signInContext.close();

  console.log(`capturing ${urls.size} screens × ${THEMES.length * VIEWPORTS.length} variants`);
  await capture(browser, urls, storage);
  await rm(storage);

  await writeFile(join(outDir, "index.html"), contactSheet(urls));
  console.log(`\n  open ${join(outDir, "index.html")}\n`);
} finally {
  await browser.close();
}
