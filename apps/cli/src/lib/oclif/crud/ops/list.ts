import { spinner } from "@clack/prompts";
import { Flags } from "@oclif/core";
import { Paging } from "@zitadel/api/runtime/paging";

import { sanitizeResponse } from "../../../api-client";

import { nonBlankString } from "../../flags";

import type { CommandResult, GlobalOptions } from "../../types";
import { plainFlag } from "../../tabulatable";
import { wireOf } from "../wire";
import { type ParsedFilter, parseFilter, parseSort } from "../query";
import { parseOrThrow } from "../shared";
import { chosenColumns } from "../columns";
import { Cmd } from "../../../cmd";
import { fieldPaths } from "../paths";
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
    const pagingFlags = {
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
    };
    const presentation = {
      fields: nonBlankString({
        description:
          "Columns to show, comma-separated dot-paths (e.g. id,attributes.email). Defaults to the resource's own columns; `--json` is unaffected.",
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
            filter: nonBlankString({
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
            sort: nonBlankString({
              description: `Sort as field:direction (asc|desc). Fields: ${sorts.join(", ")}.`,
            }),
          }
        : {}),
    };
    return {
      description: `List ${topic}.${spec.drains === true ? " Fetches every page unless --limit or --page-token asks for one." : ""}`,
      examples: [
        `<%= config.bin %> ${topic} list --json`,
        ...(paged && spec.drains !== true ? [`<%= config.bin %> ${topic} list --all --json`] : []),
        ...(filters[0]
          ? [
              `<%= config.bin %> ${topic} list --filter ${filters[0].field}=${filters[0].operations[0]}:<value>${sorts[0] ? ` --sort ${sorts[0]}:desc` : ""}`,
            ]
          : []),
      ],
      flags: {
        ...(paged ? pagingFlags : {}),
        ...presentation,
        ...specific,
        ...options.flags,
        plain: plainFlag,
      },
      args: {},
    };
  }

  protected override async execute(
    { flags }: OperationInput,
    _meta: GlobalOptions,
  ): Promise<CommandResult> {
    const { topic, resource, spec, options } = this.definition;
    const wire = wireOf(options.wire);
    // With a schema in hand the columns are known before any request, so a
    // typo fails without contacting the server at all.
    const shape = fieldPaths(spec.item);
    const early = shape ? chosenColumns(flags.fields, resource.columns, [], shape) : undefined;
    // Every list's pages arrive as the server sent them, so the walk below
    // sends each cursor back unchanged and escapes only what the list answers.
    const ctx = await this.context({ verbatim: true });
    // An unpaged endpoint has no cursor flags to read and would reject the
    // parameters anyway, so nothing is sent and one request is the whole list.
    const paged = spec.paged !== false;
    const pageFields = (token?: string): Json =>
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
      parseFilter(String(raw), spec.filters ?? [], options.operations),
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
                paging: pageFields(token),
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
            ...pageFields(token),
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
    // The walk begins at the page --page-token names, if any.
    const first = typeof flags["page-token"] === "string" ? flags["page-token"] : undefined;
    const paging = new Paging({
      items: (response) => {
        return sanitizeResponse(spec.items(response));
      },
      next: (response) => {
        return spec.next?.(response);
      },
    });
    const walk = paging.walk(async (token, number) => {
      const page = await request(token ?? first);
      progress?.message(`Fetching ${topic} — page ${number}`);
      return page;
    });
    // The spinner owns the cursor and a SIGINT handler until it is stopped, so a
    // page that fails mid-drain has to stop it too; otherwise the error prints
    // under a live spinner and the handler outlives the command.
    const collected = await paging.collect(walk, { all }).catch((error: unknown) => {
      progress?.stop(`Fetching ${topic} failed`);
      throw error;
    });
    const { items } = collected;
    const next = sanitizeResponse(collected.next);
    progress?.stop(`Fetched ${items.length} ${items.length === 1 ? resource.singular : topic}`);

    const rows = items;
    const columns = early ?? chosenColumns(flags.fields, resource.columns, items);
    const empty = `No ${topic} found.`;
    const footer: string[] = [];
    const page = {
      token: next,
      command: `${topic} list`,
      flags: repeatedFlags(flags),
      cursorKey: wire.nextPageToken,
    };
    const extra = {};

    return this.listResult(
      { plain: flags.plain === true },
      {
        columns,
        rows,
        items,
        singular: resource.singular,
        plural: topic,
        empty,
        footer,
        page,
        extra,
      },
    );
  }
}

/**
 * The flags a follow-up page has to carry: a cursor is only valid with the
 * sorting and filters that produced it, and the page size is part of what the
 * caller asked for. Values are re-emitted exactly as they were typed.
 */
const repeatedFlags = (flags: Json): readonly string[] => {
  const limit = typeof flags.limit === "number" ? [`--limit ${flags.limit}`] : [];
  const sort = typeof flags.sort === "string" ? [Cmd.option("--sort", flags.sort)] : [];
  const filters = (Array.isArray(flags.filter) ? flags.filter : []).map((filter) =>
    Cmd.option("--filter", String(filter)),
  );
  return [...limit, ...sort, ...filters];
};

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
      params[key] = value;
      return params;
    }
    params[key] = Array.isArray(existing)
      ? [...existing, value]
      : existing === undefined
        ? [value]
        : [existing, value];
    return params;
  }, {});
