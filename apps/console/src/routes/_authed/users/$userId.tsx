import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Check, Copy, Fingerprint, UserRoundCog } from "lucide-react";
import { useId, useState } from "react";

import { DeleteUserDialog } from "@/components/delete-user-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { api } from "../../../api/zitadel";
import { field } from "../../../lib/record";
import { type UserSchema, schemaDisplayName, schemaFields } from "../../../lib/schema";
import { userDisplayName } from "../../../lib/user";
import { getConsoleProjectId } from "../../../runtime/runtime";

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
    const projectId = getConsoleProjectId();
    const user = await api.getUserByID(params.userId, { project_id: projectId });

    // Both are chrome for the record rather than the record itself, so neither
    // is allowed to reject the loader: a failure costs a card, not the screen.
    const schemaId = field(user, "$schema");
    const [schema, passkeys] = await Promise.all([
      schemaId
        ? api
            .getSchemaById(schemaId, { project_id: projectId })
            .then((value) => value as UserSchema)
            .catch(() => undefined)
        : Promise.resolve(undefined),
      api
        .listUserPasskeys(params.userId, { project_id: projectId })
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
const CARD_HEAD = "flex items-center gap-3 px-6 py-5";
const PLATE = "flex size-9 items-center justify-center rounded-md bg-muted text-foreground";
const EYEBROW = "text-muted-foreground font-serif text-xs tracking-[0.96px] uppercase";
const GRID = "grid gap-x-6 gap-y-5 px-6 pt-5 pb-4 sm:grid-cols-2";
const ROW = "flex items-center justify-between gap-4 px-6 py-4";

function UserDetail() {
  const { user, schema, passkeys } = Route.useLoaderData();
  const { userId } = Route.useParams();
  const router = useRouter();
  const name = userDisplayName(user) ?? field(user, "email") ?? userId;
  const fields = schema ? schemaFields(schema) : [];
  const metadata = userMetadata(user);

  return (
    <div className={PAGE}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className={HEADING}>{name}</h1>
          {metadata.status && (
            <Badge
              variant={metadata.status === "active" ? "secondary" : "outline"}
              className="capitalize"
            >
              {metadata.status.replace(/_/g, " ")}
            </Badge>
          )}
        </div>
        <Card className="gap-0 rounded-xl py-0">
          <CardContent className="flex flex-wrap gap-x-8 gap-y-3 px-5 py-3">
            <MetaItem label="User ID" value={userId} copyable />
            {metadata.createdAt && (
              <MetaItem label="Created" value={formatDate(metadata.createdAt)} />
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
                <span className="text-foreground font-serif text-base leading-6">
                  {schema ? schemaDisplayName(schema, "Unknown") : "Unknown"}
                </span>
              </div>
            </div>
            <Separator />
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
                    value={field(user, entry.key) ?? ""}
                  />
                ))}
              </div>
            )}
            <p id="profile-readonly" className="text-muted-foreground px-6 pb-5 text-xs">
              Editing a user needs an update endpoint that does not exist yet, so these values are
              read-only.
            </p>
          </Card>

          <Card className={CARD}>
            <CardContent className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-foreground text-sm font-medium">Delete user</span>
                <span className="text-muted-foreground text-sm">
                  Permanently removes {name}, including sessions and access grants. This can&rsquo;t
                  be undone.
                </span>
              </div>
              <DeleteUserDialog
                userId={userId}
                name={name}
                onDeleted={() => router.navigate({ to: "/users" })}
              >
                <Button variant="destructive" className="shrink-0 px-2.5">
                  Delete user
                </Button>
              </DeleteUserDialog>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="authentication">
          <Card className={CARD}>
            <div className={CARD_HEAD}>
              <span className={PLATE} aria-hidden>
                <Fingerprint className="size-[18px]" />
              </span>
              <div className="flex flex-col">
                <span className={EYEBROW}>Authentication</span>
                <span className="text-foreground font-serif text-base leading-6">
                  {schema ? schemaDisplayName(schema, "Unknown") : "Unknown"}
                </span>
              </div>
            </div>
            <Separator />
            {/* Only Passkey is listed. The design's Password row shows a "last
                changed" date the API does not expose, and its `Set` pill would
                be a claim the console cannot check. */}
            <div className={ROW}>
              <span className="text-foreground text-sm">Passkey</span>
              {passkeys === undefined ? (
                <span className="text-muted-foreground text-sm">Could not be loaded</span>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground text-sm">{passkeys.length} registered</span>
                  <Badge variant="secondary">{passkeys.length > 0 ? "Enabled" : "None"}</Badge>
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
 * no Save promises more than a plain one, so the input says what it is and
 * points at the note explaining why.
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
      <Input
        id={id}
        readOnly
        value={value}
        aria-describedby="profile-readonly"
        className="h-9 rounded-md px-2.5 py-1 text-sm"
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
  return { status: field(record, "status"), createdAt: field(record, "createdAt") };
}

/**
 * A created date, in the viewer's own locale.
 *
 * The design renders `12 Jul 2026`, which is how this reads in a British locale
 * — that is the mock's locale, not a format the product should impose. Day,
 * short month and year are requested; the order and separators are the
 * viewer's. Tests derive the expected string the same way rather than hardcoding
 * one locale's output.
 *
 * Falls back to the raw value rather than rendering `Invalid Date` if the server
 * sends something unparseable.
 */
function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** One labelled value in the header card, optionally copyable. */
function MetaItem({
  label,
  value,
  copyable = false,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused (permissions, insecure origin). The id
      // is on screen and selectable, so a failure needs no error surface.
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className={EYEBROW}>{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-foreground font-mono text-sm">{value}</span>
        {copyable && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => void copy()}
            aria-label={copied ? `${label} copied` : `Copy ${label}`}
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          </Button>
        )}
      </div>
    </div>
  );
}
