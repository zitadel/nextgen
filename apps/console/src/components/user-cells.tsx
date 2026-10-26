import { Link } from "@tanstack/react-router";
import { Braces, Info } from "lucide-react";

import { DocumentViewer } from "@/components/document-viewer";
import {
  RESOURCE_CELL,
  RESOURCE_STICKY_BODY,
  RESOURCE_STICKY_START,
  ResourceIdCell,
} from "@/components/resource-list";
import { TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
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

// The identifier's property beside it: a label, so smaller and quieter than
// the value it names (`InlineCode` alone is the 12/16 prose size).
const IDENTIFIER_CHIP = "text-muted-foreground shrink-0 px-1 py-0 text-[10px] leading-3.5";

/**
 * The User cell of a user table: the server-resolved identity (display →
 * identifier → id, ADR 058 §3a) as the link to the user, and the designated
 * identifier (x-identifier) beneath a display name. Schema-driven columns
 * cannot promise a meaningful leading value; this cell always can, so a
 * mixed-schema list still reads the identifier down one column.
 *
 * The identifier carries its property as a chip (`email`, `username`), once,
 * beside whichever line shows it: a list that mixes schemas signs people in
 * with different properties, and a tooltip hid that (D23).
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
    <InlineCode className={IDENTIFIER_CHIP}>{user.identifierProperty}</InlineCode>
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
            <HoverCardContent align="start" className="w-80 overflow-hidden p-3">
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
        {/* The schema's glyph, as its sidebar entry draws it, and its name
            opening it: the schema is what decides everything below. */}
        <p className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5">
          <Braces aria-hidden strokeWidth={1.5} className="size-3.5 shrink-0" />
          {user.schemaId ? (
            <Link
              to="/schemas/$schemaId"
              params={{ schemaId: user.schemaId }}
              className="hover:text-foreground truncate underline-offset-2 hover:underline"
            >
              {context.schemaTitle}
            </Link>
          ) : (
            <span className="truncate">No schema</span>
          )}
        </p>
      </div>
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 py-2.5 leading-4.5">
        <dt className="text-muted-foreground">Signs in with</dt>
        <dd className="flex min-w-0 items-center gap-1.5">
          {user.identifier ? (
            <>
              {user.identifierProperty && (
                <InlineCode className={IDENTIFIER_CHIP}>{user.identifierProperty}</InlineCode>
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
      {/* Guidance, not data: a band of its own, edge to edge under the card's
          12px inset, so it does not read as another row of the list. On the
          page canvas, since `muted` is the popover's own colour in dark mode. */}
      <p className="text-muted-foreground border-border bg-background -mx-3 -mb-3 flex gap-2 border-t px-3 py-2.5 text-[11px] leading-4">
        <Info aria-hidden strokeWidth={1.5} className="mt-px size-3.5 shrink-0" />
        <span>
          The schema decides what a user signs in with (
          <code className="whitespace-nowrap">x-identifier</code>) and what the console calls them (
          <code className="whitespace-nowrap">x-display</code>).
        </span>
      </p>
    </div>
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

/**
 * The Attributes cell of the Users list: one muted line naming the first
 * attributes no column shows, and a count of the rest. It is a fixed 280px
 * wherever a schema has more properties than that, which is what keeps the
 * table's width bounded (D23).
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
          {/* Focus lands on the popover itself, not on its first tab: an
              auto-focused tab would open with its focus ring drawn. Tab still
              walks on to View details, the tabs and Copy. */}
          <PopoverContent
            align="start"
            aria-label={`Attributes of ${user.name}`}
            tabIndex={-1}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement).focus();
            }}
            className="max-h-(--radix-popover-content-available-height) w-[min(28rem,calc(100vw-2rem))] overflow-y-auto p-0"
          >
            {/* 16px inset, the same as the viewer's tab labels and code. */}
            <div className="flex items-start justify-between gap-3 px-4 py-3">
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
            <DocumentViewer document={user.attributes} noun="attributes" compact />
          </PopoverContent>
        </Popover>
      )}
    </TableCell>
  );
}
