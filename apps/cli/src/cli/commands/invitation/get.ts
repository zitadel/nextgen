import { Args } from "@oclif/core";

import { InvitationService, invitationRole } from "@/lib/backend";
import { GetInvitationResponse } from "@/lib/backend/schemas";
import { CommandGroups } from "@/cli/commands/groups";
import { type Admitted, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { type Refused, taken } from "@/lib/oclif/flags";
import { chosenColumns } from "@/lib/oclif/columns";
import { fieldPaths } from "@/lib/oclif/crud";
import { fieldsFlag, Tabulatable } from "@/lib/oclif/tabulatable";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { invitationIdSchema } from "./id";
import { ServerCommand } from "@/cli/commands/server-command";

/**
 * The invitation `invitation get` reads. The schema is the API spec's own, so
 * a value that is not one is refused before anything is called.
 */
// Annotated: its `next` names this topic's list, which would make the type circular.
const INVITATION_ID: Refused<string> = {
  schema: invitationIdSchema,
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
 * shown again after `invitation create`. `--fields` cuts the data and the rows
 * to the dot-paths it names, judged by the invitation's shape.
 */
export default class InvitationGet extends Tabulatable(ServerCommand(EnvironmentCommand)) {
  static override description = "Read one invitation by id.";
  static override group = CommandGroups.usersAndAccess;
  static override groupOrder = 7;
  static override examples = ["<%= config.bin %> invitation get inv_01JCQK5R7T9V1X3Z5B7D9F1H3J"];
  static override args = {
    invitation_id: Args.custom<string>({ parse: taken(INVITATION_ID) })({
      required: true,
      description: "The invitation to read.",
    }),
  };

  static override flags = {
    fields: fieldsFlag({
      shape: fieldPaths(GetInvitationResponse),
    }),
  };

  protected async execute({ args, flags }: Admitted<typeof InvitationGet>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();

    const invitationService = new InvitationService(client, projectId);
    const invitation = await invitationService.get(args.invitationId);

    const title = `Read ${escapeControlCharacters(invitation.id)}`;

    return this.emit({
      status: "ok",
      data: flags.fields === undefined ? invitation : this.pickFields(invitation, flags.fields),
      summary: {
        title,
        sections: [],
        lines: this.tabulateDetail(
          undefined,
          chosenColumns(
            flags.fields,
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
            [],
          ),
          flags.fields === undefined
            ? {
                id: invitation.id,
                name: invitation.metadata?.name ?? "",
                role: invitationRole(invitation),
                status: invitation.status,
                created_at: invitation.created_at,
                expires_at: invitation.expires_at,
                responded_by: invitation.responded_by ?? "",
                responded_at: invitation.responded_at ?? "",
              }
            : invitation,
        ).split("\n"),
      },
    });
  }
}
