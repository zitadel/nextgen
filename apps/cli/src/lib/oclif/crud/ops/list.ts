import { spinner } from "@clack/prompts";
import { Flags } from "@oclif/core";

import { publicCliCommand } from "../../../public-cli";
import type { CommandResult, GlobalOptions } from "../../types";
import { collectPages } from "../paging";
import { parseFilter, parseSort } from "../query";
import { parseOrThrow } from "../shared";
import { chosenColumns } from "../columns";
import { fieldPaths, itemSchemaOf } from "../paths";
import { renderRows, renderTable } from "../table";
import type { Json, ListSpec } from "../types";
import {
  type OperationDefinition,
  type OperationInput,
  type OperationStatics,
  ResourceCommand,
} from "./command";

/**
 * `<topic> list`: one page by default, `--all` to drain, `--filter` / `--sort`
 * for query-backed lists or one flag per parameter for GET-backed ones.
 * Emits `{ items, count, next_page_token }` and a column table for humans.
 */
export class ListOperation<Ctx> extends ResourceCommand<Ctx, ListSpec<Ctx>> {
  static describe<Ctx>({
    topic,
    spec,
    options,
  }: OperationDefinition<Ctx, ListSpec<Ctx>>): OperationStatics {
    const paging = {
      limit: Flags.integer({
        description: "Page size (server default 20, max 100).",
        min: 1,
        max: 100,
      }),
      "page-token": Flags.string({
        description: "Continue from a previous page's next_page_token.",
      }),
      all: Flags.boolean({
        char: "a",
        description: "Fetch every page instead of one.",
        exclusive: ["page-token"],
      }),
      fields: Flags.string({
        description:
          "Columns to show, comma-separated dot-paths (e.g. id,attributes.email). Defaults to the resource's own columns; `--json` is unaffected.",
      }),
      plain: Flags.boolean({
        description:
          "Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.",
      }),
    };
    const specific =
      spec.kind === "query"
        ? {
            filter: Flags.string({
              multiple: true,
              description: `Filter as field=operation:value (operation defaults to equals). Fields: ${spec.filterFields.join(", ")}. Operations: ${options.operations.join(", ")}.`,
            }),
            sort: Flags.string({
              description: `Sort as field:direction (asc|desc). Fields: ${spec.sortFields.join(", ")}.`,
            }),
          }
        : Object.fromEntries(
            spec.params.map((p) => [
              p.flag,
              p.multiple
                ? Flags.string({
                    description: p.description,
                    multiple: true,
                    options: p.options && [...p.options],
                  })
                : Flags.string({
                    description: p.description,
                    options: p.options && [...p.options],
                  }),
            ]),
          );
    const example =
      spec.kind === "query"
        ? `--filter ${spec.filterFields[0]}=${options.operations[0]}:<value> --sort ${spec.sortFields[0]}:desc`
        : `--${spec.params[0]?.flag} ${spec.params[0]?.options?.[0] ?? "<value>"} --limit 50`;
    return {
      description: `List ${topic}.`,
      examples: [
        `<%= config.bin %> ${topic} list --json`,
        `<%= config.bin %> ${topic} list --all --json`,
        `<%= config.bin %> ${topic} list ${example}`,
      ],
      flags: { ...paging, ...specific, ...options.flags },
      args: {},
    };
  }

  protected override async execute(
    { flags }: OperationInput,
    meta: GlobalOptions,
  ): Promise<CommandResult> {
    const { topic, resource, spec, options } = this.definition;
    // With a schema in hand the columns are known before any request, so a
    // typo fails without contacting the server at all.
    const shape = fieldPaths(itemSchemaOf(spec.response, spec.items));
    const early = shape ? chosenColumns(flags.fields, resource.columns, [], shape) : undefined;
    const ctx = await this.connect(meta);
    const paging = (token?: string): Json => ({
      ...(typeof flags.limit === "number" && { limit: flags.limit }),
      ...(token && { page_token: token }),
    });

    // One request per page. A query body is validated against the schema
    // first, so an unknown filter field fails locally with the accepted
    // values rather than as a server 400.
    const request = (token?: string): Promise<unknown> =>
      spec.kind === "query"
        ? spec.call(
            ctx,
            parseOrThrow(
              spec.body,
              {
                ...paging(token),
                ...(typeof flags.sort === "string" && {
                  sorting: parseSort(flags.sort, spec.sortFields),
                }),
                ...(Array.isArray(flags.filter) &&
                  flags.filter.length > 0 && {
                    filter: flags.filter.map((raw) =>
                      parseFilter(String(raw), spec.filterFields, options.operations),
                    ),
                  }),
              },
              "Invalid list query",
              `Filter fields: ${spec.filterFields.join(", ")}. Sort fields: ${spec.sortFields.join(", ")}.`,
            ),
          )
        : spec.call(ctx, {
            ...paging(token),
            ...Object.fromEntries(
              spec.params
                .filter((p) => flags[p.flag] !== undefined)
                .map((p) => [p.param, flags[p.flag]]),
            ),
          });

    const all = flags.all === true;
    // `--all` is one request per page, so a wide drain would otherwise sit
    // silent. The spinner is terminal-only: no animation reaches a pipe, and
    // `--json` has already silenced everything.
    const progress = all && process.stdout.isTTY && !this.jsonEnabled() ? spinner() : undefined;
    progress?.start(`Fetching ${topic}`);
    let fetched = 0;
    let drained = false;
    // The spinner owns the cursor and a SIGINT handler until it is stopped, so a
    // page that fails mid-drain has to stop it too; otherwise the error prints
    // under a live spinner and the handler outlives the command.
    const { items, next } = await collectPages(
      async (token) => {
        const page = await request(token);
        fetched += 1;
        progress?.message(`Fetching ${topic} — page ${fetched}`);
        return page;
      },
      {
        items: spec.items,
        all,
        token: typeof flags["page-token"] === "string" ? flags["page-token"] : undefined,
      },
    )
      .then((page) => {
        drained = true;
        return page;
      })
      .finally(() => {
        if (!drained) {
          progress?.stop(`Fetching ${topic} failed`);
        }
      });
    progress?.stop(`Fetched ${items.length} ${items.length === 1 ? resource.singular : topic}`);

    // A terminal gets the aligned table with its header and footer; a pipe (or
    // `--plain`) gets one tab-separated record per line, which `cut` and `awk`
    // can split and nothing else has to parse around.
    const plain = flags.plain === true || !process.stdout.isTTY;
    const columns = early ?? chosenColumns(flags.fields, resource.columns, items);
    // A page token is only valid alongside the sorting and filters that issued
    // it, so the suggested next page repeats the whole invocation rather than
    // handing back a bare token. `--all` already drained everything, so it
    // suggests nothing.
    const nextCommands =
      next && !all
        ? [
            publicCliCommand(
              [`${topic} list`, ...repeatedFlags(spec, flags), `--page-token ${shellArg(next)}`, "--json"].join(
                " ",
              ),
              meta.cliVersion,
            ),
          ]
        : [];
    return {
      status: "ok",
      data: {
        items,
        count: items.length,
        next_page_token: next,
        ...(nextCommands.length > 0 ? { next_commands: nextCommands } : {}),
      },
      pretty: plain
        ? renderRows(columns, items)
        : items.length === 0
          ? `No ${topic} found.`
          : [
              renderTable(columns, items),
              "",
              `${items.length} ${items.length === 1 ? resource.singular : topic}`,
              ...(next ? [`More available: --page-token ${shellArg(next)} (or --all)`] : []),
            ].join("\n"),
    };
  }
}

/**
 * The flags a follow-up page has to carry: a cursor is only valid with the
 * sorting and filters that produced it, and the page size is part of what the
 * caller asked for. Values are re-emitted exactly as they were typed.
 */
const repeatedFlags = <Ctx>(spec: ListSpec<Ctx>, flags: Json): readonly string[] => {
  const parts: string[] = [];
  if (typeof flags.limit === "number") {
    parts.push(`--limit ${flags.limit}`);
  }
  if (spec.kind === "query") {
    if (typeof flags.sort === "string") {
      parts.push(`--sort ${shellArg(flags.sort)}`);
    }
    for (const filter of Array.isArray(flags.filter) ? flags.filter : []) {
      parts.push(`--filter ${shellArg(String(filter))}`);
    }
    return parts;
  }
  for (const param of spec.params) {
    const value = flags[param.flag];
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      parts.push(`--${param.flag} ${shellArg(String(one))}`);
    }
  }
  return parts;
};

/** Quote a value that a shell would otherwise split or interpret. */
const shellArg = (value: string): string =>
  /^[A-Za-z0-9_.:@/=+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;


