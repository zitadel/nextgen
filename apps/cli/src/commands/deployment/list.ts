import { Flags } from "@oclif/core";

import {
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankString,
} from "../../lib/oclif";
import { collectPages } from "../../lib/oclif/crud/paging";
import { renderList } from "../../lib/oclif/crud/table";
import { listData } from "../../lib/oclif/envelope";
import { shellArg } from "../../lib/shell";

/** The columns `list` renders, in order. */
const COLUMNS = ["id", "release_id", "reason", "origins", "deployed_at"] as const;

/**
 * `zitadel deployment list` — show the project's deployment history.
 *
 * Newest first: what went live where, and when. `--origin` narrows it to one
 * origin's history; `--live` shows what each target serves now instead of the
 * full history. Like every list verb it fetches one page and reports
 * `next_page_token`; `--all` drains the history, `--limit` / `--page-token`
 * walk it a page at a time.
 */
export default class DeploymentList extends EnvironmentCommand {
  static override description = "List the project's deployments, newest first.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> deployment list",
    "<%= config.bin %> deployment list --all",
    "<%= config.bin %> deployment list --live",
    "<%= config.bin %> deployment list --origin https://app.acme.com",
  ];
  static override flags = {
    origin: Flags.string({ description: "Only deployments that targeted this origin." }),
    live: Flags.boolean({ description: "What each target serves now, not the full history." }),
    limit: Flags.integer({
      description: "Page size (server default 20, max 100).",
      min: 1,
      max: 100,
    }),
    "page-token": nonBlankString({
      description: "Continue from a previous page's next_page_token.",
    }),
    all: Flags.boolean({
      char: "a",
      description: "Fetch every page instead of one.",
      exclusive: ["page-token"],
    }),
    plain: Flags.boolean({
      description:
        "Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(DeploymentList);
    await this.toMeta(flags);
    const { client, projectId } = await this.connect();

    const params = {
      project_id: projectId,
      origin: flags.origin,
      live: flags.live,
      limit: flags.limit,
      page_token: flags["page-token"],
    };
    // One page unless `--all`, as every list does; the walk starts at
    // `--page-token`, and a drain leaves no next page to report.
    const { items: deployments, next } = await collectPages(
      (token) => client.listDeployments({ ...params, page_token: token ?? params.page_token }),
      {
        items: (page) => page.deployments,
        all: flags.all === true,
        next: (page) => page.next_page_token,
      },
    );

    // Flatten each deployment's targets to one `origins` cell for the table.
    const rows = deployments.map((deployment) => ({
      id: deployment.id,
      release_id: deployment.release_id,
      reason: deployment.metadata.reason,
      origins: deployment.targets.map((target) => target.origin).join(", "),
      deployed_at: deployment.deployed_at,
    }));

    // A page token is only valid alongside the flags that issued it, so the
    // suggested next page repeats the whole invocation rather than a bare
    // token. `--all` already drained everything, so it suggests nothing.
    const nextCommand =
      next && flags.all !== true
        ? this.suggest(
            [
              "deployment list",
              ...(flags.origin === undefined ? [] : [`--origin ${shellArg(flags.origin)}`]),
              ...(flags.live ? ["--live"] : []),
              ...(flags.limit === undefined ? [] : [`--limit ${flags.limit}`]),
              // `next` is an opaque server cursor: quote it so whitespace or shell
              // metacharacters in a copied command cannot execute as server-controlled
              // text or break the suggestion.
              `--page-token ${shellArg(next)}`,
              "--json",
            ].join(" "),
          )
        : undefined;

    const plain = flags.plain || !process.stdout.isTTY;
    return this.emit({
      status: "ok",
      data: listData(deployments, { nextPageToken: next }),
      ...(nextCommand === undefined ? {} : { next: { commands: [nextCommand] } }),
      machineReadable: plain,
      pretty: renderList(COLUMNS, rows, {
        plain,
        singular: "deployment",
        empty: "No deployments yet.",
        footer: next ? [`More available: --page-token ${shellArg(next)} (or --all)`] : [],
      }),
    });
  }
}
