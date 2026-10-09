import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Users } from "lucide-react";

import { api } from "@/api/zitadel";
import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_ROW_ICON,
  RESOURCE_ROW_LINK,
  RESOURCE_TABLE_FIXED,
  RESOURCE_TABLE_TOP,
  RESOURCE_TABLE_WRAP,
  ResourceEmptyRow,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceMenuHead,
  ResourcePage,
  ResourceRow,
  ResourceTitle,
  RowMenu,
} from "@/components/resource-list";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { useLoadMore } from "@/hooks/use-load-more";
import { formatDate } from "@/lib/date";
import {
  projectScopeDeps,
  requireProjectScope,
  useRequiredProjectScope,
} from "@/lib/project-scope";
import { type UserSchema, schemaDisplayName, schemaSignInSummary } from "@/lib/schema";

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

      <div className={`${RESOURCE_TABLE_WRAP} ${RESOURCE_TABLE_TOP}`}>
        {/* Four equal columns, as the design lays them out (D17); the trailing
            one carries the row menu. */}
        <Table className={RESOURCE_TABLE_FIXED}>
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell className={COLUMN}>Name</ResourceHeadCell>
              <ResourceHeadCell className={COLUMN}>Sign-in methods</ResourceHeadCell>
              <ResourceHeadCell className={COLUMN}>Created</ResourceHeadCell>
              <ResourceMenuHead className={COLUMN} />
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {schemas.length === 0 ? (
              <ResourceEmptyRow colSpan={4}>This project has no user schemas.</ResourceEmptyRow>
            ) : (
              schemas.map((entry) => <SchemaRow key={entry.id} {...entry} />)
            )}
          </TableBody>
        </Table>
      </div>
      <LoadMore paging={paging} />
    </ResourcePage>
  );
}

const COLUMN = "w-1/4";

/**
 * One row of the schema directory: the name, its enabled sign-in methods, when
 * it was created, and the row menu. The whole row opens the schema.
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
  const navigate = useNavigate();
  const name = schemaDisplayName(schema, id);
  // "Passkey + Password" reads off the document's own `x-auth-methods`. The
  // annotation says which methods the user type supports; the order they are
  // offered in belongs to the flow, not to the schema.
  const signIn = schemaSignInSummary(schema);

  return (
    <ResourceRow
      onOpen={() => void navigate({ to: "/schemas/$schemaId", params: { schemaId: id } })}
    >
      <TableCell className={`${RESOURCE_CELL} truncate`}>
        <Link to="/schemas/$schemaId" params={{ schemaId: id }} className={RESOURCE_ROW_LINK}>
          <Users aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
          {name}
        </Link>
      </TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>{signIn}</TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>{formatDate(createdAt)}</TableCell>
      <TableCell className={`${RESOURCE_CELL} text-right`}>
        <RowMenu name={name}>
          <DropdownMenuItem asChild>
            <Link to="/schemas/$schemaId" params={{ schemaId: id }}>
              View schema
            </Link>
          </DropdownMenuItem>
        </RowMenu>
      </TableCell>
    </ResourceRow>
  );
}
