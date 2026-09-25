import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "@zitadel/testing/playwright";

import { grantProjectAdmin } from "../src-real/support";

/**
 * Scenario A of #1300's walkthroughs: the single-project deployment. An
 * operator signs in to the project they manage (home = target) with nothing
 * but the session cookie, and visits every management screen.
 *
 * Nothing here is asserted beyond "the step could be driven": a screen that
 * renders an error boundary is recorded as such, and the run moves on. Each
 * step captions the video so a reviewer can tell screens apart at a glance.
 */

const label = process.env.WALKTHROUGH_LABEL ?? "current";

/** How long each screen stays still in the recording. */
const DWELL_MS = 1_800;

test.afterEach(async ({ page }, testInfo) => {
  const video = page.video();
  await page.close();
  if (!video) return;
  const videoDir = videoDirFor(testInfo);
  mkdirSync(videoDir, { recursive: true });
  await video.saveAs(join(videoDir, `${label}--${slugify(testInfo.title)}.webm`));
});

test("scenario A: single project, session cookie only", async ({ page, zitadel, seed }) => {
  const operator = await seed.user();
  await grantProjectAdmin(zitadel.handle, operator.id);
  // A few rows so the lists have something to show when they load.
  await seed.users(3);
  await seedTeam(zitadel.handle, "Walkthrough seeded team");

  await step(page, "Sign in", async () => {
    await page.goto("./");
    await page.getByLabel("Email").fill(operator.email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Password").fill(operator.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  });

  await screen(page, "Projects", "projects", { openFirstRow: true });
  await screen(page, "Settings", "settings");
  await screen(page, "Users", "users", { openFirstRow: true });
  await screen(page, "Teams", "teams?status=active", { openFirstRow: true });
  // These two render cards, not a table: open the seeded default by name.
  await screen(page, "User schemas", "schemas", {
    open: (p) => p.getByText("DefaultHumanUserSchema", { exact: true }).first(),
  });
  await screen(page, "Login flows", "flow-definitions", {
    open: (p) => p.getByText("Default login", { exact: true }).first(),
  });
  await screen(page, "Branding", "branding");

  await step(page, "Mutation: add a team", async () => {
    await page.goto("teams?status=active");
    await caption(page, "Mutation: add a team");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Add team" });
    await drawer.getByLabel("Team name").fill(`Walkthrough ${Date.now().toString(36)}`);
    await drawer.getByRole("button", { name: "Add team", exact: true }).click();
  });

  await step(page, "Mutation: add a user", async () => {
    await page.goto("users");
    await caption(page, "Mutation: add a user");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Add user" });
    await expect(drawer.locator('input[data-slot="input"]').first()).toBeVisible();
    await fillUserForm(drawer);
    await drawer.getByRole("button", { name: "Add user", exact: true }).click();
  });
});

/**
 * Visits one screen, optionally opens a detail view — the first table row, or
 * whatever `open` points at — and lets each sit.
 */
async function screen(
  page: Page,
  title: string,
  path: string,
  options: { openFirstRow?: boolean; open?: (page: Page) => Locator } = {},
): Promise<void> {
  await step(page, title, async () => {
    await page.goto(path);
    await caption(page, title);
  });
  const open =
    options.open ??
    (options.openFirstRow
      ? (p: Page) => p.getByRole("table").getByRole("link").first()
      : undefined);
  if (!open) return;
  await step(page, `${title}: detail`, async () => {
    await open(page).click({ timeout: 5_000 });
    await caption(page, `${title}: detail`);
  });
}

/**
 * Runs one walkthrough step. A step that cannot be driven (the screen it
 * needs is an error state) is logged and skipped — the recording shows why.
 */
async function step(page: Page, title: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
    await page.waitForLoadState("load");
  } catch (error) {
    console.log(`[walkthrough] "${title}" could not be completed: ${String(error).split("\n")[0]}`);
    await caption(page, `${title} — could not be completed`);
  }
  // The pause is the point here: it is what a viewer of the video reads by.
  // oxlint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(DWELL_MS);
  // A still per step, for PR descriptions and for checking a recording
  // without scrubbing through it.
  stepCount += 1;
  const frames = join(videoDirFor(test.info()), `${label}-frames`);
  mkdirSync(frames, { recursive: true });
  const slug = `${String(stepCount).padStart(2, "0")}-${slugify(title)}`;
  await page.screenshot({ path: join(frames, `${slug}.png`) });
}

let stepCount = 0;

function slugify(text: string): string {
  return text.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

/** Next to the config, i.e. apps/console-e2e/walkthrough-videos/. */
function videoDirFor(testInfo: TestInfo): string {
  return join(dirname(testInfo.config.configFile ?? "."), "walkthrough-videos");
}

/** A fixed caption, so every frame says which step it shows. */
async function caption(page: Page, text: string): Promise<void> {
  await page
    .evaluate((content) => {
      const id = "walkthrough-caption";
      let element = document.getElementById(id);
      if (!element) {
        element = document.createElement("div");
        element.id = id;
        Object.assign(element.style, {
          // Top centre: the one spot no screen or drawer puts a control.
          position: "fixed",
          top: "12px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: "2147483647",
          padding: "6px 12px",
          borderRadius: "6px",
          background: "rgba(17, 24, 39, 0.88)",
          color: "#fff",
          font: "600 13px/1.4 system-ui, sans-serif",
          pointerEvents: "none",
        });
        document.body.append(element);
      }
      element.textContent = content;
    }, text)
    // A caption is decoration; a page mid-navigation just goes without one.
    .catch(() => undefined);
}

/** Fills the schema-driven Add user form with plausible values. */
async function fillUserForm(drawer: Locator): Promise<void> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const inputs = drawer.locator('input[data-slot="input"]');
  for (let index = 0; index < (await inputs.count()); index++) {
    const input = inputs.nth(index);
    const name = ((await input.getAttribute("name")) ?? "").toLowerCase();
    if (name.includes("email")) await input.fill(`walkthrough-${suffix}@example.com`);
    else if (name.includes("password")) await input.fill("Walkthrough-Passw0rd!");
    else if (name.includes("given")) await input.fill("Walk");
    else if (name.includes("family")) await input.fill("Through");
  }
}

/**
 * Creates a team through the API with the boot-captured project secret, from
 * the test process — the browser never sees the secret.
 */
async function seedTeam(
  handle: { baseUrl: string; projectId: string; projectSecret: string },
  name: string,
): Promise<void> {
  const query = new URLSearchParams({ project_id: handle.projectId });
  const response = await fetch(`${handle.baseUrl}/teams?${query.toString()}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${handle.projectSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(`POST /teams answered ${response.status}: ${await response.text()}`);
  }
}
