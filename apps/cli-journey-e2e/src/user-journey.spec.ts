import { expect, test, type Locator, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("password registration, logout, and login work in a fresh Next app", async ({
  page,
}) => {
  const email = uniqueEmail("password");
  const password = "Correct-Horse-42!";

  await expectProtectedRouteToRedirect(page);
  await page.goto("/login");
  await registerWithPassword(page, email, password);
  await expectSignedIn(page);
  await expectSessionCookie(page);

  await logout(page);
  await loginWithPassword(page, email, password);
  await expectSignedIn(page);
  await expectSessionCookie(page);
});

if (process.env.JOURNEY_ENABLE_PASSKEY === "1") {
  test("passkey registration, logout, and passkey login work in a fresh Next app", async ({
    page,
  }) => {
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
}

async function expectProtectedRouteToRedirect(page: Page): Promise<void> {
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
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
  await fillPassword(page, password);
  await clickSubmit(page);
  const skip = actionLocator(page, "skip").or(page.getByRole("button", { name: /skip for now/i }));
  if (await skip.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await skip.click();
  }
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

async function logout(page: Page): Promise<void> {
  await clickAction(page, /logout|sign out/i, ["logout"]);
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

async function expectRegistrationChoice(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: /create|register|sign up|no-account/i }),
  ).toBeVisible({ timeout: 30_000 });
}

async function fillEmail(page: Page, email: string): Promise<void> {
  await fillField(page, emailFieldCandidates(page), email, 30_000);
}

async function fillEmailIfVisible(page: Page, email: string): Promise<void> {
  const emailField = await firstVisibleField(emailFieldCandidates(page), 1_000);
  if (emailField) {
    await emailField.fill(email);
  }
}

async function fillPassword(page: Page, password: string): Promise<void> {
  await fillField(page, passwordFieldCandidates(page), password, 30_000);
}

async function isPasswordVisible(page: Page): Promise<boolean> {
  return Boolean(await firstVisibleField(passwordFieldCandidates(page), 1_000));
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

function emailFieldCandidates(page: Page): Locator[] {
  return [
    page.locator('zl-field[name="email"] input'),
    page.locator('input[name="email"], input[type="email"], input[autocomplete="email"]'),
    page.getByLabel(/email/i),
  ];
}

function passwordFieldCandidates(page: Page): Locator[] {
  return [
    page.locator('zl-field[name="password"] input'),
    page.locator('input[name="password"], input[type="password"], input[autocomplete*="password"]'),
    page.getByLabel(/password/i),
  ];
}

async function fillField(
  page: Page,
  candidates: Locator[],
  value: string,
  timeout: number,
): Promise<void> {
  const field = await firstVisibleField(candidates, timeout);
  if (!field) {
    throw new Error(`No visible field found at ${page.url()}`);
  }
  await field.fill(value);
}

async function firstVisibleField(
  candidates: Locator[],
  timeout: number,
): Promise<Locator | null> {
  const deadline = Date.now() + timeout;
  do {
    for (const candidate of candidates) {
      const field = candidate.first();
      if (await field.isVisible().catch(() => false)) {
        return field;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return null;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}
