import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("password-only registration, logout, and password login work in a fresh Next app", async ({
  page,
}) => {
  const email = uniqueEmail("password");
  const password = "Correct-Horse-42!";

  await expectProtectedRouteToRedirect(page);
  await page.goto("/login");
  await registerWithPassword(page, email, password, { setupPasskey: false });
  await expectSignedIn(page);
  await expectSessionCookie(page);

  await logout(page);
  await loginWithPassword(page, email, password);
  await expectSignedIn(page);
  await expectSessionCookie(page);
});

if (process.env.JOURNEY_ENABLE_PASSKEY !== "0") {
  test("passkey-only registration, logout, and passkey login work in a fresh Next app", async ({
    page,
  }) => {
    await enableVirtualAuthenticator(page);

    const email = uniqueEmail("passkey");

    await page.goto("/login");
    await registerWithPasskey(page, email);
    await expectSignedIn(page);
    await expectSessionCookie(page);

    await logout(page);
    await loginWithPasskey(page, email);
    await expectSignedIn(page);
    await expectSessionCookie(page);
  });

  test("password-plus-passkey registration supports password and passkey login", async ({
    page,
  }) => {
    await enableVirtualAuthenticator(page);

    const email = uniqueEmail("password-passkey");
    const password = "Correct-Horse-43!";

    await page.goto("/login");
    await registerWithPassword(page, email, password, { setupPasskey: true });
    await expectSignedIn(page);
    await expectSessionCookie(page);

    await logout(page);
    await loginWithPassword(page, email, password);
    await expectSignedIn(page);
    await expectSessionCookie(page);

    await logout(page);
    await loginWithPasskey(page, email);
    await expectSignedIn(page);
    await expectSessionCookie(page);
  });
}

async function expectProtectedRouteToRedirect(page: Page): Promise<void> {
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
}

async function registerWithPassword(
  page: Page,
  email: string,
  password: string,
  options: { setupPasskey: boolean },
): Promise<void> {
  await fillEmail(page, email);
  await advanceUnknownUserToRegistration(page);
  await expectRegistrationChoice(page);
  await fillEmailIfVisible(page, email);
  await choosePasswordRegistration(page);
  await fillPassword(page, password);
  await clickSubmit(page);
  await completePasskeyUpsell(page, options.setupPasskey);
}

async function loginWithPassword(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await fillEmail(page, email);
  if (!(await isPasswordVisible(page))) {
    await clickSubmit(page);
  }
  await fillPassword(page, password);
  await clickSubmit(page);
}

async function registerWithPasskey(page: Page, email: string): Promise<void> {
  await fillEmail(page, email);
  await advanceUnknownUserToRegistration(page);
  await expectRegistrationChoice(page);
  await fillEmailIfVisible(page, email);
  await clickAction(page, /register.*passkey|passkey.*register|passkey_register/i, [
    "passkey_register",
  ]);
}

async function loginWithPasskey(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await fillEmail(page, email);
  await clickAction(page, /sign in with.*passkey|passkey/i, ["passkey"]);
}

async function expectSignedIn(page: Page): Promise<void> {
  await page.waitForURL("**/profile", { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /signed in/i })).toBeVisible();
}

async function expectSessionCookie(page: Page): Promise<void> {
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "__nextgen_session",
  );
  expect(sessionCookie?.value).toBeTruthy();
  expect(sessionCookie?.httpOnly).toBe(true);
}

async function enableVirtualAuthenticator(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

async function logout(page: Page): Promise<void> {
  const logout = logoutLocator(page);
  if (!(await logout.first().isVisible({ timeout: 1000 }).catch(() => false))) {
    await page.getByRole("button", { name: /open user menu/i }).click();
  }
  await expect(logout.first()).toBeVisible({ timeout: 5000 });
  await logout.first().click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expectSessionCleared(page);
}

async function advanceUnknownUserToRegistration(page: Page): Promise<void> {
  if (await isPasswordVisible(page)) {
    await clickAction(page, /sign up|create account|register|identifier\.action\.register/i, [
      "register",
    ]);
    return;
  }
  await clickSubmit(page);
}

async function choosePasswordRegistration(page: Page): Promise<void> {
  if (await isPasswordVisible(page)) {
    return;
  }
  await clickAction(page, /continue.*password|password/i, ["submit"]);
}

async function completePasskeyUpsell(
  page: Page,
  setupPasskey: boolean,
): Promise<void> {
  await expect(
    page.getByRole("heading", { name: /sign in faster|passkey/i }),
  ).toBeVisible({ timeout: 30_000 });

  if (setupPasskey) {
    await clickAction(page, /set up.*passkey|passkey/i, ["passkey_register"]);
    return;
  }

  await clickAction(page, /skip/i, ["skip"]);
}

async function expectRegistrationChoice(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: /create|register|sign up|no-account/i }),
  ).toBeVisible({ timeout: 30_000 });
}

async function fillEmail(page: Page, email: string): Promise<void> {
  await page.getByLabel(/email/i).first().fill(email);
}

async function fillEmailIfVisible(page: Page, email: string): Promise<void> {
  const emailField = page.getByLabel(/email/i).first();
  if (await emailField.isVisible().catch(() => false)) {
    await emailField.fill(email);
  }
}

async function fillPassword(page: Page, password: string): Promise<void> {
  await page.getByLabel(/password/i).first().fill(password);
}

async function isPasswordVisible(page: Page): Promise<boolean> {
  return page.getByLabel(/password/i).first().isVisible().catch(() => false);
}

async function expectSessionCleared(page: Page): Promise<void> {
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "__nextgen_session",
  );
  expect(sessionCookie).toBeUndefined();
}

async function clickSubmit(page: Page): Promise<void> {
  await clickAction(
    page,
    /continue|sign in|sign up|create account|register|.+\.action\.submit/i,
    ["submit"],
  );
}

async function clickAction(
  page: Page,
  name: RegExp,
  actionNames: readonly string[] = [],
): Promise<void> {
  let locator = page.getByRole("button", { name }).or(page.getByRole("link", { name }));
  for (const actionName of actionNames) {
    locator = actionLocator(page, actionName).or(locator);
  }
  await locator.first().click();
}

function actionLocator(page: Page, actionName: string) {
  return page.locator(`zl-button[action="${actionName}"], [data-action="${actionName}"]`);
}

function logoutLocator(page: Page) {
  return page
    .locator("zitadel-logout .signout-btn")
    .or(actionLocator(page, "logout"))
    .or(page.getByRole("button", { name: /logout|sign out/i }))
    .or(page.getByRole("link", { name: /logout|sign out/i }));
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}
