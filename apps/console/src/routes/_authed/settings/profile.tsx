import { createFileRoute } from "@tanstack/react-router";
import { CircleUser } from "lucide-react";
import { DETAIL_CARD, DETAIL_TITLE } from "@/components/detail-page";
import { Page, SettingsColumn } from "@/components/layout";
import { SettingsCard, SettingsSection } from "@/components/settings-card";
import {
  IdentityLinks,
  MethodNote,
  Passkeys,
} from "@/features/authentication/components/sign-in-methods";
import { PAGE_TITLE_ROW } from "@/components/typography";
import { Card } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { UserAvatar, avatarSeed } from "@/components/user-avatar";
import { api } from "@/api/zitadel";
import { consoleSessionProject } from "@/auth/session";
import { fetchAllIdps, fetchMyIdentityLinks } from "@/features/authentication/api";
import { fetchMyPasskeys, fetchMyPasswordSetAt } from "@/features/authentication/api";
import { passwordState } from "@/features/authentication/model";
import { displayValue, field } from "@/lib/record";
import { type ValueField, schemaFlatRows } from "@/features/schemas/model";
import { readOwnUserSchema } from "@/features/users/own-schema";
import { userAttributes } from "@/features/users/model";
import {
  EDITABLE_TYPES,
  LABEL_HALF,
  METHOD_HEAD,
  ProfileForm,
  ProfileRow,
  ROW,
  textRow,
} from "@/features/users/components/own-profile-form";

/**
 * Settings → Profile: the person's own profile, generated from their
 * own user schema as Add user is (`schemaFields`): a row per property, nothing
 * named in code. The schema's
 * `x-identifier` is read-only (D16); the rest saves through `PATCH /users/me`.
 * Without a readable schema, the record's own identifier shows alone.
 *
 * The card opens with the person's avatar, generated from their user id as in
 * the sidebar footer, so the page reads as theirs at a glance.
 *
 * Under it, the person's sign-in methods, read with the session alone
 * (`/users/me/password`, `/users/me/passkeys`, `/users/me/identity_links`).
 * Read-only: setting a password or adding and removing the rest has no
 * self-service endpoint yet.
 */
export const Route = createFileRoute("/_authed/settings/profile")({
  staticData: {
    nav: { label: "Profile", view: "settings", order: 1, icon: CircleUser },
  },
  loader: async () => {
    // A failed schema read leaves the identifier alone (below), and a failed
    // sign-in method read costs its list, never the screen.
    const [user, schema, passwordSetAt, passkeys, identityLinks] = await Promise.all([
      api.getMyUser(consoleSessionProject()),
      readOwnUserSchema().catch(() => undefined),
      // `null`: no password; `undefined`: it could not be read.
      fetchMyPasswordSetAt().catch(() => undefined),
      fetchMyPasskeys().catch(() => undefined),
      fetchMyIdentityLinks().catch(() => undefined),
    ]);
    // A link names its connection by id; the connections give it a name. They
    // need `idp.read` in the person's own project, which a platform user does
    // not hold, so the id stands in when they cannot be read.
    const projectId = consoleSessionProject()?.project_id;
    const idps =
      projectId && identityLinks?.length ? await fetchAllIdps(projectId).catch(() => null) : null;
    return { user, schema, passwordSetAt, passkeys, identityLinks, idps };
  },
  component: ProfileScreen,
});

/**
 * The identifier row when the schema could not be read: built from the user
 * record's own `identifier_property` / `identifier` (ADR 058), so nothing
 * here names a property the schema might rename.
 */
function identifierFallback(user: Record<string, unknown>): ValueField[] {
  const key = field(user, "identifier_property");
  if (!key) return [];
  return [textRow(key, "Identifier", true)];
}

function ProfileScreen() {
  const { user, schema, passwordSetAt, passkeys, identityLinks, idps } = Route.useLoaderData();
  const record = user as Record<string, unknown>;
  const attributes = userAttributes(record);
  // The read-only row is whatever the schema designates as the identifier, or,
  // unread, what the record says it was identified by — never a fixed name.
  const identifier = schema ? field(schema, "x-identifier") : field(record, "identifier_property");

  // The identifier first — it is who the person is — then the rest in the
  // schema's own (alphabetical) order.
  const all = schema ? schemaFlatRows(schema) : identifierFallback(record);
  // Editable: anything but the identifier that a text input can round-trip.
  // Another type (a boolean) shows its value read-only rather than as text it
  // could never be saved back from. Without a schema there are no types, so
  // nothing is editable.
  const types = (schema?.properties ?? {}) as Record<string, { type?: unknown }>;
  const isEditable = (entry: ValueField) =>
    entry.key !== identifier && EDITABLE_TYPES.has(String(types[entry.key]?.type));
  const fixed = all.filter((entry) => !isEditable(entry));
  const editable = all.filter(isEditable);

  const saved = (entry: ValueField) =>
    (displayValue(attributes, entry.key) ?? "") ||
    // Unread schema: the record's resolved identifier stands in for the attribute.
    (!schema && entry.key === identifier ? (field(record, "identifier") ?? "") : "");
  const savedValues = Object.fromEntries(editable.map((entry) => [entry.key, saved(entry)]));

  return (
    <Page>
      <SettingsColumn>
        {/* No header gutter: the settings design aligns the title with the card,
            where a resource detail insets its title lockup by 8px. */}
        <div className={PAGE_TITLE_ROW}>
          <h1 className={DETAIL_TITLE}>Profile</h1>
        </div>
        {/* Says whose settings these are: the nav label alone does not. */}
        <SettingsSection
          title="Your profile"
          description="How you appear in the console. What you sign in with cannot be changed here."
        >
          <SettingsCard>
            <Field orientation="responsive" className={ROW}>
              <FieldContent className={LABEL_HALF}>
                <FieldTitle>Avatar</FieldTitle>
                <FieldDescription>Generated for you.</FieldDescription>
              </FieldContent>
              <FieldContent className="items-start @md/field-group:items-end">
                <UserAvatar
                  seed={avatarSeed({
                    identifier: field(record, "identifier"),
                    userId: field(record, "id"),
                  })}
                  className="size-10"
                />
              </FieldContent>
            </Field>
            {fixed.map((entry) => (
              <ProfileRow key={entry.key} field={entry} value={saved(entry)} readOnly />
            ))}
            {/* Keyed by the saved values: a save re-runs the loader, and the
                form starts again from what was saved. */}
            {editable.length > 0 && (
              <ProfileForm
                key={JSON.stringify(savedValues)}
                fields={editable}
                saved={savedValues}
              />
            )}
          </SettingsCard>
        </SettingsSection>

        <SettingsSection
          title="Sign-in methods"
          description="Your password, the passkeys you registered, and the identity provider accounts linked to you when you signed in with them."
        >
          <Card className={DETAIL_CARD}>
            <h3 className={METHOD_HEAD}>Password</h3>
            <MethodNote>{passwordState(passwordSetAt)}</MethodNote>
            <Separator />
            <h3 className={METHOD_HEAD}>Passkeys</h3>
            <Passkeys passkeys={passkeys} empty="You have not added a passkey." />
            <Separator />
            <h3 className={METHOD_HEAD}>Linked accounts</h3>
            <IdentityLinks
              links={identityLinks}
              idps={idps}
              empty="No identity provider account is linked to you."
              linkIdps={false}
            />
          </Card>
        </SettingsSection>
      </SettingsColumn>
    </Page>
  );
}
