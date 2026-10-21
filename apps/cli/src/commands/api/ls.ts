import { Args, Flags } from "@oclif/core";

import { type ApiOperation, findOperations, uncallable } from "../../lib/api/operations";
import { renderRows, renderTable } from "../../lib/oclif/crud/table";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";

/** One operation as `api ls` lists it. */
const entryOf = (operation: ApiOperation) => ({
  id: operation.id,
  method: operation.method,
  path: operation.path,
  summary: operation.summary,
  tag: operation.tag,
  auth: operation.auth,
  callable: uncallable(operation) === undefined,
  parameters: operation.parameters,
  body: operation.body,
  paging: operation.paging,
  command: operation.cli,
});

/**
 * `zitadel api ls` — the operations `zitadel api` can call, from the spec the
 * CLI was built with. It talks to no server, so the answer is the same
 * offline. `--json` carries each one's parameters, body and paging, which is
 * what an agent needs to build the call.
 */
export default class ApiLs extends BaseCommand {
  static override group = CommandGroups.resources;
  static override groupOrder = 1;
  static override description = "List the operations of the Zitadel API that `zitadel api` calls.";
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
    tag: Flags.string({
      description: "Only the operations of this part of the API (Users, Teams, …).",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(ApiLs);
    await this.toMeta(flags, { resolveServer: false });
    const operations = findOperations({ filter: args.filter, tag: flags.tag }).map(entryOf);

    const columns = ["id", "method", "path", "summary"];
    return this.emit({
      status: "ok",
      data: { operations, count: operations.length },
      pretty: process.stdout.isTTY
        ? [
            renderTable(columns, operations),
            "",
            `${operations.length} operations. Call one with \`${this.config.bin} api <id>\`; --json has each one's parameters.`,
          ].join("\n")
        : renderRows(columns, operations),
    });
  }
}
