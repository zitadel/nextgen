import { Args } from "@oclif/core";

import { Operation } from "@/lib/backend";
import { CommandGroups } from "@/cli/commands/groups";
import { type Admitted, type CommandResult, nonBlankString } from "@/cli/core";
import { fieldsFlag, plainFlag } from "@/cli/core/tabulatable";
import { ServerCommand } from "@/cli/commands/server-command";
import { Tabulatable } from "@/cli/core/tabulatable";
import { BaseCommand } from "@/cli/core";

/** The columns `ls` renders, in order. */
const COLUMNS = ["id", "method", "path", "summary"] as const;

/**
 * `zitadel api ls` — the operations `zitadel api` can call, from the spec the
 * CLI was built with. It talks to no server, so the answer is the same
 * offline. `--json` carries each one's parameters, body and paging, which is
 * what an agent needs to build the call.
 */
export default class ApiLs extends Tabulatable(ServerCommand(BaseCommand)) {
  static override description =
    "List the operations of the Zitadel API that the api command calls.";
  static override group = CommandGroups.apiAndEvents;
  static override groupOrder = 2;

  static override examples = [
    "<%= config.bin %> api ls",
    "<%= config.bin %> api ls passkey",
    "<%= config.bin %> api ls --tag Users --json",
    "<%= config.bin %> api ls --json | jq -r '.data.operations[] | select(.command == null) | .id'",
  ];
  static override args = {
    filter: Args.string({
      description: "Only operations whose id, path, summary or tag contains this text.",
    }),
  };
  static override flags = {
    tag: nonBlankString({
      description: "Only the operations of this part of the API (Users, Teams, …).",
    }),
    fields: fieldsFlag({
      shape: {
        known: new Set([
          "id",
          "method",
          "path",
          "summary",
          "tag",
          "auth",
          "callable",
          "parameters",
          "body",
          "paging",
          "command",
        ]),
        open: ["body", "paging"],
      },
    }),
    plain: plainFlag,
  };

  /**
   * Legacy: `--server` is accepted and ignored, so the run names no server.
   *
   * @returns No server.
   */
  protected override async resolveServer(): Promise<string> {
    return "";
  }

  /**
   * Lists the operations the CLI can call, narrowed by a filter and a tag. Each
   * is listed with its parameters, body and paging, which is what an agent
   * needs to build the call.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The operations as a list.
   */
  protected async execute({ args, flags }: Admitted<typeof ApiLs>): Promise<CommandResult> {
    const items = Operation.all({
      filter: args.filter,
      tag: flags.tag,
    }).map((operation) => {
      return {
        id: operation.id,
        method: operation.method,
        path: operation.path,
        summary: operation.summary,
        tag: operation.tag,
        auth: operation.auth,
        callable: operation.uncallable === undefined,
        parameters: operation.parameters,
        body: operation.body,
        paging: operation.paging,
        command: operation.cli,
      };
    });

    const view = {
      columns: COLUMNS,
      rows: items,
      singular: "operation",
      empty: "No operations found",
      footer: [] as string[],
      page: null,
    };

    const result = await this.listed(
      flags,
      flags.fields === undefined
        ? {
            ...view,
            extra: {},
            data: {
              operations: items,
              count: items.length,
            },
          }
        : {
            ...view,
            items,
            extra: {},
          },
    );

    return {
      ...result,
      next: {
        commands: [
          items.length === 0
            ? this.suggest({ id: "api:ls" })
            : this.suggest({
                id: "api",
                args: { operation: "<operation-id>" },
              }),
        ],
      },
    };
  }
}
