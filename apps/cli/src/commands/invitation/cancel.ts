import { Args, Flags } from "@oclif/core";
import { z } from "zod";

import { type Invitation, InvitationService } from "@/lib/backend";
import { GetInvitationParams } from "@/lib/backend/schemas";
import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { dryRunResult } from "@/lib/oclif/crud/shared";
import { Destructive } from "@/lib/oclif/destructive";
import { deletedData } from "@/lib/oclif/envelope";
import { type Refused, taken } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { prose } from "@/lib/oclif/rendering";

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
    const invitationId = args.invitationId ?? (await this.pickPending());

    return this.emit(
      await this.confirmed({
        verb: "cancel",
        name: `cancel ${invitationId}`,
        message: `Cancel ${invitationId}? Its link stops working.`,
        // A bare cancel picked its invitation, which a retry must name.
        arguments: [invitationId],
        preview: () => {
          return dryRunResult({
            verb: "cancel",
            topic: "invitation",
            id: invitationId,
          });
        },
        prepare: () => {
          return this.connect();
        },
        apply: async (consent, { client, projectId }) => {
          const unlocked = new InvitationService(consent.unlock(client), projectId);
          await unlocked.cancel(invitationId);
          return {
            status: "ok",
            data: deletedData({
              id: invitationId,
            }),
            pretty: prose(`Cancelled ${invitationId}; its link no longer works`),
          };
        },
      }),
    );
  }

  /**
   * The pending invitation a person picks when the command line named none.
   * A script is told to name one instead.
   */
  private async pickPending(): Promise<string> {
    const { client, projectId } = await this.connect();
    const invitationService = new InvitationService(client, projectId);
    const pending = await invitationService.pending();
    if (pending.length === 0) {
      throw refusalError(NOTHING_PENDING_REFUSAL, {}, (command) => {
        return this.suggest(command);
      });
    }
    return this.input({
      kind: "select",
      name: "invitation id",
      message: "Which invitation would you like to cancel?",
      retry: this.suggest("invitation list --status pending"),
      options: pending.map((invitation) => ({
        value: invitation.id,
        label: invitation.id,
        hint: pendingHint(invitation),
      })),
    });
  }
}

/** Who a pending invitation is for and when it expires, beside its id in the picker. */
function pendingHint(invitation: Invitation): string {
  const whom = invitation.metadata?.name;
  return `${whom === undefined ? "" : `${whom}, `}expires ${invitation.expires_at}`;
}
