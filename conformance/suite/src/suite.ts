import type { Page } from "@playwright/test";
import {
  expect,
  loginWithPassword,
  type SeededUser,
  sessionCookieName,
  test,
} from "@zitadel/testing/playwright";

/** What a fixture declares about its framework; everything else is shared. */
export interface ConformanceOptions {
  /**
   * A route the framework's server SDK guards, which `zitadel setup` writes
   * for it: a signed-out visit must land on `/login`. Omit it for a
   * single-page app, which has no server to guard a route.
   */
  protectedRoute?: string;
}

const loginUrl = /\/login(?:[/?#]|$)/;
const profileUrl = /\/profile(?:[/?#]|$)/;

/**
 * Registers the conformance test in the fixture's spec file: what every app
 * `zitadel setup` scaffolds must do against a fresh project on a real server.
 * The pages are the scaffold's own: `/login` renders `<ZitadelLogin>`, which
 * sends a signed-in user to `/profile`, and `/profile` renders
 * `<ZitadelSession>`, whose Sign out returns to `/login`.
 */
export function conformanceSuite(options: ConformanceOptions = {}): void {
  test("a seeded user signs in, holds the app's session cookie, signs out and signs in again", async ({
    page,
    seed,
    zitadel,
  }) => {
    const { protectedRoute } = options;
    if (protectedRoute) {
      await test.step(`a signed-out visit to ${protectedRoute} lands on /login`, async () => {
        await page.goto(protectedRoute);
        await expect(page).toHaveURL(loginUrl);
      });
    }

    const user = await seed.user();
    // The SDK keeps the session under the project's name for the app's URL
    // (ADR 073), without the __Host- prefix on loopback http (ADR 083).
    const cookieName = (): string => sessionCookieName(zitadel.handle.projectId, page.url());

    await test.step("sign in", async () => {
      await signIn(page, user);
      await expectSessionCookie(page, cookieName());
    });

    await test.step("sign out", async () => {
      await page.getByRole("button", { name: /sign out/i }).click();
      await expect(page).toHaveURL(loginUrl);
      await expect.poll(async () => hasCookie(page, cookieName()), { timeout: 10_000 }).toBe(false);
    });

    await test.step("sign in again", async () => {
      await signIn(page, user);
      await expectSessionCookie(page, cookieName());
    });
  });
}

async function signIn(page: Page, user: SeededUser): Promise<void> {
  if (!loginUrl.test(page.url())) {
    await page.goto("/login");
  }
  await loginWithPassword(page, user);
  await expect(page).toHaveURL(profileUrl, { timeout: 30_000 });
  // <ZitadelSession> reads "Signed in as <identity>"; the default schema's
  // identity is the email.
  await expect(page.getByText(user.email)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
}

async function expectSessionCookie(page: Page, name: string): Promise<void> {
  await expect.poll(async () => hasCookie(page, name), { timeout: 10_000 }).toBe(true);
  const cookie = (await page.context().cookies()).find((candidate) => candidate.name === name);
  expect(cookie?.httpOnly).toBe(true);
}

async function hasCookie(page: Page, name: string): Promise<boolean> {
  return (await page.context().cookies()).some((cookie) => cookie.name === name && cookie.value);
}
