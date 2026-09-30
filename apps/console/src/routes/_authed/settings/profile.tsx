import { createFileRoute } from "@tanstack/react-router";
import { CircleUserRound } from "lucide-react";
import { useId } from "react";

import { DetailPage } from "@/components/detail-page";
import { SettingsColumn } from "@/components/layout";
import { SettingsCard } from "@/components/settings-card";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { api } from "../../../api/zitadel";
import { field } from "../../../lib/record";
import { userAttributes, userIdentifier } from "../../../lib/user";

/**
 * Settings → Profile: the signed-in person's own account.
 *
 * Email only, and read-only (design decision D16): claiming asks for nothing
 * but an email address, and the email cannot be changed. No schema fields are
 * pulled in and there is nothing to save.
 *
 * Composes the detail shell (`detail-page.tsx`) rather than measuring its own
 * frame; the title stands alone because a settings screen has no icon tile
 * and no id card.
 */
export const Route = createFileRoute("/_authed/settings/profile")({
  staticData: {
    nav: { label: "Profile", order: 0, icon: CircleUserRound, view: "settings", group: "ACCOUNT" },
  },
  loader: async () => ({ user: await api.getMyUser() }),
  component: ProfileScreen,
});

// The wide row is two equal halves, which is what lines the control up at the
// card's midpoint. `Field` sizes the label by its text instead, through a
// variant that out-specifies a plain utility, hence the important suffix.
const LABEL_HALF = "@md/field-group:min-w-px @md/field-group:flex-[1_0_0]!";
const ROW = "@md/field-group:items-center!";

function ProfileScreen() {
  const { user } = Route.useLoaderData();
  const record = user as Record<string, unknown>;
  // The schema's `email` attribute, or the designated identifier for a schema
  // that names it differently.
  const email = field(userAttributes(record), "email") ?? userIdentifier(record) ?? "";
  const id = useId();

  return (
    <DetailPage>
      <SettingsColumn>
        {/* No header gutter: the settings frame aligns the title with the card,
            where a resource detail insets its title lockup by 8px. */}
        <h1 className="text-foreground font-serif text-2xl leading-6 tracking-tight">Profile</h1>
        <SettingsCard>
          <Field orientation="responsive" className={ROW}>
            <FieldLabel htmlFor={id} className={LABEL_HALF}>
              Email address
            </FieldLabel>
            <FieldContent>
              <Input id={id} type="email" value={email} disabled readOnly />
            </FieldContent>
          </Field>
        </SettingsCard>
      </SettingsColumn>
    </DetailPage>
  );
}
