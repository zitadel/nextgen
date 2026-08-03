import { expect, test } from "@zitadel/testing/playwright";

/**
 * The session-mint promise: tests start past login. The fixture seeds a user,
 * drives the real flow headlessly, and injects the session cookie — if any of
 * that were fake, the middleware would bounce /admin straight to /login.
 */
test("an authenticatedPage starts on a protected route without visiting login", async ({
  authenticatedPage,
  zitadel,
}) => {
  const { page, user, session } = authenticatedPage;

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin(?:[/?#]|$)/);
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await expect(page.getByText(`Signed in as ${user.id}`)).toBeVisible();

  // The same minted token drives session APIs headlessly — the value the
  // future vitest surface builds on, proven without a browser in the loop.
  // /sessions/me authenticates via the session cookie (the SDK middleware's
  // own headless pattern), so send the token the way a cookie would carry it.
  const me = await fetch(`${zitadel.handle.baseUrl}/sessions/me`, {
    headers: { cookie: `__nextgen_session=${session.sessionToken}` },
  });
  expect(me.status).toBe(200);
  expect(((await me.json()) as { user_id?: string }).user_id).toBe(user.id);
});
