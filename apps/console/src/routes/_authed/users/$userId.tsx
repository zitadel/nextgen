import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { GitCommitHorizontal, User } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useId, useMemo, useState } from "react";

import { api } from "@/api/zitadel";
import { DeleteUserDialog } from "@/components/delete-user-dialog";
import { MetaRule, MetaValue } from "@/components/detail-meta";
import {
  DETAIL_BODY,
  DETAIL_CARD,
  DetailHeader,
  DetailPage,
  DetailSection,
} from "@/components/detail-page";
import { FormError } from "@/components/form-error";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MetaItem } from "@/components/ui/meta-item";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSubmit } from "@/hooks/use-submit";
import { formatDate, formatDateTime } from "@/lib/date";
import {
  type IdpConnection,
  type UserIdentityLink,
  fetchAllIdps,
  fetchUserIdentityLinks,
} from "@/lib/idp";
import { projectScopeDeps, requireProjectScope } from "@/lib/project-scope";
import { displayValue, field } from "@/lib/record";
import {
  type SchemaField,
  type UserSchema,
  attributeValue,
  inputAttributes,
  schemaDisplayName,
  schemaFields,
  schemaProperties,
} from "@/lib/schema";
import { userAttributes, userIdentity, userIdentitySecondary, userMetadata } from "@/lib/user";

/**
 * User detail — the overview and authentication tabs.
 *
 * Some of the design cannot be built yet, and what is missing is *data*, not
 * markup. Rather than render labels with nothing behind them, each is left out
 * and recorded here:
 *
 *   - **Last login** in the header card: no such field anywhere on the user
 *   - **unlinking** a provider account: links are written only by a sign-in
 *
 * The design's "Project permissions" block is not pending — it has been removed
 * from the design (decisions log D6, and the log's open question on how project,
 * team and access relate).
 */
export const Route = createFileRoute("/_authed/users/$userId")({
  staticData: { scope: "project" },
  loaderDeps: projectScopeDeps,
  loader: async ({ params, deps }) => {
    const user = await api.getUserByID(params.userId);

    // All are chrome for the record rather than the record itself, so none is
    // allowed to reject the loader: a failure costs a row, not the screen.
    const projectId = requireProjectScope(deps.project);
    const schemaId = field(user, "schema");
    const [schema, passkeys, identityLinks, passwordSetAt] = await Promise.all([
      schemaId
        ? api
            // Schema ids are unique per project only, so name the selected one.
            .getSchemaById(schemaId, { project_id: projectId })
            .then((value) => value.schema as UserSchema)
            .catch(() => undefined)
        : Promise.resolve(undefined),
      api
        .listUserPasskeys(params.userId)
        .then((result) => result.passkeys)
        .catch(() => undefined),
      fetchUserIdentityLinks(params.userId).catch(() => undefined),
      // `null`: the user has no password; `undefined`: it could not be read.
      api
        .getUserPasswordState(params.userId)
        .then((result) => result.set_at ?? null)
        .catch(() => undefined),
    ]);

    // A link names its connection by id; the connections give it a name. Only
    // read them when there is something to name, and fall back to the id when
    // they cannot be read.
    const idps =
      identityLinks && identityLinks.length > 0
        ? await fetchAllIdps(projectId).catch(() => null)
        : null;

    return { user, schema, passkeys, identityLinks, idps, passwordSetAt };
  },
  component: UserDetail,
});

// Long utility strings live as named constants so Tailwind's scanner sees the
// full literal (it never sees a concatenated fragment).
// The design's label column on a wide row, for the fields and for the card's
// title, so the revision box starts where the inputs do: 203px plus the row's
// 12px gap is the design's 215px. The `!` beats the responsive Field's own
// `flex-auto` on its label.
const LABEL_COLUMN = "@md/field-group:flex-[0_0_203px]!";
// The design's inputs are 360px wide rather than stretched across the row.
const INPUT_WIDTH = "max-w-90";
// The design's field label is the body face at 14/21, regular weight, where
// `FieldLabel` defaults to the display face.
const FIELD_LABEL = "text-foreground font-sans leading-normal";
// The divider sits inside the body padding rather than spanning the card, and
// `w-full` is applied by an orientation variant that out-specifies a plain
// utility — so the override has to carry the same variant.
const PANEL_RULE = "mx-6 w-auto data-[orientation=horizontal]:w-auto";
// An authentication row: a muted label, its value on the right. 4px block
// padding, and 18px to the rule between rows (the list's `gap-4.5`).
const ROW = "flex items-center justify-between gap-4 py-1";
const ROW_LABEL = "text-muted-foreground min-w-0 truncate text-sm font-medium";
const ROW_VALUE = "text-foreground shrink-0 text-sm";
// `schemaProperties` type labels a text or number input or a switch can write;
// "—" is an untyped property, which accepts a string.
const WRITABLE_TYPES = new Set(["String", "Number", "Integer", "Boolean", "—"]);

function UserDetail() {
  const { user, schema, passkeys, identityLinks, idps, passwordSetAt } = Route.useLoaderData();
  const { userId } = Route.useParams();
  const router = useRouter();
  const attributes = userAttributes(user);
  // The server-resolved identity chain (ADR 058): display → identifier → id.
  const name = userIdentity(user) ?? userId;
  const secondary = userIdentitySecondary(user);
  const metadata = userMetadata(user);

  return (
    <DetailPage>
      {/* `User`, the sidebar's glyph for Users, as each detail title carries its
          section's. */}
      <DetailHeader
        icon={User}
        title={name}
        status={metadata.status && <StatusBadge status={metadata.status} />}
        subtitle={secondary}
        meta={
          <>
            <MetaValue label="User ID" value={userId} copyable />
            {metadata.createdAt && (
              <>
                <MetaRule />
                <MetaValue label="Created" value={formatDate(metadata.createdAt)} />
              </>
            )}
          </>
        }
      />

      <Tabs defaultValue="overview" className={`${DETAIL_BODY} gap-6`}>
        <TabsList aria-label="User detail sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="authentication">Authentication</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-6">
          <ProfileCard
            userId={userId}
            schema={schema}
            schemaId={field(user, "schema")}
            attributes={attributes}
            onSaved={() => router.invalidate()}
          />

          <Card className={DETAIL_CARD}>
            <CardContent className="flex flex-col gap-4 px-5 py-4.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-4">
                <span className="text-foreground font-serif text-base leading-none">
                  Delete user
                </span>
                <span className="text-muted-foreground text-[13px] leading-[19px]">
                  Permanently removes {name}, including sessions and access grants. This can&rsquo;t
                  be undone.
                </span>
              </div>
              <DeleteUserDialog
                userId={userId}
                name={name}
                onDeleted={() => router.navigate({ to: "/users" })}
              >
                {/* `lg` for the design's 40px height; the padding stays at 10px
                    rather than `lg`'s 24px, which is what makes it 93px wide. */}
                <Button variant="destructive" size="lg" className="shrink-0 px-2.5">
                  Delete user
                </Button>
              </DeleteUserDialog>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="authentication">
          <DetailSection title="Authentication">
            <AuthenticationRows
              rows={[
                { key: "password", label: "Password", value: passwordState(passwordSetAt) },
                { key: "passkey", label: "Passkey", value: passkeyState(passkeys) },
                ...identityLinkRows(identityLinks, idps),
              ]}
            />
          </DetailSection>
        </TabsContent>
      </Tabs>
    </DetailPage>
  );
}

interface AuthenticationRow {
  key: string;
  label: ReactNode;
  value: ReactNode;
}

/** The Authentication card's rows: a muted label, its value, a rule between each. */
function AuthenticationRows({ rows }: { rows: AuthenticationRow[] }) {
  return (
    <ul className="flex flex-col gap-4.5">
      {rows.map((row, index) => (
        <Fragment key={row.key}>
          {index > 0 && (
            <li role="none">
              <Separator />
            </li>
          )}
          <li className={ROW}>
            <span className={ROW_LABEL}>{row.label}</span>
            <span className={ROW_VALUE}>{row.value}</span>
          </li>
        </Fragment>
      ))}
    </ul>
  );
}

function passwordState(setAt: string | null | undefined): string {
  if (setAt === undefined) return "Could not be loaded";
  // When it was set, not "verified": an operator may have set it, and no
  // check of it is recorded.
  return setAt === null ? "Not set" : `Set ${formatDateTime(setAt)}`;
}

/**
 * A passkey is stored once its registration's attestation verifies, so its
 * `created_at` is when it was verified.
 */
function passkeyState(passkeys: { created_at: string }[] | undefined): string {
  if (passkeys === undefined) return "Could not be loaded";
  if (passkeys.length === 0) return "Not set up";
  const latest = passkeys
    .map((passkey) => passkey.created_at)
    .sort()
    .at(-1) as string;
  return passkeys.length === 1
    ? `Verified ${formatDateTime(latest)}`
    : `${passkeys.length} registered, last verified ${formatDateTime(latest)}`;
}

/**
 * One row per provider account linked to the user. A link is written when a
 * sign-in through the connection resolves to this user, so these are the
 * providers the user actually signs in with — not the ones the schema merely
 * allows.
 */
function identityLinkRows(
  links: UserIdentityLink[] | undefined,
  idps: IdpConnection[] | null,
): AuthenticationRow[] {
  if (!links?.length) {
    return [
      {
        key: "identity-providers",
        label: "Identity providers",
        value: links ? "None linked" : "Could not be loaded",
      },
    ];
  }
  const byId = new Map((idps ?? []).map((idp) => [idp.id, idp]));
  return links.map((link) => {
    const idp = byId.get(link.connection_id);
    return {
      key: link.id,
      label: idp ? (
        <Link
          to="/authentication/idps/$idpId"
          params={{ idpId: idp.id }}
          className="hover:text-foreground hover:underline"
        >
          {idp.definition.display_name}
        </Link>
      ) : (
        // The connection list may be refused (`idp.read`); the id is still
        // the honest name for it.
        <span className="font-mono">{link.connection_id}</span>
      ),
      value: `Linked ${formatDate(link.created_at)}`,
    };
  });
}

/**
 * The profile: the user's attributes as its schema labels them, saved with
 * `PATCH /users/{user_id}`. The drafts follow the loaded user: a save re-runs
 * the loader, and they reset to what was stored.
 */
function ProfileCard({
  userId,
  schema,
  schemaId,
  attributes,
  onSaved,
}: {
  userId: string;
  schema: UserSchema | undefined;
  schemaId: string | undefined;
  attributes: Record<string, unknown>;
  onSaved: () => Promise<void>;
}) {
  const fields = useMemo(() => (schema ? schemaFields(schema) : []), [schema]);
  // A text input writes a string, or through `number` a number, and a switch
  // a boolean, so only a property of exactly one of those types (or none) is
  // editable. Anything else (an array, a union such as `["boolean", "null"]`)
  // stays read-only rather than storing `"true"` where the schema wants
  // `true`. So does a boolean stored as something else (`"yes"` from before a
  // type change): the switch would show it as off, and a toggle overwrite it.
  const readOnlyKeys = useMemo(
    () =>
      new Set([
        ...(schema ? schemaProperties(schema) : [])
          .filter((property) => !WRITABLE_TYPES.has(property.type))
          .map((property) => property.key),
        ...fields
          .filter(
            (entry) => entry.inputType === "boolean" && !isBooleanOrAbsent(attributes[entry.key]),
          )
          .map((entry) => entry.key),
      ]),
    [schema, fields, attributes],
  );
  const stored = useMemo(
    () =>
      Object.fromEntries(
        fields.map((entry) => [
          entry.key,
          // The switch shows an absent boolean as off, so off again is no change.
          displayValue(attributes, entry.key) ??
            (entry.inputType === "boolean" && attributes[entry.key] == null ? "false" : ""),
        ]),
      ),
    [fields, attributes],
  );
  const [values, setValues] = useState(stored);
  // An input that cannot read what it shows (a partly cleared date reports
  // `""` with `validity.badInput`); saving would delete the stored value.
  const [unreadable, setUnreadable] = useState<Record<string, boolean>>({});
  const save = useSubmit(async () => {
    await api.patchUserByID(userId, { attributes: patchOf(fields, stored, values) });
    await onSaved();
  }, "Could not save the user.");
  const { clearError } = save;

  useEffect(() => {
    setValues(stored);
    setUnreadable({});
    clearError();
  }, [stored, clearError]);

  const dirty = fields.some((entry) => values[entry.key] !== stored[entry.key]);
  const missing = fields.filter(
    (entry) => entry.required && !readOnlyKeys.has(entry.key) && !values[entry.key]?.trim(),
  );

  return (
    <Card className={DETAIL_CARD}>
      {/* The row wraps rather than truncate the id, and the box grows past its
          24px when the id breaks across lines. It is a `field-group` container
          with the fields' inset and gap, so the title takes the label column
          at the fields' breakpoint. */}
      <div className="@container/field-group flex flex-wrap items-center gap-x-3 gap-y-2 px-6 pt-5 pb-4">
        <h2 className={`text-foreground font-serif text-base leading-5 ${LABEL_COLUMN}`}>
          User schema
        </h2>
        {schema && schemaId && (
          <Button
            asChild
            variant="secondary"
            size="xs"
            className="h-auto min-h-6 max-w-full flex-wrap justify-start py-0.5 whitespace-normal has-[>svg]:px-2"
          >
            <Link to="/schemas/$schemaId" params={{ schemaId }}>
              {/* The space separates name and id in the link's accessible name. */}
              {schemaDisplayName(schema, schemaId)}{" "}
              <GitCommitHorizontal className="size-4" strokeWidth={1.5} aria-hidden />
              <Badge
                variant="ghost"
                className="h-auto min-h-5 min-w-0 shrink overflow-visible py-0 font-mono font-normal break-all whitespace-normal"
              >
                {schemaId}
              </Badge>
            </Link>
          </Button>
        )}
      </div>
      <Separator className={PANEL_RULE} />
      {fields.length === 0 ? (
        <p className="text-muted-foreground px-6 pt-4 pb-5 text-sm">
          {schema
            ? "This schema defines no attributes that can be shown."
            : "This user’s schema could not be read, so its attributes cannot be labelled."}
        </p>
      ) : (
        <form
          className="flex flex-col gap-4 px-6 pt-4 pb-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save.run();
          }}
        >
          <FieldGroup className="gap-4">
            {fields.map((entry) => (
              <ProfileField
                key={entry.key}
                entry={entry}
                value={values[entry.key] ?? ""}
                readOnly={readOnlyKeys.has(entry.key)}
                missing={missing.includes(entry)}
                // Marked, since it is the only reason on screen why Save is off.
                unreadable={unreadable[entry.key] ?? false}
                onBadInput={(badInput) =>
                  setUnreadable((current) => ({ ...current, [entry.key]: badInput }))
                }
                onChange={(value) => setValues((current) => ({ ...current, [entry.key]: value }))}
              />
            ))}
          </FieldGroup>
          <FormError message={save.error} />
          <div className="flex justify-end">
            {/* Secondary, small: the resting Save is the secondary fill, which
                `disabled:opacity-50` dims — as `RenameCard`'s. Full width on
                a phone, as the design's mobile frame draws it. */}
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              className="gap-1 px-2.5 text-xs max-sm:w-full"
              disabled={!dirty || missing.length > 0 || Object.values(unreadable).some(Boolean)}
              loading={save.pending}
            >
              Save
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/**
 * The attributes a save changes, and only those. A cleared field is sent as
 * `null` rather than `""`, which would fail a `format` such as `email`.
 */
function patchOf(
  fields: SchemaField[],
  stored: Record<string, string>,
  values: Record<string, string>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const entry of fields) {
    if (values[entry.key] === stored[entry.key]) continue;
    const value = values[entry.key]?.trim() ?? "";
    patch[entry.key] = value === "" ? null : attributeValue(entry, value);
  }
  return patch;
}

function isBooleanOrAbsent(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "boolean";
}

/** One attribute of the profile, as a switch for a boolean. */
function ProfileField({
  entry,
  value,
  readOnly,
  missing,
  unreadable,
  onBadInput,
  onChange,
}: {
  entry: SchemaField;
  value: string;
  readOnly: boolean;
  /** A required value the draft has emptied. */
  missing: boolean;
  unreadable: boolean;
  /**
   * Whether the input shows something its `value` cannot express. Read on
   * every native `input` event: `onChange` skips one that leaves the value
   * as it was, such as the last step of clearing a partial date.
   */
  onBadInput: (badInput: boolean) => void;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <Field orientation="responsive">
      {/* As in the add-user sheet: the marker is a sibling of the label, not
          part of it, so the accessible name stays the field name. */}
      <div className={`flex items-center gap-2 ${LABEL_COLUMN}`}>
        <FieldLabel htmlFor={id} className={FIELD_LABEL}>
          {entry.label}
        </FieldLabel>
        {!entry.required && <MetaItem>Optional</MetaItem>}
      </div>
      <FieldContent>
        {entry.inputType === "boolean" ? (
          <div className="flex items-center gap-2">
            {/* A switch cannot be read-only, so a locked value disables it. */}
            <Switch
              id={id}
              checked={value === "true"}
              onCheckedChange={(checked) => onChange(String(checked))}
              required={entry.required}
              disabled={readOnly}
            />
            {/* The switch reports its own state, so Yes/No is for the eye. A
                locked value shows as stored instead, which the switch cannot
                report. */}
            <span className="text-foreground text-sm font-medium" aria-hidden={!readOnly}>
              {readOnly ? value : value === "true" ? "Yes" : "No"}
            </span>
          </div>
        ) : (
          <Input
            id={id}
            name={entry.key}
            {...inputAttributes(entry)}
            value={value}
            readOnly={readOnly}
            required={entry.required}
            placeholder={entry.placeholder}
            aria-invalid={missing || unreadable || undefined}
            // `aria-invalid` says the field is wrong; this says why.
            aria-describedby={missing ? errorId : undefined}
            className={INPUT_WIDTH}
            onChange={(event) => onChange(event.target.value)}
            onInput={(event) => onBadInput(event.currentTarget.validity.badInput)}
          />
        )}
        {missing && <FieldError id={errorId}>This field is required.</FieldError>}
      </FieldContent>
    </Field>
  );
}
