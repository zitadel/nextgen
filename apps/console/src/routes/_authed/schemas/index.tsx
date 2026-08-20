import { createFileRoute, Link } from "@tanstack/react-router";
import { Ellipsis, Lock } from "lucide-react";

import { RESOURCE_HEADER, RESOURCE_PAGE } from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InlineCode } from "@/components/ui/inline-code";
import { formatDate } from "@/lib/date";
import {
  type UserSchema,
  schemaAuthMethods,
  schemaDisplayName,
  schemaProperties,
} from "@/lib/schema";

import { api } from "../../../api/zitadel";
import { getConsoleProjectId } from "../../../runtime/runtime";

export const Route = createFileRoute("/_authed/schemas/")({
  staticData: { nav: { label: "User schemas", order: 1, parent: "/users" } },
  loader: async () => {
    const projectId = getConsoleProjectId();
    // `GET /schemas` returns `{ id, created_at }` and nothing else, so the
    // row's name, attributes and sign-in methods all have to come from each
    // document. The list is configuration and stays small (~20, decisions log
    // D0a/D7), so fetching them together is cheap and there is no pagination
    // to interleave with.
    // `kind` scopes the list to user schemas. The screen is titled `User
    // schemas` and only knows how to render one, so this is the contract the
    // rows already assume rather than a new restriction.
    const entries = await api.listSchemas({ project_id: projectId, kind: "user-schema" });
    const documents = await Promise.all(
      entries.map(async (entry) => {
        try {
          return (await api.getSchemaById(entry.id)) as UserSchema;
        } catch {
          // One unreadable document costs its row's detail, not the screen.
          return undefined;
        }
      }),
    );
    // Mapped rather than spread so the wire's `created_at` stops at the loader
    // and the row keeps the console's camelCase.
    return entries.map((entry, index) => ({
      id: entry.id,
      createdAt: entry.created_at,
      schema: documents[index],
    }));
  },
  component: SchemasScreen,
});

function SchemasScreen() {
  const schemas = Route.useLoaderData();

  return (
    <div className={`${RESOURCE_PAGE} pt-4`}>
      <div className={`${RESOURCE_HEADER} flex h-9 items-center`}>
        {/* The frame titles this screen `Schemas`; D8 keeps the noun qualified
            everywhere it appears, which is also what the sidebar entry says. */}
        <h1 className="font-serif text-2xl leading-6 tracking-tight text-foreground">
          User schemas
        </h1>
      </div>

      {/* The design's `Card` — rows run edge to edge and carry their own
          `px-6`, so the dividers between them are full-bleed. */}
      <Card className="mt-3 gap-0 overflow-hidden border-foreground/10 py-0 shadow-xs">
        {schemas.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            This project has no user schemas.
          </p>
        ) : (
          schemas.map((entry) => <SchemaRow key={entry.id} {...entry} />)
        )}
      </Card>
    </div>
  );
}

/**
 * `Schema Row` (`1389:9690`).
 *
 * Four columns — name + sign-in methods, the attributes it collects, its
 * metadata, and the row menu. The design system's note on the component is the
 * spec for its behaviour: *"Whole row is the click target; hover is the
 * affordance (no chevron). Default: dimmed ⋯. Hover: `accent` fill, name
 * brightened, ⋯ full opacity."*
 *
 * The click target is a stretched link rather than a handler on the row, so
 * there is still exactly one focusable control for the destination and the row
 * keeps working with the keyboard and middle-click. The menu sits above that
 * overlay.
 *
 * Below `lg` the columns stack: the design's `Breakpoint=Wide` variant names a
 * narrow sibling that is not in this file, so the stack is the console's own
 * reading of it rather than a frame to diff against.
 */
function SchemaRow({
  id,
  createdAt,
  schema,
}: {
  id: string;
  createdAt: string;
  schema: UserSchema | undefined;
}) {
  const name = schema ? schemaDisplayName(schema, id) : id;
  const attributes = schema ? schemaProperties(schema).map((property) => property.key) : [];
  // "Passkey + Password" reads off the document's own `x-auth-methods`. The
  // annotation says which methods the user type supports; the order they are
  // offered in belongs to the flow, not to the schema.
  const signIn = schema
    ? schemaAuthMethods(schema)
        .filter((method) => method.enabled)
        .map((method) => method.label)
        .join(" + ")
    : "";

  return (
    <div className="group relative flex flex-col gap-4 border-b border-border px-6 py-3.5 last:border-b-0 hover:bg-accent lg:flex-row lg:items-center lg:gap-6">
      <div className="flex shrink-0 flex-col gap-1 lg:min-w-[220px]">
        <Link
          to="/schemas/$schemaId"
          params={{ schemaId: id }}
          className="font-serif text-base leading-6 text-foreground opacity-90 group-hover:opacity-100 after:absolute after:inset-0 after:content-['']"
        >
          {name}
        </Link>
        {signIn && (
          <span className="flex items-center gap-1 text-xs leading-4 font-medium text-muted-foreground">
            <Lock className="size-3" aria-hidden />
            {signIn}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-1.5">
        {attributes.map((attribute) => (
          <InlineCode key={attribute} className={CHIP}>
            {attribute}
          </InlineCode>
        ))}
      </div>

      <dl className="flex shrink-0 flex-col gap-1 text-xs leading-4 text-muted-foreground">
        <MetaRow label="Created">{formatDate(createdAt)}</MetaRow>
        {/* The design mocks a short id; a real one is a 30-character `sch_*`,
            so it is clamped with the whole value on hover and on the detail
            screen. Together with the date it is what identifies one schema
            among several (decisions log D10). */}
        <MetaRow label="ID">
          <span title={id} className="block max-w-[180px] truncate">
            {id}
          </span>
        </MetaRow>
      </dl>

      {/* Above the stretched link, or the row's own destination would swallow
          the menu's clicks. */}
      <div className="absolute top-3.5 right-4 lg:relative lg:top-auto lg:right-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${name}`}
              className="relative z-10 opacity-50 group-hover:opacity-100"
            >
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem asChild>
              <Link to="/schemas/$schemaId" params={{ schemaId: id }}>
                View schema
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/**
 * The chip lifts to `card` while its row is hovered.
 *
 * `InlineCode` rests on `muted`, and the row's hover fill is `accent` — which
 * in the light theme is the *same* value (`#f5f5f5`), so a borderless chip
 * disappears into its own row's hover state. The design cannot have caught it:
 * the frame is drawn with light variable values on a dark canvas, so the light
 * hover was never rendered. `card` is one step off the row in both themes
 * (lighter in light, darker in dark) and stays a semantic token, but it is the
 * console's fix for a token collision, not something the design specifies.
 */
const CHIP = "group-hover:bg-card";

/** One `CREATED 12 Jul 2026` line: a regular label, a medium value. */
function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1">
      <dt className="font-normal uppercase">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
