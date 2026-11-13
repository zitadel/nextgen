import { Flags } from "@oclif/core";
import { z } from "zod";

import { Paging } from "@/lib/backend/transport";
import { chosenColumns, readColumns } from "@/lib/oclif/crud/columns";
import { type FieldPaths, fieldPaths } from "@/lib/oclif/crud/paths";
import {
  type ParsedFilter,
  parseFilter,
  parseSort,
  type TypedFilter,
  type TypedSort,
} from "@/lib/oclif/crud/query";
import { parseOrThrow } from "@/lib/oclif/crud/shared";
import type { FilterField, Json, ListSpec } from "@/lib/oclif/crud/types";
import { wireOf } from "@/lib/oclif/crud/wire";
import { nonBlankString, type Refused, reads, whole } from "@/lib/oclif/flags";
import { plainFlag } from "@/lib/oclif/tabulatable";
import type { CommandResult } from "@/lib/oclif/types";

import {
  type OperationDefinition,
  type OperationInput,
  type OperationStatics,
  ResourceCommand,
} from "./command";

type ListFlags = Readonly<{
  limit?: number;
  pageToken?: string;
  all?: boolean;
  fields?: readonly string[];
  filter?: readonly TypedFilter[];
  sort?: TypedSort;
  plain?: boolean;
}>;

type ListInput = OperationInput<ListFlags, Json>;

/**
 * `<topic> list`: one page by default, `--all` to drain, `--filter` / `--sort`
 * for query-backed lists or one flag per parameter for GET-backed ones.
 * Emits `{ items, count, next_page_token }` and a column table for humans.
 */
/** The page sizes the server accepts, quoted by the refusal and the reference. */
const LIMIT_MIN = 1;
const LIMIT_MAX = 100;

/** What a page size the server would refuse is refused for. */
const LIMIT = {
  schema: whole.pipe(z.number().min(LIMIT_MIN).max(LIMIT_MAX)),
  refusal: {
    message: "{value} is not a valid page size",
    hint: "Use a whole number from {min} to {max}.",
  },
  values: {
    min: LIMIT_MIN,
    max: LIMIT_MAX,
  },
} as const satisfies Refused<number>;

export class ListOperation<Ctx> extends ResourceCommand<Ctx, ListSpec<Ctx>, ListInput> {
  static describe<Ctx>({
    topic,
    resource,
    spec,
    options,
  }: OperationDefinition<Ctx, ListSpec<Ctx>>): OperationStatics {
    const paged = spec.paged !== false;
    const pagingFlags = {
      limit: Flags.custom<number>({
        parse: reads(LIMIT),
      })({
        description: "Page size (server default 20, max 100).",
        min: LIMIT_MIN,
        max: LIMIT_MAX,
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
      fields: Flags.custom<
        readonly string[],
        Readonly<{ fallback: readonly string[]; shape?: FieldPaths }>
      >({
        parse: async (input, _command, flag) => {
          return readColumns(input, flag.fallback, flag.shape);
        },
      })({
        description:
          "Columns to show, comma-separated dot-paths (e.g. id,attributes.email). Defaults to the resource's own columns; `--json` is unaffected.",
        fallback: resource.columns,
        shape: fieldPaths(spec.item),
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
            filter: Flags.custom<
              TypedFilter,
              Readonly<{ filters: readonly FilterField[]; operations: readonly string[] }>
            >({
              parse: async (input, _command, flag) => {
                return {
                  raw: input,
                  ...parseFilter(input, flag.filters, flag.operations),
                };
              },
            })({
              multiple: true,
              filters,
              operations: options.operations,
              description: `Filter as field=operation:value (operation defaults to equals). Fields: ${filters
                .map((field) => {
                  return `${field.field} (${field.operations.join("|")}${field.values ? `; values ${field.values.join("|")}` : ""}${field.combine === "or" ? "; repeats widen" : ""})`;
                })
                .join(", ")}.`,
            }),
          }
        : {}),
      ...(sorts.length > 0
        ? {
            sort: Flags.custom<TypedSort, Readonly<{ sorts: readonly string[] }>>({
              parse: async (input, _command, flag) => {
                return {
                  raw: input,
                  ...parseSort(input, flag.sorts),
                };
              },
            })({
              sorts,
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

  protected override async operate({ flags }: ListInput): Promise<CommandResult> {
    const { topic, resource, spec, options } = this.definition;
    const wire = wireOf(options.wire);
    const shape = fieldPaths(spec.item);
    // The pages arrive as the server sent them, cursor included, so a token
    // goes back exactly as it came. Nothing here spells out what could drive a
    // terminal, because nothing here prints: a row reaches a person through
    // `emitList`, whose cells are spelled out as they are read, and reaches a
    // script through the envelope, which the serialiser escapes.
    const ctx = await this.context();
    // An unpaged endpoint has no cursor flags to read and would reject the
    // parameters anyway, so nothing is sent and one request is the whole list.
    const paged = spec.paged !== false;
    const pageFields = (token?: string): Json => {
      return paged
        ? {
            ...(flags.limit !== undefined && { [wire.limit]: flags.limit }),
            ...(token && { [wire.pageToken]: token }),
          }
        : {};
    };

    const given = flags.filter ?? [];
    // A field that declares a default contributes it only when the caller did
    // not name that field, so naming it always wins.
    const defaults = (spec.filters ?? []).flatMap((field) => {
      return field.default !== undefined &&
        !given.some((one) => {
          return one.field.field === field.field;
        })
        ? [{ field, operation: "equals", value: field.default }]
        : [];
    });
    const parsed = [...given, ...defaults];
    const sorting = flags.sort && {
      field: flags.sort.field,
      direction: flags.sort.direction,
    };

    // Transport is the only thing that differs: a structured query endpoint
    // takes a validated body, a GET list takes flat parameters. The caller
    // typed the same thing either way.
    const request = (token?: string): Promise<unknown> => {
      return spec.body
        ? spec.call(
            ctx,
            parseOrThrow(
              spec.body,
              wire.query({
                paging: pageFields(token),
                sorting,
                filters: parsed.map(({ field, operation, value }) => {
                  return {
                    field: field.field,
                    operation,
                    value,
                  };
                }),
              }),
              "Invalid list query",
              `Filter fields: ${(spec.filters ?? [])
                .map((one) => {
                  return one.field;
                })
                .join(", ")}. Sort fields: ${(spec.sorts ?? []).join(", ")}.`,
            ),
          )
        : spec.call(ctx, {
            ...pageFields(token),
            ...queryParams(parsed),
            ...(sorting && spec.sortParam ? { [spec.sortParam]: sorting.direction } : {}),
          });
    };

    // A resource that drains by default does so only when the caller named no
    // page: asking for one with --limit or --page-token is asking for one.
    const asked = flags.limit !== undefined || flags.pageToken !== undefined;
    const all = paged && (flags.all === true || (spec.drains === true && !asked));
    const plural = resource.plural ?? topic;
    const progress = all ? this.ui.spinner(`Fetching ${plural}`) : undefined;
    const paging = new Paging({
      items: (response) => {
        return spec.items(response);
      },
      next: (response) => {
        return spec.next?.(response);
      },
    });
    const walk = paging.walk(async (token, number) => {
      // The walk begins at the page --page-token names, if any.
      const page = await request(token ?? flags.pageToken);
      progress?.message(`Fetching ${plural} — page ${number}`);

      return page;
    });
    // The spinner owns the cursor and a SIGINT handler until it is stopped, so a
    // page that fails mid-drain has to stop it too; otherwise the error prints
    // under a live spinner and the handler outlives the command.
    const collected = await paging.collect(walk, { all }).catch((error: unknown) => {
      progress?.clear();
      throw error;
    });
    const { items, next } = collected;
    progress?.stop(
      `Fetched ${items.length} ${new Intl.PluralRules("en").select(items.length) === "one" ? resource.singular : plural}`,
    );

    const rows = items;
    const columns = chosenColumns(flags.fields, resource.columns, items, shape);
    const footer: string[] = [];
    const page = {
      token: next,
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
        plural,
        empty: next ? `No ${plural} on this page` : `No ${plural} found`,
        footer,
        page,
        extra,
      },
    );
  }
}

/**
 * Parsed filters as the flat query parameters a GET list expects. A field
 * names the parameter each of its operations travels as, and a field whose
 * repeats widen collects its values into an array rather than overwriting.
 */
const queryParams = (parsed: readonly ParsedFilter[]): Json => {
  return parsed.reduce<Record<string, unknown>>((params, { field, operation, value }) => {
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
};
