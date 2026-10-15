import type {
  QueryIdps200IdpsItem,
  QueryIdps200IdpsItemDefinition,
} from "@zitadel/api/generated/model";
import { ApiError } from "@zitadel/api/runtime/fetch";

import { api } from "@/api/zitadel";
import type { FlowDefinitionEntry } from "./flow-definition";
import { readAllPages } from "./paging";
import {
  type SchemaEntry,
  schemaAuthMethods,
  schemaDisplayName,
  schemaSsoProviders,
} from "./schema";

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

/**
 * Every connection in the project, newest first: the Identity providers list
 * as shown, and the slugs schemas and flows reference resolved from it. Or
 * `null` when the caller may not read them.
 *
 * `null` is the screen's only signal for `idp.read`: the console has no
 * effective-permissions read, so the refusal itself is the answer (the same
 * reading `fetchUsers` gives a refused expansion). It hides the Identity
 * providers tab and leaves the Sign-in tab on raw slugs. Any other failure is
 * a real error and reaches the route's error boundary.
 */
export async function fetchAllIdps(projectId: string): Promise<IdpConnection[] | null> {
  try {
    return await readAllPages(async (pageToken) => {
      // The API sorts ascending by default.
      const page = await api.queryIdps(
        { limit: 100, page_token: pageToken, sorting: { field: "created_at", direction: "desc" } },
        { project_id: projectId },
      );
      return { items: page.idps, next: page.next_page_token };
    });
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 403) return null;
    throw cause;
  }
}

/**
 * The connection's client id, as written in its `oidc` block. A `${{ VAR }}`
 * reference is shown verbatim: the value differs per environment, and
 * resolving it is the engine's job.
 */
export function idpClientId(definition: IdpDefinition): string | undefined {
  return definition.oidc?.client_id;
}

const PROTOCOL_LABELS: Record<string, string> = { oidc: "OIDC" };

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
 * The schemas whose latest revision lists each slug in `sso.providers`, by
 * name. No API answers this, so it is computed from the schema list, once for
 * every connection a list shows.
 */
export function schemasBySsoProvider(
  schemas: Array<Pick<SchemaEntry, "id" | "schema">>,
): Map<string, IdpReference[]> {
  const bySlug = new Map<string, IdpReference[]>();
  for (const { id, schema } of schemas) {
    const reference = { id, name: schemaDisplayName(schema, id) };
    for (const slug of schemaSsoProviders(schema)) {
      const users = bySlug.get(slug) ?? [];
      users.push(reference);
      bySlug.set(slug, users);
    }
  }
  for (const users of bySlug.values()) users.sort(byName);
  return bySlug;
}

/** The schemas whose latest revision lists `slug` in `sso.providers`, by name. */
export function schemasUsingIdp(
  slug: string,
  schemas: Array<Pick<SchemaEntry, "id" | "schema">>,
): IdpReference[] {
  return schemasBySsoProvider(schemas).get(slug) ?? [];
}

/** The flows whose latest revision has a step listing `slug` in `sso_providers`. */
export function flowsUsingIdp(slug: string, flows: FlowDefinitionEntry[]): FlowDefinitionEntry[] {
  return flows.filter((entry) =>
    (entry.flow_definition.steps ?? []).some((step) => step.sso_providers?.includes(slug)),
  );
}

function byName(a: IdpReference, b: IdpReference): number {
  return a.name.localeCompare(b.name);
}

/**
 * "Business, Consumer ... +4": the first `shown` names and a count for the
 * rest, as the design truncates a list of user schemas in a table cell.
 */
export function nameSummary(names: string[], shown = 2): string {
  const rest = names.length - shown;
  return rest > 0 ? `${names.slice(0, shown).join(", ")} ... +${rest}` : names.join(", ");
}

/**
 * One row of the Sign-in methods tab: a method some schema enables, and the
 * schemas that enable it.
 */
export interface SignInMethodRow {
  /** `passkey`, `password`, or `sso:<slug>`. */
  key: string;
  /** The method's label, or a provider's connection name — its slug without one. */
  label: string;
  /** The schemas enabling the method, by name. */
  schemas: IdpReference[];
  /** The newest of the schema revisions behind the row, and the connection's. */
  lastChange: string;
  /** The connection behind a provider row, for its link. */
  idpId?: string;
  /**
   * A listed slug no connection has. The CLI validator rejects this, but the
   * server can still hold it, and hiding it would make a broken sign-in
   * option look absent rather than broken. Never set without `idp.read`.
   */
  missing?: boolean;
}

/**
 * The methods in use across the project: Passkey and Password where any
 * schema enables them, then one row per listed provider slug by connection
 * name. A connection no schema lists is not a way anyone signs in, so it has
 * no row here; the Identity providers tab shows it as `Not used`.
 *
 * With `idps` `null` — no `idp.read` — provider rows carry the raw slug, and
 * whether a connection backs it is not known.
 */
export function signInMethodRows(
  schemas: SchemaEntry[],
  idps: IdpConnection[] | null,
): SignInMethodRow[] {
  const rows = new Map<string, SignInMethodRow>();
  const add = (key: string, label: string, entry: SchemaEntry) => {
    const row = rows.get(key) ?? { key, label, schemas: [], lastChange: entry.createdAt };
    row.schemas.push({ id: entry.id, name: schemaDisplayName(entry.schema, entry.id) });
    row.lastChange = latest(row.lastChange, entry.createdAt);
    rows.set(key, row);
  };
  for (const entry of schemas) {
    for (const method of schemaAuthMethods(entry.schema)) {
      if (!method.enabled) continue;
      if (method.key === "sso") {
        for (const slug of method.providers) add(`sso:${slug}`, slug, entry);
      } else {
        add(method.key, method.label, entry);
      }
    }
  }

  const bySlug = new Map((idps ?? []).map((idp) => [idp.slug, idp]));
  const methods: SignInMethodRow[] = [];
  const providers: SignInMethodRow[] = [];
  for (const row of rows.values()) {
    row.schemas.sort(byName);
    if (!row.key.startsWith("sso:")) {
      methods.push(row);
      continue;
    }
    const idp = bySlug.get(row.label);
    if (idp) {
      providers.push({
        ...row,
        label: idp.definition.display_name,
        idpId: idp.id,
        lastChange: latest(row.lastChange, idp.updated_at),
      });
    } else {
      providers.push(idps ? { ...row, missing: true } : row);
    }
  }
  // Passkey before Password, the order `schemaAuthMethods` keeps; providers
  // by name.
  methods.sort((a, b) => a.key.localeCompare(b.key));
  providers.sort((a, b) => a.label.localeCompare(b.label));
  return [...methods, ...providers];
}

function latest(a: string, b: string): string {
  return new Date(b).getTime() > new Date(a).getTime() ? b : a;
}
