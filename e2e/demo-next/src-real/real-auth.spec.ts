import type { Page } from "@playwright/test";
import {
  expect,
  flowAction,
  flowField,
  loginWithPassword,
  sessionCookieName,
  test,
  type SeededUser,
} from "@zitadel/testing/playwright";

async function expectAuthenticatedAs(
  page: Page,
  user: SeededUser,
  projectId: string,
): Promise<void> {
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  // Default schema: email identifier, no display — the line shows the email.
  await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
  // The SDK keeps the session under the project's name, for the app's URL
  // (ADR 073, ADR 083).
  const cookies = await page.context().cookies();
  const session = cookies.find(
    (cookie) => cookie.name === sessionCookieName(projectId, page.url()),
  );
  expect(session).toBeDefined();
  expect(session?.httpOnly).toBe(true);
}

test("rejected password creates no app session; a corrected password signs in as the seeded user", async ({
  page,
  seed,
  zitadel,
}) => {
  const user = await seed.user();
  await page.goto("/login");
  // The real two-step flow (identifier -> password), driven by the
  // `default-login` flow definition the kit bootstrapped on the instance.
  await loginWithPassword(page, { ...user, password: `${user.password}-incorrect` });
  await expect(page.locator("zitadel-login").getByRole("alert")).toBeVisible();
  await expect(flowField(page, "password")).toBeVisible();
  const cookieName = sessionCookieName(zitadel.handle.projectId, page.url());
  expect((await page.context().cookies()).some((cookie) => cookie.name === cookieName)).toBe(false);
  const protectedPage = await page.request.get("/admin", { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(protectedPage.status());
  expect(new URL(protectedPage.headers().location!, page.url()).pathname).toBe("/login");

  await flowField(page, "password").fill(user.password);
  await flowAction(page, "submit").click();
  await page.waitForURL("**/admin", { timeout: 20_000 });
  await expectAuthenticatedAs(page, user, zitadel.handle.projectId);
});
