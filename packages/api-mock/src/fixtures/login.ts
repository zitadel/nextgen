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

export type StepFixtureInput = {
  flowId: string;
  sessionToken: string;
  /** Issuer URL embedded in signed tokens (e.g. `"http://localhost:4000"`). */
  iss: string;
};

const submitContinue = { submit: { text_key: "submit.continue", primary: true } };

function wrap(input: StepFixtureInput, step: CreateFlow201Step, extras?: Partial<CreateFlow201>): CreateFlow201 {
  return {
    id: input.flowId,
    session_id: "sess_mock",
    session_token: input.sessionToken,
    step,
    ...extras,
  };
}

export function identifierStep(input: StepFixtureInput): CreateFlow201 {
  return wrap(input, {
    name: "identifier",
    texts: { title_key: "identifier.title", description_key: "identifier.description" },
    fields: { email: { type: "email", text_key: "identifier.field.email", required: true } },
    actions: submitContinue,
    gates: {},
  });
}

export function registerStep(input: StepFixtureInput): CreateFlow201 {
  return wrap(input, {
    name: "register",
    texts: { title_key: "register.title", description_key: "register.description" },
    fields: {
      email: { type: "email", text_key: "register.field.email", required: true },
      given_name: { type: "text", text_key: "register.field.given_name", required: true },
      family_name: { type: "text", text_key: "register.field.family_name", required: true },
    },
    actions: submitContinue,
    gates: {},
  });
}

export function passwordStep(input: StepFixtureInput): CreateFlow201 {
  return wrap(input, {
    name: "password",
    texts: { title_key: "password.title", description_key: "password.description" },
    fields: { password: { type: "password", text_key: "password.field.password", required: true } },
    actions: { submit: { text_key: "submit.signin", primary: true } },
    gates: {},
  });
}

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

export function doneStep(input: StepFixtureInput & { redirectUri?: string }): CreateFlow201 {
  const { redirectUri, iss } = input;
  return wrap(
    input,
    {
      name: "done",
      texts: { title_key: "complete.title" },
      complete: redirectUri ? "redirect" : "show",
      fields: {},
      actions: {},
      gates: {},
    },
    {
      handoff_token: signHandoffToken({ sub: "mock-user@example.com", iss }),
      handoff_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    },
  );
}
