import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";

import { AuthCard, AuthShell } from "../auth-shell";

/**
 * `Blocks / signinPasskey` — Figma 1705:2332 (desktop), 1705:2355 (mobile).
 * The passkey enrolment prompt after sign-in; the block has no trustmark.
 */
export function PasskeyScreen() {
  return (
    <AuthShell trustmark={false}>
      <AuthCard title="Sign in faster next time" description="With Face ID, Touch ID, or PIN.">
        <CardContent className="flex flex-col gap-3">
          <Button className="w-full">Setup passkey</Button>
          <Button variant="secondary" className="w-full">
            Skip for now
          </Button>
        </CardContent>
      </AuthCard>
    </AuthShell>
  );
}
