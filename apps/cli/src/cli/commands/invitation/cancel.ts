import { Args, Flags } from "@oclif/core";
import { z } from "zod";

import { type Invitation, InvitationService, invitationGrant, invitationRole } from "@/lib/backend";
import { GetInvitationParams } from "@/lib/backend/schemas";
import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { dryRunResult } from "@/lib/oclif/crud/shared";
import { Destructive } from "@/lib/oclif/destructive";
import { deletedData } from "@/lib/oclif/envelope";
import { type Refused, taken } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { escapeControlCharacters } from "@/lib/terminal-text";

/** The invitation `invitation cancel` cancels, as the API spells an invitation id. */
const INVITATION_ID: Refused<string> = {
  schema: z.string().trim().pipe(GetInvitationParams.shape.id),
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Find one with `zitadel invitation list --status pending --status rejected`.",
    next: [{ id: "invitation:list", flags: { status: ["pending", "rejected"] } }],
    details: {
      argument: "{input}",
    },
  },
};

/** The product event a cancel sends once the API confirms it (ADR 086, amended). */
const INVITATION_CANCELLED = "invitation_cancelled";

/**
 * How a bare cancel is refused when it cannot pick: a dry run must not read the
 * server, and a run with nobody to ask would read it only to refuse.
 */
const NO_ID_REFUSAL: Refusal = {
  message: "Name the invitation to cancel",
  hint: "Pass its id; find one with `zitadel invitation list --status pending --status rejected`.",
  next: [{ id: "invitation:list", flags: { status: ["pending", "rejected"] } }],
};

/** How a cancel of an invitation that has already finished is refused. */
const NOT_CANCELLABLE_REFUSAL: Refusal = {
  message: "{id} is {status}, so there is nothing to cancel",
  hint: "Only a pending or declined invitation can be cancelled.",
  next: [{ id: "invitation:list", flags: { status: ["pending", "rejected"] } }],
};

/** How a bare cancel is refused when the project has no invitation left to cancel. */
const NOTHING_CANCELLABLE_REFUSAL: Refusal = {
  message: "The project has no pending or declined invitations",
  hint: "Only a pending or declined invitation can be cancelled.",
  next: [{ id: "invitation:list" }],
};

/**
 * `zitadel invitation cancel [invitation_id]` — cancel a pending invitation,
 * so its link can no longer be redeemed, or remove a declined one. Without an
 * id it offers the pending and declined
 * invitations to pick from.
 */
export default class InvitationCancel extends Destructive(EnvironmentCommand) {
  static override description =
    "Cancel a pending invitation so its link stops working, or remove a declined one.";
  static override group = CommandGroups.projectAdministration;
  static override groupOrder = 4;
  static override examples = [
    "<%= config.bin %> invitation cancel",
    "<%= config.bin %> invitation cancel inv_01JCQK5R7T9V1X3Z5B7D9F1H3J",
    "<%= config.bin %> invitation cancel inv_01JCQK5R7T9V1X3Z5B7D9F1H3J --force",
  ];
  static override args = {
    invitation_id: Args.custom<string>({ parse: taken(INVITATION_ID) })({
      description: "The invitation to cancel. Omit it to pick a pending or declined one.",
    }),
  };
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description:
        "Cancel the invitation without the confirmation prompt. Required when non-interactive.",
    }),
  };

  protected async execute({ args }: Admitted<typeof InvitationCancel>): Promise<JsonEnvelope> {
    if (args.invitationId === undefined && (this.dryRun || this.nonInteractive)) {
      throw refusalError(NO_ID_REFUSAL, {});
    }
    const target = args.invitationId ?? (await this.pickCancellable());
    const invitationId = typeof target === "string" ? target : target.id;

    return this.emit(
      await this.confirmed({
        verb: "cancel",
        name: `cancel ${invitationId}`,
        message: ({ invitation }) => {
          return invitation.status === "pending"
            ? `Cancel ${describe(invitation)} so its link stops working?`
            : `Cancel ${describe(invitation)} and remove its record?`;
        },
        // A bare cancel picked its invitation, which a retry must name.
        arguments: [invitationId],
        preview: async () => {
          return dryRunResult({
            verb: "cancel",
            topic: "invitation",
            id: invitationId,
            next: await this.realRun(),
          });
        },
        // A dry run stops before this, so it needs no connection: the read
        // that names a named invitation in the question happens here.
        prepare: async () => {
          const connection = await this.connect();
          const invitation =
            typeof target === "string"
              ? await this.readCancellable(
                  new InvitationService(connection.client, connection.projectId),
                  target,
                )
              : target;
          return { ...connection, invitation };
        },
        apply: async (consent, { client, projectId, invitation }) => {
          const unlocked = new InvitationService(consent.unlock(client), projectId);
          await unlocked.cancel(invitation.id);
          // A declined journey already ended with invitation_rejected.
          if (invitation.status === "pending") {
            this.trackEvent(INVITATION_CANCELLED, {
              role: invitationGrant(invitation),
              invitation_journey_id: invitation.journey_id,
            });
          }
          const id = escapeControlCharacters(invitation.id);
          const title =
            invitation.status === "pending"
              ? `Cancelled ${id}; its link no longer works`
              : `Cancelled ${id}; its record is removed`;
          return {
            status: "ok",
            data: deletedData({ title, id: invitation.id }),
            summary: {
              title,
              sections: [],
            },
          };
        },
      }),
    );
  }

  /**
   * The pending or declined invitation a person picks when the command line
   * named none.
   * A script is told to name one instead.
   */
  private async pickCancellable(): Promise<Invitation> {
    const { client, projectId } = await this.connect();
    const cancellable = await new InvitationService(client, projectId).cancellable();
    if (cancellable.length === 0) {
      throw refusalError(NOTHING_CANCELLABLE_REFUSAL, {});
    }
    return this.ask.select({
      name: "invitation id",
      message: "Which invitation would you like to cancel?",
      retry: this.suggest({ id: "invitation:list", flags: { status: ["pending", "rejected"] } }),
      options: cancellable.map((invitation) => ({
        value: invitation,
        label: invitation.id,
        hint: cancellableHint(invitation),
      })),
    });
  }

  /**
   * The invitation the command line named, read before anyone is asked, so
   * the question can name it and one a cancel cannot delete is refused:
   * the server answers that cancel with the same 404 as a miss.
   */
  private async readCancellable(
    invitationService: InvitationService,
    invitationId: string,
  ): Promise<Invitation> {
    const invitation = await invitationService.get(invitationId);
    if (invitation.status !== "pending" && invitation.status !== "rejected") {
      throw refusalError(NOT_CANCELLABLE_REFUSAL, {
        id: invitation.id,
        status: invitation.status,
      });
    }
    return invitation;
  }
}

/** The invitation as the question names it: its id, who it is for, and the role. */
function describe(invitation: Invitation): string {
  const whom = invitation.metadata?.name;
  const role = invitationRole(invitation);
  return whom === undefined
    ? `${invitation.id} (${role})`
    : `${invitation.id} for ${whom} (${role})`;
}

/** Who an invitation is for and where it stands, beside its id in the picker. */
function cancellableHint(invitation: Invitation): string {
  const whom = invitation.metadata?.name;
  // The name is whatever an administrator typed; the picker draws hints as given.
  return escapeControlCharacters(
    `${whom === undefined ? "" : `${whom}, `}${
      invitation.status === "pending" ? `expires ${invitation.expires_at}` : "declined"
    }`,
  );
}
