import { createFileRoute } from "@tanstack/react-router";
import { CircleUserRound } from "lucide-react";
import { useId } from "react";

import { SettingsCard } from "@/components/settings-card";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { api } from "../../../api/zitadel";
import { displayValue } from "../../../lib/record";
import { type SchemaField, type UserSchema, schemaFields } from "../../../lib/schema";
import { userAttributes } from "../../../lib/user";

/**
 * Settings → Profile — the account's own profile (#916; Figma `1568:97804`:
 * wide `1556:87256`, narrow `1718:21347`).
 *
 * Reads `GET /users/me` and labels the attributes from the account's own
 * schema, exactly as the user detail screen does — the form is schema-driven,
 * not a fixed field list.
 *
 * Everything renders inert, and the design's Save is absent rather than
 * disabled: there is still no `PATCH /users/{user_id}` (#693), and the
 * precedent runs twice through this codebase — the user detail's read-only
 * profile, and the portal nav's removed disabled rows. A dead control
 * advertises a feature; Save arrives with the endpoint. Email is the one field
 * that stays uneditable *by design* — the frame draws it in the input's
 * Disabled state, annotated "Email can't be changed" — so it renders
 * `disabled` while the name fields are merely `readOnly` for now.
 *
 * The glyph is the design's `Lucide Icon / CircleUserRound` (`1610:44265`),
 * read off the node rather than picked by meaning.
 */
export const Route = createFileRoute("/_authed/settings/profile")({
  staticData: {
    nav: { label: "Profile", order: 0, icon: CircleUserRound, section: "account" },
  },
  loader: async () => {
    const user = await api.getMyUser();

    // The schema labels the record rather than being the record, so it is not
    // allowed to reject the loader: a failure costs the field labels, not the
    // screen (same posture as the user detail loader).
    const schema = user.schema
      ? await api
          .getSchemaById(user.schema)
          .then((value) => value.schema as UserSchema)
          .catch(() => undefined)
      : undefined;

    return { user, schema };
  },
  component: ProfilePage,
});

// The frames centre a content column in the Main area: 704px wide at 1280,
// full-width minus a 16px gutter in the 400px frame, starting 32px down.
const PAGE = "mx-auto flex w-full max-w-[704px] flex-col px-4 pt-8 pb-8";
// `Pro Blocks / Page Header / settingsProfile` (`1602:35943`): a 76px band —
// 20px of padding around a 36px title row — holding only the serif title.
const HEADER = "flex items-center py-5";
const HEADING = "text-foreground font-serif text-2xl leading-none tracking-tight";

function ProfilePage() {
  const { user, schema } = Route.useLoaderData();
  const attributes = userAttributes(user);
  const fields = schema ? schemaFields(schema) : [];

  return (
    <div className={PAGE}>
      <header className={HEADER}>
        <h1 className={HEADING}>Profile</h1>
      </header>
      <SettingsCard>
        {fields.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Your schema could not be read, so your attributes cannot be labelled.
          </p>
        ) : (
          fields.map((entry) => (
            <ProfileField
              key={entry.key}
              entry={entry}
              value={displayValue(attributes, entry.key) ?? ""}
            />
          ))
        )}
      </SettingsCard>
    </div>
  );
}

/**
 * The wide row is two *equal* halves — the frame (`1718:30828`) draws label and
 * control as `flex-[1_0_0]` each, which is what lines every input up at the
 * same x. shadcn's responsive `Field` instead gives the label `flex-auto`,
 * sized by its own text, so each row's input gets whatever the label leaves
 * ("Email" leaves more room than "Family name") and the column staircases.
 * The variant compiles to a descendant selector that out-specifies a plain
 * utility — the specificity trap in `docs/styling.md` — hence the important
 * suffix.
 */
const LABEL_HALF = "@md/field-group:min-w-px @md/field-group:flex-[1_0_0]!";

/**
 * One row of the profile card: the design-system `Field` in its `Responsive`
 * orientation — label-left beside the control when the card is wide, stacked
 * when it is narrow (the orientation reads the card's own width via
 * `SettingsCard`'s `FieldGroup` container).
 *
 * `email` is the login identifier the platform owns (the annotated Disabled
 * input in the frame); every other attribute is read-only until #693.
 */
function ProfileField({ entry, value }: { entry: SchemaField; value: string }) {
  const id = useId();
  const locked = entry.key === "email";

  return (
    <Field orientation="responsive">
      <FieldLabel htmlFor={id} className={LABEL_HALF}>
        {entry.label}
      </FieldLabel>
      <FieldContent>
        <Input
          id={id}
          type={entry.inputType}
          value={value}
          className="text-sm"
          {...(locked ? { disabled: true } : { readOnly: true })}
        />
      </FieldContent>
    </Field>
  );
}
