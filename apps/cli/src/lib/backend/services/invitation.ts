import type {
  CreateInvitation201,
  GetInvitation200,
  ListInvitationsParams,
} from "@zitadel/api/generated/model";
import { pagedFunctions, type ZitadelClient } from "@/lib/backend/client";
import { ApiService, type Page, type PageOptions } from "@/lib/backend/api-service";
import { Paging } from "@zitadel/api/runtime/paging";

/** One invitation as the API reports it, without the link only a create returns. */
export type Invitation = Readonly<GetInvitation200>;

/** An invitation a create or replace just made, with the one-shot link to share. */
export type CreatedInvitation = Readonly<CreateInvitation201>;

/** The lifecycle states an invitation can be in. */
export type InvitationStatus = Invitation["status"];

/** The kinds of invitation the API declares. */
export type InvitationType = Invitation["type"];

/** The project role a `project_member` invitation grants. */
export type InvitationRelation = Extract<
  Invitation,
  { type: "project_member" }
>["project_member"]["relation"];

/** What {@link InvitationService.create} makes. */
export type InvitationInput = Readonly<{
  relation: InvitationRelation;
  name?: string;
  replaces?: string;
}>;

/** The filters, page size and cursor {@link InvitationService.page} takes. */
export type InvitationPageQuery = Omit<ListInvitationsParams, "project_id">;

/**
 * The role an invitation grants, in one word: the project relation, or the
 * team role for a team invitation.
 *
 * @param invitation - The invitation.
 * @returns The role.
 */
export function invitationRole(invitation: Invitation): string {
  return invitation.type === "project_member"
    ? invitation.project_member.relation
    : invitation.team_member.role;
}

/**
 * What the invitation grants, its type and role in one word: `project_viewer`,
 * `project_editor`, `project_admin`, or `team_member`.
 *
 * @param invitation - The invitation.
 * @returns The type and role combined.
 */
export function invitationGrant(invitation: Invitation): string {
  return invitation.type === "project_member"
    ? `project_${invitation.project_member.relation}`
    : "team_member";
}

/** The invitations of one project: create or replace, list, read and cancel (ADR 086). */
export class InvitationService extends ApiService {
  private readonly projectId: string;

  /**
   * Bind the service to a client and a project.
   *
   * @param client - The client every call goes through.
   * @param projectId - The project the invitations belong to.
   */
  constructor(client: ZitadelClient, projectId: string) {
    super(client);
    this.projectId = projectId;
  }

  /**
   * Invite someone into the project, or replace an invitation with a new one
   * that keeps its journey.
   *
   * @param input - The role, who it is for, and the invitation it replaces.
   * @returns The invitation and its link, which no later read returns.
   */
  async create(input: InvitationInput): Promise<CreatedInvitation> {
    return this.client.createInvitation(
      {
        type: "project_member",
        project_member: {
          relation: input.relation,
        },
        ...(input.name === undefined ? {} : { metadata: { name: input.name } }),
        ...(input.replaces === undefined ? {} : { replaces_invitation_id: input.replaces }),
      },
      {
        project_id: this.projectId,
      },
    );
  }

  /**
   * List the project's invitations, newest first, a page at a time.
   *
   * @param query - The filters, the page size and the cursor to continue from.
   * @param options - `all` to drain every page instead of reading one.
   * @returns The items read, and the cursor to the next page when one remains.
   */
  async page(
    query: InvitationPageQuery = {},
    options: PageOptions = {},
  ): Promise<Page<Invitation>> {
    const paging = new Paging(pagedFunctions.listInvitations);
    const pages = this.client.listInvitations.pages({
      project_id: this.projectId,
      ...query,
    });
    return paging.collect(pages, {
      all: options.all === true,
    });
  }

  /**
   * Every invitation a cancel accepts, pending or declined, for a person to
   * pick one from.
   *
   * @returns The cancellable invitations, newest first.
   */
  async cancellable(): Promise<readonly Invitation[]> {
    return this.client.listInvitations.all({
      project_id: this.projectId,
      status: ["pending", "rejected"],
    });
  }

  /**
   * Read one invitation.
   *
   * @param invitationId - The invitation to read.
   * @returns The invitation, without its link.
   */
  async get(invitationId: string): Promise<Invitation> {
    return this.client.getInvitation(invitationId, {
      project_id: this.projectId,
    });
  }

  /**
   * Cancel a pending invitation, so its link can no longer be redeemed.
   *
   * @param invitationId - The invitation to cancel.
   */
  async cancel(invitationId: string): Promise<void> {
    await this.client.cancelInvitation(invitationId, {
      project_id: this.projectId,
    });
  }
}
