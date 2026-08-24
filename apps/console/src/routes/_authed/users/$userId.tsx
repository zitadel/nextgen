import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Key, UserRoundCog } from "lucide-react";
import { useId } from "react";

import { DeleteUserDialog } from "@/components/delete-user-dialog";
import { EYEBROW, MetaRule, MetaValue } from "@/components/detail-meta";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { api } from "../../../api/zitadel";
import { formatDate } from "../../../lib/date";
import { displayValue, field } from "../../../lib/record";
import { type UserSchema, schemaDisplayName, schemaFields } from "../../../lib/schema";
import { userAttributes, userDisplayName } from "../../../lib/user";

/**
 * User detail (Figma `467:44362`, `Filled` and `Authentication` variants).
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
 *
 * The design's "Project permissions" block is not pending — it has been removed
 * from the design (decisions log D6, and the log's open question on how project,
 * team and access relate).
 */
export const Route = createFileRoute("/_authed/users/$userId")({
  loader: async ({ params }) => {
    const user = await api.getUserByID(params.userId);

    // Both are chrome for the record rather than the record itself, so neither
    // is allowed to reject the loader: a failure costs a card, not the screen.
    const schemaId = field(user, "schema");
    const [schema, passkeys] = await Promise.all([
      schemaId
        ? api
            .getSchemaById(schemaId)
            .then((value) => value.schema as UserSchema)
            .catch(() => undefined)
        : Promise.resolve(undefined),
      api
        .listUserPasskeys(params.userId)
        .then((result) => result.passkeys)
        .catch(() => undefined),
    ]);

    return { user, schema, passkeys };
  },
  component: UserDetail,
});

// Long utility strings live as named constants so Tailwind's scanner sees the
// full literal (it never sees a concatenated fragment).
const PAGE = "px-4 pt-9 pb-8 sm:px-8";
const HEADING = "text-foreground font-serif text-2xl leading-8 tracking-tight";
const CARD = "gap-0 rounded-xl py-0";
// The panel body is 24px in from the card edge and 20px down, with 16px between
// the header, the divider and the content (Detail Panel `1305:392714`).
const CARD_HEAD = "flex items-center gap-3 px-6 pt-5 pb-4";
const PLATE = "flex size-9 items-center justify-center rounded-md bg-muted text-foreground";
// 18px between fields on both axes — not a 4px-scale step, so it is written out.
const GRID = "grid gap-[18px] px-6 pt-4 pb-5 sm:grid-cols-2";
const ROW = "flex items-center justify-between gap-4 px-6 pt-4 pb-5";
// The divider sits inside the body padding rather than spanning the card, and
// `w-full` is applied by an orientation variant that out-specifies a plain
// utility — so the override has to carry the same variant.
const PANEL_RULE = "mx-6 w-auto data-[orientation=horizontal]:w-auto";

function UserDetail() {
  const { user, schema, passkeys } = Route.useLoaderData();
  const { userId } = Route.useParams();
  const router = useRouter();
  const attributes = userAttributes(user);
  const name = userDisplayName(attributes) ?? field(attributes, "email") ?? userId;
  const fields = schema ? schemaFields(schema) : [];
  const metadata = userMetadata(user);

  return (
    <div className={PAGE}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className={HEADING}>{name}</h1>
          {metadata.status && <StatusBadge status={metadata.status} />}
        </div>
        <Card className="gap-0 rounded-xl py-0">
          {/* Stacked below `sm`, in a row above it — the mobile frame
              (`520:80552`) keeps every item flush left and turns the column
              rule into a tick on its own row between them. */}
          <CardContent className="flex flex-col px-5 py-3.5 sm:flex-row sm:flex-wrap sm:items-start">
            <MetaValue label="User ID" value={userId} copyable />
            {metadata.createdAt && (
              <>
                <MetaRule />
                <MetaValue label="Created" value={formatDate(metadata.createdAt)} />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="mt-6 gap-6">
        <TabsList aria-label="User detail sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="authentication">Authentication</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4">
          <Card className={CARD}>
            <div className={CARD_HEAD}>
              <span className={PLATE} aria-hidden>
                <UserRoundCog className="size-[18px]" />
              </span>
              <div className="flex flex-col">
                <span className={EYEBROW}>User schema</span>
                <span className="text-foreground text-base leading-6">
                  {schema ? schemaDisplayName(schema, "Unknown") : "Unknown"}
                </span>
              </div>
            </div>
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

          <Card className={CARD}>
            <CardContent className="flex flex-col gap-4 px-5 py-[18px] sm:flex-row sm:items-center sm:justify-between">
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
          <Card className={CARD}>
            <div className={CARD_HEAD}>
              {/* `Lucide Icon / Key` (`911:34248`) — the design names the glyph,
                  so it is read off the node rather than picked by meaning. */}
              <span className={PLATE} aria-hidden>
                <Key className="size-[18px]" />
              </span>
              <div className="flex flex-col">
                <span className={EYEBROW}>Authentication</span>
                <span className="text-foreground text-base leading-6">
                  {schema ? schemaDisplayName(schema, "Unknown") : "Unknown"}
                </span>
              </div>
            </div>
            <Separator className={PANEL_RULE} />
            {/* Only Passkey is listed. The design's Password row shows a "last
                changed" date the API does not expose, and its `Set` pill would
                be a claim the console cannot check. */}
            <div className={ROW}>
              <span className="text-foreground text-sm font-medium">Passkey</span>
              {passkeys === undefined ? (
                <span className="text-muted-foreground text-[13px] leading-[22px]">
                  Could not be loaded
                </span>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground text-[13px] leading-[22px]">
                    {passkeys.length} registered
                  </span>
                  {/* The design's only badge here is `Enabled` (`1305:392844`).
                      With nothing registered the count already says so, and a
                      second capsule reading `None` restates it. */}
                  {passkeys.length > 0 && <Badge variant="secondary">Enabled</Badge>}
                </div>
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
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
      <FieldLabel
        htmlFor={id}
        className="text-foreground font-serif text-sm leading-5 font-normal"
      >
        {label}
      </FieldLabel>
      {/* `bg-background`, not the card's own fill: the design resolves the input
          to `base/background`, which is what makes it read as inset against the
          lighter card rather than dissolving into it. */}
      <Input
        id={id}
        readOnly
        value={value}
        className="bg-background h-9 rounded-md px-2.5 py-1 text-sm"
      />
    </Field>
  );
}

/**
 * The server-owned `metadata` block. Read defensively: it sits on an otherwise
 * open record, so a user written before it existed simply has none.
 */
function userMetadata(user: Record<string, unknown>): { status?: string; createdAt?: string } {
  const metadata = user.metadata;
  if (!metadata || typeof metadata !== "object") return {};
  const record = metadata as Record<string, unknown>;
  return { status: field(record, "status"), createdAt: field(record, "created_at") };
}

