import { Args } from "@oclif/core";

import { Operation } from "@/lib/backend";
import {
  type Admitted,
  BaseCommand,
  CommandGroups,
  type JsonEnvelope,
  nonBlankString,
} from "@/lib/oclif";
import { plainFlag, Tabulatable } from "@/lib/oclif/tabulatable";

/** The columns `ls` renders, in order. */
const COLUMNS = ["id", "method", "path", "summary"] as const;

/** One operation as `api ls` lists it. */
function entryOf(operation: Operation) {
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
}

/**
 * `zitadel api ls` — the operations `zitadel api` can call, from the spec the
 * CLI was built with. It talks to no server, so the answer is the same
 * offline. `--json` carries each one's parameters, body and paging, which is
 * what an agent needs to build the call.
 */
export default class ApiLs extends Tabulatable(BaseCommand) {
  static override description = "List the operations of the Zitadel API that `zitadel api` calls.";
  static override group = CommandGroups.diagnostics;
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
    plain: plainFlag,
  };

  static override meta = {
    resolveServer: false,
  };

  protected async execute({ args, flags }: Admitted<typeof ApiLs>): Promise<JsonEnvelope> {
    const items = Operation.all({
      filter: args.filter,
      tag: flags.tag,
    }).map((operation) => {
      return entryOf(operation);
    });

    const rows = items;
    const columns = COLUMNS;
    const empty = `No operations match. \`${this.config.bin} api ls\` lists every one.`;
    const footer = [
      `Call one with \`${this.config.bin} api <id>\`; --json has each one's parameters.`,
    ];
    const page = null;
    const extra = {};
    const data = {
      operations: items,
      count: items.length,
    };

    return this.emitList(flags, {
      columns,
      rows,
      singular: "operation",
      empty,
      footer,
      page,
      extra,
      data,
    });
  }
}
