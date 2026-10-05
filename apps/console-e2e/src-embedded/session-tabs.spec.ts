import type { Page, Response } from "@playwright/test";
import { expect, test } from "@zitadel/testing/playwright";

import { grantProjectAdmin } from "../src-real/support";

/**
 * Two tabs, one cookie jar (ADR 053 §5, Console ADR 0002).
 *
 * Every console write carries the session's CSRF token, and signing in again
 * in another tab replaces the cookie the token is bound to. The open tab finds
 * out when its next write is refused with `403 auth.csrf_invalid`, reads the
 * session again, and then:
 *
 *   - the same person: it loads the new token and retries the write once, so
 *     the person never notices;
 *   - someone else: the write is not replayed as them, and the page reloads,
 *     starting over as whoever is signed in now.
 *
 * Only the built binary shows this honestly: one origin, the real cookie, and
 * no proxy adding a credential.
 */

type Person = { email: string; password: string };

async function signIn(page: Page, person: Person): Promise<void> {
  await page.getByLabel("Email").fill(person.email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password").fill(person.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

/** Logs the current person out in `page` and signs `person` in there. */
async function switchTo(page: Page, person: Person): Promise<void> {
  await page.goto("/ui/console/");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/ui\/console\/login/);
  await signIn(page, person);
}

/** Opens Add team with a name filled in, ready to submit. */
async function prepareTeam(page: Page, name: string) {
  await page.goto("/ui/console/teams?status=active");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Add team" });
  await drawer.getByLabel("Team name").fill(name);
  return drawer.getByRole("button", { name: "Add team", exact: true });
}

/** Every `POST /teams` answer `page` sees, in order. */
function teamWrites(page: Page): Response[] {
  const seen: Response[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/teams" && response.request().method() === "POST") {
      seen.push(response);
    }
  });
  return seen;
}

/** Marks the document, so a reload is visible as the mark going away. */
async function markDocument(page: Page): Promise<() => Promise<boolean>> {
  await page.evaluate(() => {
    (window as unknown as { __sameDocument?: boolean }).__sameDocument = true;
  });
  return () =>
    page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true);
}

test("a write after the same person signed in again in another tab goes through", async ({
  context,
  page,
  seed,
  zitadel,
}) => {
  const operator = await seed.user();
  await grantProjectAdmin(zitadel.handle, operator.id);

  await page.goto("/ui/console/");
  await signIn(page, operator);
  const name = `Retried ${Date.now().toString(36)}`;
  const submit = await prepareTeam(page, name);
  const sameDocument = await markDocument(page);
  const writes = teamWrites(page);

  // Another tab: the same person signs out and in again, so the cookie, and
  // the token bound to it, are new.
  const other = await context.newPage();
  await switchTo(other, operator);

  await submit.click();
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();

  // Refused once for the stale token, then retried with the new one.
  expect(writes.map((response) => response.status())).toEqual([403, 201]);
  expect(await writes[0]?.json()).toMatchObject({ code: "auth.csrf_invalid" });
  expect(await sameDocument()).toBe(true);
});

test("a write after someone else signed in in another tab reloads instead of writing as them", async ({
  context,
  page,
  seed,
  zitadel,
}) => {
  const operator = await seed.user();
  await grantProjectAdmin(zitadel.handle, operator.id);
  const colleague = await seed.user();

  await page.goto("/ui/console/");
  await signIn(page, operator);
  const submit = await prepareTeam(page, `Never ${Date.now().toString(36)}`);
  const sameDocument = await markDocument(page);
  const writes = teamWrites(page);

  const other = await context.newPage();
  await switchTo(other, colleague);

  const reloaded = page.waitForEvent("load");
  await submit.click();
  await reloaded;

  // Refused for the stale token and never replayed as the colleague.
  expect(writes.map((response) => response.status())).toEqual([403]);
  expect(await sameDocument()).toBe(false);
  // The new document starts as the colleague.
  await expect(page.getByRole("button", { name: `Account: ${colleague.email}` })).toBeVisible();
});
