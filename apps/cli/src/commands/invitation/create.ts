import { Flags } from "@oclif/core";
import { z } from "zod";

import {
  type CreatedInvitation,
  type InvitationRelation,
  InvitationService,
  invitationGrant,
  invitationRole,
} from "@/lib/backend";
import { GetInvitationParams } from "@/lib/backend/schemas";
import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { filled, reads, type Refused } from "@/lib/oclif/flags";
import { Promptable } from "@/lib/oclif/promptable";
import { prose } from "@/lib/oclif/rendering";
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
  z.string().max(NAME_MAX, `it is longer than ${NAME_MAX} characters`),
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
    next: ["invitation list"],
  },
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
    const { client, projectId } = await this.connect();
    const invitationService = new InvitationService(client, projectId);

    const name = flags.name ?? (await this.askName());
    const relation = flags.relation ?? (await this.askRelation());
    if (!(await this.askToCreate(name, relation, flags.replaces))) {
      return this.emit({
        status: "skipped",
        reason: "create-cancelled",
        data: {},
        pretty: prose("Nothing was created."),
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
      pretty: prose(created(invitation)),
      next: {
        commands: [this.suggest("invitation list --status pending")],
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
    const answer = await this.input({
      kind: "text",
      name: "name",
      message:
        "Who is this invitation for? Other administrators see the name; leave it blank to skip.",
      flag: "--name",
      parse: parseAnsweredName,
    });
    return answer === "" ? undefined : answer;
  }

  /** The role the invitation grants, asked when `--relation` did not give it. */
  private async askRelation(): Promise<InvitationRelation> {
    return this.input({
      kind: "select",
      name: "relation",
      message: "Which role should whoever accepts receive on the project?",
      flag: "--relation",
      retry: this.suggest("invitation create --relation viewer"),
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
    return this.input({
      kind: "yes-no",
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

/**
 * What a person reads after a create: the link, then what it does. The link
 * stands on a line of its own so it copies cleanly.
 */
function created(invitation: CreatedInvitation): string {
  return [
    invitation.link,
    "",
    `Whoever opens it gets the ${invitationRole(invitation)} role. It expires in 72 hours.`,
  ].join("\n");
}
