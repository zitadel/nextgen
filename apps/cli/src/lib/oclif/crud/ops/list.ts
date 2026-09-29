import { spinner } from "@clack/prompts";
import { Flags } from "@oclif/core";

import { publicCliCommand } from "../../../public-cli";
import type { CommandResult, GlobalOptions } from "../../types";
import { collectPages } from "../paging";
import { wireOf } from "../wire";
import { type ParsedFilter, parseFilter, parseSort } from "../query";
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
    const paged = spec.paged !== false;
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
    };
    const presentation = {
      fields: Flags.string({
        description:
          "Columns to show, comma-separated dot-paths (e.g. id,attributes.email). Defaults to the resource's own columns; `--json` is unaffected.",
      }),
      plain: Flags.boolean({
        description:
          "Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.",
      }),
    };
    const filters = spec.filters ?? [];
    const sorts = spec.sorts ?? [];
    // One `--filter` for every list. The help names each field with the
    // operations that field accepts, so a grammar the endpoint cannot honour
    // is visible before it is typed rather than after it fails.
    const specific = {
      ...(filters.length > 0
        ? {
            filter: Flags.string({
              multiple: true,
              description: `Filter as field=operation:value (operation defaults to equals). Fields: ${filters
                .map(
                  (field) =>
                    `${field.field} (${field.operations.join("|")}${field.values ? `; values ${field.values.join("|")}` : ""}${field.combine === "or" ? "; repeats widen" : ""})`,
                )
                .join(", ")}.`,
            }),
          }
        : {}),
      ...(sorts.length > 0
        ? {
            sort: Flags.string({
              description: `Sort as field:direction (asc|desc). Fields: ${sorts.join(", ")}.`,
            }),
          }
        : {}),
    };
    return {
      description: `List ${topic}.${spec.drains === true ? " Fetches every page unless --limit or --page-token asks for one." : ""}`,
      examples: [
        `<%= config.bin %> ${topic} list --json`,
        ...(paged && spec.drains !== true
          ? [`<%= config.bin %> ${topic} list --all --json`]
          : []),
        ...(filters[0]
          ? [
              `<%= config.bin %> ${topic} list --filter ${filters[0].field}=${filters[0].operations[0]}:<value>${sorts[0] ? ` --sort ${sorts[0]}:desc` : ""}`,
            ]
          : []),
      ],
      flags: { ...(paged ? paging : {}), ...presentation, ...specific, ...options.flags },
      args: {},
    };
  }

  protected override async execute(
    { flags }: OperationInput,
    meta: GlobalOptions,
  ): Promise<CommandResult> {
    const { topic, resource, spec, options } = this.definition;
    const wire = wireOf(options.wire);
    // With a schema in hand the columns are known before any request, so a
    // typo fails without contacting the server at all.
    const shape = fieldPaths(itemSchemaOf(spec.response, spec.items));
    const early = shape ? chosenColumns(flags.fields, resource.columns, [], shape) : undefined;
    const ctx = await this.connect(meta);
    // An unpaged endpoint has no cursor flags to read and would reject the
    // parameters anyway, so nothing is sent and one request is the whole list.
    const paged = spec.paged !== false;
    const paging = (token?: string): Json =>
      paged
        ? {
            ...(typeof flags.limit === "number" && { [wire.limit]: flags.limit }),
            ...(token && { [wire.pageToken]: token }),
          }
        : {};

    // One request per page. Filters are parsed and checked against each
    // field's own declaration first, so an operation the endpoint does not
    // offer fails locally with what that field accepts.
    const given = (Array.isArray(flags.filter) ? flags.filter : []).map((raw) =>
      parseFilter(String(raw), spec.filters ?? []),
    );
    // A field that declares a default contributes it only when the caller did
    // not name that field, so naming it always wins.
    const defaults = (spec.filters ?? []).flatMap((field) =>
      field.default !== undefined && !given.some((one) => one.field.field === field.field)
        ? [{ field, operation: "equals", value: field.default }]
        : [],
    );
    const parsed = [...given, ...defaults];
    const sorting =
      typeof flags.sort === "string" ? parseSort(flags.sort, spec.sorts ?? []) : undefined;

    // Transport is the only thing that differs: a structured query endpoint
    // takes a validated body, a GET list takes flat parameters. The caller
    // typed the same thing either way.
    const request = (token?: string): Promise<unknown> =>
      spec.body
        ? spec.call(
            ctx,
            parseOrThrow(
              spec.body,
              wire.query({
                paging: paging(token),
                sorting,
                filters: parsed.map(({ field, operation, value }) => ({
                  field: field.field,
                  operation,
                  value,
                })),
              }),
              "Invalid list query",
              `Filter fields: ${(spec.filters ?? []).map((f) => f.field).join(", ")}. Sort fields: ${(spec.sorts ?? []).join(", ")}.`,
            ),
          )
        : spec.call(ctx, {
            ...paging(token),
            ...queryParams(parsed),
            ...(sorting && spec.sortParam ? { [spec.sortParam]: sorting.direction } : {}),
          });

    // A resource that drains by default does so only when the caller named no
    // page: asking for one with --limit or --page-token is asking for one.
    const asked = flags.limit !== undefined || flags["page-token"] !== undefined;
    const all = paged && (flags.all === true || (spec.drains === true && !asked));
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
        nextPageToken: wire.nextPageToken,
        token:
          paged && typeof flags["page-token"] === "string" ? flags["page-token"] : undefined,
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
              [`${topic} list`, ...repeatedFlags(flags), `--page-token ${shellArg(next)}`, "--json"].join(
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
        [wire.nextPageToken]: next,
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
const repeatedFlags = (flags: Json): readonly string[] => {
  const limit = typeof flags.limit === "number" ? [`--limit ${flags.limit}`] : [];
  const sort = typeof flags.sort === "string" ? [`--sort ${shellArg(flags.sort)}`] : [];
  const filters = (Array.isArray(flags.filter) ? flags.filter : []).map(
    (filter) => `--filter ${shellArg(String(filter))}`,
  );
  return [...limit, ...sort, ...filters];
};

/** Quote a value that a shell would otherwise split or interpret. */
const shellArg = (value: string): string =>
  /^[A-Za-z0-9_.:@/=+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;



/**
 * Parsed filters as the flat query parameters a GET list expects. A field
 * names the parameter each of its operations travels as, and a field whose
 * repeats widen collects its values into an array rather than overwriting.
 */
const queryParams = (parsed: readonly ParsedFilter[]): Json =>
  parsed.reduce<Record<string, unknown>>((params, { field, operation, value }) => {
    const key = field.params?.[operation] ?? field.field;
    const existing = params[key];
    if (field.combine !== "or") {
      return { ...params, [key]: value };
    }
    return {
      ...params,
      [key]: Array.isArray(existing) ? [...existing, value] : existing === undefined ? [value] : [existing, value],
    };
  }, {});
