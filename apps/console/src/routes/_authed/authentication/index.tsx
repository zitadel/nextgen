import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Shield, Users } from "lucide-react";
import { useEffect } from "react";

import {
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_ROW_ICON,
  RESOURCE_ROW_LINK,
  RESOURCE_TABLE_FIXED,
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
import { Badge } from "@/components/ui/badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { InlineCode } from "@/components/ui/inline-code";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/date";
import {
  fetchAllIdps,
  type IdpConnection,
  type IdpReference,
  nameSummary,
  schemasBySsoProvider,
  type SignInMethodRow,
  signInMethodRows,
} from "@/lib/idp";
import { projectScopeDeps, requireProjectScope } from "@/lib/project-scope";
import { fetchAllSchemas, type SchemaEntry } from "@/lib/schema";

/**
 * Authentication — the sign-in methods in use across the project's user
 * schemas, and its identity provider connections. Read-only: sign-in methods
 * live in the schema document and connections are applied through the CLI
 * (#998).
 *
 * The open tab is in the URL (`?tab=`), so a reload or a shared link opens
 * the same one.
 */
export interface AuthenticationSearch {
  /** `identity-providers`, or absent for the default Sign-in methods tab. */
  tab?: "identity-providers";
}

export const Route = createFileRoute("/_authed/authentication/")({
  // Order 4: between Users (3) and Login flows (5), as the design places it.
  staticData: { scope: "project", nav: { label: "Authentication", order: 4, icon: Shield } },
  validateSearch: (search: Record<string, unknown>): AuthenticationSearch =>
    search.tab === "identity-providers" ? { tab: "identity-providers" } : {},
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }): Promise<Loaded> => {
    const projectId = requireProjectScope(deps.project);
    // The whole project's schemas and connections: both tabs join the two on
    // the slug, and no API answers that join directly. The connections are
    // also the Identity providers list, so it is not paged.
    const [schemas, idps] = await Promise.all([
      fetchAllSchemas(projectId),
      fetchAllIdps(projectId),
    ]);
    return { schemas, idps };
  },
  component: AuthenticationScreen,
});

/** What the loader hands the tabs. */
interface Loaded {
  schemas: SchemaEntry[];
  /** `null` without `idp.read`. */
  idps: IdpConnection[] | null;
}

function AuthenticationScreen() {
  const loaded = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  // Without `idp.read` the tab does not exist, so a link to it opens Sign-in
  // methods rather than an empty strip, and the URL drops the tab it cannot
  // show.
  const canReadIdps = loaded.idps !== null;
  const staleTab = !canReadIdps && search.tab !== undefined;
  useEffect(() => {
    if (staleTab) void navigate({ search: {}, replace: true });
  }, [staleTab, navigate]);
  const tab = canReadIdps && search.tab === "identity-providers" ? search.tab : "sign-in";

  return (
    <ResourcePage>
      <ResourceTitle>Authentication</ResourceTitle>

      {/* 8px under the title and 16px over the table, as the page header
          draws the tab strip. */}
      <Tabs
        value={tab}
        onValueChange={(next) =>
          void navigate({
            search: { tab: next === "identity-providers" ? "identity-providers" : undefined },
          })
        }
        className="mt-2 gap-4"
      >
        <TabsList className="h-10 px-0 py-[3px]">
          <TabsTrigger value="sign-in" variant="muted">
            Sign-in methods
          </TabsTrigger>
          {canReadIdps && (
            <TabsTrigger value="identity-providers" variant="muted">
              Identity providers
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="sign-in">
          <SignInMethods loaded={loaded} />
        </TabsContent>

        {loaded.idps && (
          <TabsContent value="identity-providers">
            <IdentityProviders idps={loaded.idps} schemas={loaded.schemas} />
          </TabsContent>
        )}
      </Tabs>
    </ResourcePage>
  );
}

/** The first and last columns; the user schema column takes the rest. */
const COLUMN = "w-1/4";

/**
 * One row per sign-in method in use — Passkey, Password, then each provider
 * — with the user schemas that allow it: "who can sign in with this?" at a
 * glance.
 */
function SignInMethods({ loaded }: { loaded: Loaded }) {
  const rows = signInMethodRows(loaded.schemas, loaded.idps);

  return (
    <div className={RESOURCE_TABLE_WRAP}>
      <Table className={RESOURCE_TABLE_FIXED}>
        <TableHeader>
          <ResourceHeaderRow>
            <ResourceHeadCell className={COLUMN}>Method</ResourceHeadCell>
            <ResourceHeadCell>User schema</ResourceHeadCell>
            <ResourceHeadCell className={COLUMN}>Last change</ResourceHeadCell>
          </ResourceHeaderRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <ResourceEmptyRow colSpan={3}>
              No user schema in this project enables a sign-in method.
            </ResourceEmptyRow>
          ) : (
            rows.map((row) => <MethodRow key={row.key} row={row} />)
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function MethodRow({ row }: { row: SignInMethodRow }) {
  const navigate = useNavigate();
  // A provider with a connection opens it; Passkey and Password have no page.
  const idpId = row.idpId;

  return (
    <ResourceRow
      onOpen={
        idpId
          ? () => void navigate({ to: "/authentication/idps/$idpId", params: { idpId } })
          : undefined
      }
    >
      <TableCell className={`${RESOURCE_CELL} truncate`}>
        {idpId ? (
          <Link to="/authentication/idps/$idpId" params={{ idpId }} className={RESOURCE_ROW_LINK}>
            {row.label}
          </Link>
        ) : row.missing ? (
          // A slug no connection has: shown as written, like the schema
          // screens show it, and flagged — a broken option would otherwise
          // look like a working one.
          <span className="inline-flex items-center gap-2.5">
            <InlineCode>{row.label}</InlineCode>
            <Badge variant="destructive">No connection</Badge>
          </span>
        ) : (
          <span className="text-sm font-medium text-foreground">{row.label}</span>
        )}
      </TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>
        <SchemaNames items={row.schemas} />
      </TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>{formatDate(row.lastChange)}</TableCell>
    </ResourceRow>
  );
}

/**
 * The user schemas a row concerns, behind the users glyph: the first two by
 * name and a count for the rest, as the design truncates them.
 */
function SchemaNames({ items }: { items: IdpReference[] }) {
  if (items.length === 0) return <>Not used</>;
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <Users aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
      <span className="truncate">{nameSummary(items.map((item) => item.name))}</span>
    </span>
  );
}

/**
 * The project's connections, newest first, each with the user schemas that
 * list its slug.
 */
function IdentityProviders({ idps, schemas }: { idps: IdpConnection[]; schemas: SchemaEntry[] }) {
  const users = schemasBySsoProvider(schemas);

  return (
    <div className={RESOURCE_TABLE_WRAP}>
      <Table className={RESOURCE_TABLE_FIXED}>
        <TableHeader>
          <ResourceHeaderRow>
            <ResourceHeadCell className={COLUMN}>Provider</ResourceHeadCell>
            <ResourceHeadCell>User schema</ResourceHeadCell>
            <ResourceHeadCell className="w-[18%]">Last change</ResourceHeadCell>
            <ResourceMenuHead className="w-[7%]" />
          </ResourceHeaderRow>
        </TableHeader>
        <TableBody>
          {idps.length === 0 ? (
            <ResourceEmptyRow colSpan={4}>
              This project has no identity providers. Add one with{" "}
              <InlineCode>zitadel auth-method sso enable</InlineCode>.
            </ResourceEmptyRow>
          ) : (
            idps.map((idp) => <IdpRow key={idp.id} idp={idp} users={users.get(idp.slug) ?? []} />)
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function IdpRow({ idp, users }: { idp: IdpConnection; users: IdpReference[] }) {
  const navigate = useNavigate();
  const name = idp.definition.display_name;

  return (
    <ResourceRow
      onOpen={() => void navigate({ to: "/authentication/idps/$idpId", params: { idpId: idp.id } })}
    >
      <TableCell className={`${RESOURCE_CELL} truncate`}>
        <Link
          to="/authentication/idps/$idpId"
          params={{ idpId: idp.id }}
          className={RESOURCE_ROW_LINK}
        >
          <Shield aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
          {name}
        </Link>
      </TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>
        <SchemaNames items={users} />
      </TableCell>
      {/* `updated_at` is when the newest revision was created: the last
          change to the connection. */}
      <TableCell className={RESOURCE_CELL_MUTED}>{formatDate(idp.updated_at)}</TableCell>
      <TableCell className={`${RESOURCE_CELL} text-right`}>
        <RowMenu name={name}>
          <DropdownMenuItem asChild>
            <Link to="/authentication/idps/$idpId" params={{ idpId: idp.id }}>
              View connection
            </Link>
          </DropdownMenuItem>
        </RowMenu>
      </TableCell>
    </ResourceRow>
  );
}
