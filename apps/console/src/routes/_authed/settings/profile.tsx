import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useId, useState } from "react";

import { DETAIL_CARD, DETAIL_TITLE } from "@/components/detail-page";
import { FormError } from "@/components/form-error";
import { Page, SettingsColumn } from "@/components/layout";
import { SettingsCard, SettingsSection } from "@/components/settings-card";
import { IdentityLinks, MethodNote, Passkeys } from "@/components/sign-in-methods";
import { PAGE_TITLE_ROW } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { UserAvatar, avatarSeed } from "@/components/user-avatar";

import { api } from "@/api/zitadel";
import { consoleSessionProject, refreshSession } from "@/auth/session";
import { useSubmit } from "@/hooks/use-submit";
import { fetchAllIdps } from "@/lib/idp";
import { fetchMyPasswordSetAt, passwordState } from "@/lib/sign-in-methods";
import { displayValue, field } from "@/lib/record";
import { type SchemaField, attributeValue, inputAttributes, schemaFields } from "@/lib/schema";
import { readOwnUserSchema } from "@/lib/user-schema";
import { userAttributes } from "@/lib/user";

/**
 * Account settings → Settings: the person's own profile, generated from their
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
    nav: { label: "Settings", order: 1, icon: Settings, view: "settings" },
  },
  loader: async () => {
    // A failed schema read leaves the identifier alone (below), and a failed
    // sign-in method read costs its list, never the screen.
    const [user, schema, passwordSetAt, passkeys, identityLinks] = await Promise.all([
      api.getMyUser(consoleSessionProject()),
      readOwnUserSchema().catch(() => undefined),
      // `null`: no password; `undefined`: it could not be read.
      fetchMyPasswordSetAt().catch(() => undefined),
      // Read with the session alone (`/users/me/*`): no grant needed, so they
      // answer for a platform user who holds none.
      api.listMyPasskeys.all({ limit: 100, ...consoleSessionProject() }).catch(() => undefined),
      api.listMyIdentityLinks
        .all({ limit: 100, ...consoleSessionProject() })
        .catch(() => undefined),
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

// The wide row is two equal halves, which is what lines the control up at the
// card's midpoint. `Field` sizes the label by its text instead, through a
// variant that out-specifies a plain utility, hence the important suffix.
const LABEL_HALF = "@md/field-group:min-w-px @md/field-group:flex-[1_0_0]!";
const ROW = "@md/field-group:items-center!";
// A sign-in method's heading inside the card, on the rows' 24px inset.
const METHOD_HEAD = "px-6 pt-5 text-sm font-medium text-foreground";

/**
 * The identifier row when the schema could not be read: built from the user
 * record's own `identifier_property` / `identifier` (ADR 058), so nothing
 * here names a property the schema might rename.
 */
function identifierFallback(user: Record<string, unknown>): SchemaField[] {
  const key = field(user, "identifier_property");
  if (!key) return [];
  return [{ key, label: "Identifier", required: true, inputType: "text" }];
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
  const all = schema ? schemaFields(schema) : identifierFallback(record);
  // Editable: anything but the identifier that a text input can round-trip.
  // Another type (a boolean) shows its value read-only rather than as text it
  // could never be saved back from. Without a schema there are no types, so
  // nothing is editable.
  const types = (schema?.properties ?? {}) as Record<string, { type?: unknown }>;
  const isEditable = (entry: SchemaField) =>
    entry.key !== identifier && EDITABLE_TYPES.has(String(types[entry.key]?.type));
  const fixed = all.filter((entry) => !isEditable(entry));
  const editable = all.filter(isEditable);

  const saved = (entry: SchemaField) =>
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
          <h1 className={DETAIL_TITLE}>Settings</h1>
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

/** The editable rows and Save, starting from the saved values. */
function ProfileForm({ fields, saved }: { fields: SchemaField[]; saved: Record<string, string> }) {
  const router = useRouter();
  const [values, setValues] = useState(saved);
  const changed = fields.filter((entry) => (values[entry.key] ?? "").trim() !== saved[entry.key]);
  const missingRequired = fields.some(
    (entry) => entry.required && (values[entry.key] ?? "").trim() === "",
  );

  const save = useSubmit(async () => {
    const patch: Record<string, unknown> = {};
    for (const entry of changed) {
      const value = (values[entry.key] ?? "").trim();
      // Cleared means deleted (`null`), not an empty string — which would fail
      // a `format` and reads as a value rather than its absence.
      patch[entry.key] = value === "" ? null : attributeValue(entry, value);
    }
    await api.patchMyUser({ attributes: patch }, consoleSessionProject());
    // The account menu renders the session's `display`; drop the cached
    // session (only it: the CSRF token and the other cached reads still hold)
    // so a changed name shows without waiting out the cache.
    refreshSession();
    await router.invalidate();
  }, "Could not save your profile.");

  return (
    <>
      {fields.map((entry) => (
        <ProfileRow
          key={entry.key}
          field={entry}
          value={values[entry.key] ?? ""}
          onChange={(value) => setValues((current) => ({ ...current, [entry.key]: value }))}
          onEnter={() => {
            if (changed.length > 0 && !missingRequired) void save.run();
          }}
        />
      ))}
      <div className="flex flex-col gap-2">
        <FormError message={save.error} />
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void save.run()}
            disabled={changed.length === 0 || missingRequired}
            loading={save.pending}
          >
            Save
          </Button>
        </div>
      </div>
    </>
  );
}

function ProfileRow({
  field: entry,
  value,
  readOnly = false,
  onChange,
  onEnter,
}: {
  field: SchemaField;
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onEnter?: () => void;
}) {
  const id = useId();

  return (
    <Field orientation="responsive" className={ROW}>
      <FieldLabel htmlFor={id} className={LABEL_HALF}>
        {entry.label}
      </FieldLabel>
      <FieldContent>
        <Input
          id={id}
          name={entry.key}
          {...inputAttributes(entry)}
          value={value}
          placeholder={
            readOnly
              ? entry.inputType === "email"
                ? "No email address"
                : "Not set"
              : (entry.placeholder ?? (entry.required ? undefined : "Optional"))
          }
          disabled={readOnly}
          readOnly={readOnly}
          required={!readOnly && entry.required}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onEnter?.();
          }}
        />
      </FieldContent>
    </Field>
  );
}

/** The property types a text input can show and save back unchanged. */
const EDITABLE_TYPES = new Set(["string", "number", "integer"]);
