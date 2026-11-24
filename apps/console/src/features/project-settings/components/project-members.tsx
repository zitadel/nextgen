import { ChevronDown, ChevronRight, EllipsisVertical, UserCog, Users } from "lucide-react";
import { Fragment, useState } from "react";

import { RemoveMemberDialog } from "./remove-member-dialog";
import {
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_MENU_CELL_NARROW,
  RESOURCE_STICKY_BODY,
  RESOURCE_STICKY_END,
  RESOURCE_TABLE_FIXED,
  RESOURCE_TABLE_SCROLL,
  RESOURCE_TABLE_WRAP,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceMenuHead,
  ResourceRow,
  RowMenu,
} from "@/components/resource-list";
import { StatusBadge } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import {
  type Expiry,
  type Grant,
  type Member,
  type MemberRow,
  type Person,
  type RowAction,
  initials,
  toMemberRows,
} from "@/features/project-settings/members";
import { useScrollEdges } from "@/hooks/use-scroll-edges";
import { formatDate } from "@/lib/date";
import { titleCase } from "@/lib/text";

const MEMBER_CELL = `${RESOURCE_CELL} text-sm`;
/** The row menu's cell, pinned to the card's right edge. */
const MENU_CELL = `${RESOURCE_MENU_CELL_NARROW} ${RESOURCE_STICKY_END} ${RESOURCE_STICKY_BODY}`;
/**
 * A row with nothing to open takes no hover fill, so it does not read as
 * clickable; its pinned menu cell drops the fill with it.
 */
const STATIC_ROW = "hover:bg-transparent";
const STATIC_MENU_CELL = `${MENU_CELL} group-hover:bg-card`;
/** The member cell's avatar and name block, 8px apart. */
const MEMBER_BLOCK = "flex min-w-0 items-center gap-2";
const NAME = "text-foreground truncate text-sm font-medium";
const SECONDARY = "text-muted-foreground block truncate text-xs";

/**
 * A project's members (#2857, root ADR 086 §6): every person and team with a
 * role on it, the role, and when it ends. A team opens to the people who hold
 * the project through it.
 *
 * The rows come from two reads (`toMemberRows`): the grants say what a person
 * or team holds and until when, and the members list says who holds the
 * project through a team, including the team that owns it.
 */
export function ProjectMembers({
  projectId,
  members,
  grants,
  viewerUserId,
  onChanged,
}: {
  projectId: string;
  members: Member[];
  grants: Grant[];
  /** The signed-in user, to mark their own row. */
  viewerUserId?: string;
  /** Called after access was removed, to reload the page's data. */
  onChanged: () => void;
}) {
  const rows = toMemberRows(members, grants, viewerUserId);
  const scroll = useScrollEdges();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    // Labelled so the section is a landmark assistive tech can jump to. The row
    // menu stays at the card's right edge while the rest scrolls under it, so
    // it is reachable on a phone.
    <section
      // Keyed on which body it holds: the scroll edges are measured on the
      // table's own container, which exists only while there are rows.
      key={rows.length === 0 ? "empty" : "rows"}
      aria-label="Members"
      ref={scroll.ref}
      data-scroll-start={scroll.edges.start || undefined}
      data-scroll-end={scroll.edges.end || undefined}
      className={`${RESOURCE_TABLE_WRAP} ${RESOURCE_TABLE_SCROLL}`}
    >
      {rows.length === 0 ? (
        // The card's empty state: 24px around the block, 16px between its
        // parts, a 16px title and a 24px glyph, and one line of guidance where
        // it fits.
        <Empty className="m-6">
          <EmptyHeader className="max-w-md gap-4">
            <EmptyMedia variant="icon" className="mb-0">
              <UserCog aria-hidden className="size-6 stroke-[1.5]" />
            </EmptyMedia>
            <EmptyTitle className="text-base leading-5">No members yet</EmptyTitle>
            <EmptyDescription className="leading-5">
              Invite a member to give them access to this project.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table className={RESOURCE_TABLE_FIXED}>
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell>Member</ResourceHeadCell>
              {/* The design's 200 and 248 of 976px, so the member column keeps the rest. */}
              <ResourceHeadCell className="w-[20%]">Role</ResourceHeadCell>
              <ResourceHeadCell className="w-[25%]">Expires at</ResourceHeadCell>
              <ResourceMenuHead narrow className={RESOURCE_STICKY_END} />
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const expandable = row.kind === "team" && row.members.length > 0;
              const expanded = expandable && open.has(row.key);
              return (
                <Fragment key={row.key}>
                  <ResourceRow
                    className={expandable ? "group" : `group ${STATIC_ROW}`}
                    onOpen={expandable ? () => toggle(row.key) : undefined}
                  >
                    <TableCell className={MEMBER_CELL}>
                      {row.kind === "user" ? (
                        <PersonBlock person={row} />
                      ) : (
                        <TeamBlock
                          name={row.name}
                          count={row.members.length}
                          expanded={expanded}
                          onToggle={() => toggle(row.key)}
                        />
                      )}
                    </TableCell>
                    <TableCell className={`${RESOURCE_CELL} ${NAME}`}>
                      {row.roles.map(titleCase).join(", ")}
                    </TableCell>
                    <TableCell className={`${RESOURCE_CELL} text-foreground text-sm`}>
                      <ExpiryCell expiry={row.expiry} />
                    </TableCell>
                    <TableCell className={expandable ? MENU_CELL : STATIC_MENU_CELL}>
                      {row.action ? (
                        <RowActions
                          projectId={projectId}
                          row={row}
                          action={row.action}
                          onRemoved={onChanged}
                        />
                      ) : (
                        <NoActionNote row={row} />
                      )}
                    </TableCell>
                  </ResourceRow>
                  {expanded &&
                    row.members.map((person) => (
                      <ResourceRow
                        key={`${row.key}:${person.userId}`}
                        className={`group ${STATIC_ROW}`}
                      >
                        <TableCell className={MEMBER_CELL}>
                          {/* Under its team: the avatar starts 24px past the team's. */}
                          <span className="flex min-w-0 items-center pl-14">
                            <PersonBlock person={person} self={person.userId === viewerUserId} />
                          </span>
                        </TableCell>
                        <TableCell className={`${RESOURCE_CELL_MUTED} font-medium`}>
                          Via team
                        </TableCell>
                        <TableCell className={RESOURCE_CELL} />
                        <TableCell className={STATIC_MENU_CELL} />
                      </ResourceRow>
                    ))}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/** Why a row has no menu, where the viewer could otherwise expect one. */
function NoActionNote({ row }: { row: MemberRow }) {
  const note = row.kind === "user" ? row.self && "You" : row.owning && "Owner";
  if (!note) return null;
  return <span className="text-muted-foreground block text-center text-xs">{note}</span>;
}

/** `self` marks the viewer under a team, where no note says so. */
function PersonBlock({ person, self = false }: { person: Person; self?: boolean }) {
  return (
    <span className={MEMBER_BLOCK}>
      <Avatar size="sm" aria-hidden>
        {/* The design's muted initials on the muted disc are 4.34:1 in light, under
            AA for 10px text, so they take the foreground. */}
        <AvatarFallback className="text-foreground">{initials(person.name)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0">
        <span className={`${NAME} block`}>
          {person.name}
          {self && " (you)"}
        </span>
        {person.secondary && <span className={SECONDARY}>{person.secondary}</span>}
      </span>
    </span>
  );
}

/**
 * A team's disclosure, avatar, name and badge. The whole row toggles it too;
 * the chevron is the control a keyboard or screen reader reaches.
 */
function TeamBlock({
  name,
  count,
  expanded,
  onToggle,
}: {
  name: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <span className={MEMBER_BLOCK}>
      {count > 0 ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} the members of ${name}`}
          onClick={onToggle}
        >
          <Chevron aria-hidden className="stroke-[1.5]" />
        </Button>
      ) : (
        // Keeps the team's avatar in line with the others.
        <span aria-hidden className="size-6 shrink-0" />
      )}
      <Avatar size="sm" aria-hidden>
        <AvatarFallback>
          <Users className="size-3 stroke-[1.5]" />
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={NAME}>{name}</span>
          <Badge variant="secondary">Team</Badge>
        </span>
        <span className={SECONDARY}>
          {count === 0 ? "No members" : `${count} ${count === 1 ? "member" : "members"}`}
        </span>
      </span>
    </span>
  );
}

function ExpiryCell({ expiry }: { expiry: Expiry }) {
  if (expiry.kind === "expired") return <StatusBadge status="expired" />;
  if (expiry.kind === "on") return formatDate(expiry.at);
  return "—";
}

/** The row's one action, as the grants it holds allow (`toMemberRows`). */
function RowActions({
  projectId,
  row,
  action,
  onRemoved,
}: {
  projectId: string;
  row: MemberRow;
  action: RowAction;
  onRemoved: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <RowMenu name={row.name} icon={EllipsisVertical} contentClassName="w-36">
        <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
          {action.kind === "remove-role" ? "Remove role" : "Remove access"}
        </DropdownMenuItem>
      </RowMenu>
      <RemoveMemberDialog
        projectId={projectId}
        row={row}
        action={action}
        open={confirming}
        onOpenChange={setConfirming}
        onRemoved={onRemoved}
      />
    </>
  );
}
