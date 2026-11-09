import { expect, test, type Page } from "@playwright/test";
import {
  clickFlowAction,
  enableVirtualPasskey,
  fillFlowField,
  flowAction,
  flowField,
  identity,
  loginWithPasskey,
  loginWithPassword,
  registerWithPasskey,
  registerWithPassword,
} from "@zitadel/testing/playwright";

import {
  appSessionCookieName,
  expectSignedIn,
  expectsProtectedRouteRedirect,
  gotoLogin,
  loginUrl,
  logout,
  registrationProfile,
} from "./support";

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const framework = process.env.JOURNEY_FRAMEWORK ?? "next";
// The scaffolded sign-in preset decides which journeys apply: the default
// password-first scaffold enters on the identifier step; passkey-first
// enters on a fields-less passkey step with an email fallback. `||`, not
// `??`: the runner passes an empty string for "default preset", and an
// empty preset must still register the password-first journeys.
const preset = process.env.JOURNEY_PRESET || "password-first";

if (preset === "password-first") {
  test(`password-only registration, logout, and password login work in a fresh ${framework} app`, async ({
    page,
  }) => {
    const { email, password } = identity();

    if (expectsProtectedRouteRedirect) {
      await expectProtectedRouteToRedirect(page);
    }
    await gotoLogin(page);
    await registerWithPassword(page, { email, password, profile: registrationProfile });
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
    const { email, password } = identity();

    await gotoLogin(page);

    // The identifier step's "Sign up" nav must work with the email box
    // empty: navigate-kind actions skip field validation, and the purposed
    // transition re-enters the flow in register mode. The registration
    // step's own `sign_in` action is a structural, locale-free marker — it
    // is the one action only that step declares.
    await clickFlowAction(page, "register");
    await expect(flowAction(page, "sign_in")).toBeVisible();

    // Round-trip back to sign-in through the register step's own nav.
    await clickFlowAction(page, "sign_in");
    await expect(flowField(page, "email", { label: /email/i })).toBeVisible();
    await expect(flowAction(page, "sign_in")).toBeHidden();

    // Forward again and complete the registration entirely on the nav
    // path — this must run real register semantics (create, not verify).
    await clickFlowAction(page, "register");
    await expect(flowAction(page, "sign_in")).toBeVisible();
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
    await expectSignedIn(page);
    await expectSessionCookie(page);
  });
}

if (preset === "passkey-first" && process.env.JOURNEY_ENABLE_PASSKEY !== "0") {
  test(`passkey-first preset: fallback registration, then one-tap passkey login in a fresh ${framework} app`, async ({
    page,
  }) => {
    const authenticator = await enableVirtualPasskey(page);
    const { email } = identity();

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

async function expectProtectedRouteToRedirect(page: Page): Promise<void> {
  await page.goto("/profile");
  await expect(page).toHaveURL(loginUrl);
}

async function expectSessionCookie(page: Page): Promise<void> {
  const name = await appSessionCookieName(page.url());
  await expect
    .poll(
      async () =>
        Boolean(
          (await page.context().cookies()).find((cookie) => cookie.name === name && cookie.value),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  const sessionCookie = (await page.context().cookies()).find((cookie) => cookie.name === name);
  expect(sessionCookie?.httpOnly).toBe(true);
}
