import { Flags } from "@oclif/core";

import { parseColumns } from "./columns";
import { readAssignment } from "./assign";
import type { Assignment } from "./assign";
import type { BodyField } from "./fields";
import type { FieldPaths } from "./paths";
import { type ParsedFilter, parseFilter, parseSort } from "./query";
import type { FilterField } from "./types";
import type { ZodLike } from "./zod";

/** A `--filter` entry, read, with the text it was typed as. */
export type TypedFilter = ParsedFilter & Readonly<{ raw: string }>;

/** A `--sort` entry, read, with the text it was typed as. */
export type TypedSort = Readonly<{ raw: string; field: string; direction: string }>;

/** A list's `--filter`: each entry is read against the fields the list declares. */
export const filterFlag = Flags.custom<
  TypedFilter,
  Readonly<{ filters: readonly FilterField[]; operations: readonly string[] }>
>({
  parse: async (input, _command, flag) => {
    return {
      raw: input,
      ...parseFilter(input, flag.filters, flag.operations),
    };
  },
});

/** A list's `--sort`, read against the fields the list can be sorted by. */
export const sortFlag = Flags.custom<TypedSort, Readonly<{ sorts: readonly string[] }>>({
  parse: async (input, _command, flag) => {
    return {
      raw: input,
      ...parseSort(input, flag.sorts),
    };
  },
});

/**
 * `--fields`: the columns to show. `shape` is what the record can carry, when
 * a schema says so, and `fallback` is what the hint offers as an example.
 */
export const fieldsFlag = Flags.custom<
  readonly string[],
  Readonly<{ fallback: readonly string[]; shape?: FieldPaths }>
>({
  parse: async (input, _command, flag) => parseColumns(input, flag.fallback, flag.shape),
});

/** `--set`: one field of the body by its path, read against the body's schema. */
export const setFlag = Flags.custom<
  Assignment,
  Readonly<{ document: ZodLike | undefined; fields: readonly BodyField[] }>
>({
  parse: async (input, _command, flag) => readAssignment(input, flag.document, flag.fields),
});
