import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";

import {
  AuthCard,
  AuthInput,
  AuthShell,
  FooterPrompt,
  PasswordLabel,
  SsoProviders,
} from "../auth-shell";

/**
 * Two approved sign-up frames sit side by side on the Figma `✅ Login` page;
 * which is canonical is still open, so both are kept as separate states:
 *
 * - `card`: `Blocks / signup` library instance — Figma 1705:2161 (desktop),
 *   1705:2204 (mobile).
 * - `logo`: a detached `Blocks / signup` frame with a brand-logo lockup above
 *   the card — Figma 2226:10119 (desktop; no mobile frame). It also paints the
 *   footer prompt in the `muted-foreground` token instead of the raw #737373.
 *
 * `sso` appends the (exploration) provider block after the primary action.
 */
export function SignUpScreen({
  variant,
  sso = false,
}: {
  variant: "card" | "logo";
  sso?: boolean;
}) {
  const logo = variant === "logo";
  return (
    <AuthShell logo={logo}>
      <AuthCard title="Create account">
        <CardContent>
          <form className="flex flex-col gap-7" onSubmit={(event) => event.preventDefault()}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="sign-up-email">Email</FieldLabel>
                <AuthInput id="sign-up-email" type="email" placeholder="m@example.com" />
              </Field>
              <Field>
                <PasswordLabel htmlFor="sign-up-password" />
                <AuthInput
                  id="sign-up-password"
                  type="password"
                  aria-describedby="sign-up-password-hint"
                />
                <FieldDescription id="sign-up-password-hint" className="leading-5">
                  At least 8 characters, including a symbol and number.
                </FieldDescription>
              </Field>
            </FieldGroup>
            <div className="flex flex-col gap-3">
              <Button type="submit" className="w-full">
                Create account
              </Button>
              {sso && <SsoProviders />}
              <FooterPrompt
                prompt="Already have an account?"
                action="Sign in"
                href={sso ? "#sign-in-google" : "#sign-in"}
                tone={logo ? "token" : "figma-override"}
              />
            </div>
          </form>
        </CardContent>
      </AuthCard>
    </AuthShell>
  );
}
