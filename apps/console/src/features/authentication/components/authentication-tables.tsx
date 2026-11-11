import { Link, useNavigate } from "@tanstack/react-router";
import { Braces, Shield } from "lucide-react";
import type { ReactNode } from "react";
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
  ResourceRow,
  RowMenu,
} from "@/components/resource-list";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { InlineCode } from "@/components/ui/inline-code";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { formatDate } from "@/lib/date";
import {
  type IdpConnection,
  type IdpReference,
  nameSummary,
  schemasBySsoProvider,
  type SignInMethodRow,
  signInMethodRows,
} from "@/features/authentication/model";
import type { AuthenticationData } from "@/features/authentication/load";
import type { SchemaEntry } from "@/features/schemas/model";

/**
 * The page a connection opens: the project's, or the root's in the reserved
 * platform project (D41). The screen that draws the tables names it, so a row
 * never opens a project's page at the root.
 */
export type IdpDetailRoute = "/authentication/idps/$idpId" | "/platform/authentication/idps/$idpId";

/** The first and last columns; the user schema column takes the rest. */
const COLUMN = "w-1/4";

/**
 * One row per sign-in method in use — Passkey, Password, then each provider
 * — with the user schemas that allow it: "who can sign in with this?" at a
 * glance.
 */
export function SignInMethods({
  loaded,
  detail,
  empty,
}: {
  loaded: AuthenticationData;
  detail: IdpDetailRoute;
  /** What an empty table says, where it is not a project's (the root's, D41). */
  empty?: ReactNode;
}) {
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
              {empty ?? "No user schema in this project enables a sign-in method."}
            </ResourceEmptyRow>
          ) : (
            rows.map((row) => <MethodRow key={row.key} row={row} detail={detail} />)
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function MethodRow({ row, detail }: { row: SignInMethodRow; detail: IdpDetailRoute }) {
  const navigate = useNavigate();
  // A provider with a connection opens it; Passkey and Password have no page.
  const idpId = row.idpId;

  return (
    <ResourceRow
      onOpen={idpId ? () => void navigate({ to: detail, params: { idpId } }) : undefined}
    >
      <TableCell className={`${RESOURCE_CELL} truncate`}>
        {idpId ? (
          <Link to={detail} params={{ idpId }} className={RESOURCE_ROW_LINK}>
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
 * The user schemas a row concerns, behind the User schemas glyph: the first two by
 * name and a count for the rest, as the design truncates them.
 */
function SchemaNames({ items }: { items: IdpReference[] }) {
  if (items.length === 0) return <>Not used</>;
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <Braces aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
      <span className="truncate">{nameSummary(items.map((item) => item.name))}</span>
    </span>
  );
}

/**
 * The project's connections, newest first, each with the user schemas that
 * list its slug.
 */
export function IdentityProviders({
  idps,
  schemas,
  detail,
  empty,
}: {
  idps: IdpConnection[];
  schemas: SchemaEntry[];
  detail: IdpDetailRoute;
  /**
   * What an empty table says, where it is not a project's (the root's, D41):
   * the CLI hint is a project's, whose connections its own deploys carry.
   */
  empty?: ReactNode;
}) {
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
              {empty ?? (
                <>
                  This project has no identity providers. Add one with{" "}
                  <InlineCode>zitadel auth-method sso enable</InlineCode>.
                </>
              )}
            </ResourceEmptyRow>
          ) : (
            idps.map((idp) => (
              <IdpRow key={idp.id} idp={idp} users={users.get(idp.slug) ?? []} detail={detail} />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function IdpRow({
  idp,
  users,
  detail,
}: {
  idp: IdpConnection;
  users: IdpReference[];
  detail: IdpDetailRoute;
}) {
  const navigate = useNavigate();
  const name = idp.definition.display_name;

  return (
    <ResourceRow onOpen={() => void navigate({ to: detail, params: { idpId: idp.id } })}>
      <TableCell className={`${RESOURCE_CELL} truncate`}>
        <Link to={detail} params={{ idpId: idp.id }} className={RESOURCE_ROW_LINK}>
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
            <Link to={detail} params={{ idpId: idp.id }}>
              View connection
            </Link>
          </DropdownMenuItem>
        </RowMenu>
      </TableCell>
    </ResourceRow>
  );
}
