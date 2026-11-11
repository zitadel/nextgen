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
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { useLoadMore } from "@/hooks/use-load-more";
import { LIST_PAGE_SIZE } from "@/lib/paging";

import {
  analyticsRole,
  describeExpiry,
  effectiveStatus,
  type Invitation,
  type InvitationStatus,
  roleLabel,
} from "../model";
import { type CreatedInvitation, InvitationCreatedDialog } from "./invitation-created";
import { InviteMemberDialog } from "./invite-member-dialog";

/** The first page of a project's invitations, or why it could not be read. */
export type InvitationsRead =
  | { invitations: Invitation[]; nextPageToken?: string }
  | { error: string };

/**
 * `GET /invitations`: one page, newest first, in any status. The page it is
 * read for carries more than invitations, so a failed read costs the tab its
 * table rather than the page everything else on it.
 */
export async function readInvitations(
  projectId: string,
  pageToken?: string,
): Promise<{ invitations: Invitation[]; nextPageToken?: string }> {
  const page = await api.listInvitations({
    project_id: projectId,
    limit: LIST_PAGE_SIZE,
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
 * **Actions follow the lifecycle.** A pending link can be cancelled or
 * replaced; an expired one only replaced, since `DELETE /invitations/{id}`
 * removes pending rows alone and the server keeps expired ones until its own
 * cleanup. Accepted and declined are final and carry no menu. The design draws
 * `Cancel invitation` on an expired row too, with a `Remove expired
 * invitation?` confirmation; it returns with an endpoint that removes one.
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
              <UserCog aria-hidden strokeWidth={1.5} />
            </EmptyMedia>
            <EmptyTitle>No invitations yet</EmptyTitle>
            <EmptyDescription>Create a link to invite someone to this project.</EmptyDescription>
            <InviteMemberDialog
              projectId={projectId}
              projectName={projectName}
              onInvited={onChanged}
            >
              <Button size="sm" className="px-2.5 text-xs">
                Invite member
              </Button>
            </InviteMemberDialog>
          </EmptyHeader>
        </Empty>
      </Card>
    );
  }

  return (
    <>
      <div className={RESOURCE_TABLE_WRAP}>
        <Table className={RESOURCE_TABLE_FIXED}>
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell>Name</ResourceHeadCell>
              <ResourceHeadCell className="w-40">Role</ResourceHeadCell>
              <ResourceHeadCell className="w-72">Status</ResourceHeadCell>
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

/** The tab's one action, drawn on the tab row beside the tabs. */
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
      <TableCell className={RESOURCE_CELL}>
        <span className="flex items-center gap-2">
          <InvitationStatusBadge status={status} />
          {status === "pending" && (
            <span className="text-muted-foreground truncate text-xs leading-4">
              {describeExpiry(invitation.expires_at)}
            </span>
          )}
        </span>
      </TableCell>
      <TableCell className={RESOURCE_CELL}>
        {(status === "pending" || status === "expired") && (
          <InvitationActions
            projectId={projectId}
            invitation={invitation}
            name={name}
            cancellable={status === "pending"}
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

function InvitationActions({
  projectId,
  invitation,
  name,
  cancellable,
  onCancelled,
  onReplaced,
}: {
  projectId: string;
  invitation: Invitation;
  name: string;
  /** Only a pending invitation can be cancelled. */
  cancellable: boolean;
  onCancelled: () => void;
  onReplaced: (created: CreatedInvitation) => void;
}) {
  const [dialog, setDialog] = useState<"regenerate" | "cancel" | undefined>(undefined);
  const close = (open: boolean) => {
    if (!open) setDialog(undefined);
  };

  return (
    <>
      <RowMenu name={name} contentClassName="w-50">
        <DropdownMenuItem onSelect={() => setDialog("regenerate")}>
          Regenerate link
        </DropdownMenuItem>
        {cancellable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDialog("cancel")}>
              Cancel invitation
            </DropdownMenuItem>
          </>
        )}
      </RowMenu>

      <ConfirmDialog
        open={dialog === "regenerate"}
        onOpenChange={close}
        variant="default"
        title="Regenerate invitation link?"
        description={
          cancellable
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

      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={close}
        title="Cancel invitation?"
        description="This invitation link will stop working."
        cancel="Keep invitation"
        action="Cancel invitation"
        fallback="Could not cancel the invitation. Try again."
        onConfirm={async () => {
          await api.cancelInvitation(invitation.id, { project_id: projectId });
          toast.success("Invitation cancelled");
          onCancelled();
        }}
      />
    </>
  );
}
