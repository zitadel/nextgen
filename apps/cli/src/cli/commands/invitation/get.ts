import { Args } from "@oclif/core";
import { z } from "zod";

import { InvitationService, invitationRole } from "@/lib/backend";
import { GetInvitationParams } from "@/lib/backend/schemas";
import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { type Refused, taken } from "@/lib/oclif/flags";
import { Tabulatable } from "@/lib/oclif/tabulatable";
import { json } from "@/lib/oclif/rendering";
import { escapeControlCharacters } from "@/lib/terminal-text";

/**
 * The invitation `invitation get` reads. The schema is the API spec's own, so
 * a value that is not one is refused before anything is called.
 */
const INVITATION_ID: Refused<string> = {
  schema: z.string().trim().pipe(GetInvitationParams.shape.id),
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Find one with `zitadel invitation list`.",
    next: [{ id: "invitation:list" }],
    details: {
      argument: "{input}",
    },
  },
};

/**
 * `zitadel invitation get <invitation_id>` — read one invitation: who it is
 * for, the role it grants, its status and when it expires. The link is never
 * shown again after `invitation create`.
 */
export default class InvitationGet extends Tabulatable(EnvironmentCommand) {
  static override description = "Read one invitation by id.";
  static override group = CommandGroups.projectAdministration;
  static override groupOrder = 3;
  static override examples = ["<%= config.bin %> invitation get inv_01JCQK5R7T9V1X3Z5B7D9F1H3J"];
  static override args = {
    invitation_id: Args.custom<string>({ parse: taken(INVITATION_ID) })({
      required: true,
      description: "The invitation to read.",
    }),
  };

  protected async execute({ args }: Admitted<typeof InvitationGet>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();

    const invitationService = new InvitationService(client, projectId);
    const invitation = await invitationService.get(args.invitationId);

    const title = `Read ${escapeControlCharacters(invitation.id)}`;
    if (this.isJson || !this.isOnScreen) {
      return this.emit({
        status: "ok",
        data: invitation,
        pretty: json(invitation),
        summary: {
          title,
          sections: [],
        },
      });
    }

    return this.emit({
      status: "ok",
      data: invitation,
      summary: {
        title,
        sections: [],
        lines: this.tabulateDetail(
          undefined,
          [
            "id",
            "name",
            "role",
            "status",
            "created_at",
            "expires_at",
            "responded_by",
            "responded_at",
          ],
          {
            id: invitation.id,
            name: invitation.metadata?.name ?? "",
            role: invitationRole(invitation),
            status: invitation.status,
            created_at: invitation.created_at,
            expires_at: invitation.expires_at,
            responded_by: invitation.responded_by ?? "",
            responded_at: invitation.responded_at ?? "",
          },
        ).split("\n"),
      },
    });
  }
}
