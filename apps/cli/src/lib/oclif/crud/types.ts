import type { Interfaces } from "@oclif/core";

import type { CommandGroup } from "../groups";
import type { Connection } from "../environment-command";
import type { References } from "./secrets";

/**
 * Contract between a resource registry and the CRUD factory. Everything is
 * parameterised over `Ctx`, the caller-supplied platform connection every
 * verb calls through; the factory itself never sees a client.
 */

export type Verb = "list" | "get" | "create" | "update" | "delete" | "revoke" | "deactivate";
export type ResourceCommandId = `${string}:${Verb}`;
export type Json = Readonly<Record<string, unknown>>;

/**
 * Structural subset of a Zod schema (a `ZodType<B>` satisfies it); keeps the
 * factory free of a Zod import while carrying the parsed body type `B`.
 */
export type Schema<B = unknown> = {
  safeParse: (
    value: unknown,
  ) => { success: true; data: B } | { success: false; error: { issues: unknown } };
};

/**
 * One filterable field of a list, and what the endpoint will actually accept
 * for it. Declaring this per field is what lets every list share a single
 * `--filter field=operation:value` grammar: a structured query endpoint
 * (`POST /<resource>/query`) usually accepts every operation, while a `GET`
 * list accepts `equals` on a handful of query parameters. The CLI offers the
 * same spelling for both and refuses — locally, naming the field — anything
 * the endpoint cannot honour, rather than presenting one grammar per
 * transport.
 */
export type FilterField = Readonly<{
  /** Name as typed in `--filter` — the field as the API names it. */
  field: string;
  /** Operations this field accepts. */
  operations: readonly string[];
  /**
   * `GET` transport only: the query parameter each operation is sent as, when
   * it is not the field's own name. An endpoint that spells a range as two
   * parameters (`created_after`, `created_before`) maps them here, so the
   * caller still writes `created_at=greater_than:…`.
   */
  params?: Readonly<Record<string, string>>;
  /** Closed value set, enforced before any request. */
  values?: readonly string[];
  /**
   * Value sent when the caller does not name this field. Use it where the
   * server's own default is not the answer most callers want: a revisioned
   * collection lists every revision by default, while someone typing `list`
   * usually means "show me the current ones".
   */
  default?: string;
  /**
   * How repeated uses of this field combine. `and` (the default) narrows;
   * `or` widens, which is what a `GET` list does with a repeated parameter.
   * Stated per field because it is not inferable and changes what a query
   * means.
   */
  combine?: "and" | "or";
  /** Extra help beyond the generated line. */
  description?: string;
}>;

/**
 * A `list` verb. Transport is an implementation detail of `call`: a spec
 * carrying `body` is validated and sent as a structured query, and one
 * without it is sent as flat query parameters. Everything the caller sees —
 * the flags, the grammar, the envelope — is the same either way.
 */
export type ListSpec<Ctx, B = Json, P = unknown, T = unknown> = Readonly<{
  /**
   * Generated schema of one listed item. `--fields` is checked against the
   * record shape it describes, so the same arguments are valid whether a page
   * came back full or empty.
   */
  item?: Schema;
  /**
   * Whether a bare invocation drains every page. Off by default: a page is the
   * honest answer for an unbounded collection. A resource turns it on when a
   * partial answer would read as a complete one — a revision history shown
   * twenty rows deep looks finished rather than truncated. `--limit` and
   * `--page-token` still fetch a single page.
   */
  drains?: boolean;
  /**
   * Generated request-body schema of a structured query endpoint. Its presence
   * selects that transport; a `GET` list omits it.
   */
  body?: Schema<B>;
  /** Filterable fields; omit for a list that accepts none. */
  filters?: readonly FilterField[];
  /** Sortable fields; omit for a list that cannot be sorted. */
  sorts?: readonly string[];
  /**
   * `GET` transport only: the query parameter carrying the sort direction,
   * for an endpoint that orders by one implicit field.
   */
  sortParam?: string;
  call(ctx: Ctx, request: B): Promise<P>;
  /**
   * The items a page holds, read off the page `call` answers with (or the page
   * itself, for an endpoint that answers with the array). Method syntax, so a
   * spec typed by its page still assigns to the erased spec the registry holds.
   */
  items(page: P): readonly T[];
}> &
  (PagedList<P> | UnpagedList);

/**
 * A cursor-paginated list (ADR 027), the default: it reads the cursor to the
 * page after `page` off it the same way as its items, empty or missing on the
 * last page.
 */
type PagedList<P> = Readonly<{
  paged?: true;
  next(page: P): string | null | undefined;
}>;

/**
 * A list whose endpoint returns its whole collection in one response, so the
 * paging flags are not generated, no cursor is sent, and none is read.
 */
type UnpagedList = Readonly<{ paged: false; next?: never }>;

/**
 * Every dot-path into `T`: its fields, and the fields of the objects below
 * them, stopping at arrays. What a resource's columns and detail may name.
 *
 * Only declared fields count: an index signature would let any name through.
 * A union `T` (a `get` that answers with either of two records) names only the
 * paths every member has, as `keyof` does.
 */
export type FieldPath<T> = [T] extends [readonly unknown[]]
  ? never
  : [T] extends [object]
    ? {
        // Not mapped over `keyof T`, so a union is not split per member: each
        // level recurses into the union of the members' fields.
        [K in DeclaredKeys<T>]-?: K | `${K}.${FieldPath<NonNullable<T[K & keyof T]>>}`;
      }[DeclaredKeys<T>]
    : never;

// The named fields every member of `T` declares. Mapped over `keyof T` itself,
// which visits declared fields one by one even beside an index signature
// (`keyof T & string` would collapse them into it); `keyof` of the per-member
// results keeps only the ones all members share.
type DeclaredKeys<T> = keyof {
  [K in keyof T as K extends string ? (string extends K ? never : K) : never]: unknown;
} &
  string;

// Method syntax for the same reason as `CreateSpec`: a spec typed by its
// record `R` still assigns to the erased spec the registry holds.
export type GetSpec<Ctx, R = unknown> = Readonly<{
  call(ctx: Ctx, id: string): Promise<R>;
  /** Generated response schema of the record itself; see {@link ListSpec.item}. */
  response?: Schema;
  /**
   * Blocks a terminal shows under the fields, for a value that does not read
   * on one line (a release's pointers). Skipped when `--fields` picks the view.
   */
  sections?(item: R): readonly string[];
}>;
/**
 * What a write answers with: a record, or nothing for a write that answers
 * without a body, which the generated client types as `void`.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: the generated client's own type for an empty answer.
export type WriteResult = Json | void;

// Method syntax makes `body` bivariant, so a concrete-body spec still assigns to
// the erased spec the registry and factory hold; the body/schema fit is checked
// at the builder call site, not as bodies flow through the factory.
export type CreateSpec<Ctx, B = Json, C = WriteResult> = Readonly<
  WriteShape & {
    schema: Schema<B>;
    call(ctx: Ctx, body: B): Promise<C>;
  }
>;
export type UpdateSpec<Ctx, B = Json, U = WriteResult> = Readonly<
  WriteShape & {
    schema: Schema<B>;
    call(ctx: Ctx, id: string, body: B): Promise<U>;
  }
>;

/** What a write declares about its body beyond the schema. */
export type WriteShape = Readonly<{
  /**
   * Property of the request body the resource's document sits under (`idp`).
   * Field flags, `--set` paths, `--data` and `--file` then address the
   * document itself — the shape the resource has in a file under `.zitadel/`
   * and in `get --json` — and the factory wraps it on the way out.
   */
  root?: string;
  /**
   * The flags of the command's leading example, for a body whose rules the
   * required fields cannot carry: a grant names exactly one of `user` and
   * `team`, which no generated example can know.
   */
  example?: string;
}>;
export type DeleteSpec<Ctx> = Readonly<{
  /**
   * The command verb, when the endpoint does something other than remove the
   * resource. `delete` means the thing is gone; an operation that changes a
   * resource's state while leaving it readable is named after what it does —
   * a session is `revoke`d, a team is `deactivate`d (ADR 024).
   *
   * This follows `gh`, which deletes secrets and keys but closes, locks and
   * merges pull requests, and has no `pr delete` at all. Spelling a
   * deactivation `delete` would tell the user the team is gone when it is
   * still there. Defaults to `delete`.
   */
  verb?: Extract<Verb, "delete" | "revoke" | "deactivate">;
  /**
   * The property reported beside the id, naming what the server did. Defaults
   * to the verb's own past tense (`deleted`, `revoked`, `deactivated`).
   */
  outcome?: string;
  call: (ctx: Ctx, id: string) => Promise<void>;
}>;

/** One CLI topic. The factory turns it into up to five command classes. */
export type ResourceDescriptor<Ctx> = Readonly<{
  /** Singular noun for messages (`user`). */
  singular: string;
  /**
   * Group the root help lists this resource's commands under. Generated
   * commands have no file to carry a `static group`, so the table says it.
   */
  group?: CommandGroup;
  /** Position of the resource's row within its group on the root help, lowest first. */
  groupOrder?: number;
  /** Property carrying the resource's own id on the wire. */
  idField: string;
  /**
   * The id a write answered with, read off its result. The registry's
   * `resource` builder makes it from `idField`, typed against each write, so
   * the write commands read no field by name. Method syntax, so a reader typed
   * by its write still assigns to the erased descriptor.
   */
  idOf(written: Json): unknown;
  /**
   * Name of the positional argument the verbs take, and the word `--help`
   * shows. Defaults to `id`; a resource addressed by something else names it
   * (an environment is fetched by `name`), so the usage line reads as the API
   * does rather than calling everything an id.
   */
  idArg?: string;
  /**
   * What the positional accepts, for `--help`. Defaults to
   * `<singular> <idArg>`, which reads well when the argument is an `id` or a
   * `name` but not when a resource takes more than one kind of reference.
   * `get` also reads it into its summary, "Get one <singular> by …", so word
   * it as a noun phrase that follows "by".
   */
  idDescription?: string;
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

/**
 * How the platform spells cursor pagination and structured queries on the
 * wire. The defaults are this API's ({@link DEFAULT_WIRE}); a platform that
 * spells its cursor differently overrides them rather than the factory
 * carrying one API's vocabulary as though it were universal.
 */
export type WireConventions = Readonly<{
  /** Request property carrying the page size. */
  limit: string;
  /** Request property carrying the cursor. */
  pageToken: string;
  /**
   * Envelope property the next page's cursor is reported under, as this
   * platform spells it. Only the name: the cursor itself is read off each page
   * by its list's own `next`.
   */
  nextPageToken: string;
  /** Assembles the structured-query body from the parts the flags produced. */
  query: (parts: QueryParts) => Json;
}>;

/** The pieces of a structured query, before the platform decides their shape. */
export type QueryParts = Readonly<{
  /** Already spelled with this platform's paging property names. */
  paging: Json;
  filters: readonly Readonly<{ field: string; operation: string; value: string }>[];
  sorting?: Readonly<{ field: string; direction: string }>;
}>;

export type ResourceCommandOptions<Ctx> = Readonly<{
  /**
   * Shapes the platform connection every verb calls through. It receives the
   * command's own `connect`, so nothing connects until a verb needs it.
   */
  connect: (open: () => Promise<Connection>) => Promise<Ctx>;
  /** Extra flags added to every generated command. */
  flags?: Interfaces.FlagInput;
  /** Wire vocabulary; each property falls back to {@link DEFAULT_WIRE}. */
  wire?: Partial<WireConventions>;
  /**
   * How the platform spells a reference to a value it holds elsewhere. A
   * reference is not a credential, so it may stand on a command line; without
   * this, no value is taken for one.
   */
  references?: References;
}>;
