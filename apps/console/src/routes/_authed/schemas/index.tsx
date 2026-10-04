import { createFileRoute, Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";

import { api } from "@/api/zitadel";
import {
  DIRECTORY_CHIP,
  DIRECTORY_ROW_LINK,
  DirectoryCard,
  DirectoryRow,
} from "@/components/directory-list";
import { LoadMore, ResourcePage, ResourceTitle } from "@/components/resource-list";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { InlineCode } from "@/components/ui/inline-code";
import { useLoadMore } from "@/hooks/use-load-more";
import { formatDate } from "@/lib/date";
import { projectScopeDeps, requireProjectScope, useRequiredProjectScope } from "@/lib/project-scope";
import {
  type UserSchema,
  schemaAuthMethods,
  schemaDisplayName,
  schemaProperties,
} from "@/lib/schema";

export const Route = createFileRoute("/_authed/schemas/")({
  staticData: { scope: "project", nav: { label: "User schemas", order: 1, parent: "/users" } },
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }) => {
    const projectId = requireProjectScope(deps.project);
    // `kind` scopes the list to user schemas. The screen is titled `User
    // schemas` and only knows how to render one, so this is the contract the
    // rows already assume rather than a new restriction.
    //
    // `revisions: latest` makes a row a schema rather than an edit: schemas are
    // immutable and versioned by URL, so a project that has revised one four
    // times has four rows for it in the full history.
    const page = await api.listSchemas({
      project_id: projectId,
      kind: "user-schema",
      revisions: "latest",
      limit: PAGE_SIZE,
    });
    return {
      schemas: page.schemas.map(toSchemaRow),
      nextPageToken: page.next_page_token ?? undefined,
    };
  },
  component: SchemasScreen,
});

/**
 * One page of schemas. `GET /schemas` is cursor-paginated, so the size is a
 * page size rather than a cap on what the operator can reach — `Load more`
 * walks the rest (same D5 reading as the users screen: a button, not
 * pagination controls).
 */
const PAGE_SIZE = 25;

// Mapped rather than spread so the wire's `created_at` stops at the loader
// and the row keeps the console's camelCase.
function toSchemaRow(entry: { id: string; metadata: { created_at: string }; schema: unknown }) {
  return {
    id: entry.id,
    createdAt: entry.metadata.created_at,
    schema: entry.schema as UserSchema,
  };
}

function SchemasScreen() {
  const projectId = useRequiredProjectScope();
  const loaded = Route.useLoaderData();

  const paging = useLoadMore(
    loaded,
    async (pageToken) => {
      // Same `kind` and `revisions` as the loader: the cursor only pins the
      // ordering and mode, so a filter drift between pages would silently
      // page over a different set.
      const page = await api.listSchemas({
        project_id: projectId,
        kind: "user-schema",
        revisions: "latest",
        limit: PAGE_SIZE,
        page_token: pageToken,
      });
      return {
        items: page.schemas.map(toSchemaRow),
        nextPageToken: page.next_page_token ?? undefined,
      };
    },
    "Could not load more schemas.",
  );
  const schemas = [...loaded.schemas, ...paging.extra];

  return (
    <ResourcePage>
      {/* The design titles this screen `Schemas`; D8 keeps the noun qualified
          everywhere it appears, which is also what the sidebar entry says. */}
      <ResourceTitle>User schemas</ResourceTitle>

      <DirectoryCard empty={schemas.length === 0 ? "This project has no user schemas." : undefined}>
        {schemas.map((entry) => (
          <SchemaRow key={entry.id} {...entry} />
        ))}
      </DirectoryCard>
      <LoadMore paging={paging} />
    </ResourcePage>
  );
}

/**
 * One row of the schema directory: name and sign-in methods, the attributes it
 * collects, its metadata, and the row menu.
 */
function SchemaRow({
  id,
  createdAt,
  schema,
}: {
  id: string;
  createdAt: string;
  schema: UserSchema;
}) {
  const name = schemaDisplayName(schema, id);
  const attributes = schemaProperties(schema).map((property) => property.key);
  // "Passkey + Password" reads off the document's own `x-auth-methods`. The
  // annotation says which methods the user type supports; the order they are
  // offered in belongs to the flow, not to the schema.
  const signIn = schemaAuthMethods(schema)
    .filter((method) => method.enabled)
    .map((method) => method.label)
    .join(" + ");

  return (
    <DirectoryRow
      name={name}
      title={
        <Link to="/schemas/$schemaId" params={{ schemaId: id }} className={DIRECTORY_ROW_LINK}>
          {name}
        </Link>
      }
      caption={
        signIn && (
          <>
            <Lock className="size-3" aria-hidden />
            {signIn}
          </>
        )
      }
      chips={attributes.map((attribute) => (
        <InlineCode key={attribute} className={DIRECTORY_CHIP}>
          {attribute}
        </InlineCode>
      ))}
      menu={
        <DropdownMenuItem asChild>
          <Link to="/schemas/$schemaId" params={{ schemaId: id }}>
            View schema
          </Link>
        </DropdownMenuItem>
      }
    >
      <dl className="flex shrink-0 flex-col gap-1 text-xs leading-4 text-muted-foreground">
        <MetaLine label="Created">{formatDate(createdAt)}</MetaLine>
        {/* The design mocks a short id; a real one is a 30-character `sch_*`,
            so it is clamped with the whole value on hover and on the detail
            screen. Together with the date it is what identifies one schema
            among several (decisions log D10). */}
        <MetaLine label="ID">
          <span title={id} className="block max-w-45 truncate">
            {id}
          </span>
        </MetaLine>
      </dl>
    </DirectoryRow>
  );
}

/** One `CREATED 12 Jul 2026` line: a regular label, a medium value. */
function MetaLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1">
      <dt className="font-normal uppercase">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
