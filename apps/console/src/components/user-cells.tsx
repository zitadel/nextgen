import { Link } from "@tanstack/react-router";

import { RESOURCE_CELL } from "@/components/resource-list";
import { TableCell } from "@/components/ui/table";
import { CopyButton } from "@/components/ui/copy-button";
import type { UserRow } from "@/lib/user-list";

/** The User and schema-driven cells clamp at 280px and truncate. */
export const USER_CLAMP = "max-w-70";

// The row's copy button rests hidden and shows on the row's hover or its own
// focus, so a keyboard reaches it; where there is no hover it always shows.
// The row needs the `group` class for the hover.
const ROW_COPY =
  "shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";

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
 * The ID cell of a user table. It takes whatever width the other columns leave
 * (`w-full max-w-0`) and truncates inside it, so the default schema's table
 * fits a 1024px window without scrolling. The tooltip keeps the whole id, and
 * the copy button copies it however much of it shows.
 */
export function UserIdCell({ user }: { user: UserRow }) {
  return (
    <TableCell className={`${RESOURCE_CELL} w-full max-w-0 min-w-40`}>
      <span className="flex items-center gap-1">
        <span className="text-foreground min-w-0 truncate text-sm" title={user.id}>
          {user.id}
        </span>
        <CopyButton value={user.id} label={`Copy the ID of ${user.name}`} className={ROW_COPY} />
      </span>
    </TableCell>
  );
}
