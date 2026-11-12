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
    hint: "Find one with `zitadel invitation list --status pending`.",
    next: ["invitation list --status pending"],
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
  hint: "Pass its id; find one with `zitadel invitation list --status pending`.",
  next: ["invitation list --status pending"],
};

/** How a cancel of an invitation that has already finished is refused. */
const NOT_PENDING_REFUSAL: Refusal = {
  message: "{id} is {status}, so there is nothing to cancel",
  hint: "Only a pending invitation can be cancelled.",
  next: ["invitation list --status pending"],
};

/** How a bare cancel is refused when the project has no invitation left to cancel. */
const NOTHING_PENDING_REFUSAL: Refusal = {
  message: "The project has no pending invitations",
  hint: "Only a pending invitation can be cancelled.",
  next: ["invitation list"],
};

/**
 * `zitadel invitation cancel [invitation_id]` — cancel a pending invitation,
 * so its link can no longer be redeemed. Without an id it offers the pending
 * invitations to pick from.
 */
export default class InvitationCancel extends Destructive(EnvironmentCommand) {
  static override description = "Cancel a pending invitation so its link stops working.";
  static override group = CommandGroups.projectAdministration;
  static override groupOrder = 4;
  static override examples = [
    "<%= config.bin %> invitation cancel",
    "<%= config.bin %> invitation cancel inv_01JCQK5R7T9V1X3Z5B7D9F1H3J",
    "<%= config.bin %> invitation cancel inv_01JCQK5R7T9V1X3Z5B7D9F1H3J --force",
  ];
  static override args = {
    invitation_id: Args.custom<string>({ parse: taken(INVITATION_ID) })({
      description: "The invitation to cancel. Omit it to pick one of the pending invitations.",
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
      throw refusalError(NO_ID_REFUSAL, {}, (command) => {
        return this.suggest(command);
      });
    }
    const target = args.invitationId ?? (await this.pickPending());
    const invitationId = typeof target === "string" ? target : target.id;

    return this.emit(
      await this.confirmed({
        verb: "cancel",
        name: `cancel ${invitationId}`,
        message: ({ invitation }) => {
          return `Cancel ${describe(invitation)} so its link stops working?`;
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
              ? await this.readPending(
                  new InvitationService(connection.client, connection.projectId),
                  target,
                )
              : target;
          return { ...connection, invitation };
        },
        apply: async (consent, { client, projectId, invitation }) => {
          const unlocked = new InvitationService(consent.unlock(client), projectId);
          await unlocked.cancel(invitation.id);
          this.trackEvent(INVITATION_CANCELLED, {
            role: invitationGrant(invitation),
            invitation_journey_id: invitation.journey_id,
          });
          const title = `Cancelled ${escapeControlCharacters(invitation.id)}; its link no longer works`;
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
   * The pending invitation a person picks when the command line named none.
   * A script is told to name one instead.
   */
  private async pickPending(): Promise<Invitation> {
    const { client, projectId } = await this.connect();
    const pending = await new InvitationService(client, projectId).pending();
    if (pending.length === 0) {
      throw refusalError(NOTHING_PENDING_REFUSAL, {}, (command) => {
        return this.suggest(command);
      });
    }
    return this.ask.select({
      name: "invitation id",
      message: "Which invitation would you like to cancel?",
      retry: this.suggest("invitation list --status pending"),
      options: pending.map((invitation) => ({
        value: invitation,
        label: invitation.id,
        hint: pendingHint(invitation),
      })),
    });
  }

  /**
   * The invitation the command line named, read before anyone is asked, so
   * the question can name it and one that is no longer pending is refused:
   * the server answers that cancel with the same 404 as a miss.
   */
  private async readPending(
    invitationService: InvitationService,
    invitationId: string,
  ): Promise<Invitation> {
    const invitation = await invitationService.get(invitationId);
    if (invitation.status !== "pending") {
      throw refusalError(
        NOT_PENDING_REFUSAL,
        {
          id: invitation.id,
          status: invitation.status,
        },
        (command) => {
          return this.suggest(command);
        },
      );
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

/** Who a pending invitation is for and when it expires, beside its id in the picker. */
function pendingHint(invitation: Invitation): string {
  const whom = invitation.metadata?.name;
  // The name is whatever an administrator typed; the picker draws hints as given.
  return escapeControlCharacters(
    `${whom === undefined ? "" : `${whom}, `}expires ${invitation.expires_at}`,
  );
}
