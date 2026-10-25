import { Link } from "@tanstack/react-router";

import { RESOURCE_CELL, ResourceIdCell } from "@/components/resource-list";
import { TableCell } from "@/components/ui/table";
import type { UserRow } from "@/lib/user-list";

/** The User and schema-driven cells clamp at 280px and truncate. */
export const USER_CLAMP = "max-w-70";

/**
 * The User cell of a user table: the server-resolved identity (display →
 * identifier → id, ADR 058 §3a) as the link to the user, and the designated
 * identifier (x-identifier) beneath a display name, its tooltip naming the
 * property it came from. Schema-driven columns cannot promise a meaningful
 * leading value; this cell always can, so a mixed-schema list still reads the
 * identifier down one column.
 */
export function UserIdentityCell({ user }: { user: UserRow }) {
  return (
    <TableCell className={`${RESOURCE_CELL} ${USER_CLAMP} text-sm`}>
      <Link
        to="/users/$userId"
        params={{ userId: user.id }}
        className="text-foreground block truncate font-medium underline-offset-2 hover:underline"
      >
        {user.name}
      </Link>
      {user.secondary && (
        <span
          className="text-muted-foreground block truncate text-xs"
          title={user.identifierProperty}
        >
          {user.secondary}
        </span>
      )}
    </TableCell>
  );
}

/**
 * The ID cell of a user table: the shared one (`ResourceIdCell`), which takes
 * the slack, so the default schema's table fits a 1024px window without
 * scrolling.
 */
export function UserIdCell({ user }: { user: UserRow }) {
  return <ResourceIdCell id={user.id} name={user.name} />;
}
