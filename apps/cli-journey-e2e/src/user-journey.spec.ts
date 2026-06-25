/* oxlint-disable playwright/expect-expect, playwright/no-conditional-in-test */
import { expect, test, type Locator, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const framework = process.env.JOURNEY_FRAMEWORK ?? "next";
const expectsProtectedRouteRedirect = framework === "next" || framework === "nuxt";
const loginUrl = /\/login(?:[/?#]|$)/;
const profileUrl = /\/profile(?:[/?#]|$)/;

test(`password-only registration, logout, and password login work in a fresh ${framework} app`, async ({
  page,
}) => {
  const email = uniqueEmail("password");
  const password = "Correct-Horse-42!";

  if (expectsProtectedRouteRedirect) {
    await expectProtectedRouteToRedirect(page);
  }
  await gotoLogin(page);
  await registerWithPassword(page, email, password);
  await expectSignedIn(page);
  await expectSessionCookie(page);

  await logout(page);
  await loginWithPassword(page, email, password);
  await expectSignedIn(page);
  await expectSessionCookie(page);
});

if (process.env.JOURNEY_ENABLE_PASSKEY !== "0") {
  test(`passkey-only registration, logout, and passkey login work in a fresh ${framework} app`, async ({
    page,
  }) => {
    await enableVirtualAuthenticator(page);

    const email = uniqueEmail("passkey");

    await gotoLogin(page);
    await registerWithPasskey(page, email);
    await expectSignedIn(page);
    await expectSessionCookie(page);

    await logout(page);
    await enableVirtualAuthenticator(page);
    await loginWithPasskey(page, email);
    await expectSignedIn(page);
    await expectSessionCookie(page);
  });

}

async function expectProtectedRouteToRedirect(page: Page): Promise<void> {
  await page.goto("/profile");
  await expect(page).toHaveURL(loginUrl);
}

async function gotoLogin(page: Page): Promise<void> {
  if (loginUrl.test(page.url())) {
    return;
  }

  await page.waitForLoadState("load", { timeout: 5000 }).catch(() => undefined);
  if (loginUrl.test(page.url())) {
    return;
  }

  await page.goto("/login").catch(async (error: unknown) => {
    if (!isInterruptedByLoginNavigation(error) && !loginUrl.test(page.url())) {
      throw error;
    }
    if (!loginUrl.test(page.url())) {
      await page.waitForURL(loginUrl, { timeout: 5000 });
    }
  });
}

async function registerWithPassword(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await fillEmail(page, email);
  await advanceUnknownUserToRegistration(page);
  await expectRegistrationChoice(page);
  await fillEmailIfVisible(page, email);
  await fillProfileFieldsIfVisible(page);
  await choosePasswordRegistration(page);
  await fillPassword(page, password);
  await clickSubmit(page);
  await skipPasskeyUpsellIfVisible(page);
}

async function loginWithPassword(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await gotoLogin(page);
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
  await fillProfileFieldsIfVisible(page);
  await clickAction(page, /register.*passkey|passkey.*register|passkey_register/i, [
    "passkey_register",
  ]);
}

async function loginWithPasskey(page: Page, email: string): Promise<void> {
  await gotoLogin(page);
  await fillEmail(page, email);
  await clickAction(page, /sign in with.*passkey|passkey/i, ["passkey"]);
}

async function skipPasskeyUpsellIfVisible(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: /skip for now/i });
  const nextState = await Promise.race([
    skip
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "passkey-upsell" as const),
    signedInLocator(page)
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "signed-in" as const),
  ]).catch(() => {
    throw new Error(
      `Timed out waiting for signed-in surface or passkey upsell; current URL: ${page.url()}`,
    );
  });
  if (nextState === "passkey-upsell") {
    await skip.click();
  }
}

async function expectSignedIn(page: Page): Promise<void> {
  await expect(page).toHaveURL(profileUrl, { timeout: 30_000 });
  await expect(signedInLocator(page).first()).toBeVisible({ timeout: 30_000 });
}

async function expectSessionCookie(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        Boolean(
          (await page.context().cookies()).find(
            (cookie) => cookie.name === "__nextgen_session" && cookie.value,
          ),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "__nextgen_session",
  );
  expect(sessionCookie?.httpOnly).toBe(true);
}

let virtualAuthenticatorAdded = false;

async function enableVirtualAuthenticator(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");

  if (virtualAuthenticatorAdded) {
    // Authenticator already created — just refreshing the CDP session
    // binding so credentials remain accessible after navigation.
    return;
  }

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
  virtualAuthenticatorAdded = true;
}

async function logout(page: Page): Promise<void> {
  const logout = logoutLocator(page);
  if (!(await logout.first().isVisible({ timeout: 1000 }).catch(() => false))) {
    await page.getByRole("button", { name: /open user menu/i }).click();
  }
  await expect(logout.first()).toBeVisible({ timeout: 5000 });
  await logout.first().click();
  const loggedOutUrl = expectsProtectedRouteRedirect
    ? loginUrl
    : /\/(?:login)?(?:[/?#]|$)/;
  await expect(page).toHaveURL(loggedOutUrl);
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

async function expectRegistrationChoice(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: /create|register|sign up|no-account/i }),
  ).toBeVisible({ timeout: 30_000 });
}

async function fillEmail(page: Page, email: string): Promise<void> {
  await fieldControl(page, "email", /email/i).fill(email);
}

async function fillEmailIfVisible(page: Page, email: string): Promise<void> {
  const emailField = fieldControl(page, "email", /email/i);
  if (await emailField.isVisible().catch(() => false)) {
    await emailField.fill(email);
  }
}

async function fillProfileFieldsIfVisible(page: Page): Promise<void> {
  await fillFieldIfVisible(page, /given.?name/i, "Ada");
  await fillFieldIfVisible(page, /family.?name/i, "Lovelace");
  await fillFieldIfVisible(page, /date.?of.?birth/i, "1990-01-15");
}

async function fillFieldIfVisible(
  page: Page,
  label: RegExp,
  value: string,
): Promise<void> {
  const field = page.getByLabel(label).first();
  if (await field.isVisible().catch(() => false)) {
    await field.fill(value);
  }
}

async function fillPassword(page: Page, password: string): Promise<void> {
  await fieldControl(page, "password", /password/i).fill(password);
}

async function isPasswordVisible(page: Page): Promise<boolean> {
  return fieldControl(page, "password", /password/i).isVisible().catch(() => false);
}

async function expectSessionCleared(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        (await page.context().cookies()).some(
          (cookie) => cookie.name === "__nextgen_session",
        ),
      { timeout: 5000 },
    )
    .toBe(false);
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
  const candidates: Locator[] = [];
  for (const actionName of actionNames) {
    candidates.push(
      page.getByTestId(`zitadel-action-${actionName}-button`),
      page.getByTestId(`zitadel-action-${actionName}`),
      page.getByTestId(`zitadel-action-${actionName}-link`),
      actionLocator(page, actionName),
    );
  }
  candidates.push(page.getByRole("button", { name }), page.getByRole("link", { name }));

  for (const candidate of candidates) {
    const target = candidate.first();
    if (await target.isVisible({ timeout: 1000 }).catch(() => false)) {
      await target.click();
      return;
    }
  }

  const fallback = candidates[candidates.length - 1];
  if (!fallback) {
    throw new Error("No action candidates configured");
  }
  await fallback.first().click();
}

function actionLocator(page: Page, actionName: string) {
  return page.locator(`zl-button[action="${actionName}"], [data-action="${actionName}"]`);
}

function isInterruptedByLoginNavigation(error: unknown): boolean {
  return (
    error instanceof Error &&
    isExpectedNavigationRace(error.message, "/login")
  );
}

function isExpectedNavigationRace(message: string, path: string): boolean {
  return (
    (message.includes('interrupted by another navigation to "') ||
      message.includes("net::ERR_ABORTED at ")) &&
    message.includes(path)
  );
}

function profileActionLocator(page: Page): Locator {
  return logoutLocator(page).or(page.getByRole("button", { name: /open user menu/i }));
}

function signedInLocator(page: Page): Locator {
  return page.getByRole("heading", { name: /signed in/i }).or(profileActionLocator(page));
}

function fieldControl(page: Page, fieldName: string, label: RegExp): Locator {
  return page
    .getByTestId(`zitadel-field-${fieldName}`)
    .locator("input")
    .or(page.locator(`zl-field[name="${fieldName}"]`).locator("input"))
    .or(page.getByLabel(label))
    .first();
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
