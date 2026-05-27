/**
 * Orval-typed step fixtures for the canonical login flow.
 *
 * Each builder returns a `CreateFlow201` shape. The wire is identical for
 * `POST /flow`, `POST /flow/{id}/submit`, and `GET /flow/{id}` (orval emits
 * three structurally identical aliases), so a single fixture set drives all
 * three handlers.
 *
 * Branding is applied by `../handlers.ts` via the overlay in `../branding.ts`
 * — fixtures themselves never embed branding so playground / test consumers
 * can swap it without rebuilding the fixture.
 */
import type { CreateFlow201, CreateFlow201Step } from "@zitadel-nextgen/api/generated/model";

import { signHandoffToken } from "../crypto.js";
import type { StoredCredential } from "../lib/authn/index.js";

export type StepFixtureInput = {
  flowId: string;
  sessionToken: string;
  /** Issuer URL embedded in signed tokens (e.g. `"http://localhost:4000"`). */
  iss: string;
  /**
   * Email captured from the identifier step, used as the JWT `sub` claim in
   * the handoff token. Falls back to `"mock-user@example.com"` when absent
   * (e.g. SSO flows that skip the identifier step).
   */
  capturedEmail?: string;
  /**
   * Credentials registered for this user, looked up from {@link AuthnStore}
   * by email before each response. Used by `passkeyLoginStep` to build
   * `allowCredentials` with the correct transports so the browser can match
   * and surface the enrolled authenticator. An empty list omits the
   * `allowCredentials` field entirely, falling back to discoverable-credential
   * mode — which is correct when the user has no credentials yet, or after a
   * server restart that wipes the in-memory store.
   *
   * All other step builders ignore this field; it is safe to always populate
   * it regardless of which step is being rendered.
   */
  registeredCredentials?: Pick<StoredCredential, "credentialId" | "transports">[];
};

/**
 * Derive a stable base64url user handle from an email address.
 *
 * In a real RP, `user.id` is an opaque, unique identifier stored by the
 * authenticator alongside the credential — it must never be the email itself
 * (to avoid leaking PII to the platform authenticator). A deterministic
 * encoding of the email is sufficient for the mock: it is stable across
 * registrations for the same address, unique per address, and keeps the
 * browser's keychain from conflating credentials belonging to different users.
 */
function emailToUserHandle(email: string): string {
  return btoa(email).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Wrap a step shape in the standard {@link CreateFlow201} envelope.
 * All fixtures delegate to this helper so the session fields stay consistent.
 */
function wrap(input: StepFixtureInput, step: CreateFlow201Step, extras?: Partial<CreateFlow201>): CreateFlow201 {
  return {
    id: input.flowId,
    session_id: "sess_mock",
    session_token: input.sessionToken,
    step,
    ...extras,
  };
}

/**
 * Combined sign-in card — Figma 2xl `6593:141983`, card `6593:141985`,
 * stack `6593:141989` (email + password + forgot + CTAs on one step).
 *
 * Matches the Flow API shape in `docs/design/flowengine/flow-engine.md`
 * (single `login` step with `fields: [email, password]`).
 */
export function identifierStep(input: StepFixtureInput): CreateFlow201 {
  return wrap(input, {
    name: "identifier",
    texts: { title_key: "identifier.title" },
    fields: {
      email: {
        type: "email",
        text_key: "identifier.field.email",
        required: true,
      },
      password: {
        type: "password",
        text_key: "identifier.field.password",
        required: true,
      },
    },
    actions: {
      submit: { text_key: "submit.signin", primary: true },
      passkey: { text_key: "identifier.action.passkey" },
      register: { text_key: "identifier.action.register.link" },
      recover: { text_key: "action.forgot_password" },
    },
    gates: {},
  });
}

/** Sign-up 2xl frame `6593:141741`, card `6593:141743`, stack `6593:141747`. */
export function registerStep(input: StepFixtureInput): CreateFlow201 {
  return wrap(input, {
    name: "register",
    texts: { title_key: "register.title" },
    fields: {
      email: {
        type: "email",
        text_key: "register.field.email",
        required: true,
      },
      password: {
        type: "password",
        text_key: "register.field.password",
        required: true,
        validation: { min_length: 8 },
      },
    },
    actions: {
      submit: { text_key: "register.action.submit", primary: true },
    },
    gates: {},
  });
}

/**
 * Password-only step — legacy split-credential screen kept for tests that
 * target it directly. Not reachable from any `START` transition in the normal
 * flow; the happy path goes `identifier → passkey-upsell` directly.
 */
export function passwordStep(input: StepFixtureInput): CreateFlow201 {
  return wrap(input, {
    name: "password",
    texts: { title_key: "password.title" },
    fields: {
      password: {
        type: "password",
        text_key: "password.field.password",
        required: true,
      },
    },
    actions: {
      submit: { text_key: "submit.signin", primary: true },
      passkey: { text_key: "password.action.passkey" },
      register: { text_key: "password.action.register.link" },
    },
    gates: {},
  });
}

/**
 * Password recovery step — shown when the user clicks "Forgot password?" on
 * the identifier screen. Tells the user to check their email and offers a
 * "Back to sign in" action (simulating the recovery pivot return).
 */
export function recoverStep(input: StepFixtureInput): CreateFlow201 {
  return wrap(input, {
    name: "recover",
    texts: {
      title_key: "recover.title",
      description_key: "recover.description",
    },
    fields: {},
    actions: {
      submit: { text_key: "recover.action.back", primary: true },
    },
    gates: {},
  });
}

/**
 * Passkey enrolment upsell — prompts the user to set up a passkey after a
 * successful credential sign-in. Figma `6594:630`.
 */
export function passkeyUpsellStep(input: StepFixtureInput): CreateFlow201 {
  return wrap(input, {
    name: "passkey-upsell",
    texts: { title_key: "passkey-upsell.title" },
    fields: {},
    actions: {
      setup: { text_key: "passkey-upsell.action.setup", primary: true },
      skip: { text_key: "passkey-upsell.action.skip" },
    },
    gates: {},
  });
}

/**
 * Passkey setup step — returned after the user clicks "Set up passkey" on the
 * upsell screen. Contains a mock `challenge` with WebAuthn registration
 * options so `<zl-passkey ceremony="register">` can trigger
 * `navigator.credentials.create()`. Follows the two-submit model from ADR 013.
 */
export function passkeySetupStep(input: StepFixtureInput): CreateFlow201 {
  const userEmail = input.capturedEmail ?? "mock-user@example.com";
  return wrap(input, {
    name: "passkey-setup",
    texts: { title_key: "passkey-upsell.title" },
    fields: {},
    actions: {
      submit: { text_key: "submit.continue", primary: true },
    },
    gates: {},
    challenge: {
      method: "passkey",
      challenge_id: "ch_mock_passkey_setup",
      options: {
        ceremony: "register",
        challenge: "AAAAAAAAAAAAAAAAAAAAAA",
        rp: { name: "Mock RP", id: "localhost" },
        user: {
          id: emailToUserHandle(userEmail),
          name: userEmail,
          displayName: userEmail,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        timeout: 60000,
        attestation: "none",
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "preferred",
        },
      },
    },
  });
}

/**
 * Passkey login step — returned when the user clicks "Sign in with passkey"
 * on the identifier screen. Contains a mock `challenge` with WebAuthn
 * authentication options so `<zl-passkey ceremony="authenticate">` can
 * trigger `navigator.credentials.get()`. The browser prompts for an
 * existing credential (Touch ID / Windows Hello / security key).
 *
 * When `input.registeredCredentials` is non-empty, `allowCredentials` is
 * populated so the browser targets exactly the enrolled authenticator. An
 * empty list omits the field, triggering discoverable-credential mode.
 */
export function passkeyLoginStep(input: StepFixtureInput): CreateFlow201 {
  const allowCredentials = (input.registeredCredentials ?? []).map((c) => ({
    type: "public-key",
    id: c.credentialId,
    transports: c.transports,
  }));

  return wrap(input, {
    name: "passkey-login",
    texts: { title_key: "passkey-login.title" },
    fields: {},
    actions: {
      submit: { text_key: "submit.continue", primary: true },
      cancel: { text_key: "action.cancel" },
    },
    gates: {},
    challenge: {
      method: "passkey",
      challenge_id: "ch_mock_passkey_login",
      options: {
        ceremony: "authenticate",
        challenge: "BBBBBBBBBBBBBBBBBBBBBB",
        rpId: "localhost",
        timeout: 60000,
        userVerification: "preferred",
        ...(allowCredentials.length > 0 ? { allowCredentials } : {}),
      },
    },
  });
}

/**
 * SSO redirect step — tells the orchestrator to navigate to the identity
 * provider's authorisation endpoint.
 *
 * `redirectUrl` is optional so callers can supply a provider-specific URL in
 * future; today `handlers.ts` does not pass one, so the hardcoded mock URL is
 * always used.
 *
 * TODO: thread `ssoProviderId` from the machine context through to a computed
 * redirect URL so each provider gets a distinct mock destination.
 */
export function ssoRedirectStep(
  input: StepFixtureInput & { redirectUrl?: string },
): CreateFlow201 {
  return wrap(input, {
    name: "sso-redirect",
    texts: { title_key: "sso.redirect.title" },
    fields: {},
    actions: {},
    gates: {},
    redirect_url: input.redirectUrl ?? "https://idp.mock.invalid/authorize",
  });
}

/**
 * Signed-in confirmation step — includes a short-lived handoff token the
 * client exchanges for a session cookie via `POST /sessions/exchange`.
 *
 * `handoff_token_expires_at` is set to 60 seconds from the time this function
 * is called, matching the `exp` claim inside the JWT. Tests that assert on
 * this value should treat it as approximate rather than exact.
 *
 * The `sub` claim falls back to `"mock-user@example.com"` when `capturedEmail`
 * is absent or an empty string. The `||` operator (rather than `??`) is
 * intentional: an empty-string email is not a valid JWT subject, so it should
 * also fall back to the placeholder.
 */
export async function doneStep(input: StepFixtureInput): Promise<CreateFlow201> {
  const { iss, capturedEmail } = input;
  return wrap(
    input,
    {
      name: "done",
      texts: { title_key: "complete.title" },
      complete: "show",
      fields: {},
      actions: {
        continue: { text_key: "signed-in.continue", primary: true },
        logout: { text_key: "signed-in.logout" },
      },
      gates: {},
    },
    {
      handoff_token: await signHandoffToken({
        sub: capturedEmail || "mock-user@example.com",
        iss,
      }),
      handoff_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
  );
}
