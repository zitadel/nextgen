import { Flags } from "@oclif/core";
import { z } from "zod";

import {
  type Invitation,
  type InvitationRelation,
  InvitationService,
  invitationGrant,
  invitationRole,
} from "@/lib/backend";
import { GetInvitationParams } from "@/lib/backend/schemas";
import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { dryRunResult } from "@/lib/oclif/crud/shared";
import { filled, reads, type Refused } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { Promptable } from "@/lib/oclif/promptable";
import { escapeControlCharacters } from "@/lib/terminal-text";
import type { Parsed } from "@zitadel/config/idp";

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
const NAME_MAX = 200;

/** A name for who an invitation is for, as the API bounds it. */
const NAME_SCHEMA = filled.pipe(
  z.string().refine((name) => {
    // Counted in characters, as the API's maxLength is, not UTF-16 units.
    return [...name].length <= NAME_MAX;
  }, `it is longer than ${NAME_MAX} characters`),
);

/** Who `--name` says the invitation is for. */
const NAME: Refused<string> = {
  schema: NAME_SCHEMA,
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Pass a name of 1 to {max} characters, or leave {input} out.",
  },
  values: {
    max: NAME_MAX,
  },
};

/** The invitation `--replaces` names, as the API spells an invitation id. */
const REPLACES: Refused<string> = {
  schema: z.string().trim().pipe(GetInvitationParams.shape.id),
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Find one with `zitadel invitation list`.",
    next: [{ id: "invitation:list" }],
  },
};

/** How a `--replaces` naming an accepted invitation is refused. */
const REPLACES_ACCEPTED_REFUSAL: Refusal = {
  message: "{id} was already accepted, so there is nothing to replace",
  hint: "Create a new invitation instead.",
  next: [{ id: "invitation:create" }],
};

/**
 * `zitadel invitation create` — invite someone into the project with a link.
 *
 * Asks who the invitation is for and which role it grants, confirms, and
 * prints the link. The link is shown once: no later read returns it, so it is
 * never recorded anywhere but the output. `--replaces` makes a new link for an
 * invitation that was lost or expired, keeping its journey (ADR 086).
 */
export default class InvitationCreate extends Promptable(EnvironmentCommand) {
  static override description = "Invite someone into the project with a link to share.";
  static override group = CommandGroups.projectAdministration;
  static override groupOrder = 1;
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

  protected async execute({ flags }: Admitted<typeof InvitationCreate>): Promise<JsonEnvelope> {
    // A replacement without a name keeps the original's, so it is not asked.
    const name = flags.name ?? (flags.replaces === undefined ? await this.askName() : undefined);
    const relation = flags.relation ?? (await this.askRelation());
    // A dry run makes no request, so it answers before the connection.
    if (this.dryRun) {
      return this.emit(
        dryRunResult({
          verb: "create",
          topic: "invitation",
          body: {
            type: "project_member",
            project_member: { relation },
            ...(name === undefined ? {} : { metadata: { name } }),
            ...(flags.replaces === undefined ? {} : { replaces_invitation_id: flags.replaces }),
          },
          next: await this.realRun(),
        }),
      );
    }

    const { client, projectId } = await this.connect();
    const invitationService = new InvitationService(client, projectId);
    const replaced =
      flags.replaces === undefined
        ? undefined
        : await this.readReplaced(invitationService, flags.replaces);
    if (!(await this.askToCreate(name ?? replaced?.metadata?.name, relation, replaced?.id))) {
      return this.emit({
        status: "skipped",
        reason: "create-cancelled",
        data: {},
        summary: {
          title: "Nothing was created",
          sections: [],
        },
      });
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

    return this.emit({
      status: "ok",
      data: invitation,
      summary: {
        title: `Created ${escapeControlCharacters(invitation.id)}`,
        sections: [],
        lines: [
          escapeControlCharacters(invitation.link),
          `Whoever opens it gets the ${invitationRole(invitation)} role. It expires in 72 hours.`,
        ],
      },
      next: {
        commands: [this.suggest({ id: "invitation:list", flags: { status: "pending" } })],
      },
    });
  }

  /**
   * Who the invitation is for, asked of a person and left out for a script:
   * the API takes none, so a run with nobody to ask goes on without it. A blank
   * answer leaves it out too.
   */
  private async askName(): Promise<string | undefined> {
    if (this.nonInteractive) {
      return undefined;
    }
    const answer = await this.ask.text({
      name: "name",
      message: "Who is this invitation for?",
      placeholder: "Shown to other administrators; leave blank to skip",
      flag: "--name",
      parse: parseAnsweredName,
    });
    return answer === "" ? undefined : answer;
  }

  /**
   * The invitation `--replaces` names, read before anything is asked: the
   * server refuses to replace one that was accepted.
   */
  private async readReplaced(
    invitationService: InvitationService,
    invitationId: string,
  ): Promise<Invitation> {
    const invitation = await invitationService.get(invitationId);
    if (invitation.status === "accepted") {
      throw refusalError(REPLACES_ACCEPTED_REFUSAL, { id: invitation.id });
    }
    return invitation;
  }

  /** The role the invitation grants, asked when `--relation` did not give it. */
  private async askRelation(): Promise<InvitationRelation> {
    return this.ask.select({
      name: "relation",
      message: "Which role should whoever accepts receive on the project?",
      flag: "--relation",
      retry: this.suggest({ id: "invitation:create", flags: { relation: "viewer" } }),
      initialValue: "viewer",
      options: RELATIONS.map((relation) => ({
        value: relation,
        label: relation,
        hint: RELATION_HINTS[relation],
      })),
    });
  }

  /**
   * Whether to make the link, asked of a person only: creating is not
   * destructive, and a script that passed its flags has already decided.
   */
  private async askToCreate(
    name: string | undefined,
    relation: InvitationRelation,
    replaces: string | undefined,
  ): Promise<boolean> {
    if (this.nonInteractive) {
      return true;
    }
    const whom = name === undefined ? "an invitation" : `an invitation for ${name}`;
    const replacing = replaces === undefined ? "" : `, replacing ${replaces}`;
    return this.ask.yesNo({
      name: "creation",
      message: `Create ${whom} as ${relation}${replacing}?`,
      initialValue: true,
    });
  }
}

/**
 * A typed answer to who the invitation is for, held to the rule `--name` is,
 * except that a blank answer skips it and comes back empty.
 */
function parseAnsweredName(value: string): Parsed<string> {
  if (value.trim() === "") {
    return { ok: true, value: "" };
  }
  const parsed = NAME_SCHEMA.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, problem: parsed.error.issues[0]?.message ?? "it is not valid" };
}
