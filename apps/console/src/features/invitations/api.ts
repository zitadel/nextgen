import { trackEvent } from "@/addon/analytics";
import { api } from "@/api/zitadel";
import { describeError } from "@/lib/api-error";
import { LIST_PAGE_SIZE } from "@/lib/paging";

import {
  analyticsRole,
  type CreatedInvitation,
  type Invitation,
  type InvitationPageState,
  isInvitationGone,
  isOpen,
  type ProjectRelation,
} from "./model";
import { clearInvitationToken, readInvitationToken } from "./token";

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
 * `POST /invitations` for a project role, and the event that reports it. A
 * replacement (`replaces`) is a create too: the server deletes the invitation
 * it names and this response is the only time the new link exists.
 */
export async function createProjectInvitation(
  projectId: string,
  invitation: {
    relation: ProjectRelation;
    /** Who the link is for, as a note to the administrators. */
    name?: string;
    /** The invitation this one replaces. */
    replaces?: string;
  },
): Promise<CreatedInvitation> {
  const { relation, name, replaces } = invitation;
  const created = await api.createInvitation(
    {
      type: "project_member",
      project_member: { relation },
      ...(name ? { metadata: { name } } : {}),
      ...(replaces ? { replaces_invitation_id: replaces } : {}),
    },
    { project_id: projectId },
  );
  trackEvent("invitation_created", {
    role: analyticsRole(created),
    invitation_journey_id: created.journey_id,
  });
  return { relation, link: created.link };
}

/**
 * What the invitation page shows for the token the link left in storage. It
 * only looks the invitation up, which is a read, so running it again can never
 * spend the link. A token the server no longer knows is cleared; a failure of
 * any other kind keeps it for a retry.
 */
export async function lookupStoredInvitation(): Promise<InvitationPageState> {
  const token = readInvitationToken();
  if (!token) return { kind: "unavailable" };
  try {
    const invitation = await api.lookupInvitation({ token });
    if (isOpen(invitation)) return { kind: "open", token, invitation };
  } catch (cause) {
    if (!isInvitationGone(cause)) {
      return {
        kind: "error",
        message: describeError(cause, "The invitation could not be loaded. Try again."),
      };
    }
  }
  // Unknown to the server, or finished: the token is of no further use.
  clearInvitationToken();
  return { kind: "unavailable" };
}
