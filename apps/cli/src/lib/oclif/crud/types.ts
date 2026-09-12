import type { Interfaces } from "@oclif/core";

import type { GlobalOptions } from "../types";

/**
 * Contract between a resource registry and the CRUD factory. Everything is
 * parameterised over `Ctx`, the caller-supplied platform connection every
 * verb calls through; the factory itself never sees a client.
 */

export type Verb = "list" | "get" | "create" | "update" | "delete" | "revoke";
export type ResourceCommandId = `${string}:${Verb}`;
export type Json = Readonly<Record<string, unknown>>;
export type Page = Readonly<{ items: readonly unknown[]; next: string | null }>;

/** Structural subset of a Zod schema; keeps the factory free of a Zod import. */
export type Schema = {
  safeParse: (value: unknown) => { success: boolean; data?: unknown; error?: { issues: unknown } };
};

/**
 * A `list` verb backed by a structured query endpoint (`POST /<resource>/query`).
 * The factory assembles `{limit, page_token, sorting, filter}` from flags,
 * validates it against `body`, and hands it to `call`. `filterFields` /
 * `sortFields` feed `--help`; pin them to the schema with a test.
 */
export type QueryListSpec<Ctx> = Readonly<{
  kind: "query";
  /** Response property holding the page of items. */
  items: string;
  /**
   * Generated response schema. `--fields` is checked against the record shape
   * it describes, so the same arguments are valid whether a page came back full
   * or empty.
   */
  response?: Schema;
  body: Schema;
  filterFields: readonly string[];
  sortFields: readonly string[];
  call: (ctx: Ctx, body: Json) => Promise<unknown>;
}>;

/** One query-string parameter of a GET-style list, lifted to a CLI flag. */
export type ParamFlag = Readonly<{
  /** Flag name as typed on the command line (kebab-case). */
  flag: string;
  /** Parameter name on the wire. */
  param: string;
  description: string;
  /** Repeatable flag → array parameter. */
  multiple?: boolean;
  /** Closed set of accepted values, enforced by oclif at parse time. */
  options?: readonly string[];
}>;

/** A `list` verb backed by a GET endpoint whose filters are query parameters. */
export type ParamsListSpec<Ctx> = Readonly<{
  kind: "params";
  items: string;
  /** Generated response schema; see {@link QueryListSpec.response}. */
  response?: Schema;
  params: readonly ParamFlag[];
  call: (ctx: Ctx, params: Json) => Promise<unknown>;
}>;

export type ListSpec<Ctx> = QueryListSpec<Ctx> | ParamsListSpec<Ctx>;
export type GetSpec<Ctx> = Readonly<{
  call: (ctx: Ctx, id: string) => Promise<unknown>;
  /** Generated response schema of the record itself; see {@link QueryListSpec.response}. */
  response?: Schema;
}>;
export type CreateSpec<Ctx> = Readonly<{
  schema: Schema;
  call: (ctx: Ctx, body: Json) => Promise<unknown>;
}>;
export type UpdateSpec<Ctx> = Readonly<{
  schema: Schema;
  call: (ctx: Ctx, id: string, body: Json) => Promise<unknown>;
}>;
export type DeleteSpec<Ctx> = Readonly<{
  /** Command verb; defaults to `delete`. */
  verb?: "delete" | "revoke";
  /**
   * What the API actually does, when that is not removal — a team's DELETE
   * deactivates it and leaves it readable (ADR 024). Reported to the caller
   * instead of claiming the resource is gone. Defaults to the verb's own past
   * tense (`deleted`, `revoked`).
   */
  outcome?: string;
  call: (ctx: Ctx, id: string) => Promise<void>;
}>;

/** One CLI topic. The factory turns it into up to five command classes. */
export type ResourceDescriptor<Ctx> = Readonly<{
  /** Singular noun for messages (`user`). */
  singular: string;
  /** Property carrying the resource's own id on the wire. */
  idField: string;
  /** Dot-paths projected into the human-readable table; `--json` carries the full resource. */
  columns: readonly string[];
  /**
   * Dot-path whose value heads the human rendering of `get` (a user's
   * identifier, a team's name). Falls back to {@link idField}.
   */
  heading?: string;
  /**
   * Ordered dot-paths `get` shows on a terminal. Defaults to {@link columns};
   * a record usually deserves more detail than a table row.
   */
  detail?: readonly string[];
  list?: ListSpec<Ctx>;
  get?: GetSpec<Ctx>;
  create?: CreateSpec<Ctx>;
  update?: UpdateSpec<Ctx>;
  delete?: DeleteSpec<Ctx>;
}>;

export type ResourceRegistry<Ctx> = Readonly<Record<string, ResourceDescriptor<Ctx>>>;

export type ResourceCommandOptions<Ctx> = Readonly<{
  /** Opens the platform connection every verb calls through; runs after flag parsing. */
  connect: (meta: GlobalOptions) => Promise<Ctx>;
  /** Filter operations the query endpoints accept (`equals`, `contains`, …). */
  operations: readonly string[];
  /** Extra flags added to every generated command (e.g. an environment selector). */
  flags?: Interfaces.FlagInput;
}>;
