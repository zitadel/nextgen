import { ApiError } from "@zitadel/api/runtime/fetch";

import type { ZitadelClient } from "../../api-client";
import { mapBounded } from "../../map-bounded";
import { reportWarning } from "../../warnings";
import type { Step, StepContext } from "../pipeline";

/** Users read per page, and the most the whole check reads, shared out across its scans. */
const PAGE_SIZE = 100;
const SCAN_CAP = 1000;
/** The most stranded users whose identity links are looked up. */
const LINK_CHECKS = 200;
/** Identity-link reads in flight at once. */
const CONCURRENCY = 10;

type QueriedUser = Awaited<ReturnType<ZitadelClient["queryUsers"]>>["users"][number];
type QueryUsersBody = Parameters<ZitadelClient["queryUsers"]>[0];
type UserFilter = NonNullable<QueryUsersBody["filter"]>[number];
type Flow = { schema: string; identifier?: string };
/**
 * What a scan found, whose users it only partly read without finding anything,
 * and whether a request failed.
 */
type Scan = { warnings: string[]; partial: string[]; failed: boolean };
/** A schema as the project lists it: its object type and designated identifier. */
type SchemaInfo = { objectType: string; identifier?: string };
/** The project's schemas by id, or nothing when the listing could not be read. */
type Names = () => Promise<ReadonlyMap<string, SchemaInfo> | undefined>;
/** A scan with nothing to report. */
const nothing = (): Scan => ({ warnings: [], partial: [], failed: false });
/** What stranded users are counted under when their schema could not be named. */
const UNNAMED = Symbol("unnamed");
/** Only active users can sign in, so only they can be locked out. */
const ACTIVE: UserFilter = { field: "status", operation: "equals", value: "active" };

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
  runsFor: ["deploy"],
  async run(ctx: StepContext): Promise<undefined> {
    try {
      for (const message of await lockoutWarnings(ctx)) {
        reportWarning(message);
      }
    } catch {
      // Never a failed deploy, but never a silent pass either.
      reportWarning(
        "Could not finish checking existing users for sign-in lockouts: an unexpected error stopped the check.",
      );
    }
    return undefined;
  },
};

async function lockoutWarnings(ctx: StepContext): Promise<string[]> {
  // Names are only needed for flows that name a schema by id and for the SSO
  // warning, so they are read on first use, and a failed read costs the names.
  let listed: Promise<ReadonlyMap<string, SchemaInfo> | undefined> | undefined;
  const names: Names = () => {
    listed ??= objectTypes(ctx).catch(() => undefined);
    return listed;
  };
  const { flows, unresolved, unreadable } = await servedFlows(ctx, names);
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
    unresolved || unreadable ? nothing() : ssoWarnings(ctx, flows, names, share),
  ]);
  const scans = settled.flatMap((outcome) =>
    outcome.status === "fulfilled" ? [outcome.value] : [],
  );
  // A clean result must not look the same as a check that did not run fully.
  const notes: string[] = [];
  if (
    settled.some((outcome) => outcome.status === "rejected") ||
    scans.some((scan) => scan.failed)
  ) {
    notes.push(
      "Could not finish checking existing users for sign-in lockouts: a request to the server failed.",
    );
  }
  if (unreadable) {
    notes.push("Skipped the SSO lockout check: the project's schemas could not be read.");
  } else if (unresolved) {
    notes.push(
      "Skipped the SSO lockout check: a flow names a schema that this release does not define.",
    );
  }
  const partial = scans.flatMap((scan) => scan.partial);
  if (partial.length > 0) {
    notes.push(
      `Checked only some of the users of ${partial.join(", ")} for sign-in lockouts (the read limit was reached), so a clean result is not proof.`,
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
): Promise<{ flows: Flow[]; unresolved: boolean; unreadable: boolean }> {
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
  let unreadable = false;
  for (const flow of ctx.bundle.flow_definitions) {
    if (typeof flow.user_schema !== "string" || flow.status === "draft") {
      continue;
    }
    const ref = flow.user_schema;
    const known = objectTypes.has(ref) ? ref : byId.get(ref);
    const listing = known === undefined ? await names() : undefined;
    const listed = listing?.get(ref);
    const schema = known ?? listed?.objectType;
    if (schema === undefined) {
      // Without the listing it is not known whether the schema exists.
      unreadable ||= known === undefined && listing === undefined;
      unresolved ||= listing !== undefined;
      continue;
    }
    // Only the schema's designated identifier performs a lookup, and only when
    // a step on the login path collects it.
    const identifier = designated.get(schema) ?? listed?.identifier;
    const looksUp = identifier !== undefined && loginPathFields(flow).has(identifier);
    flows.push({ schema, ...(looksUp ? { identifier } : {}) });
  }
  return { flows, unresolved, unreadable };
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
  const scans = await mapBounded(
    [...lookups],
    CONCURRENCY,
    async ([objectType, identifier]): Promise<Scan> => {
      try {
        const { users, truncated } = await readUsers(
          ctx,
          [{ field: "schema_object_type", operation: "equals", value: objectType }, ACTIVE],
          share,
        );
        const missing = users.filter((user) => !carries(user, identifier));
        if (missing.length === 0) {
          return { warnings: [], partial: truncated ? [quote(objectType)] : [], failed: false };
        }
        return {
          warnings: [
            `${count(missing.length, truncated)} of ${count(users.length, truncated)} existing ${plural(users.length, "user")} of ${quote(objectType)} ${missing.length === 1 ? "has" : "have"} no ${quote(identifier)}, the field the login flow looks users up by, so typing it offers them registration instead of signing them in. Set it on each user: zitadel users update <user_id> --set attributes.${identifier}=<value> (add --schema <revision_id> to move a user to a newer revision of the schema)`,
          ],
          partial: [],
          failed: false,
        };
      } catch {
        // One schema's failed read must not discard the warnings of the others.
        return { warnings: [], partial: [], failed: true };
      }
    },
  );
  return {
    warnings: scans.flatMap((scan) => scan.warnings),
    partial: scans.flatMap((scan) => scan.partial),
    failed: scans.some((scan) => scan.failed),
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
    return nothing();
  }
  const read = await readUsers(
    ctx,
    [
      ...served.map(
        (value): UserFilter => ({ field: "schema_object_type", operation: "not_equals", value }),
      ),
      ACTIVE,
    ],
    share,
  );
  // One request per user, so only the first few are asked; when more were read
  // the result is partial, and a clean one says so.
  const stranded = read.users.slice(0, LINK_CHECKS);
  const truncated = read.truncated || read.users.length > LINK_CHECKS;
  // Its own boundary: a link read that fails (a user deleted since the query)
  // must not discard the other warnings.
  let failed = false;
  const hasLink = await mapBounded(stranded, CONCURRENCY, async (user) => {
    try {
      const { identity_links: links } = await ctx.client.listUserIdentityLinks(user.id, {
        limit: 1,
      });
      return links.length > 0;
    } catch (error) {
      // A user deleted since the query answers 404: nothing to report.
      if (!(error instanceof ApiError && error.status === 404)) {
        failed = true;
      }
      return false;
    }
  });
  // Revisions of one schema share an object type, so they are one count.
  const linked = new Map<string | symbol, number>();
  const nameOf = hasLink.some(Boolean) ? await names() : undefined;
  stranded.forEach((user, index) => {
    if (!hasLink[index]) {
      return;
    }
    const name = nameOf?.get(user.schema)?.objectType ?? UNNAMED;
    linked.set(name, (linked.get(name) ?? 0) + 1);
  });
  const warnings = [...linked].map(([name, total]) => {
    const label = typeof name === "string" ? quote(name) : "schemas whose names could not be read";
    return `${count(total, truncated)} existing ${plural(total, "user")} of ${label} ${total === 1 ? "has" : "have"} an SSO link, but no flow in this release uses that schema, so they cannot sign in with SSO. Passkey sign-in is not affected. Users cannot move between schemas, so keep or restore a flow on ${label}.`;
  });
  return {
    warnings,
    partial: truncated && warnings.length === 0 ? ["the schemas no flow serves"] : [],
    failed,
  };
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
  let more = true;
  while (more && users.length < max) {
    const page = await ctx.client.queryUsers(
      {
        limit: Math.min(PAGE_SIZE, max - users.length),
        filter,
        ...(pageToken === undefined ? {} : { page_token: pageToken }),
      },
      { project_id: ctx.projectId },
    );
    users.push(...page.users);
    pageToken = page.next_page_token ?? undefined;
    // An empty page that still offers another is not progress.
    more = pageToken !== undefined && page.users.length > 0;
  }
  return { users, truncated: pageToken !== undefined };
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

/** Each schema revision's id against its object type and designated identifier. */
async function objectTypes(ctx: StepContext): Promise<Map<string, SchemaInfo>> {
  const names = new Map<string, SchemaInfo>();
  const listed = await ctx.client.listSchemas.all({ project_id: ctx.projectId });
  for (const entry of listed) {
    const document = entry.schema as { objectType?: unknown; "x-identifier"?: unknown } | undefined;
    if (typeof document?.objectType === "string") {
      const identifier = document["x-identifier"];
      names.set(entry.id, {
        objectType: document.objectType,
        ...(typeof identifier === "string" && identifier !== "" ? { identifier } : {}),
      });
    }
  }
  return names;
}

const quote = (value: string) => `"${value}"`;
const plural = (n: number, noun: string) =>
  new Intl.PluralRules("en").select(n) === "one" ? noun : `${noun}s`;
const count = (n: number, truncated: boolean) => (truncated ? `at least ${n}` : `${n}`);
