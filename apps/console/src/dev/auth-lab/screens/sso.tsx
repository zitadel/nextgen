/**
 * SSO exploration states — not in Figma. Step shapes follow #1042 and the
 * `default-login.scaffold.json` steps in `docs/design/idp/` (on `main`); every
 * visible string is placeholder copy standing in for a locale key that #1042
 * has yet to add. Kept minimal on purpose: they reuse the approved shell and
 * components so they can be explored and refined in Dessn.
 */

import { useId } from "react";

import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";

import {
  AuthCard,
  AuthInput,
  AuthShell,
  FooterPrompt,
  PasswordLabel,
  SsoProviders,
} from "../auth-shell";

/**
 * `register-sso` — a new Google user whose required user-schema attributes
 * did not arrive from the provider. Fields are schema-driven; the scaffold
 * collects `email`, shown here missing (required, empty). Prefilled values
 * would arrive in the field's `value` and stay editable.
 */
export function RegisterSsoScreen() {
  const id = useId();
  return (
    <AuthShell>
      <AuthCard
        title="Complete your account"
        description="Some details are missing from your Google account."
      >
        <CardContent>
          <form className="flex flex-col gap-7" onSubmit={(event) => event.preventDefault()}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
                <AuthInput id={`${id}-email`} type="email" placeholder="m@example.com" required />
              </Field>
            </FieldGroup>
            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
        </CardContent>
      </AuthCard>
    </AuthShell>
  );
}

/**
 * `sso-conflict` — the Google identity collides with an existing account.
 * Per #1042: the account-exists explanation is the step description; the step
 * renders the password field, the submit and passkey actions, the `sign_in`
 * navigate action, and the provider buttons.
 */
export function SsoConflictScreen() {
  const id = useId();
  return (
    <AuthShell>
      <AuthCard
        title="Account already exists"
        description="An account with this email already exists. Sign in to continue."
      >
        <CardContent>
          <form className="flex flex-col gap-7" onSubmit={(event) => event.preventDefault()}>
            <FieldGroup>
              <Field>
                <PasswordLabel htmlFor={`${id}-password`} />
                <AuthInput id={`${id}-password`} type="password" />
              </Field>
            </FieldGroup>
            <div className="flex flex-col gap-3">
              <Button type="submit" className="w-full">
                Sign in
              </Button>
              <Button type="button" variant="secondary" className="w-full">
                Sign in with Passkey
              </Button>
              <SsoProviders />
              <FooterPrompt action="Sign in with a different account" href="#sign-in-google" />
            </div>
          </form>
        </CardContent>
      </AuthCard>
    </AuthShell>
  );
}

/**
 * Flow-level error (state expired/reused, binding cookie mismatch, cross-schema
 * resolution): not a step, so no fields — a generic message and a restart
 * control, with no failure details (#1042, "Flow-Level Errors").
 */
export function SsoFlowErrorScreen() {
  return (
    <AuthShell>
      <AuthCard
        title="Something went wrong"
        description="We couldn't continue signing you in. Please start again."
      >
        <CardContent>
          <Button className="w-full" onClick={() => (window.location.hash = "sign-in-google")}>
            Restart
          </Button>
        </CardContent>
      </AuthCard>
    </AuthShell>
  );
}
