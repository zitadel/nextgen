import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { identity, registerWithPassword } from "@zitadel/testing/playwright";

import { ERROR_BOUNDARY_TITLE, NEUTRAL_MESSAGE } from "../../console/support/copy";
import { journeyMetadataOrSkip, runCli } from "./support";

/**
 * The local ownership journey. `zitadel start` boots the server with the
 * platform project and a local admin, and `zitadel setup --server local`
 * attaches the new project to that admin's team, so on a local server:
 *
 * - the prepared app is owned from the start and `zitadel claim` has nothing
 *   left to do,
 * - `zitadel console` mints a one-time link that signs the admin in to the
 *   local server's own console, with no password, and
 * - that admin can hand the project to a colleague and take it back again
 *   from the console's own Admins section (#1295).
 *
 * Claiming an anonymous project stays a cloud journey. These checks are
 * framework-independent; one suite proves them end to end without slowing
 * every lane (same reasoning as the doctor drift probe).
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test("a local project is owned from setup, and the console signs the local admin in", async ({
  page,
}) => {
  const metadata = await journeyMetadataOrSkip();
  const serverOrigin = new URL(metadata.localRuntimeUrl).origin;

  // setup already attached the project to the local admin's team.
  const secret = JSON.parse(await readFile(join(metadata.appDir, ".zitadel/secret"), "utf8")) as {
    project_id: string;
    team_id?: string;
    claimed_at?: string;
  };
  expect(secret.team_id, "local setup must leave the project owned").toEqual(expect.any(String));
  expect(secret.claimed_at).toEqual(expect.any(String));

  // So claim has nothing to do.
  const claim = (await runCli(metadata, ["claim", "--json"])) as {
    status: string;
    reason?: string;
    data?: { project_id?: string; team_id?: string };
  };
  expect(claim.status).toBe("skipped");
  expect(claim.reason).toBe("already-claimed");
  expect(claim.data?.project_id).toBe(secret.project_id);
  expect(claim.data?.team_id).toBe(secret.team_id);

  // The console link lands on the local server itself and signs the admin in.
  const consoleLink = (await runCli(metadata, ["console", "--no-open", "--json"])) as {
    status: string;
    data?: { sign_in_url?: string; signed_in_as?: string };
  };
  expect(consoleLink.status).toBe("ok");
  const signInUrl = consoleLink.data?.sign_in_url ?? "";
  expect(signInUrl.startsWith(`${serverOrigin}/ui/console/login?handoff=`)).toBe(true);

  await page.goto(signInUrl);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  const me = await page.evaluate(async () => {
    const res = await fetch("/api/v1/sessions/me", { credentials: "include" });
    return { status: res.status, body: (await res.json()) as { user?: { identifier?: string } } };
  });
  expect(me.status).toBe(200);
  expect(me.body.user?.identifier).toBe(consoleLink.data?.signed_in_as);
});

test("the setup admin can add and remove a project admin, and the colleague sees it", async ({
  browser,
  page,
}) => {
  const metadata = await journeyMetadataOrSkip();
  const serverOrigin = new URL(metadata.localRuntimeUrl).origin;
  const secret = JSON.parse(await readFile(join(metadata.appDir, ".zitadel/secret"), "utf8")) as {
    project_id: string;
  };
  const projectUrl = `${serverOrigin}/ui/console/projects/${secret.project_id}`;
  const { email, password } = identity();

  // The colleague signs up at the console's own sign-in screen, in their own
  // context. That screen signs in to the platform project, which is the only
  // place "Add admin" can find them: the grant service resolves an email
  // against the caller's home project, so a colleague registered in the app
  // project is silently not granted (#1295).
  const colleagueContext = await browser.newContext();
  try {
    const colleaguePage = await colleagueContext.newPage();
    await colleaguePage.goto(`${serverOrigin}/ui/console/login`);
    await registerWithPassword(colleaguePage, { email, password });
    await expect(colleaguePage).not.toHaveURL(/\/login/, { timeout: 60_000 });

    // The admin signs in through a fresh one-time link, as above.
    const consoleLink = (await runCli(metadata, ["console", "--no-open", "--json"])) as {
      data?: { sign_in_url?: string };
    };
    await page.goto(consoleLink.data?.sign_in_url ?? "");
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    // Locators copied from `e2e/console/src-real/console-real.spec.ts`,
    // which proves the same screen against an API-created project.
    await page.goto(projectUrl);
    await expect(page.getByRole("region", { name: "Admins" })).toBeVisible();
    await page.getByRole("button", { name: "Add admin", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add admin" });
    await dialog.getByRole("textbox", { name: "Email address" }).fill(email);
    await dialog.getByRole("button", { name: "Add admin", exact: true }).click();
    await expect(page.getByText(NEUTRAL_MESSAGE)).toBeVisible();

    // The row is what proves the write landed: it comes back from the list
    // read, and the message above says the same thing whether or not anything
    // was created.
    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row).toBeVisible();
    await expect(row.getByText("Admin", { exact: true })).toBeVisible();

    // And the grant is what the colleague's own session can now open.
    await colleaguePage.goto(projectUrl);
    await expect(colleaguePage.getByRole("region", { name: "Admins" })).toBeVisible();

    await row.getByRole("button", { name: `Actions for ${email}` }).click();
    await page.getByRole("menuitem", { name: "Remove admin" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove admin", exact: true })
      .click();
    // The region is asserted again rather than only the row's absence: the
    // table is gone from a not-found state, an unauthorized one and a redirect
    // to login too, so only a still-rendered screen makes the empty list mean
    // what it says.
    await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Admins" })).toBeVisible();

    // The colleague loses the project with the grant: the page's loader fails,
    // so the route's error boundary replaces the screen it rendered before.
    // Any of the boundary's titles, so which status the read answers with does
    // not decide whether it is found; never the not-found state, which only a
    // path no route matches renders.
    await colleaguePage.reload();
    await expect(colleaguePage.getByText(ERROR_BOUNDARY_TITLE)).toBeVisible();
  } finally {
    await colleagueContext.close();
  }
});
