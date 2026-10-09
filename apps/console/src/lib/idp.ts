import type {
  QueryIdps200IdpsItem,
  QueryIdps200IdpsItemDefinition,
} from "@zitadel/api/generated/model";
import { ApiError } from "@zitadel/api/runtime/fetch";

import { api } from "@/api/zitadel";
import type { FlowDefinitionEntry } from "./flow-definition";
import { type UserSchema, schemaDisplayName, schemaSsoProviders } from "./schema";

/**
 * Identity provider connections as the Authentication screens read them.
 * Read-only: connections are configuration applied through the CLI (#998), so
 * nothing here writes.
 *
 * Orval names the same object once per operation; these alias the query's
 * names and let structural typing carry `GET /idps/{id}`'s.
 */

/** One connection, at its newest revision. */
export type IdpConnection = QueryIdps200IdpsItem;

/** The stored connection document. */
export type IdpDefinition = QueryIdps200IdpsItemDefinition;

/** One page of the list screen. */
export const IDP_PAGE_SIZE = 25;

/**
 * Newest first. The API sorts ascending by default, and a cursor only pages
 * the sort that issued it, so every page of the list sends this.
 */
export const IDP_LIST_SORTING = { field: "created_at", direction: "desc" } as const;

/** One page of connections, newest first. */
export async function fetchIdpPage(
  projectId: string,
  pageToken?: string,
): Promise<{ idps: IdpConnection[]; nextPageToken?: string }> {
  const page = await api.queryIdps(
    { limit: IDP_PAGE_SIZE, page_token: pageToken, sorting: IDP_LIST_SORTING },
    { project_id: projectId },
  );
  return { idps: page.idps, nextPageToken: page.next_page_token ?? undefined };
}

/**
 * Every connection in the project, for resolving the slugs schemas and flows
 * reference — or `null` when the caller may not read them.
 *
 * `null` is the screen's only signal for `idp.read`: the console has no
 * effective-permissions read, so the refusal itself is the answer (the same
 * reading `fetchUsers` gives a refused expansion). It hides the Identity
 * providers tab and leaves the Sign-in tab on raw slugs. Any other failure is
 * a real error and reaches the route's error boundary.
 */
export async function fetchAllIdps(projectId: string): Promise<IdpConnection[] | null> {
  try {
    return await walk(async (pageToken) => {
      const page = await api.queryIdps(
        { limit: 100, page_token: pageToken, sorting: { field: "slug", direction: "asc" } },
        { project_id: projectId },
      );
      return { items: page.idps, next: page.next_page_token };
    });
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 403) return null;
    throw cause;
  }
}

/** Every user schema in the project, at its latest revision. */
export async function fetchAllSchemas(
  projectId: string,
): Promise<Array<{ id: string; schema: UserSchema; createdAt: string }>> {
  const entries = await walk(async (pageToken) => {
    const page = await api.listSchemas({
      project_id: projectId,
      kind: "user-schema",
      revisions: "latest",
      limit: 100,
      page_token: pageToken,
    });
    return { items: page.schemas, next: page.next_page_token };
  });
  return entries.map((entry) => ({
    id: entry.id,
    schema: entry.schema as UserSchema,
    createdAt: entry.metadata.created_at,
  }));
}

/** Every login flow in the project, at its latest revision. */
export async function fetchAllFlows(projectId: string): Promise<FlowDefinitionEntry[]> {
  return walk(async (pageToken) => {
    const page = await api.listFlowDefinitions({
      project_id: projectId,
      revisions: "latest",
      limit: 100,
      page_token: pageToken,
    });
    return { items: page.flow_definitions, next: page.next_page_token };
  });
}

/**
 * Follow a cursor to the end. The screens that need a whole collection —
 * resolving slugs, computing "Used by" — have no API that answers them
 * directly, so they read it all; projects carry a handful of each.
 */
async function walk<T>(
  fetchPage: (pageToken?: string) => Promise<{ items: T[]; next?: string | null }>,
): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;
  do {
    const page = await fetchPage(pageToken);
    items.push(...page.items);
    pageToken = page.next ?? undefined;
  } while (pageToken);
  return items;
}

/**
 * The connection's client id, as written: `oidc` or `oauth2`, whichever block
 * the protocol uses. A `${{ VAR }}` reference is shown verbatim — the value
 * differs per environment, and resolving it is the engine's job.
 */
export function idpClientId(definition: IdpDefinition): string | undefined {
  return definition.oidc?.client_id ?? definition.oauth2?.client_id;
}

const PROTOCOL_LABELS: Record<string, string> = { oidc: "OIDC", oauth2: "OAuth 2.0" };

/** `oidc` → `OIDC`. An unknown protocol renders verbatim rather than blank. */
export function idpProtocolLabel(protocol: string): string {
  return PROTOCOL_LABELS[protocol] ?? protocol;
}

/** A schema or flow that references a connection, for a "Used by" link. */
export interface IdpReference {
  id: string;
  name: string;
}

/**
 * The schemas whose latest revision lists `slug` in `sso.providers`, by name.
 * No API answers this, so it is computed from the schema list.
 */
export function schemasUsingIdp(
  slug: string,
  schemas: Array<{ id: string; schema: UserSchema }>,
): IdpReference[] {
  return schemas
    .filter(({ schema }) => schemaSsoProviders(schema).includes(slug))
    .map(({ id, schema }) => ({ id, name: schemaDisplayName(schema, id) }))
    .sort(byName);
}

/** The flows whose latest revision has a step listing `slug` in `sso_providers`. */
export function flowsUsingIdp(slug: string, flows: FlowDefinitionEntry[]): FlowDefinitionEntry[] {
  return flows.filter((entry) =>
    (entry.flow_definition.steps ?? []).some((step) => step.sso_providers?.includes(slug)),
  );
}

/** The flows that pin a schema (`user_schema`). */
export function flowsForSchema(
  schemaId: string,
  flows: FlowDefinitionEntry[],
): FlowDefinitionEntry[] {
  return flows.filter((entry) => entry.flow_definition.user_schema === schemaId);
}

function byName(a: IdpReference, b: IdpReference): number {
  return a.name.localeCompare(b.name);
}

/**
 * One SSO row of a schema's sign-in view.
 *
 * - `enabled`: the schema lists the slug and a connection has it.
 * - `disabled`: a connection in the project the schema does not list.
 * - `missing`: the schema lists a slug no connection has. The CLI validator
 *   rejects this, but the server can still hold it, and hiding it would make
 *   a broken sign-in option look absent rather than broken.
 */
export interface SchemaProvider {
  slug: string;
  /** The connection's `display_name`, or the slug when there is none to read. */
  name: string;
  state: "enabled" | "disabled" | "missing";
  /** The connection behind the row, for its link. */
  idpId?: string;
}

/**
 * The SSO rows of a schema: the slugs it lists, in its own order, then the
 * project's other connections, by name.
 *
 * With `idps` `null` — no `idp.read` — the listed slugs come back raw and
 * enabled, and there are no others: whether a slug has a connection, and
 * which connections exist, are both things the caller cannot see.
 */
export function schemaProviders(
  schema: UserSchema,
  idps: IdpConnection[] | null,
): SchemaProvider[] {
  const listed = schemaSsoProviders(schema);
  if (!idps) return listed.map((slug) => ({ slug, name: slug, state: "enabled" }));

  const bySlug = new Map(idps.map((idp) => [idp.slug, idp]));
  const rows: SchemaProvider[] = listed.map((slug) => {
    const idp = bySlug.get(slug);
    return idp
      ? { slug, name: idp.definition.display_name, state: "enabled", idpId: idp.id }
      : { slug, name: slug, state: "missing" };
  });
  const others = idps
    .filter((idp) => !listed.includes(idp.slug))
    .map(
      (idp): SchemaProvider => ({
        slug: idp.slug,
        name: idp.definition.display_name,
        state: "disabled",
        idpId: idp.id,
      }),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...rows, ...others];
}
