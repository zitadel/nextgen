import type { ZitadelClient } from "../../api-client";
import { mapBounded } from "../../map-bounded";
import { reportWarning } from "../../warnings";
import type { Step, StepContext } from "../pipeline";

/** Users read per page, and the most the whole check reads, shared out across its scans. */
const PAGE_SIZE = 100;
const SCAN_CAP = 1000;
/** Identity-link reads in flight at once. */
const CONCURRENCY = 10;

type QueriedUser = Awaited<ReturnType<ZitadelClient["queryUsers"]>>["users"][number];
type QueryUsersBody = Parameters<ZitadelClient["queryUsers"]>[0];
type UserFilter = NonNullable<QueryUsersBody["filter"]>[number];
type Flow = { schema: string; identifier?: string };
/** What a scan found, and whether it only saw part of the users without finding anything. */
type Scan = { warnings: string[]; partial: boolean };
type Names = () => Promise<ReadonlyMap<string, string>>;

/**
 * Warn when this deploy leaves users who exist today unable to sign in. A
 * deploy that passes validation can still lock people out, because the flow
 * and the schema are judged without the users they will meet:
 *
 * - a schema whose designated identifier (`x-identifier`) is a property the
 *   existing users of that schema do not carry sends them to registration when
 *   they type their old identifier, once a step on the login path collects it;
 * - users with a linked provider account on a schema that no flow in the
 *   release serves cannot continue an SSO sign-in (a flow moved to another
 *   schema leaves them there).
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
  // Names are only needed for flows that name a schema by id and for the SSO
  // warning, so they are read on first use, and a failed read costs the names.
  let listed: Promise<ReadonlyMap<string, string>> | undefined;
  const names: Names = () => {
    listed ??= objectTypes(ctx).catch(() => new Map<string, string>());
    return listed;
  };
  const { flows, unresolved } = await servedFlows(ctx, names);
  // Every scan gets its own share of the cap up front, so none can starve
  // another and the total stays within it.
  const scanned = new Set(
    flows.filter((flow) => flow.identifier !== undefined).map((flow) => flow.schema),
  );
  const share = Math.floor(SCAN_CAP / (scanned.size + 1));
  // One scan failing must not discard what the other found.
  const settled = await Promise.allSettled([
    lookupWarnings(ctx, flows, share),
    // With a flow whose schema is unknown, "a schema no flow serves" cannot be told.
    unresolved ? { warnings: [], partial: false } : ssoWarnings(ctx, flows, names, share),
  ]);
  const scans = settled.flatMap((outcome) =>
    outcome.status === "fulfilled" ? [outcome.value] : [],
  );
  // A clean result must not look the same as a check that did not run fully.
  const notes: string[] = [];
  if (settled.some((outcome) => outcome.status === "rejected")) {
    notes.push(
      "Could not finish checking existing users for sign-in lockouts: a request to the server failed.",
    );
  }
  if (unresolved) {
    notes.push(
      "Skipped the SSO lockout check: a flow names a schema that this release does not define.",
    );
  }
  if (scans.some((scan) => scan.partial)) {
    notes.push(
      "Checked only the first users of the project for sign-in lockouts, so a clean result is not proof.",
    );
  }
  return [...scans.flatMap((scan) => scan.warnings), ...notes];
}

/**
 * The flows the engine can select, each against the object type of its
 * schema. A flow's `user_schema` is an object type, or a schema id or `$id`
 * URL that the server resolves to one; a draft flow is never selected.
 */
async function servedFlows(
  ctx: StepContext,
  names: Names,
): Promise<{ flows: Flow[]; unresolved: boolean }> {
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
    const known = objectTypes.has(ref) ? ref : byId.get(ref);
    const schema = known ?? (await names()).get(ref);
    if (schema === undefined) {
      unresolved = true;
      continue;
    }
    // Only the schema's designated identifier performs a lookup, and only when
    // a step on the login path collects it.
    const identifier = designated.get(schema);
    const looksUp = identifier !== undefined && loginPathFields(flow).has(identifier);
    flows.push({ schema, ...(looksUp ? { identifier } : {}) });
  }
  return { flows, unresolved };
}

/** A field the login flow looks users up by that the users of its schema lack. */
async function lookupWarnings(
  ctx: StepContext,
  flows: readonly Flow[],
  share: number,
): Promise<Scan> {
  // The designated identifier belongs to the schema, so there is one per schema.
  const lookups = new Map<string, string>();
  for (const flow of flows) {
    if (flow.identifier !== undefined) {
      lookups.set(flow.schema, flow.identifier);
    }
  }
  const scans = await Promise.all(
    [...lookups].map(async ([objectType, identifier]): Promise<Scan> => {
      const { users, truncated } = await readUsers(
        ctx,
        [{ field: "schema_object_type", operation: "equals", value: objectType }],
        share,
      );
      const missing = users.filter((user) => !carries(user, identifier));
      if (missing.length === 0) {
        return { warnings: [], partial: truncated };
      }
      return {
        warnings: [
          `${count(missing.length, truncated)} of ${count(users.length, truncated)} existing ${plural(users.length, "user")} of ${quote(objectType)} ${missing.length === 1 ? "has" : "have"} no ${quote(identifier)}, the field the login flow looks users up by, so typing it offers them registration instead of signing them in. Set it on each user: zitadel users update <user_id> --set attributes.${identifier}=<value> (add --schema <revision_id> to move a user to a newer revision of the schema)`,
        ],
        partial: false,
      };
    }),
  );
  return {
    warnings: scans.flatMap((scan) => scan.warnings),
    partial: scans.some((scan) => scan.partial),
  };
}

/** Users on a schema no flow serves any more, who have a provider linked. */
async function ssoWarnings(
  ctx: StepContext,
  flows: readonly Flow[],
  names: Names,
  share: number,
): Promise<Scan> {
  const served = [...new Set(flows.map((flow) => flow.schema))];
  if (served.length === 0) {
    return { warnings: [], partial: false };
  }
  const read = await readUsers(
    ctx,
    served.map((value) => ({ field: "schema_object_type", operation: "not_equals", value })),
    share,
  );
  const stranded = read.users;
  const truncated = read.truncated;
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
  const nameOf = hasLink.some(Boolean) ? await names() : undefined;
  stranded.forEach((user, index) => {
    if (!hasLink[index]) {
      return;
    }
    const name = nameOf?.get(user.schema) ?? user.schema;
    linked.set(name, (linked.get(name) ?? 0) + 1);
  });
  const warnings = [...linked].map(
    ([name, total]) =>
      `${count(total, truncated)} existing ${plural(total, "user")} of ${quote(name)} ${total === 1 ? "has" : "have"} an SSO link, but no flow in this release uses that schema, so they cannot sign in with SSO. Passkey sign-in is not affected. Users cannot move between schemas, so keep or restore a flow on ${quote(name)}.`,
  );
  return { warnings, partial: truncated && warnings.length === 0 };
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
  // Another purpose's entry step is where a switch lands, and a missing account
  // continues as a sign-up: neither is part of logging in.
  const otherEntries = new Set(
    Object.entries(purposes ?? {})
      .filter(([purpose]) => purpose !== "login")
      .map(([, entry]) => entry),
  );
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
    for (const [outcome, transition] of Object.entries(transitions)) {
      const sameFlow = transition.flow === undefined && transition.purpose === undefined;
      const signsUp = outcome === "user_not_found" || outcome === "sso_user_not_found";
      if (
        sameFlow &&
        !signsUp &&
        typeof transition.target === "string" &&
        !otherEntries.has(transition.target)
      ) {
        queue.push(transition.target);
      }
    }
  }
  return fields;
}

async function readUsers(
  ctx: StepContext,
  filter: UserFilter[],
  max: number,
): Promise<{ users: QueriedUser[]; truncated: boolean }> {
  const users: QueriedUser[] = [];
  let pageToken: string | undefined;
  let received = 1;
  while (received > 0 && users.length < max) {
    const page = await ctx.client.queryUsers(
      {
        limit: Math.min(PAGE_SIZE, max - users.length),
        filter,
        ...(pageToken === undefined ? {} : { page_token: pageToken }),
      },
      { project_id: ctx.projectId },
    );
    users.push(...page.users);
    received = page.users.length;
    pageToken = page.next_page_token ?? undefined;
    if (pageToken === undefined) {
      return { users, truncated: false };
    }
  }
  return { users, truncated: true };
}

/** Whether the user holds a value at the (dotted) attribute path. */
function carries(user: QueriedUser, path: string): boolean {
  let node: unknown = user.attributes;
  for (const key of path.split(".")) {
    if (typeof node !== "object" || node === null) {
      return false;
    }
    if (!Object.hasOwn(node, key)) {
      return false;
    }
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
    if (typeof objectType === "string") {
      names.set(entry.id, objectType);
    }
  }
  return names;
}

const quote = (value: string) => `"${value}"`;
const plural = (n: number, noun: string) =>
  new Intl.PluralRules("en").select(n) === "one" ? noun : `${noun}s`;
const count = (n: number, truncated: boolean) => (truncated ? `at least ${n}` : `${n}`);
