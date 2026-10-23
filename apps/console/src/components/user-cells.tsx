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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { InlineCode } from "@/components/ui/inline-code";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDate } from "@/lib/date";
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
 * identifier (x-identifier) beneath a display name. Schema-driven columns
 * cannot promise a meaningful leading value; this cell always can, so a
 * mixed-schema list still reads the identifier down one column.
 *
 * The identifier carries its property as a chip (`email`, `username`), once,
 * beside whichever line shows it: a list that mixes schemas signs people in
 * with different properties, and a tooltip hid that (D21).
 *
 * `sticky` pins it to the card's left edge while the other columns scroll
 * under it (the Users list); the header cell over it takes
 * `RESOURCE_STICKY_START` too. `card` adds the identity hover card.
 */
export function UserIdentityCell({
  user,
  sticky = false,
  card,
}: {
  user: UserRow;
  sticky?: boolean;
  card?: IdentityCardContext;
}) {
  const chip = user.identifierProperty && (
    <InlineCode className="text-muted-foreground shrink-0">{user.identifierProperty}</InlineCode>
  );
  // No display name: the identifier is the link text itself.
  const chipOnName =
    !user.secondary && user.identifier !== undefined && user.name === user.identifier;
  const link = (
    <Link
      to="/users/$userId"
      params={{ userId: user.id }}
      className="text-foreground block min-w-0 truncate font-medium underline-offset-2 hover:underline"
    >
      {user.name}
    </Link>
  );
  return (
    <TableCell
      className={cn(
        RESOURCE_CELL,
        USER_CLAMP,
        "text-sm",
        sticky && [RESOURCE_STICKY_START, RESOURCE_STICKY_BODY],
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {card ? (
          <HoverCard openDelay={400} closeDelay={100}>
            <HoverCardTrigger asChild>{link}</HoverCardTrigger>
            <HoverCardContent align="start" className="w-80 p-3">
              <UserIdentityCard user={user} context={card} />
            </HoverCardContent>
          </HoverCard>
        ) : (
          link
        )}
        {chipOnName && chip}
      </span>
      {user.secondary && (
        <span className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
          {chip}
          <span className="truncate">{user.secondary}</span>
        </span>
      )}
    </TableCell>
  );
}

/** What the identity hover card knows about the list besides the row. */
export interface IdentityCardContext {
  /** The title of the user's schema, else its id. */
  schemaTitle: string;
  /** False when the list was served without memberships (a 403 on `expand`). */
  teamsKnown: boolean;
}

/**
 * The identity hover card: what the user's schema designates (what they sign
 * in with, what the console calls them), their memberships and the team that
 * owns their lifecycle, which is not a membership (ADR 024).
 *
 * Supplementary by design: a hover card opens on the link's hover and focus
 * but its content is not reachable by keyboard, and everything in it is on the
 * detail screen too.
 */
function UserIdentityCard({ user, context }: { user: UserRow; context: IdentityCardContext }) {
  const display = user.secondary ? user.name : undefined;
  const owner = user.lifecycleOwnerTeamId;
  const ownerName = owner && user.teams.find((team) => team.id === owner)?.name;
  return (
    <div className="text-xs">
      <div className="border-border border-b pb-2.5">
        <p className="text-foreground truncate text-sm font-medium">{user.name}</p>
        <p className="text-muted-foreground truncate">{context.schemaTitle} schema</p>
      </div>
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 py-2.5 leading-4.5">
        <dt className="text-muted-foreground">Signs in with</dt>
        <dd className="flex min-w-0 items-center gap-1.5">
          {user.identifier ? (
            <>
              {user.identifierProperty && (
                <InlineCode className="text-muted-foreground shrink-0">
                  {user.identifierProperty}
                </InlineCode>
              )}
              <span className="truncate">{user.identifier}</span>
            </>
          ) : (
            <span className="text-muted-foreground">No identifier</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Display name</dt>
        <dd className={display ? "truncate" : "text-muted-foreground"}>{display ?? "None"}</dd>
        <dt className="text-muted-foreground">Member of</dt>
        <dd className={user.teams.length > 0 ? "" : "text-muted-foreground"}>
          {!context.teamsKnown
            ? "Not readable with your access"
            : user.teams.length > 0
              ? user.teams
                  .map((team) =>
                    team.status && team.status !== "active"
                      ? `${team.name} (${team.status})`
                      : team.name,
                  )
                  .join(", ")
              : "No teams"}
        </dd>
        {owner !== undefined && (
          <>
            <dt className="text-muted-foreground">Lifecycle owner</dt>
            <dd className="min-w-0 truncate">
              {owner === null ? (
                <span className="text-muted-foreground">Self-owned</span>
              ) : (
                (ownerName ?? <InlineCode>{owner}</InlineCode>)
              )}
            </dd>
          </>
        )}
        {user.createdAt && (
          <>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDate(user.createdAt)}</dd>
          </>
        )}
      </dl>
      <p className="text-muted-foreground border-border border-t pt-2 text-[11px] leading-4">
        The schema decides what a user signs in with (
        <code className="whitespace-nowrap">x-identifier</code>) and what the console calls them (
        <code className="whitespace-nowrap">x-display</code>).
      </p>
    </div>
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
