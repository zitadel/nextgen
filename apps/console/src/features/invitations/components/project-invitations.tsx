import { Check, Clock3, Plus, User, UserCog, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { trackEvent } from "@/addon/analytics";
import { api } from "@/api/zitadel";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
  RowMenu,
} from "@/components/resource-list";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
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
import { LIST_PAGE_SIZE } from "@/lib/paging";

import {
  analyticsRole,
  describeExpiry,
  effectiveStatus,
  type Invitation,
  type InvitationStatus,
  inviterLabel,
  roleLabel,
} from "../model";
import { type CreatedInvitation, InvitationCreatedDialog } from "./invitation-created";
import { InviteMemberDialog } from "./invite-member-dialog";

/** The first page of a project's invitations, or why it could not be read. */
export type InvitationsRead =
  | { invitations: Invitation[]; nextPageToken?: string }
  | { error: string };

/**
 * The statuses the tab lists. An accepted invitation is left out: the person
 * it brought in is a row of the Members tab, and the server has erased the
 * name the link carried (root ADR 086, amendment of 2026-11-13).
 */
const LISTED: Invitation["status"][] = ["pending", "expired", "rejected"];

/**
 * `GET /invitations`: one page, newest first, of the links still worth a row,
 * each with the person who made it.
 */
export async function readInvitations(
  projectId: string,
  pageToken?: string,
): Promise<{ invitations: Invitation[]; nextPageToken?: string }> {
  const page = await api.listInvitations({
    project_id: projectId,
    limit: LIST_PAGE_SIZE,
    status: LISTED,
    expand: ["inviter"],
    ...(pageToken ? { page_token: pageToken } : {}),
  });
  return { invitations: page.invitations, nextPageToken: page.next_page_token ?? undefined };
}

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

/** The words of deleting an invitation, which differ by what is being deleted. */
interface Removal {
  action: string;
  title: string;
  description: string;
  fallback: string;
  done: string;
}

/** What a row's menu offers. */
interface RowActions {
  /** Regenerate link: a new link for the same person and role. */
  regenerate: boolean;
  /** How the row is deleted, where the server deletes its status. */
  removal?: Removal;
  /** Whether deleting it ends a link that still worked. */
  cancels?: boolean;
}

/**
 * The menu by status. A pending link is cancelled: it stops working. An
 * expired or a declined one already has, so deleting it is `Remove` and only
 * takes the row and the name on it out of the list. An accepted invitation is
 * final and has no menu: `DELETE /invitations/{invitation_id}` answers it
 * with the opaque `404`.
 */
const ACTIONS: Partial<Record<InvitationStatus, RowActions>> = {
  pending: {
    regenerate: true,
    cancels: true,
    removal: {
      action: "Cancel invitation",
      title: "Cancel invitation?",
      description: "This invitation link will stop working.",
      fallback: "Could not cancel the invitation. Try again.",
      done: "Invitation cancelled",
    },
  },
  expired: {
    regenerate: true,
    removal: {
      action: "Remove invitation",
      title: "Remove expired invitation?",
      description: "The link has expired. Removing the invitation takes it off this list.",
      fallback: "Could not remove the invitation. Try again.",
      done: "Invitation removed",
    },
  },
  rejected: {
    regenerate: false,
    removal: {
      action: "Remove invitation",
      title: "Remove declined invitation?",
      description: "The invitation was declined. Removing it takes it off this list.",
      fallback: "Could not remove the invitation. Try again.",
      done: "Invitation removed",
    },
  },
};

function InvitationActions({
  projectId,
  invitation,
  name,
  actions,
  onCancelled,
  onReplaced,
}: {
  projectId: string;
  invitation: Invitation;
  name: string;
  actions: RowActions;
  onCancelled: () => void;
  onReplaced: (created: CreatedInvitation) => void;
}) {
  const { regenerate, removal, cancels } = actions;
  const [dialog, setDialog] = useState<"regenerate" | "cancel" | undefined>(undefined);
  const close = (open: boolean) => {
    if (!open) setDialog(undefined);
  };

  return (
    <>
      <RowMenu name={name} contentClassName="w-50">
        {regenerate && (
          <DropdownMenuItem onSelect={() => setDialog("regenerate")}>
            Regenerate link
          </DropdownMenuItem>
        )}
        {regenerate && removal && <DropdownMenuSeparator />}
        {removal && (
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog("cancel")}>
            {removal.action}
          </DropdownMenuItem>
        )}
      </RowMenu>

      <ConfirmDialog
        open={dialog === "regenerate"}
        onOpenChange={close}
        variant="default"
        title="Regenerate invitation link?"
        description={
          cancels
            ? "The current link will stop working. The new link will be shown only once and expires in 72 hours."
            : "The new link will be shown only once and expires in 72 hours."
        }
        action="Regenerate link"
        fallback="Could not regenerate the link. Try again."
        onConfirm={async () => {
          // Only project invitations can be made here; a team invitation's row
          // has no menu until its type ships (root ADR 086 §1).
          if (invitation.type !== "project_member") return;
          const { relation } = invitation.project_member;
          const replacement = await api.createInvitation(
            {
              type: "project_member",
              project_member: { relation },
              ...(invitation.metadata ? { metadata: { name: invitation.metadata.name } } : {}),
              replaces_invitation_id: invitation.id,
            },
            { project_id: projectId },
          );
          trackEvent("invitation_created", {
            role: analyticsRole(replacement),
            invitation_journey_id: replacement.journey_id,
          });
          onReplaced({ relation, link: replacement.link });
        }}
      />

      {removal && (
        <ConfirmDialog
          open={dialog === "cancel"}
          onOpenChange={close}
          title={removal.title}
          description={removal.description}
          cancel="Keep invitation"
          action={removal.action}
          fallback={removal.fallback}
          onConfirm={async () => {
            await api.cancelInvitation(invitation.id, { project_id: projectId });
            // Only a link that still worked was cancelled; the rest were
            // already dead and removing them is housekeeping.
            if (cancels) {
              trackEvent("invitation_cancelled", {
                role: analyticsRole(invitation),
                invitation_journey_id: invitation.journey_id,
              });
            }
            toast.success(removal.done);
            onCancelled();
          }}
        />
      )}
    </>
  );
}
