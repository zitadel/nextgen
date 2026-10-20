import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { GitCommitHorizontal, Key, type LucideIcon, Shield, User } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { api } from "@/api/zitadel";
import { DeleteUserDialog } from "@/components/delete-user-dialog";
import { FormError } from "@/components/form-error";
import { MetaRule, MetaValue } from "@/components/detail-meta";
import {
  DETAIL_BODY,
  DETAIL_CARD,
  DetailHeader,
  DetailPage,
  ICON_PLATE,
} from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import { EYEBROW } from "@/components/typography";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldContent, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSubmit } from "@/hooks/use-submit";
import { formatDate } from "@/lib/date";
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
  schemaDisplayName,
  schemaFields,
} from "@/lib/schema";
import { userAttributes, userIdentity, userIdentitySecondary, userMetadata } from "@/lib/user";

/**
 * User detail — the overview and authentication tabs.
 *
 * Much of the design cannot be built yet, and what is missing is *data*, not
 * markup. Rather than render labels with nothing behind them, each is left out
 * and recorded here:
 *
 *   - **Last sign-in**: no such field anywhere on the user
 *   - the **Password** row's "last changed": no timestamp is exposed
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
    const [schema, passkeys, identityLinks] = await Promise.all([
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
    ]);

    // A link names its connection by id; the connections give it a name. Only
    // read them when there is something to name, and fall back to the id when
    // they cannot be read.
    const idps =
      identityLinks && identityLinks.length > 0
        ? await fetchAllIdps(projectId).catch(() => null)
        : null;

    return { user, schema, passkeys, identityLinks, idps };
  },
  component: UserDetail,
});

// Long utility strings live as named constants so Tailwind's scanner sees the
// full literal (it never sees a concatenated fragment).
// The panel body is 24px in from the card edge and 20px down, with 16px between
// the header, the divider and the content.
const CARD_HEAD = "flex items-center gap-3 px-6 pt-5 pb-4";
// Label and control split the wide row in halves, as on Settings → Profile.
const LABEL_HALF = "@md/field-group:min-w-px @md/field-group:flex-[1_0_0]!";
const ROW = "flex items-center justify-between gap-4 px-6 pt-4 pb-5";
// A row's secondary text: counts, dates, and the states that stand in for them.
const ROW_NOTE = "text-muted-foreground text-[13px] leading-[22px]";
// The divider sits inside the body padding rather than spanning the card, and
// `w-full` is applied by an orientation variant that out-specifies a plain
// utility — so the override has to carry the same variant.
const PANEL_RULE = "mx-6 w-auto data-[orientation=horizontal]:w-auto";

function UserDetail() {
  const { user, schema, passkeys, identityLinks, idps } = Route.useLoaderData();
  const { userId } = Route.useParams();
  const router = useRouter();
  // The server-resolved identity chain (ADR 058): display → identifier → id.
  const name = userIdentity(user) ?? userId;
  const secondary = userIdentitySecondary(user);
  const fields = schema ? schemaFields(schema) : [];
  const metadata = userMetadata(user);
  const schemaName = schema ? schemaDisplayName(schema, "Unknown") : "Unknown";
  const schemaId = field(user, "schema");
  const [tab, setTab] = useState("overview");

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

      <Tabs value={tab} onValueChange={setTab} className={`${DETAIL_BODY} gap-6`}>
        <TabsList aria-label="User detail sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="authentication">Authentication</TabsTrigger>
        </TabsList>

        {/* Kept mounted, and hidden while another tab is open, so the profile
            draft survives a look at Authentication. */}
        <TabsContent
          value="overview"
          forceMount
          hidden={tab !== "overview"}
          className="flex flex-col gap-4"
        >
          <Card className={DETAIL_CARD}>
            {/* The row wraps rather than truncate the id, and the box grows
                past its 24px when the id breaks across lines. */}
            <div className="flex flex-wrap items-center gap-2 px-6 pt-5 pb-6">
              <span className="text-foreground font-serif text-base leading-5">User schema</span>
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
            {!schema || fields.length === 0 ? (
              <p className="text-muted-foreground px-6 pb-5 text-sm">
                This user&rsquo;s schema could not be read, so its attributes cannot be labelled.
              </p>
            ) : (
              <ProfileForm userId={userId} user={user} schema={schema} />
            )}
          </Card>

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

        <TabsContent value="authentication" className="flex flex-col gap-4">
          <Card className={DETAIL_CARD}>
            {/* Key glyph, as the design names it. */}
            <CardHead icon={Key} eyebrow="Authentication" title={schemaName} />
            <Separator className={PANEL_RULE} />
            {/* Only Passkey is listed. The design's Password row shows a "last
                changed" date the API does not expose, and its `Set` pill would
                be a claim the console cannot check. */}
            <div className={ROW}>
              <span className="text-foreground text-sm font-medium">Passkey</span>
              {passkeys === undefined ? (
                <span className={ROW_NOTE}>Could not be loaded</span>
              ) : (
                <div className="flex items-center gap-3">
                  <span className={ROW_NOTE}>{passkeys.length} registered</span>
                  {/* The design's only badge here is `Enabled`.
                      With nothing registered the count already says so, and a
                      second capsule reading `None` restates it. */}
                  {passkeys.length > 0 && <Badge variant="secondary">Enabled</Badge>}
                </div>
              )}
            </div>
          </Card>

          <Card className={DETAIL_CARD}>
            <CardHead icon={Shield} eyebrow="Identity providers" title="Linked accounts" />
            <Separator className={PANEL_RULE} />
            <IdentityLinks links={identityLinks} idps={idps} />
          </Card>
        </TabsContent>
      </Tabs>
    </DetailPage>
  );
}

/**
 * The provider accounts linked to the user, one row each. A link is written
 * when a sign-in through the connection resolves to this user, so these are
 * the providers the user actually signs in with — not the ones the schema
 * merely allows.
 */
function IdentityLinks({
  links,
  idps,
}: {
  links: UserIdentityLink[] | undefined;
  idps: IdpConnection[] | null;
}) {
  if (!links?.length) {
    return (
      <p className={`${ROW_NOTE} px-6 pt-4 pb-5`}>
        {links ? "No identity provider is linked to this user." : "Could not be loaded"}
      </p>
    );
  }

  const byId = new Map((idps ?? []).map((idp) => [idp.id, idp]));
  return (
    <ul className="flex flex-col">
      {links.map((link) => {
        const idp = byId.get(link.connection_id);
        return (
          <li key={link.id} className={ROW}>
            {idp ? (
              <Link
                to="/authentication/idps/$idpId"
                params={{ idpId: idp.id }}
                className="text-foreground text-sm font-medium hover:underline"
              >
                {idp.definition.display_name}
              </Link>
            ) : (
              // The connection list may be refused (`idp.read`); the id is
              // still the honest name for it.
              <span className="text-foreground truncate font-mono text-sm">
                {link.connection_id}
              </span>
            )}
            <span className={`${ROW_NOTE} shrink-0`}>Linked {formatDate(link.created_at)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The profile form: one field per schema property, saved as a patch of the
 * changed attributes only. A save re-runs the loader, and the draft resets
 * when the stored values change, as in `RenameCard`.
 */
function ProfileForm({
  userId,
  user,
  schema,
}: {
  userId: string;
  user: Record<string, unknown>;
  schema: UserSchema;
}) {
  const router = useRouter();
  // Keyed on the loader's objects, which change only when it re-runs, so the
  // draft survives every render in between.
  const fields = useMemo(() => schemaFields(schema), [schema]);
  const { stored, locked } = useMemo(() => {
    const attributes = userAttributes(user);
    const stored: Record<string, string> = {};
    const locked = new Set<string>();
    for (const entry of fields) {
      const value = displayValue(attributes, entry.key);
      stored[entry.key] = value ?? "";
      // Stored but not as text (an array or object under a union type): an
      // empty box would invite typing over the structured value.
      const raw = attributes[entry.key];
      if (value === undefined && raw !== undefined && raw !== null) locked.add(entry.key);
    }
    return { stored, locked };
  }, [fields, user]);
  const [values, setValues] = useState(stored);
  // An input that cannot read what it shows (a partly cleared date reports
  // `""` with `validity.badInput`); saving would delete the stored value.
  const [unreadable, setUnreadable] = useState<Record<string, boolean>>({});
  const blocked = fields.some((entry) => unreadable[entry.key]);
  // Compared as they would be sent, so a stored trailing space or `42.0` for a
  // stored 42 is not a change.
  const changed = fields.filter(
    (entry) => patchValue(entry, values[entry.key]) !== patchValue(entry, stored[entry.key]),
  );
  // Only the changed fields: a required value the form cannot show (an array)
  // reads as empty without being emptied.
  const missingRequired = changed.some((entry) => entry.required && !values[entry.key]?.trim());

  const save = useSubmit(async () => {
    const attributes: Record<string, unknown> = {};
    for (const entry of changed) attributes[entry.key] = patchValue(entry, values[entry.key]);
    await api.patchUserByID(userId, { attributes });
    await router.invalidate();
  }, "Could not save the user.");
  const { clearError } = save;

  useEffect(() => {
    setValues(stored);
    setUnreadable({});
    clearError();
  }, [stored, clearError]);

  return (
    <FieldGroup className="gap-4 px-6 pb-5">
      {fields.map((entry) => (
        <ProfileField
          key={entry.key}
          field={entry}
          value={values[entry.key] ?? ""}
          onChange={(value) => setValues((current) => ({ ...current, [entry.key]: value }))}
          onBadInput={(badInput) =>
            setUnreadable((current) => ({ ...current, [entry.key]: badInput }))
          }
          // Marked, since it is the only reason on screen why Save is off.
          invalid={unreadable[entry.key] ?? false}
          readOnly={locked.has(entry.key)}
          // The reload after a save resets the draft, so typing meanwhile
          // would be lost.
          disabled={save.pending}
        />
      ))}
      <FormError message={save.error} />
      <div className="flex justify-end">
        {/* As `RenameCard`'s Save: secondary and small. */}
        <Button
          variant="secondary"
          size="sm"
          className="gap-1 px-2.5 text-xs"
          onClick={() => void save.run()}
          disabled={changed.length === 0 || missingRequired || blocked}
          loading={save.pending}
        >
          Save
        </Button>
      </div>
    </FieldGroup>
  );
}

/**
 * A field's draft as the patch carries it: the typed value, or `null` to
 * delete an emptied attribute (the schema refuses that for a required one,
 * which `missingRequired` catches first).
 */
function patchValue(entry: SchemaField, draft = ""): string | number | null {
  const trimmed = draft.trim();
  return trimmed === "" ? null : attributeValue(entry, trimmed);
}

/** One attribute of the profile, typed as its schema property declares. */
function ProfileField({
  field,
  value,
  onChange,
  onBadInput,
  invalid,
  readOnly,
  disabled,
}: {
  field: SchemaField;
  value: string;
  onChange: (value: string) => void;
  /**
   * Whether the input shows something its `value` cannot express. Read on
   * every native `input` event: `onChange` skips one that leaves the value
   * as it was, such as the last step of clearing a partial date.
   */
  onBadInput: (badInput: boolean) => void;
  invalid: boolean;
  readOnly: boolean;
  disabled: boolean;
}) {
  const id = useId();
  // A number field is a text input: a number input reports text it cannot
  // parse as empty, which would read as emptied and delete the value. No
  // decimal keypad either, since iOS's has no minus key.
  const number = field.inputType === "number";

  return (
    <Field orientation="responsive">
      <FieldLabel htmlFor={id} className={`text-foreground ${LABEL_HALF}`}>
        {field.label}
      </FieldLabel>
      <FieldContent>
        <Input
          id={id}
          name={field.key}
          type={number ? "text" : field.inputType}
          required={field.required}
          placeholder={field.placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onInput={(event) => onBadInput(event.currentTarget.validity.badInput)}
          aria-invalid={invalid || undefined}
          readOnly={readOnly}
          disabled={disabled}
        />
      </FieldContent>
    </Field>
  );
}

/** A body card's head: the icon tile beside an eyebrow and a title. */
function CardHead({
  icon: Icon,
  eyebrow,
  title,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className={CARD_HEAD}>
      <span className={ICON_PLATE} aria-hidden>
        <Icon className="size-4.5" />
      </span>
      <div className="flex flex-col">
        <span className={EYEBROW}>{eyebrow}</span>
        <span className="text-foreground text-base leading-6">{title}</span>
      </div>
    </div>
  );
}
