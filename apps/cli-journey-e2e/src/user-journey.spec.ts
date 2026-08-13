/* oxlint-disable playwright/expect-expect, playwright/no-conditional-in-test */
import { randomUUID } from "node:crypto";

import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  clickFlowAction,
  enableVirtualPasskey,
  fillFlowField,
  flowAction,
  flowField,
  loginWithPasskey,
  loginWithPassword,
  registerWithPasskey,
  registerWithPassword,
  type ProfileEntry,
} from "@zitadel/testing/playwright";

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const framework = process.env.JOURNEY_FRAMEWORK ?? "next";
// The scaffolded sign-in preset decides which journeys apply: the default
// password-first scaffold enters on the identifier step; passkey-first
// enters on a fields-less passkey step with an email fallback. `||`, not
// `??`: the runner passes an empty string for "default preset", and an
// empty preset must still register the password-first journeys.
const preset = process.env.JOURNEY_PRESET || "password-first";
const expectsProtectedRouteRedirect = framework === "next" || framework === "nuxt";
const loginUrl = /\/login(?:[/?#]|$)/;
const profileUrl = /\/profile(?:[/?#]|$)/;

// Fields some presets require at registration; the kit fills them only when
// the flow renders them.
const registrationProfile: ProfileEntry[] = [
  { field: "givenName", value: "Ada", label: /given.?name/i },
  { field: "familyName", value: "Lovelace", label: /family.?name/i },
  { field: "dateOfBirth", value: "1990-01-15", label: /date.?of.?birth/i },
];

if (preset === "password-first") {
  test(`password-only registration, logout, and password login work in a fresh ${framework} app`, async ({
    page,
  }) => {
    const email = uniqueEmail("password");
    const password = "Correct-Horse-42!";

    if (expectsProtectedRouteRedirect) {
      await expectProtectedRouteToRedirect(page);
    }
    await gotoLogin(page);
    await registerWithPassword(page, { email, password, profile: registrationProfile });
    await skipPasskeyUpsellIfVisible(page);
    await expectSignedIn(page);
    await expectSessionCookie(page);

    await logout(page);
    await gotoLogin(page);
    await loginWithPassword(page, { email, password });
    await expectSignedIn(page);
    await expectSessionCookie(page);
  });

  test(`in-card sign-up and sign-in navigation switches purpose in a fresh ${framework} app`, async ({
    page,
  }) => {
    const email = uniqueEmail("navswitch");
    const password = "Correct-Horse-43!";

    await gotoLogin(page);

    // The identifier step's "Sign up" nav must work with the email box
    // empty: navigate-kind actions skip field validation, and the purposed
    // transition re-enters the flow in register mode. The registration
    // step's `passkey_register` action is a structural, locale-free marker.
    await clickFlowAction(page, "register");
    await expect(flowAction(page, "passkey_register")).toBeVisible();

    // Round-trip back to sign-in through the register step's own nav.
    await clickFlowAction(page, "sign_in");
    await expect(flowField(page, "email", { label: /email/i })).toBeVisible();
    await expect(flowAction(page, "passkey_register")).toBeHidden();

    // Forward again and complete the registration entirely on the nav
    // path — this must run real register semantics (create, not verify).
    await clickFlowAction(page, "register");
    await expect(flowAction(page, "passkey_register")).toBeVisible();
    await fillFlowField(page, "email", email, { label: /email/i });
    for (const entry of registrationProfile) {
      if (typeof entry.value !== "string") continue;
      const field = flowField(page, entry.field, { label: entry.label });
      if (await field.isVisible().catch(() => false)) {
        await field.fill(entry.value);
      }
    }
    await clickFlowAction(page, "submit");
    await fillFlowField(page, "password", password, { label: /password/i });
    await clickFlowAction(page, "submit");
    await skipPasskeyUpsellIfVisible(page);
    await expectSignedIn(page);
    await expectSessionCookie(page);
  });
}

if (preset === "passkey-first") {
  test(`passkey-first preset: fallback registration, then one-tap passkey login in a fresh ${framework} app`, async ({
    page,
  }) => {
    const authenticator = await enableVirtualPasskey(page);
    const email = uniqueEmail("passkey-first");

    await gotoLogin(page);
    // Entry step renders the primary passkey action exactly once (a stale
    // server-owned template used to render a second passkey button — the
    // regression #495 fixed) plus the email fallback.
    const passkeyButtons = page.getByRole("button", { name: /passkey/i });
    await expect(passkeyButtons.first()).toBeVisible({ timeout: 30_000 });
    await expect(passkeyButtons).toHaveCount(1);

    // Fresh user, no credential yet: take the email fallback into
    // registration and create the account with a passkey.
    await clickFlowAction(page, "email_fallback", { name: /use email instead/i });
    await registerWithPasskey(page, { email, profile: registrationProfile });
    await expectSignedIn(page);
    await expectSessionCookie(page);
    await expect.poll(() => authenticator.credentialCount()).toBe(1);

    await logout(page);

    // Returning user: one tap on the entry step's primary action — the
    // discoverable credential signs in without typing an email. Wait for
    // the re-rendered entry step first: right after the logout redirect the
    // login component is still hydrating.
    await gotoLogin(page);
    await expect(passkeyButtons.first()).toBeVisible({ timeout: 30_000 });
    await expect(passkeyButtons).toHaveCount(1);
    await loginWithPasskey(page);
    await expectSignedIn(page);
    await expectSessionCookie(page);
    await expect.poll(() => authenticator.credentialCount()).toBe(1);
  });
}

if (preset === "password-first" && process.env.JOURNEY_ENABLE_PASSKEY !== "0") {
  test(`passkey-only registration, logout, and passkey login work in a fresh ${framework} app`, async ({
    page,
  }) => {
    const authenticator = await enableVirtualPasskey(page);

    const email = uniqueEmail("passkey");

    await gotoLogin(page);
    await registerWithPasskey(page, { email, profile: registrationProfile });
    await expectSignedIn(page);
    await expectSessionCookie(page);
    await expect.poll(() => authenticator.credentialCount()).toBe(1);

    await logout(page);
    await gotoLogin(page);
    await loginWithPasskey(page, { email });
    await expectSignedIn(page);
    await expectSessionCookie(page);
    await expect.poll(() => authenticator.credentialCount()).toBe(1);
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

async function logout(page: Page): Promise<void> {
  const logout = logoutLocator(page);
  const userMenu = page.getByRole("button", { name: /open user menu/i });

  // `<zitadel-session>` exposes Sign out directly; `<zitadel-logout>` hides it
  // behind an avatar menu. Wait for either surface, and only open the menu when
  // the direct logout control is not already visible.
  await Promise.race([
    logout.waitFor({ state: "visible", timeout: 30_000 }),
    userMenu.waitFor({ state: "visible", timeout: 30_000 }),
  ]);
  if (!(await logout.isVisible().catch(() => false))) {
    await userMenu.click();
    await logout.waitFor({ state: "visible", timeout: 5_000 });
  }
  await logout.click();
  const loggedOutUrl = expectsProtectedRouteRedirect
    ? loginUrl
    : /\/(?:login)?(?:[/?#]|$)/;
  await expect(page).toHaveURL(loggedOutUrl);
  await expectSessionCleared(page);
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

function logoutLocator(page: Page) {
  return page
    .locator("zitadel-logout .signout-btn")
    .or(page.locator('zl-button[action="logout"], [data-action="logout"]'))
    .or(page.getByRole("button", { name: /logout|sign out/i }))
    .or(page.getByRole("link", { name: /logout|sign out/i }));
}

function uniqueEmail(prefix: string): string {
  // crypto-backed, not Math.random(): these identifiers flow into the kit's
  // credential-shaped ceremony inputs, where CodeQL flags insecure randomness.
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
}
