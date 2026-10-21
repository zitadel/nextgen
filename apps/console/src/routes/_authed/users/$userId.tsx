import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Key, type LucideIcon, Shield, User, UserRoundCog } from "lucide-react";
import { useId } from "react";

import { api } from "@/api/zitadel";
import { DeleteUserDialog } from "@/components/delete-user-dialog";
import { MetaRule, MetaValue } from "@/components/detail-meta";
import { DETAIL_BODY, DETAIL_CARD, DetailHeader, ICON_PLATE } from "@/components/detail-page";
import { IdentityLinks, METHOD_NOTE, METHOD_ROW } from "@/components/sign-in-methods";
import { StatusBadge } from "@/components/status-badge";
import { EYEBROW } from "@/components/typography";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/date";
import { fetchAllIdps, fetchUserIdentityLinks } from "@/lib/idp";
import { projectScopeDeps, requireProjectScope } from "@/lib/project-scope";
import { displayValue, field } from "@/lib/record";
import { type UserSchema, schemaDisplayName, schemaFields } from "@/lib/schema";
import { userAttributes, userIdentity, userIdentitySecondary, userMetadata } from "@/lib/user";
import { Page } from "@/components/layout";

/**
 * User detail — the overview and authentication tabs.
 *
 * Much of the design cannot be built yet, and what is missing is *data*, not
 * markup. Rather than render labels with nothing behind them, each is left out
 * and recorded here:
 *
 *   - **Last sign-in**: no such field anywhere on the user
 *   - **Save** on the profile form: no `PATCH`/`PUT /users/{user_id}` (#693), so
 *     the fields render read-only rather than offering an edit that cannot land
 *   - the **`v1 · live`** schema badge: schema versioning is #445
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
// 18px between fields on both axes.
const GRID = "grid gap-4.5 px-6 pt-4 pb-5 sm:grid-cols-2";
// The divider sits inside the body padding rather than spanning the card, and
// `w-full` is applied by an orientation variant that out-specifies a plain
// utility — so the override has to carry the same variant.
const PANEL_RULE = "mx-6 w-auto data-[orientation=horizontal]:w-auto";

function UserDetail() {
  const { user, schema, passkeys, identityLinks, idps } = Route.useLoaderData();
  const { userId } = Route.useParams();
  const router = useRouter();
  const attributes = userAttributes(user);
  // The server-resolved identity chain (ADR 058): display → identifier → id.
  const name = userIdentity(user) ?? userId;
  const secondary = userIdentitySecondary(user);
  const fields = schema ? schemaFields(schema) : [];
  const metadata = userMetadata(user);
  const schemaName = schema ? schemaDisplayName(schema, "Unknown") : "Unknown";

  return (
    <Page>
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

        <TabsContent value="overview" className="flex flex-col gap-4">
          <Card className={DETAIL_CARD}>
            <CardHead icon={UserRoundCog} eyebrow="User schema" title={schemaName} />
            <Separator className={PANEL_RULE} />
            {fields.length === 0 ? (
              <p className="text-muted-foreground px-6 py-5 text-sm">
                This user&rsquo;s schema could not be read, so its attributes cannot be labelled.
              </p>
            ) : (
              <div className={GRID}>
                {fields.map((entry) => (
                  <ProfileField
                    key={entry.key}
                    label={entry.label}
                    value={displayValue(attributes, entry.key) ?? ""}
                  />
                ))}
              </div>
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
            <div className={METHOD_ROW}>
              <span className="text-foreground text-sm font-medium">Passkey</span>
              {passkeys === undefined ? (
                <span className={METHOD_NOTE}>Could not be loaded</span>
              ) : (
                <div className="flex items-center gap-3">
                  <span className={METHOD_NOTE}>{passkeys.length} registered</span>
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
            <IdentityLinks
              links={identityLinks}
              idps={idps}
              empty="No identity provider is linked to this user."
            />
          </Card>
        </TabsContent>
      </Tabs>
    </Page>
  );
}

/**
 * One attribute of the profile.
 *
 * Read-only until `PATCH /users/{user_id}` exists (#693): an editable field with
 * no Save promises more than a plain one.
 */
function ProfileField({ label, value }: { label: string; value: string }) {
  const id = useId();

  return (
    <Field>
      <FieldLabel htmlFor={id} className="text-foreground">
        {label}
      </FieldLabel>
      <Input id={id} readOnly value={value} />
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
