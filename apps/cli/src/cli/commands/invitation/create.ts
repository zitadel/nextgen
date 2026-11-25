import { Flags } from "@oclif/core";
import { z } from "zod";

import {
  type Invitation,
  type InvitationRelation,
  InvitationService,
  invitationGrant,
  invitationRole,
} from "@/lib/backend";
import { createInvitationBodyOneOneMetadataNameMax } from "@/lib/backend/schemas";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { filled, reads, type Refused } from "@/cli/core/flags";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { invitationIdSchema } from "./id";
import { Promptable } from "@/cli/core/promptable";
import { ChangeCommand } from "@/cli/commands/bases";
import { Telemetered } from "@/cli/telemetry/telemetered";

/** The product event a create or replace sends once the API confirms it (ADR 086 §9). */
const INVITATION_CREATED = "invitation_created";

/** The project roles an invitation can grant, least first. */
const RELATIONS = ["viewer", "editor", "admin"] as const satisfies readonly InvitationRelation[];

/** What each role lets the person who accepts do, for the prompt. */
const RELATION_HINTS: Readonly<Record<InvitationRelation, string>> = {
  viewer: "reads the project",
  editor: "changes the project's configuration",
  admin: "also manages who works on the project",
};

/** The longest name the API stores for who an invitation is for. */
const NAME_MAX = createInvitationBodyOneOneMetadataNameMax;

/**
 * A name for who an invitation is for, as the API bounds it: counted in
 * characters, as the API's maxLength is, not UTF-16 units.
 */
const NAME_SCHEMA = filled.pipe(
  z.string().refine((name) => {
    return [...name].length <= NAME_MAX;
  }, `it is longer than ${NAME_MAX} characters`),
);

/** Who `--name` says the invitation is for. */
const NAME = {
  schema: NAME_SCHEMA,
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Pass a name of 1 to {max} characters, or leave {input} out.",
  },
  values: {
    max: NAME_MAX,
  },
} as const satisfies Refused<string>;

/**
 * The invitation `--replaces` names, as the API spells an invitation id. It is
 * annotated because its `next` names this topic's list, which would make the
 * type circular.
 */
const REPLACES: Refused<string> = {
  schema: invitationIdSchema,
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Find one with `zitadel invitation list`.",
    next: [{ id: "invitation:list" }],
  },
};

/** How a `--replaces` naming an accepted invitation is refused. */
const REPLACES_ACCEPTED_REFUSAL = {
  message: "{id} was already accepted, so there is nothing to replace",
  hint: "Create a new invitation instead.",
  next: [{ id: "invitation:create" }],
} as const satisfies Refusal;

/** Says the link cannot be read again, in the console's words. */
const SHOWN_ONCE = "This link is shown only once. Copy it now.";

/**
 * `zitadel invitation create` — invite someone into the project with a link.
 *
 * Asks who the invitation is for and which role it grants, confirms, and
 * prints the link. The link is shown once: no later read returns it, so it is
 * never recorded anywhere but the output. `--replaces` makes a new link for an
 * invitation that was lost or expired, keeping its journey (ADR 086).
 */
export default class InvitationCreate extends Telemetered(Promptable(ChangeCommand)) {
  static override description = "Invite someone into the project with a link to share.";
  static override group = CommandGroups.usersAndAccess;
  static override groupOrder = 5;

  static override examples = [
    "<%= config.bin %> invitation create",
    '<%= config.bin %> invitation create --name "John Doe" --relation editor',
    "<%= config.bin %> invitation create --replaces inv_01JCQK5R7T9V1X3Z5B7D9F1H3J --relation editor",
  ];
  static override flags = {
    name: Flags.custom<string>({ parse: reads(NAME) })({
      description: "Who the invitation is for, shown to other administrators. Never matched.",
    }),
    relation: Flags.custom<InvitationRelation>({})({
      options: [...RELATIONS],
      description: "The project role whoever accepts receives.",
    }),
    replaces: Flags.custom<string>({ parse: reads(REPLACES) })({
      description: "The invitation this one replaces; the new one keeps its journey.",
    }),
  };

  /**
   * Says what the invitation would be, without sending it. Without
   * `--replaces` a dry run makes no request, so it needs no connection.
   *
   * @param input - The flags and arguments of the run.
   * @returns The dry run's envelope.
   */
  protected async preview({ flags }: Admitted<typeof InvitationCreate>): Promise<CommandResult> {
    const { name, relation, replaced } = await this.intended(flags);

    return dryRunResult({
      verb: "create",
      topic: "invitation",
      body: {
        type: "project_member",
        project_member: { relation },
        ...(name === undefined ? {} : { metadata: { name } }),
        ...(replaced === undefined ? {} : { replaces_invitation_id: replaced.id }),
      },
      next: await this.realRun(),
    });
  }

  /**
   * Sends the invitation. A person is asked before the link is made; creating
   * is not destructive, and a script that passed its flags has already decided.
   *
   * @param input - The flags and arguments of the run.
   * @returns The run's envelope.
   */
  protected async apply({ flags }: Admitted<typeof InvitationCreate>): Promise<CommandResult> {
    const { name, relation, replaced } = await this.intended(flags);
    const invitationService = await this.service(InvitationService);
    const whom =
      (name ?? replaced?.metadata?.name) === undefined
        ? "an invitation"
        : `an invitation for ${name ?? replaced?.metadata?.name}`;
    const replacing = replaced?.id === undefined ? "" : `, replacing ${replaced.id}`;
    if (
      !this.nonInteractive &&
      !(await this.ask.yesNo({
        name: "creation",
        message: `Create ${whom} as ${relation}${replacing}?`,
        initialValue: true,
      }))
    ) {
      return {
        status: "skipped",
        reason: "create-cancelled",
        data: {},
        summary: {
          title: "Nothing was created",
          sections: [],
        },
      };
    }

    const invitation = await invitationService.create({
      relation,
      name,
      replaces: flags.replaces,
    });
    this.trackEvent(INVITATION_CREATED, {
      role: invitationGrant(invitation),
      invitation_journey_id: invitation.journey_id,
    });

    const title = `Created ${escapeControlCharacters(invitation.id)}`;

    return {
      status: "ok",
      data: { title, ...invitation },
      summary: {
        title,
        sections: [],
        lines: [
          escapeControlCharacters(invitation.link),
          `Whoever opens it gets the ${invitationRole(invitation)} role. It expires in 72 hours.`,
          SHOWN_ONCE,
        ],
      },
      next: {
        commands: [
          this.suggest({
            id: "invitation:list",
            flags: { status: ["pending"] },
          }),
        ],
      },
    };
  }

  /**
   * What the invitation is for, settled the same way for a dry run and a real
   * run. The original is read before anything is asked, a dry run included, so
   * an accepted one is refused first and a dry run predicts what the run does.
   * A replacement without a name keeps the original's, so it is not asked.
   * Who it is for is asked of a person and left out for a script, as is a blank
   * answer: the API takes none. The role is asked when `--relation` did not
   * give it, and an accepted original is refused, as the server would.
   *
   * @param flags - The flags the command was given.
   * @returns The name, the relation and the invitation it replaces.
   */
  private async intended(flags: Admitted<typeof InvitationCreate>["flags"]): Promise<{
    /** What the invitation is called, when the run is to ask or was told. */
    name: string | undefined;
    /** How the invited person relates to the project. */
    relation: InvitationRelation;
    /** The invitation this one replaces, when `--replaces` names one. */
    replaced: Invitation | undefined;
  }> {
    const replaced =
      flags.replaces === undefined
        ? undefined
        : await (await this.service(InvitationService)).get(flags.replaces);
    if (replaced?.status === "accepted") {
      throw refusalError(REPLACES_ACCEPTED_REFUSAL, { id: replaced.id });
    }
    const answer =
      flags.name === undefined && replaced === undefined && !this.nonInteractive
        ? await this.ask.text({
            name: "name",
            message: "Who is this invitation for?",
            placeholder: "Shown to other administrators; leave blank to skip",
            flag: "--name",
            parse: (value) => {
              if (value.trim() === "") {
                return { ok: true, value: "" };
              }
              const parsed = NAME_SCHEMA.safeParse(value);
              return parsed.success
                ? { ok: true, value: parsed.data }
                : { ok: false, problem: parsed.error.issues[0]?.message ?? "it is not valid" };
            },
          })
        : undefined;
    const name = flags.name ?? (answer === "" ? undefined : answer);
    const relation =
      flags.relation ??
      (await this.ask.select({
        name: "relation",
        message: "Which role should whoever accepts receive on the project?",
        flag: "--relation",
        retry: this.suggest({
          id: "invitation:create",
          flags: { relation: "viewer" },
        }),
        initialValue: "viewer",
        options: RELATIONS.map((relation) => {
          return {
            value: relation,
            label: relation,
            hint: RELATION_HINTS[relation],
          };
        }),
      }));

    return {
      name,
      relation,
      replaced,
    };
  }
}
