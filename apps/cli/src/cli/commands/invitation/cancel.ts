import { Args } from "@oclif/core";

import { type Invitation, InvitationService, invitationGrant, invitationRole } from "@/lib/backend";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { deletedData } from "@/cli/core/envelope";
import { type Refused, taken } from "@/cli/core/flags";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { invitationIdSchema } from "./id";
import { Promptable } from "@/cli/core/promptable";
import { Destructive } from "@/cli/core/destructive";
import { ChangeCommand } from "@/cli/commands/bases";
import { Telemetered } from "@/cli/telemetry/telemetered";

/**
 * The invitation `invitation cancel` cancels, as the API spells an invitation
 * id. It is annotated because its `next` names this topic's list, which would
 * make the type circular.
 */
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

/** The product event a cancel sends once the API confirms it (ADR 086, amended). */
const INVITATION_CANCELLED = "invitation_cancelled";

/**
 * How a bare cancel is refused when it cannot pick: a dry run must not read the
 * server, and a run with nobody to ask would read it only to refuse.
 */
const NO_ID_REFUSAL = {
  message: "Name the invitation to cancel",
  hint: "Pass its id; find one with `zitadel invitation list`.",
  next: [{ id: "invitation:list" }],
} as const satisfies Refusal;

/** How a cancel of an accepted invitation is refused. */
const NOT_CANCELLABLE_REFUSAL = {
  message: "{id} is {status}, so there is nothing to cancel",
  hint: "An accepted invitation can't be cancelled.",
  next: [{ id: "invitation:list" }],
} as const satisfies Refusal;

/** How a bare cancel is refused when the project has no invitation left to cancel. */
const NOTHING_CANCELLABLE_REFUSAL = {
  message: "The project has no pending, expired or declined invitations",
  hint: "An accepted invitation can't be cancelled.",
  next: [{ id: "invitation:list" }],
} as const satisfies Refusal;

/** The invitation as the question names it: its id, who it is for, and the role. */
function describe(invitation: Invitation): string {
  const whom = invitation.metadata?.name;
  const role = invitationRole(invitation);
  return whom === undefined
    ? `${invitation.id} (${role})`
    : `${invitation.id} for ${whom} (${role})`;
}

/**
 * `zitadel invitation cancel [invitation_id]` — cancel a pending invitation,
 * so its link can no longer be redeemed, or remove an expired or declined one.
 * Without an id it offers the pending, expired and declined invitations to
 * pick from.
 */
export default class InvitationCancel extends Telemetered(
  Destructive(
    Promptable(ChangeCommand),
    "Cancel the invitation without the confirmation prompt. Required when non-interactive.",
  ),
) {
  static override description =
    "Cancel a pending invitation so its link stops working, or remove an expired or declined one.";
  static override group = CommandGroups.usersAndAccess;
  static override groupOrder = 8;

  static override examples = [
    "<%= config.bin %> invitation cancel",
    "<%= config.bin %> invitation cancel inv_01JCQK5R7T9V1X3Z5B7D9F1H3J",
    "<%= config.bin %> invitation cancel inv_01JCQK5R7T9V1X3Z5B7D9F1H3J --force",
  ];
  static override args = {
    invitation_id: Args.custom<string>({ parse: taken(INVITATION_ID) })({
      description: "The invitation to cancel. Omit it to pick a pending, expired or declined one.",
    }),
  };

  /**
   * Says which invitation would be cancelled, without cancelling it.
   *
   * @param input - The flags and arguments of the run.
   * @returns The dry run's envelope.
   */
  protected async preview({ args }: Admitted<typeof InvitationCancel>): Promise<CommandResult> {
    if (args.invitationId === undefined) {
      throw refusalError(NO_ID_REFUSAL, {});
    }

    return dryRunResult({
      verb: "cancel",
      topic: "invitation",
      id: args.invitationId,
      next: await this.realRun(),
    });
  }

  /**
   * Cancels the invitation, after asking. A bare cancel picked its invitation,
   * which a retry must name. Only a pending invitation counts as cancelled in
   * telemetry: a declined journey already ended with invitation_rejected, and
   * an expired one counts as not accepted. A person is offered the pending,
   * expired and declined invitations when none is named, and a script is told
   * to name one. A named invitation is read before anyone is asked, so the
   * question can name it and an accepted one is refused: the server answers
   * that cancel with the same 404 as a miss.
   *
   * @param input - The flags and arguments of the run.
   * @returns The run's envelope.
   */
  protected async apply({ args }: Admitted<typeof InvitationCancel>): Promise<CommandResult> {
    if (args.invitationId === undefined && this.nonInteractive) {
      throw refusalError(NO_ID_REFUSAL, {});
    }
    const listed =
      args.invitationId === undefined
        ? await (await this.service(InvitationService)).cancellable()
        : [];
    if (args.invitationId === undefined && listed.length === 0) {
      throw refusalError(NOTHING_CANCELLABLE_REFUSAL, {});
    }
    const target =
      args.invitationId ??
      (await this.ask.select({
        name: "invitation id",
        message: "Which invitation would you like to cancel?",
        retry: this.suggest({ id: "invitation:list" }),
        options: listed.map((invitation) => {
          const whom = invitation.metadata?.name;
          const standing =
            invitation.status === "pending"
              ? `expires ${invitation.expires_at}`
              : invitation.status === "expired"
                ? `expired ${invitation.expires_at}`
                : "declined";
          return {
            value: invitation,
            label: invitation.id,
            hint: escapeControlCharacters(`${whom === undefined ? "" : `${whom}, `}${standing}`),
          };
        }),
      }));
    const invitationId = typeof target === "string" ? target : target.id;

    return await this.confirmed({
      verb: "cancel",
      name: `cancel ${invitationId}`,
      message: ({ invitation }) => {
        return invitation.status === "pending"
          ? `Cancel ${describe(invitation)} so its link stops working?`
          : `Cancel ${describe(invitation)} and remove its record?`;
      },
      arguments: [invitationId],
      prepare: async () => {
        const invitation =
          typeof target === "string"
            ? await (await this.service(InvitationService)).get(target)
            : target;
        if (invitation.status === "accepted") {
          throw refusalError(NOT_CANCELLABLE_REFUSAL, {
            id: invitation.id,
            status: invitation.status,
          });
        }

        return { invitation };
      },
      apply: async (_consent, { invitation }) => {
        await (await this.service(InvitationService)).cancel(invitation.id);
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
    });
  }
}
