import { Flags } from "@oclif/core";
import { z } from "zod";

import { DeploymentService } from "@/lib/backend";
import { Cmd } from "@/lib/cmd";
import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankString,
} from "@/lib/oclif";
import { reads, type Refused, whole } from "@/lib/oclif/flags";
import { plainFlag, Tabulatable } from "@/lib/oclif/tabulatable";

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
 * `zitadel deployment list` — show the project's deployment history.
 *
 * Newest first: what went live where, and when. `--origin` narrows it to one
 * origin's history; `--live` shows what each target serves now instead of the
 * full history. Like every list verb it fetches one page and reports
 * `next_page_token`; `--all` drains the history, `--limit` / `--page-token`
 * walk it a page at a time.
 */
export default class DeploymentList extends Tabulatable(EnvironmentCommand) {
  static override description = "List the project's deployments, newest first.";
  static override group = CommandGroups.configuration;

  static override examples = [
    "<%= config.bin %> deployment list",
    "<%= config.bin %> deployment list --all",
    "<%= config.bin %> deployment list --live",
    "<%= config.bin %> deployment list --origin https://app.acme.com",
  ];
  static override flags = {
    origin: nonBlankString({ description: "Only deployments that targeted this origin." }),
    live: Flags.boolean({ description: "What each target serves now, not the full history." }),
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
      exclusive: ["page-token"],
    }),
    plain: plainFlag,
  };

  protected async execute({ flags }: Admitted<typeof DeploymentList>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();

    const deploymentService = new DeploymentService(client, projectId);
    const listed = await deploymentService.page(
      {
        origin: flags.origin,
        live: flags.live,
        limit: flags.limit,
        page_token: flags.pageToken,
      },
      {
        all: flags.all,
      },
    );

    const items = listed.items;
    const rows = items.map((deployment) => {
      return {
        id: deployment.id,
        release_id: deployment.release_id,
        reason: deployment.reason ?? "deploy",
        origins: deployment.origins.join(", "),
        deployed_at: deployment.deployed_at,
      };
    });
    const columns = ["id", "release_id", "reason", "origins", "deployed_at"];
    const empty = "No deployments found";
    const footer: string[] = [];
    const page = {
      token: listed.next,
      command: "deployment list",
      flags: [
        ...(flags.origin === undefined ? [] : [Cmd.option("--origin", flags.origin)]),
        ...(flags.live ? ["--live"] : []),
        ...(flags.limit === undefined ? [] : [`--limit ${flags.limit}`]),
      ],
    };
    const extra = {};

    return this.emitList(flags, {
      columns,
      rows,
      items,
      singular: "deployment",
      empty,
      footer,
      page,
      extra,
    });
  }
}
