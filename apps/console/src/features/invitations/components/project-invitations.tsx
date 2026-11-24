import { Check, Clock3, Plus, User, UserCog, X } from "lucide-react";
import { useState } from "react";

import { CARD_ACTION_BUTTON } from "@/components/detail-page";
import { FormError } from "@/components/form-error";
import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_TABLE_FIXED,
  RESOURCE_TABLE_WRAP,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceMenuHead,
  ResourceRow,
} from "@/components/resource-list";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { useLoadMore } from "@/hooks/use-load-more";
import { formatDate } from "@/lib/date";

import { type InvitationsRead, readInvitations } from "../api";
import {
  type CreatedInvitation,
  describeExpiry,
  effectiveStatus,
  type Invitation,
  type InvitationStatus,
  inviterLabel,
  roleLabel,
} from "../model";
import { ACTIONS, InvitationActions } from "./invitation-actions";
import { InvitationCreatedDialog } from "./invitation-created";
import { InviteMemberDialog } from "./invite-member-dialog";

/**
 * A project's invitations (root ADR 086 §6, #2855): every link an
 * administrator made, newest first, with what it grants and where it stands.
 * It is a table of its own, apart from the members: an invitation names no
 * account until somebody accepts it.
 *
 * **The name is a note, not a person.** It is what the administrator typed
 * when creating the link, and the server erases it once the invitation is
 * accepted or declined. A row without one is `Unnamed invitation`.
 *
 * **Actions follow the status** (`ACTIONS`). A pending link can be replaced or
 * cancelled. An expired one can be replaced or removed, as `Remove` rather
 * than `Cancel` since its link is already dead. A declined one can only be
 * removed: the person said no, so there is no link to make again.
 *
 * **Replacing shows a link again.** A replace is a create
 * (`replaces_invitation_id`), so its response is the second and last time a
 * link for this person is shown, in the same dialog a fresh invitation ends
 * in.
 */
export function ProjectInvitations({
  projectId,
  projectName,
  read,
  onChanged,
}: {
  projectId: string;
  projectName: string;
  read: InvitationsRead;
  /** Called after an invitation was created, replaced or cancelled, to reload. */
  onChanged: () => void;
}) {
  return (
    // Labelled so the section is a landmark assistive tech can jump to.
    <section aria-label="Invitations" className="flex flex-col">
      {"error" in read ? (
        <FormError message={read.error} />
      ) : (
        <InvitationsTable
          projectId={projectId}
          projectName={projectName}
          loaded={read}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}

function InvitationsTable({
  projectId,
  projectName,
  loaded,
  onChanged,
}: {
  projectId: string;
  projectName: string;
  loaded: { invitations: Invitation[]; nextPageToken?: string };
  onChanged: () => void;
}) {
  const paging = useLoadMore(
    loaded,
    async (pageToken) => {
      const page = await readInvitations(projectId, pageToken);
      return { items: page.invitations, nextPageToken: page.nextPageToken };
    },
    "Could not load more invitations.",
  );
  const invitations = [...loaded.invitations, ...(paging.extra as Invitation[])];
  // The replacement's link, held here: the row it came from is gone by the
  // time the list reloads.
  const [replaced, setReplaced] = useState<CreatedInvitation | undefined>(undefined);

  if (invitations.length === 0) {
    return (
      <Card className="items-center gap-0 p-6">
        <Empty className="w-full">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserCog aria-hidden className="stroke-[1.5]" />
            </EmptyMedia>
            <EmptyTitle>No invitations yet</EmptyTitle>
            <EmptyDescription>Create a link to invite someone to this project.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <InviteMemberDialog
              projectId={projectId}
              projectName={projectName}
              onInvited={onChanged}
            >
              <Button size="sm" className="px-2.5 text-xs">
                Invite member
              </Button>
            </InviteMemberDialog>
          </EmptyContent>
        </Empty>
      </Card>
    );
  }

  return (
    <>
      <div className={RESOURCE_TABLE_WRAP}>
        {/* Wider than the shared minimum: the fixed columns alone are 668px,
            so at 36rem the name column had no width left and its text ran
            under Role. This leaves it 196px before the card scrolls. */}
        <Table className={`${RESOURCE_TABLE_FIXED} min-w-[54rem]`}>
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell>Name</ResourceHeadCell>
              <ResourceHeadCell className="w-32">Role</ResourceHeadCell>
              <ResourceHeadCell className="w-56">Invited by</ResourceHeadCell>
              <ResourceHeadCell className="w-64">Status</ResourceHeadCell>
              <ResourceMenuHead className="w-15" />
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                projectId={projectId}
                invitation={invitation}
                onCancelled={onChanged}
                onReplaced={setReplaced}
              />
            ))}
          </TableBody>
        </Table>
      </div>
      <LoadMore paging={paging} />

      <InvitationCreatedDialog
        projectName={projectName}
        created={replaced}
        onClose={() => {
          setReplaced(undefined);
          onChanged();
        }}
      />
    </>
  );
}

/** Invite member, drawn on the tabs' row of the Members page. */
export function InviteMemberButton({
  projectId,
  projectName,
  onInvited,
}: {
  projectId: string;
  projectName: string;
  onInvited: () => void;
}) {
  return (
    <InviteMemberDialog projectId={projectId} projectName={projectName} onInvited={onInvited}>
      <Button variant="secondary" size="sm" className={CARD_ACTION_BUTTON}>
        <Plus aria-hidden />
        Invite member
      </Button>
    </InviteMemberDialog>
  );
}

function InvitationRow({
  projectId,
  invitation,
  onCancelled,
  onReplaced,
}: {
  projectId: string;
  invitation: Invitation;
  onCancelled: () => void;
  onReplaced: (created: CreatedInvitation) => void;
}) {
  const status = effectiveStatus(invitation);
  const name = invitation.metadata?.name ?? "Unnamed invitation";
  const actions = ACTIONS[status];
  // What stands beside the badge: when a pending link runs out, or when a
  // declined one was answered.
  const detail =
    status === "pending"
      ? describeExpiry(invitation.expires_at)
      : status === "rejected" && invitation.responded_at
        ? formatDate(invitation.responded_at)
        : undefined;

  return (
    <ResourceRow>
      <TableCell className={RESOURCE_CELL}>
        <span className="flex min-w-0 items-center gap-2">
          <Avatar size="sm">
            <AvatarFallback>
              <User aria-hidden className="size-3" strokeWidth={1.5} />
            </AvatarFallback>
          </Avatar>
          <span className="text-muted-foreground truncate text-xs leading-4">{name}</span>
        </span>
      </TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>{roleLabel(invitation)}</TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>
        {/* A project secret made the link: there is nobody to name. */}
        <span className="block truncate">{inviterLabel(invitation) ?? "—"}</span>
      </TableCell>
      <TableCell className={RESOURCE_CELL}>
        <span className="flex items-center gap-2">
          <InvitationStatusBadge status={status} />
          {detail && (
            <span className="text-muted-foreground truncate text-xs leading-4">{detail}</span>
          )}
        </span>
      </TableCell>
      <TableCell className={RESOURCE_CELL}>
        {actions && (
          <InvitationActions
            projectId={projectId}
            invitation={invitation}
            name={name}
            actions={actions}
            onCancelled={onCancelled}
            onReplaced={onReplaced}
          />
        )}
      </TableCell>
    </ResourceRow>
  );
}

/**
 * The status pill: the design system's secondary `Badge` with its left icon.
 * The design draws `Pending` and `Expired`; the two final states the list also
 * returns take the same pill. `rejected` reads `Declined`, the word the
 * invitation page uses for it.
 */
const STATUS: Record<InvitationStatus, { label: string; icon: typeof Clock3; tone?: string }> = {
  pending: { label: "Pending", icon: Clock3 },
  expired: { label: "Expired", icon: Clock3, tone: "text-destructive" },
  accepted: { label: "Accepted", icon: Check, tone: "text-success" },
  rejected: { label: "Declined", icon: X },
};

function InvitationStatusBadge({ status }: { status: InvitationStatus }) {
  const { label, icon: Icon, tone } = STATUS[status];
  return (
    <Badge variant="secondary">
      <Icon aria-hidden className={tone} strokeWidth={1.5} />
      {label}
    </Badge>
  );
}
