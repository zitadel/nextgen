import type { ZitadelClient } from "../../api-client";
import { mapBounded } from "../../map-bounded";
import { reportWarning } from "../../warnings";
import type { Step, StepContext } from "../pipeline";

/** Users read per page, and the most the whole check reads, across every scan. */
const PAGE_SIZE = 100;
const SCAN_CAP = 1000;
/** Identity-link reads in flight at once. */
const CONCURRENCY = 10;

type QueriedUser = Awaited<ReturnType<ZitadelClient["queryUsers"]>>["users"][number];
type QueryUsersBody = Parameters<ZitadelClient["queryUsers"]>[0];
type UserFilter = NonNullable<QueryUsersBody["filter"]>[number];
type Flow = { schema: string; identifiers: string[] };
/** How many users the whole check may still read. */
type Budget = { remaining: number };

/**
 * Warn when this deploy leaves users who exist today unable to sign in. A
 * deploy that passes validation can still lock people out, because the flow
 * and the schema are judged without the users they will meet:
 *
 * - a schema whose designated identifier (`x-identifier`) is a property the
 *   existing users of that schema do not carry sends them to registration when
 *   they type their old identifier, once a step on the login path collects it;
 * - a flow moved to another schema cannot continue an SSO sign-in whose linked
 *   user is on the old schema.
 *
 * Both are read from the users the project holds now, so they hold whatever
 * the previous release said. Warn only: a deploy that does this on purpose, or
 * after migrating the users, is not stopped. The check is best effort, as it
 * only needs read access and a failing read must never fail a deploy.
 */
export const lockoutStep: Step = {
  name: "lockout",
  runsFor: ["deploy", "preview"],
  async run(ctx: StepContext): Promise<undefined> {
    try {
      for (const message of await lockoutWarnings(ctx)) {
        reportWarning(message);
      }
    } catch {
      // Unreadable users mean no warning, never a failed deploy.
    }
    return undefined;
  },
};

async function lockoutWarnings(ctx: StepContext): Promise<string[]> {
  // Only names for the warnings and for flows that name a schema by id; the
  // lookups below do not depend on it, so a failed read costs the names.
  const names = await objectTypes(ctx).catch(() => new Map<string, string>());
  const { flows, unresolved } = servedFlows(ctx, names);
  const budget: Budget = { remaining: SCAN_CAP };
  const [lookups, sso] = await Promise.all([
    lookupWarnings(ctx, flows, budget),
    // With a flow whose schema is unknown, "a schema no flow serves" cannot be told.
    unresolved ? [] : ssoWarnings(ctx, flows, names, budget),
  ]);
  return [...lookups, ...sso];
}

/**
 * The flows the engine can select, each against the object type of its
 * schema. A flow's `user_schema` is an object type, or a schema id or `$id`
 * URL that the server resolves to one; a draft flow is never selected.
 */
function servedFlows(
  ctx: StepContext,
  names: ReadonlyMap<string, string>,
): { flows: Flow[]; unresolved: boolean } {
  const objectTypes = new Set<string>();
  const designated = new Map<string, string>();
  const byId = new Map<string, string>();
  for (const schema of ctx.bundle.schemas) {
    if (typeof schema.objectType !== "string") {
      continue;
    }
    objectTypes.add(schema.objectType);
    if (typeof schema["x-identifier"] === "string" && schema["x-identifier"] !== "") {
      designated.set(schema.objectType, schema["x-identifier"]);
    }
    if (typeof schema.$id === "string") {
      byId.set(schema.$id, schema.objectType);
    }
  }
  const flows: Flow[] = [];
  let unresolved = false;
  for (const flow of ctx.bundle.flow_definitions) {
    if (typeof flow.user_schema !== "string" || flow.status === "draft") {
      continue;
    }
    const ref = flow.user_schema;
    const schema = objectTypes.has(ref) ? ref : (byId.get(ref) ?? names.get(ref));
    if (schema === undefined) {
      unresolved = true;
      continue;
    }
    // Only the schema's designated identifier performs a lookup, and only when
    // a step on the login path collects it.
    const identifier = designated.get(schema);
    const looksUp = identifier !== undefined && loginPathFields(flow).has(identifier);
    flows.push({ schema, identifiers: looksUp ? [identifier] : [] });
  }
  return { flows, unresolved };
}

/** A field the login flow looks users up by that the users of its schema lack. */
async function lookupWarnings(
  ctx: StepContext,
  flows: readonly Flow[],
  budget: Budget,
): Promise<string[]> {
  const lookups = new Map<string, Set<string>>();
  for (const flow of flows) {
    const known = lookups.get(flow.schema) ?? new Set<string>();
    for (const identifier of flow.identifiers) {
      known.add(identifier);
    }
    lookups.set(flow.schema, known);
  }
  const warnings: string[] = [];
  for (const [objectType, identifiers] of lookups) {
    if (identifiers.size === 0) {
      continue;
    }
    const { users, truncated } = await readUsers(
      ctx,
      [{ field: "schema_object_type", operation: "equals", value: objectType }],
      budget,
    );
    for (const identifier of identifiers) {
      const missing = users.filter((user) => !carries(user, identifier));
      if (missing.length === 0) {
        continue;
      }
      warnings.push(
        `${count(missing.length, truncated)} of ${count(users.length, truncated)} existing ${plural(users.length, "user")} of ${quote(objectType)} ${missing.length === 1 ? "has" : "have"} no ${quote(identifier)}, the field the login flow looks users up by, so they cannot sign in with a password. Move each to the new revision and set it in one update: zitadel users update <user_id> --schema <revision_id> --set attributes.${identifier}=<value>`,
      );
    }
  }
  return warnings;
}

/** Users on a schema no flow serves any more, who have a provider linked. */
async function ssoWarnings(
  ctx: StepContext,
  flows: readonly Flow[],
  names: ReadonlyMap<string, string>,
  budget: Budget,
): Promise<string[]> {
  const served = [...new Set(flows.map((flow) => flow.schema))];
  if (served.length === 0) {
    return [];
  }
  const { users: stranded, truncated } = await readUsers(
    ctx,
    served.map((value) => ({ field: "schema_object_type", operation: "not_equals", value })),
    budget,
  );
  // Its own boundary: a link read that fails (a user deleted since the query)
  // must not discard the other warnings.
  const hasLink = await mapBounded(stranded, CONCURRENCY, async (user) => {
    try {
      const { identity_links: links } = await ctx.client.listUserIdentityLinks(user.id, {
        limit: 1,
      });
      return links.length > 0;
    } catch {
      return false;
    }
  });
  // Revisions of one schema share an object type, so they are one count.
  const linked = new Map<string, number>();
  stranded.forEach((user, index) => {
    if (!hasLink[index]) {
      return;
    }
    const name = names.get(user.schema) ?? user.schema;
    linked.set(name, (linked.get(name) ?? 0) + 1);
  });
  return [...linked].map(
    ([name, total]) =>
      `${count(total, truncated)} existing ${plural(total, "user")} of ${quote(name)} ${total === 1 ? "has" : "have"} an SSO link, but no flow in this release uses that schema, so they cannot sign in with SSO. Passkey sign-in is not affected. Users cannot move between schemas, so keep or restore a flow on ${quote(name)}.`,
  );
}

/**
 * The fields collected on a flow's login path: the steps reachable from the
 * login entry through transitions that stay in the login purpose. A transition
 * that names another purpose (sign-up) or another flow leaves the path, so the
 * `passkey-first` preset, which reaches its identifier step from the entry
 * through `email_fallback`, is covered.
 */
function loginPathFields(flow: Record<string, unknown>): Set<string> {
  const purposes = flow.purposes as Record<string, unknown> | undefined;
  const steps = Array.isArray(flow.steps) ? (flow.steps as Array<Record<string, unknown>>) : [];
  const byName = new Map(steps.map((step) => [step.name, step]));
  const fields = new Set<string>();
  const seen = new Set<unknown>();
  const queue: unknown[] = [purposes?.login];
  for (let head = 0; head < queue.length; head += 1) {
    const name = queue[head];
    const step = byName.get(name);
    if (step === undefined || seen.has(name)) {
      continue;
    }
    seen.add(name);
    for (const field of Array.isArray(step.fields) ? step.fields : []) {
      if (typeof field === "string") {
        fields.add(field);
      }
    }
    const transitions = (step.transitions ?? {}) as Record<string, Record<string, unknown>>;
    for (const transition of Object.values(transitions)) {
      const sameFlow = transition.flow === undefined && transition.purpose === undefined;
      if (sameFlow && typeof transition.target === "string") {
        queue.push(transition.target);
      }
    }
  }
  return fields;
}

async function readUsers(
  ctx: StepContext,
  filter: UserFilter[],
  budget: Budget,
): Promise<{ users: QueriedUser[]; truncated: boolean }> {
  const users: QueriedUser[] = [];
  let pageToken: string | undefined;
  if (budget.remaining <= 0) {
    return { users, truncated: true };
  }
  do {
    const limit = Math.min(PAGE_SIZE, budget.remaining);
    const page = await ctx.client.queryUsers(
      {
        limit,
        filter,
        ...(pageToken === undefined ? {} : { page_token: pageToken }),
      },
      { project_id: ctx.projectId },
    );
    users.push(...page.users);
    budget.remaining -= page.users.length;
    pageToken = page.next_page_token ?? undefined;
  } while (pageToken !== undefined && budget.remaining > 0);
  return { users, truncated: pageToken !== undefined };
}

/** Whether the user holds a value at the (dotted) attribute path. */
function carries(user: QueriedUser, path: string): boolean {
  let node: unknown = user.attributes;
  for (const key of path.split(".")) {
    if (typeof node !== "object" || node === null) return false;
    if (!Object.hasOwn(node, key)) return false;
    node = (node as Record<string, unknown>)[key];
  }
  return node !== undefined && node !== null && node !== "";
}

/** Each schema's URL against its object type, to name it as the files do. */
async function objectTypes(ctx: StepContext): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const listed = await ctx.client.listSchemas.all({ project_id: ctx.projectId });
  for (const entry of listed) {
    const objectType = (entry.schema as { objectType?: unknown } | undefined)?.objectType;
    if (typeof objectType === "string") names.set(entry.id, objectType);
  }
  return names;
}

const quote = (value: string) => `"${value}"`;
const plural = (n: number, noun: string) => (n === 1 ? noun : `${noun}s`);
const count = (n: number, truncated: boolean) => (truncated ? `at least ${n}` : `${n}`);
