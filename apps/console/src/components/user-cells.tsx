import { Link } from "@tanstack/react-router";

import { DocumentViewer } from "@/components/document-viewer";
import {
  RESOURCE_CELL,
  RESOURCE_STICKY_BODY,
  RESOURCE_STICKY_START,
} from "@/components/resource-list";
import { TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AttributeSummary, UserRow } from "@/lib/user-list";
import { cn } from "@/lib/utils";

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
 *
 * `sticky` pins it to the card's left edge while the other columns scroll
 * under it (the Users list); the header cell over it takes
 * `RESOURCE_STICKY_START` too.
 */
export function UserIdentityCell({ user, sticky = false }: { user: UserRow; sticky?: boolean }) {
  return (
    <TableCell
      className={cn(
        RESOURCE_CELL,
        USER_CLAMP,
        "text-sm",
        sticky && [RESOURCE_STICKY_START, RESOURCE_STICKY_BODY],
      )}
    >
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

/**
 * The Attributes cell of the Users list: one muted line naming the first
 * attributes no column shows, and a count of the rest. It is a fixed 280px
 * wherever a schema has more properties than that, which is what keeps the
 * table's width bounded (D21).
 *
 * The line opens the user's whole `attributes` tree in a popover, objects and
 * arrays included, which a cell never stringifies (`toUserRow`). A row with
 * nothing left to summarise reads as an em dash, like any empty cell.
 */
export function UserAttributesCell({
  user,
  summary,
}: {
  user: UserRow;
  summary: AttributeSummary;
}) {
  const empty = summary.entries.length === 0 && summary.more === 0;
  return (
    <TableCell className={cn(RESOURCE_CELL, "w-70 max-w-70 text-muted-foreground text-sm")}>
      {empty ? (
        "—"
      ) : (
        <Popover>
          <PopoverTrigger asChild>
            {/* Ghost, pulled out by its own inset so the text aligns with the
                column's other cells and only the hover fill reaches past them. */}
            <Button
              variant="ghost"
              size="sm"
              className="-mx-2 w-[calc(100%+1rem)] justify-start gap-1.5 px-2! font-normal text-muted-foreground hover:text-foreground"
            >
              <span className="sr-only">Attributes of {user.name}: </span>
              <span className="min-w-0 truncate">
                {summary.entries.map((entry) => `${entry.key}: ${entry.value}`).join(" · ")}
              </span>
              {/* Outside the truncating span, as the Team cell's `+more` is: a
                  long first value must not clip the count of the rest. */}
              {summary.more > 0 && (
                <span className="shrink-0">
                  {summary.entries.length > 0
                    ? `· +${summary.more}`
                    : `${summary.more} ${summary.more === 1 ? "attribute" : "attributes"}`}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-3">
            <div className="mb-3 flex items-start justify-between gap-3 px-1">
              <PopoverHeader className="min-w-0">
                <PopoverTitle>Attributes</PopoverTitle>
                <PopoverDescription className="truncate text-xs">{user.name}</PopoverDescription>
              </PopoverHeader>
              <Link
                to="/users/$userId"
                params={{ userId: user.id }}
                className="shrink-0 text-sm underline-offset-2 hover:underline"
              >
                View details
              </Link>
            </div>
            <DocumentViewer
              document={user.attributes}
              noun="attributes"
              hint={false}
              codeClassName="max-h-80"
            />
          </PopoverContent>
        </Popover>
      )}
    </TableCell>
  );
}
