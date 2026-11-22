import { ChevronDown, ChevronRight, EllipsisVertical, Plus, UserCog, Users } from "lucide-react";
import { Fragment, useState } from "react";

import { AddAdminDialog } from "./add-admin-dialog";
import { RemoveMemberDialog } from "./remove-member-dialog";
import { CARD_ACTION_BUTTON } from "@/components/detail-page";
import {
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_MENU_CELL_NARROW,
  RESOURCE_TABLE_FIXED,
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
import { formatDate } from "@/lib/date";
import { titleCase } from "@/lib/text";

const MEMBER_CELL = `${RESOURCE_CELL} text-sm`;
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
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    // Labelled so the section is a landmark assistive tech can jump to.
    <section aria-label="Members" className={RESOURCE_TABLE_WRAP}>
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
              Invite people or add a team to give them access to this project.
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
              <ResourceMenuHead narrow />
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const expanded = row.kind === "team" && open.has(row.key);
              return (
                <Fragment key={row.key}>
                  <ResourceRow className="group">
                    <TableCell className={MEMBER_CELL}>
                      {row.kind === "user" ? (
                        <PersonBlock person={row} self={row.self} />
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
                    <TableCell className={RESOURCE_MENU_CELL_NARROW}>
                      {row.action && (
                        <RowActions
                          projectId={projectId}
                          row={row}
                          action={row.action}
                          onRemoved={onChanged}
                        />
                      )}
                    </TableCell>
                  </ResourceRow>
                  {expanded &&
                    row.members.map((person) => (
                      <ResourceRow key={`${row.key}:${person.userId}`}>
                        <TableCell className={MEMBER_CELL}>
                          {/* Under its team: the avatar starts 24px in. */}
                          <span className="flex min-w-0 items-center pl-6">
                            <PersonBlock person={person} self={person.userId === viewerUserId} />
                          </span>
                        </TableCell>
                        <TableCell className={`${RESOURCE_CELL_MUTED} font-medium`}>
                          Via team
                        </TableCell>
                        <TableCell className={RESOURCE_CELL} />
                        <TableCell className={RESOURCE_MENU_CELL_NARROW} />
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

function PersonBlock({ person, self }: { person: Person; self: boolean }) {
  return (
    <span className={MEMBER_BLOCK}>
      <Avatar size="sm" aria-hidden>
        {/* The design's muted initials on the muted disc are 4.34:1 in light, under
            AA for 10px text, so they take the foreground. */}
        <AvatarFallback className="text-foreground text-[10px]!">
          {initials(person.name)}
        </AvatarFallback>
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

/** A team's name, its badge and the disclosure that lists its people. */
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
      <Avatar size="sm" aria-hidden>
        <AvatarFallback>
          <Users className="size-3 stroke-[1.5]" />
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={NAME}>{name}</span>
          <Badge variant="secondary">Team</Badge>
          {count > 0 && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-4 rounded-sm"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Hide" : "Show"} the members of ${name}`}
              onClick={onToggle}
            >
              <Chevron aria-hidden className="stroke-[1.5]" />
            </Button>
          )}
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

/**
 * The page's one action, drawn on its heading's row rather than in the table:
 * the secondary small button the design placed beside the tabs.
 */
export function AddAdminButton({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  return (
    <AddAdminDialog projectId={projectId} onAdded={onAdded}>
      <Button variant="secondary" size="sm" className={CARD_ACTION_BUTTON}>
        <Plus aria-hidden />
        Add admin
      </Button>
    </AddAdminDialog>
  );
}
