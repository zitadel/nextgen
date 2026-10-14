import { createFileRoute, useLocation, useRouter } from "@tanstack/react-router";
import { CircleUserRound } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { DETAIL_TITLE } from "@/components/detail-page";
import { FormError } from "@/components/form-error";
import { Page, SettingsColumn } from "@/components/layout";
import { SettingsCard } from "@/components/settings-card";
import { PAGE_TITLE_ROW } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { api } from "@/api/zitadel";
import { invalidateSessionCache } from "@/auth/session";
import { useSubmit } from "@/hooks/use-submit";
import { field } from "@/lib/record";
import { type SchemaField, type UserSchema, schemaFields } from "@/lib/schema";
import { userAttributes } from "@/lib/user";

/**
 * Settings → Profile: the signed-in person's own account, built from their
 * user schema the way Add user builds its form (`schemaFields`) — a row per
 * property, so the platform project's `name` (`PlatformHumanUserSchema`)
 * appears because the schema declares it, and a schema with more fields shows
 * those too.
 *
 * The identifier (`x-identifier` — the email in the shipped schemas) is read-only (design
 * decision D16): claiming asks for nothing but an email address, and it cannot
 * be changed. Every other property is editable through `PATCH /users/me`, which
 * validates the merged result against the same schema. A schema with nothing
 * but the identifier leaves nothing to save, so the screen has no Save.
 *
 * Nothing here names a property: the rows, labels and input types come from
 * the schema, and the read-only row from its `x-identifier`. When the schema
 * cannot be read, the screen shows the record's own identifier alone rather
 * than guessing at fields the server might refuse.
 *
 * Composes the detail shell (`detail-page.tsx`) rather than measuring its own
 * layout; the title stands alone because a settings screen has no icon tile
 * and no id card.
 */
export const Route = createFileRoute("/_authed/settings/profile")({
  staticData: {
    nav: { label: "Profile", order: 0, icon: CircleUserRound, view: "settings", group: "ACCOUNT" },
  },
  loader: async () => {
    const user = await api.getMyUser();
    const schemaId = field(user, "schema");
    // Read without a project id: it resolves in the session's own project, the
    // one the person's user lives in.
    const schema = schemaId
      ? await api
          .getSchemaById(schemaId)
          .then((value) => value.schema as UserSchema)
          .catch(() => undefined)
      : undefined;
    return { user, schema };
  },
  component: ProfileScreen,
});

// The wide row is two equal halves, which is what lines the control up at the
// card's midpoint. `Field` sizes the label by its text instead, through a
// variant that out-specifies a plain utility, hence the important suffix.
const LABEL_HALF = "@md/field-group:min-w-px @md/field-group:flex-[1_0_0]!";
const ROW = "@md/field-group:items-center!";

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
  const { user, schema } = Route.useLoaderData();
  const router = useRouter();
  const attributes = userAttributes(user as Record<string, unknown>);
  // The read-only row is whatever the schema designates as the identifier, or,
  // unread, what the record says it was identified by — never a fixed name.
  const identifier = schema
    ? field(schema, "x-identifier")
    : field(user as Record<string, unknown>, "identifier_property");

  // The identifier first — it is who the person is — then the rest in the
  // schema's own (alphabetical) order.
  const all = schema ? schemaFields(schema) : identifierFallback(user as Record<string, unknown>);
  const fixed = all.filter((entry) => entry.key === identifier);
  const editable = schema ? all.filter((entry) => entry.key !== identifier) : [];

  const saved = (entry: SchemaField) =>
    displayValue(attributes[entry.key]) ||
    // Unread schema: the record's resolved identifier stands in for the attribute.
    (!schema && entry.key === identifier
      ? (field(user as Record<string, unknown>, "identifier") ?? "")
      : "");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((entry) => [entry.key, saved(entry)])),
  );
  const changed = editable.filter((entry) => (values[entry.key] ?? "").trim() !== saved(entry));
  const missingRequired = editable.some(
    (entry) => entry.required && (values[entry.key] ?? "").trim() === "",
  );

  const save = useSubmit(async () => {
    const patch: Record<string, unknown> = {};
    for (const entry of changed) {
      const value = (values[entry.key] ?? "").trim();
      // Cleared means deleted (`null`), not an empty string — which would fail
      // a `format` and reads as a value rather than its absence.
      patch[entry.key] = value === "" ? null : typed(entry, value);
    }
    await api.patchMyUser({ attributes: patch });
    // The account menu renders the session's `display`; drop the cached
    // session so a changed name shows without waiting out the cache.
    invalidateSessionCache();
    await router.invalidate();
  }, "Could not save your profile.");
  const { clearError } = save;

  // A save re-runs the loader; the form follows the saved record.
  const savedKey = editable.map((entry) => `${entry.key}=${saved(entry)}`).join("&");
  useEffect(() => {
    setValues(Object.fromEntries(editable.map((entry) => [entry.key, saved(entry)])));
    clearError();
  }, [savedKey, clearError]);

  return (
    <Page>
      <SettingsColumn>
        {/* No header gutter: the settings design aligns the title with the card,
            where a resource detail insets its title lockup by 8px. */}
        <div className={PAGE_TITLE_ROW}>
          <h1 className={DETAIL_TITLE}>Profile</h1>
        </div>
        <SettingsCard>
          {fixed.map((entry) => (
            <ProfileRow key={entry.key} field={entry} value={saved(entry)} readOnly />
          ))}
          {editable.map((entry) => (
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
          {editable.length > 0 && (
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
          )}
        </SettingsCard>
      </SettingsColumn>
    </Page>
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
  // The account menu's "Add your name" lands here with the property as the
  // hash (`#name`): focus that field, so the prompt ends where typing starts.
  const focus = useLocation({ select: (location) => location.hash === entry.key });

  return (
    <Field orientation="responsive" className={ROW}>
      <FieldLabel htmlFor={id} className={LABEL_HALF}>
        {entry.label}
      </FieldLabel>
      <FieldContent>
        <Input
          id={id}
          name={entry.key}
          type={entry.inputType}
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
          autoFocus={!readOnly && focus}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onEnter?.();
          }}
        />
      </FieldContent>
    </Field>
  );
}

/** A stored attribute as the input shows it. */
function displayValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/**
 * An input's string as the schema types it: a `number` property is validated
 * against a JSON number, so `"42"` is sent as `42`. A value that will not
 * parse goes through untouched so the server explains why (as in Add user).
 */
function typed(entry: SchemaField, value: string): unknown {
  if (entry.inputType !== "number") return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}
