import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Browser, Locator, Page, TestInfo } from "@playwright/test";
import { expect, registerWithPassword, test } from "@zitadel/testing/playwright";

/**
 * Screen recordings of the embedded console, for PR descriptions (#1300).
 *
 * The deployment a customer runs: the platform project bootstrapped, the
 * console signing people into it, and customer projects managed through
 * grants. The operator signs up through the console's own login — so they
 * live in the platform project, as a real operator does — and is granted admin
 * on the instance's customer project by email. Everything the browser does
 * then runs on the session cookie alone.
 *
 * Nothing is asserted beyond "the step could be driven": a screen that renders
 * an error boundary is recorded as such, and the run moves on. Each step
 * captions the video and leaves a numbered still, so a reviewer can tell
 * screens apart at a glance. This is an opt-in recording tool, not coverage —
 * see `apps/console-e2e/AGENTS.md`.
 */

const label = process.env.RECORD_SCREENS_LABEL ?? "current";
const operatorPassword = "Record-Screens-Passw0rd!";

/** How long each screen stays still in the recording. */
const DWELL_MS = 1_800;

let stepCount = 0;

test.beforeEach(() => {
  stepCount = 0;
});

test.afterEach(async ({ page }, testInfo) => {
  const video = page.video();
  await page.close();
  if (!video) return;
  mkdirSync(recordingsDir(testInfo), { recursive: true });
  await video.saveAs(join(recordingsDir(testInfo), `${label}--${slugify(testInfo.title)}.webm`));
});

test("platform operator on a customer project", async ({ page, browser, zitadel, seed }) => {
  const operator = seed.identity().email;
  const colleague = seed.identity().email;
  // Rows for the customer project's lists, seeded with its secret from the test
  // process; the browser never sees a secret.
  await seed.users(3);
  await seedTeam(zitadel.handle, "Support");

  // The colleague exists only so "add admin" has somebody real to add; they
  // sign up in their own, unrecorded context.
  await signUpElsewhere(browser, colleague);

  await step(page, "Sign up through the console (platform project)", async () => {
    await page.goto("./");
    await registerWithPassword(page, { email: operator, password: operatorPassword });
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  });

  // The grant a customer project's owner would give: admin, by email. Grants
  // bind platform-project users by identifier (#1192).
  await grantAdminByEmail(zitadel.handle, operator);

  const project = `projects/${zitadel.handle.projectId}`;
  await screen(page, "Projects", "projects");
  await screen(page, "Customer project", project);
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

  await step(page, "Write: rename the customer project", async () => {
    await page.goto(project);
    await caption(page, "Write: rename the customer project");
    const field = page.getByLabel("Project name");
    await field.fill(`${(await field.inputValue()) || "project"} (renamed)`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
  });

  await step(page, "Write: add a colleague as admin", async () => {
    await page.goto(project);
    await caption(page, "Write: add a colleague as admin");
    await page.getByRole("button", { name: "Add admin", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add admin" });
    await dialog.getByRole("textbox", { name: "Email address" }).fill(colleague);
    await dialog.getByRole("button", { name: "Add admin", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: colleague })).toBeVisible();
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
 * Runs one step. A step that cannot be driven (the screen it needs is an error
 * state) is logged and skipped — the recording shows why. Each step then
 * dwells and leaves a numbered still in this test's own frames folder.
 */
async function step(page: Page, title: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
    await page.waitForLoadState("load");
  } catch (error) {
    console.log(
      `[record-screens] "${title}" could not be completed: ${String(error).split("\n")[0]}`,
    );
    await caption(page, `${title} — could not be completed`);
  }
  // The pause is the point here: it is what a viewer of the video reads by.
  // oxlint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(DWELL_MS);
  stepCount += 1;
  const testInfo = test.info();
  const frames = join(recordingsDir(testInfo), `${label}--${slugify(testInfo.title)}-frames`);
  mkdirSync(frames, { recursive: true });
  const slug = `${String(stepCount).padStart(2, "0")}-${slugify(title)}`;
  await page.screenshot({ path: join(frames, `${slug}.png`) });
}

/** A fixed caption, so every frame says which step it shows. */
async function caption(page: Page, text: string): Promise<void> {
  await page
    .evaluate((content) => {
      const id = "record-screens-caption";
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

/** Signs `email` up in a fresh, unrecorded browser context, then closes it. */
async function signUpElsewhere(browser: Browser, email: string): Promise<void> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const page = await context.newPage();
    await page.goto("./");
    await registerWithPassword(page, { email, password: operatorPassword });
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));
  } finally {
    await context.close();
  }
}

type ProjectHandle = { baseUrl: string; projectId: string; projectSecret: string };

/**
 * Makes a platform-project user an admin of the customer project, by email,
 * with that project's secret — from the test process, never the browser.
 */
async function grantAdminByEmail(handle: ProjectHandle, email: string): Promise<void> {
  await post(handle, `/grants?project_id=${handle.projectId}`, {
    user: { identifier: email },
    relation: "admin",
  });
}

/** Creates a team in the customer project with its secret. */
async function seedTeam(handle: ProjectHandle, name: string): Promise<void> {
  await post(handle, `/teams?project_id=${handle.projectId}`, { name });
}

async function post(handle: ProjectHandle, path: string, body: unknown): Promise<void> {
  const response = await fetch(`${handle.baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${handle.projectSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} answered ${response.status}: ${await response.text()}`);
  }
}

function slugify(text: string): string {
  return text
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/** Next to the config, i.e. apps/console-e2e/recordings/. */
function recordingsDir(testInfo: TestInfo): string {
  return join(dirname(testInfo.config.configFile ?? "."), "recordings");
}
