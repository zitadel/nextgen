import { Link, useNavigate } from "@tanstack/react-router";
import { Braces, Shield } from "lucide-react";
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
import type { SchemaEntry } from "@/features/schemas/model";

/** What the loader hands the tabs. */
export interface Loaded {
  schemas: SchemaEntry[];
  /** `null` without `idp.read`. */
  idps: IdpConnection[] | null;
}

/** The first and last columns; the user schema column takes the rest. */
const COLUMN = "w-1/4";

/**
 * One row per sign-in method in use — Passkey, Password, then each provider
 * — with the user schemas that allow it: "who can sign in with this?" at a
 * glance.
 */
export function SignInMethods({ loaded }: { loaded: Loaded }) {
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
}: {
  idps: IdpConnection[];
  schemas: SchemaEntry[];
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
