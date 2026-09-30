import { useId } from "react";

import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";

import {
  AuthAlert,
  AuthCard,
  AuthInput,
  AuthShell,
  FooterPrompt,
  PasswordLabel,
  SsoProviders,
} from "../auth-shell";

/**
 * `Blocks / signin` — Figma 1705:1533 (desktop). With `alert` it is
 * `Blocks / signinAlert` — Figma 1705:1535 (desktop), 1705:2247 (mobile).
 *
 * `sso` appends the (exploration) provider block after the actions; the SSO
 * error states re-render this same step with an `alert`, as the engine does
 * (#1042: errors surface on the originating step).
 */
export function SignInScreen({
  alert,
  sso = false,
}: {
  alert?: { title: string; description: string };
  sso?: boolean;
}) {
  const id = useId();
  return (
    <AuthShell>
      <AuthCard title="Sign in">
        <CardContent>
          <form className="flex flex-col gap-7" onSubmit={(event) => event.preventDefault()}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
                <AuthInput id={`${id}-email`} type="email" placeholder="m@example.com" />
              </Field>
              <Field>
                <PasswordLabel htmlFor={`${id}-password`} forgot />
                <AuthInput id={`${id}-password`} type="password" />
              </Field>
              {alert && <AuthAlert {...alert} />}
            </FieldGroup>
            <div className="flex flex-col gap-3">
              <Button type="submit" className="w-full">
                Sign in
              </Button>
              <Button type="button" variant="secondary" className="w-full">
                Sign in with Passkey
              </Button>
              {sso && <SsoProviders />}
              <FooterPrompt
                prompt="Don't have an account?"
                action="Sign up"
                href={sso ? "#sign-up-google" : "#sign-up-card"}
              />
            </div>
          </form>
        </CardContent>
      </AuthCard>
    </AuthShell>
  );
}
