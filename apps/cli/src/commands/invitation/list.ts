import { Flags } from "@oclif/core";
import { z } from "zod";

import {
  InvitationService,
  invitationRole,
  type InvitationStatus,
  type InvitationType,
} from "@/lib/backend";
import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankString,
} from "@/lib/oclif";
import { reads, type Refused, whole } from "@/lib/oclif/flags";
import { plainFlag, Tabulatable } from "@/lib/oclif/tabulatable";
import { relatedFlags } from "@/lib/suggestion/relations";

/** The columns `list` renders, in order. */
const COLUMNS = ["id", "name", "role", "status", "expires_at"] as const;

/** The statuses `--status` narrows to, as the API reports them. */
const STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "expired",
] as const satisfies readonly InvitationStatus[];

/** The types `--type` narrows to, as the API declares them. */
const TYPES = ["project_member", "team_member"] as const satisfies readonly InvitationType[];

/** The page sizes the server accepts, quoted by the refusal and the reference. */
const LIMIT_MIN = 1;
const LIMIT_MAX = 100;

/** The page size `--limit` asks for, as the server bounds it. */
const LIMIT: Refused<number> = {
  schema: whole.pipe(z.number().min(LIMIT_MIN).max(LIMIT_MAX)),
  refusal: {
    message: "{value} is not a valid {input}",
    hint: "Use a whole number from {min} to {max}.",
  },
  values: {
    min: LIMIT_MIN,
    max: LIMIT_MAX,
  },
};

/**
 * `zitadel invitation list` — show the project's invitations, newest first,
 * with their status and expiry. `--status` and `--type` narrow the page; like
 * every list verb it fetches one page and reports `next_page_token`.
 */
export default class InvitationList extends Tabulatable(EnvironmentCommand) {
  static override description = "List the project's invitations, newest first.";
  static override group = CommandGroups.projectAdministration;
  static override groupOrder = 2;
  static override examples = [
    "<%= config.bin %> invitation list",
    "<%= config.bin %> invitation list --status pending",
    "<%= config.bin %> invitation list --all --json",
  ];
  static override flags = relatedFlags(
    {
      status: Flags.custom<InvitationStatus>({})({
        options: [...STATUSES],
        description: "Only invitations with this status.",
      }),
      type: Flags.custom<InvitationType>({})({
        options: [...TYPES],
        description: "Only invitations of this type.",
      }),
      limit: Flags.custom<number>({
        parse: reads(LIMIT),
      })({
        min: LIMIT_MIN,
        max: LIMIT_MAX,
        description: "Page size (server default 20, max 100).",
      }),
      "page-token": nonBlankString({
        description: "Continue from a previous page's next_page_token.",
      }),
      all: Flags.boolean({
        char: "a",
        description: "Fetch every page instead of one.",
      }),
      plain: plainFlag,
    },
    { all: { exclusive: ["page-token"] } },
  );

  protected async execute({ flags }: Admitted<typeof InvitationList>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();

    const invitationService = new InvitationService(client, projectId);
    const listed = await invitationService.page(
      {
        status: flags.status,
        type: flags.type,
        limit: flags.limit,
        page_token: flags.pageToken,
      },
      {
        all: flags.all,
      },
    );

    const items = listed.items;
    const rows = items.map((invitation) => {
      return {
        id: invitation.id,
        name: invitation.metadata?.name ?? "",
        role: invitationRole(invitation),
        status: invitation.status,
        expires_at: invitation.expires_at,
      };
    });
    const columns = COLUMNS;
    const empty = "No invitations yet.";
    const footer: string[] = [];
    const page = {
      token: listed.next,
    };
    const extra = {};

    return this.emitList(flags, {
      columns,
      rows,
      items,
      singular: "invitation",
      empty,
      footer,
      page,
      extra,
    });
  }
}
