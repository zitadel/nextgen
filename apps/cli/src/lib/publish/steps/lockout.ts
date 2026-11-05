import { usableSignInMethods } from "@/lib/auth-methods";
import type { Credential, QueriedUser, UserQuery } from "@/lib/backend";
import { isCancellation } from "@/lib/errors";
import { mapBounded } from "@/lib/map-bounded";
import { reportWarning } from "@/lib/warnings";
import type { Step, StepContext } from "@/lib/publish/pipeline";

/** Users read per page, and the most the whole check reads, shared out across its scans. */
const PAGE_SIZE = 100;
const SCAN_CAP = 1000;
/** The most stranded users whose identity links are looked up. */
const LINK_CHECKS = 200;
/** Identity-link reads in flight at once. */
const CONCURRENCY = 10;

type UserFilter = NonNullable<UserQuery["filter"]>[number];
type Flow = { schema: string; identifier?: string };
/**
 * What a scan found, whose users it only partly read without finding anything,
 * and whether a request failed.
 */
type Scan = { warnings: string[]; partial: string[]; failed: boolean };
/** A schema as the project lists it: its object type, designated identifier and the ways in it enables. */
type SchemaInfo = { objectType: string; identifier?: string; methods: readonly Credential[] };
/** A schema whose users this release takes a way to sign in from, and the ways it keeps. */
type MethodChange = {
  objectType: string;
  disabled: readonly Credential[];
  kept: readonly Credential[];
};
/** The project's schemas by revision id and by object type, or nothing when the listing could not be read. */
type Listing = {
  byId: ReadonlyMap<string, SchemaInfo>;
  /** The newest revision of each object type, which is what a flow naming the object type runs on. */
  byObjectType: ReadonlyMap<string, SchemaInfo>;
};
type Names = () => Promise<Listing | undefined>;
/** A scan with nothing to report. */
const nothing = (): Scan => ({ warnings: [], partial: [], failed: false });
/** Several scans as one. */
const merged = (scans: readonly Scan[]): Scan => ({
  warnings: scans.flatMap((scan) => scan.warnings),
  partial: scans.flatMap((scan) => scan.partial),
  failed: scans.some((scan) => scan.failed),
});
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
 * - users of a schema that no flow in the release serves cannot sign in at all
 *   (a flow moved to another schema leaves them there), and those with a
 *   linked provider account cannot continue an SSO sign-in either;
 * - users whose only credential is a method this release disables on their
 *   schema (a passkey, once passkeys are off) have nothing left to sign in with.
 *
 * All are read from the users the project holds now, so they hold whatever
 * the previous release said. Warn only: a deploy that does this on purpose, or
 * after migrating the users, is not stopped. The check is best effort, as it
 * only needs read access and a failing read must never fail a deploy.
 */
export const lockoutStep: Step = {
  name: "lockout",
  runsFor: ["deploy"],
  async run(ctx: StepContext): Promise<undefined> {
    // Branding, policies and connections cannot lock anyone out. Without a
    // diff to say so, the check runs.
    // A flow whose schema the release does not carry runs on the server's
    // newest revision, which a clean diff says nothing about.
    if (ctx.learned?.schemasOrFlowsChanged === false && !resolvesOnServer(ctx)) {
      return undefined;
    }
    try {
      for (const message of await lockoutWarnings(ctx)) {
        reportWarning(message);
      }
    } catch (error) {
      // The person stopping the command is not a check that could not finish.
      if (isCancellation(error)) {
        throw error;
      }
      // Never a failed deploy, but never a silent pass either.
      reportWarning(
        "Could not finish checking existing users for sign-in lockouts: an unexpected error stopped the check.",
      );
    }
    return undefined;
  },
};

function resolvesOnServer(ctx: StepContext): boolean {
  const carried = new Set<unknown>();
  for (const schema of ctx.bundle.schemas) {
    carried.add(schema.objectType);
    carried.add(schema.$id);
  }
  return ctx.bundle.flow_definitions.some(
    (flow) => typeof flow.user_schema === "string" && !carried.has(flow.user_schema),
  );
}

async function lockoutWarnings(ctx: StepContext): Promise<string[]> {
  // Names are only needed for flows that name a schema by id and for the SSO
  // warning, so they are read on first use, and a failed read costs the names.
  let listed: Promise<Listing | undefined> | undefined;
  const names: Names = () => {
    listed ??= objectTypes(ctx).catch(() => undefined);
    return listed;
  };
  const { flows, unresolved, unreadable } = await servedFlows(ctx, names);
  // Why the unserved-schema check cannot run, if it cannot. A release with no flow
  // definitions needs no note: against a real server, such a release leaves the
  // project serving the flows it already had, so it strands no one (unlike one
  // whose flows are all drafts).
  const ssoSkipped = unreadable
    ? "Skipped the check for users of schemas no flow serves: the project's schemas could not be read."
    : unresolved
      ? "Skipped the check for users of schemas no flow serves: a flow names a schema that this release does not define."
      : ctx.bundle.flow_definitions.length === 0
        ? ""
        : undefined;
  const disabling = await disabledMethods(ctx, names, flows);
  // Every scan gets its own share of the cap up front, so none can starve
  // another and the total stays within it.
  const scanned = new Set(
    flows.filter((flow) => flow.identifier !== undefined).map((flow) => flow.schema),
  );
  const share = Math.max(1, Math.floor(SCAN_CAP / (scanned.size + 1 + disabling.changes.length)));
  // One scan failing must not discard what the other found.
  const settled = await Promise.allSettled([
    lookupWarnings(ctx, flows, share),
    ssoSkipped === undefined ? unservedWarnings(ctx, flows, names, share) : nothing(),
    credentialWarnings(ctx, disabling.changes, share),
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
  if (ssoSkipped) {
    notes.push(ssoSkipped);
  }
  if (disabling.unreadable) {
    notes.push(
      "Skipped the check for users whose only way to sign in this release disables: the live release's schemas could not be read.",
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
    const schema = known ?? (listing?.byId.get(ref) ?? listing?.byObjectType.get(ref))?.objectType;
    if (schema === undefined) {
      // Without the listing it is not known whether the schema exists.
      unreadable ||= known === undefined && listing === undefined;
      unresolved ||= listing !== undefined;
      continue;
    }
    // Only the schema's designated identifier performs a lookup, and only when
    // a step on the login path collects it. The release pins the newest
    // revision, so a revision id only names the object type: the bundle's own
    // schema decides the identifier (and may have none), and the newest listed
    // revision decides it only for a schema this release does not carry.
    const identifier = objectTypes.has(schema)
      ? designated.get(schema)
      : listing?.byObjectType.get(schema)?.identifier;
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
            `${count(missing.length, truncated)} of ${count(users.length, truncated)} existing ${plural(users.length, "user")} of ${quote(objectType)} ${missing.length === 1 ? "has" : "have"} no ${quote(identifier)}, the field the login flow looks users up by, so those who sign in with a password and type it are offered registration instead of being signed in. Move each user to the schema revision that defines it and set it in one update: ${ctx.suggest(`users update <user_id> --schema <revision_id> --set attributes.${identifier}=<value>`)}`,
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
  return merged(scans);
}

/** Users on a schema no flow serves any more, and which of them have a provider linked. */
async function unservedWarnings(
  ctx: StepContext,
  flows: readonly Flow[],
  names: Names,
  share: number,
): Promise<Scan> {
  const served = [...new Set(flows.map((flow) => flow.schema))];
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
  // Every one of them is stranded, linked or not. The link read is one request
  // per user, so only the first few are asked, and the SSO count says so.
  const stranded = read.users;
  const linkChecked = stranded.slice(0, LINK_CHECKS);
  const linksPartial = stranded.length > LINK_CHECKS || read.truncated;
  // Its own boundary: a link read that fails (a user deleted since the query)
  // must not discard the other warnings.
  let failed = false;
  const hasLink = await mapBounded(linkChecked, CONCURRENCY, async (user) => {
    try {
      // A user deleted since the query holds no links, which the service
      // answers rather than raising: nothing to report for them.
      return await ctx.users.hasIdentityLink(user.id);
    } catch (error) {
      if (isCancellation(error)) {
        throw error;
      }
      failed = true;
      return false;
    }
  });
  // Revisions of one schema share an object type, so they are one count.
  const found = new Map<string | symbol, { users: number; linked: number }>();
  const linksUnsure = linksPartial || failed;
  const nameOf = stranded.length > 0 ? await names() : undefined;
  stranded.forEach((user, index) => {
    const name = nameOf?.byId.get(user.schema)?.objectType ?? UNNAMED;
    const entry = found.get(name) ?? { users: 0, linked: 0 };
    entry.users += 1;
    entry.linked += hasLink[index] ? 1 : 0;
    found.set(name, entry);
  });
  const warnings = [...found].map(([name, { users, linked }]) => {
    const label = typeof name === "string" ? quote(name) : "schemas whose names could not be read";
    const sso =
      linked > 0
        ? ` (${count(linked, linksUnsure)} of them ${linked === 1 ? "has" : "have"} an SSO link)`
        : "";
    return `${count(users, read.truncated)} existing ${plural(users, "user")} of ${label} ${users === 1 ? "is" : "are"} on a schema no flow in this release uses${sso}, so they cannot sign in with a password or SSO. Users cannot move between schemas, so keep or restore a flow on ${label}.`;
  });
  return {
    warnings,
    partial: read.truncated && warnings.length === 0 ? ["the schemas no flow serves"] : [],
    failed,
  };
}

/**
 * The schemas whose revision in the live release enables a way to sign in
 * that the revision this release pins does not: its own, or the newest one
 * for a schema a flow names that the release does not carry. The live release is the baseline, not
 * the newest revision listed: a schema switched off and back on again pins an
 * older revision. A schema nothing live pins has no users of the live login to
 * strand, and nothing deployed means nothing to compare.
 */
async function disabledMethods(
  ctx: StepContext,
  names: Names,
  flows: readonly Flow[],
): Promise<{ changes: MethodChange[]; unreadable: boolean }> {
  // What each schema enables after this release: the release's own revision,
  // or, for a schema a flow names that the release does not carry, the newest
  // revision, which the server pins in its place.
  const bundled = new Map<string, Credential[]>();
  for (const schema of ctx.bundle.schemas) {
    if (typeof schema.objectType === "string") {
      bundled.set(schema.objectType, credentialMethods(schema));
    }
  }
  const autoPinned = [...new Set(flows.map((flow) => flow.schema))].filter(
    (objectType) => !bundled.has(objectType),
  );
  if (bundled.size === 0 && autoPinned.length === 0) {
    return { changes: [], unreadable: false };
  }
  const releases = await liveReleases(ctx);
  if (releases === undefined) {
    return { changes: [], unreadable: true };
  }
  if (releases.length === 0) {
    return { changes: [], unreadable: false };
  }
  const listing = await names();
  if (listing === undefined) {
    return { changes: [], unreadable: true };
  }
  // Every primary origin's release counts: a method any of them enables is in use.
  const live = new Map<string, Set<Credential>>();
  const use = (info: SchemaInfo) => {
    const methods = live.get(info.objectType) ?? new Set<Credential>();
    for (const method of info.methods) {
      methods.add(method);
    }
    live.set(info.objectType, methods);
  };
  for (const release of releases) {
    // A release that pins no flow serves no sign-in, so none of its methods
    // are in use.
    if (!release.pinsFlow) {
      continue;
    }
    for (const id of release.schemas) {
      const info = listing.byId.get(id);
      // A live revision the listing does not show leaves its methods unknown.
      if (info === undefined) {
        return { changes: [], unreadable: true };
      }
      use(info);
    }
  }
  const changes: MethodChange[] = [];
  const after = new Map(bundled);
  for (const objectType of autoPinned) {
    const newest = listing.byObjectType.get(objectType);
    if (newest !== undefined) {
      after.set(objectType, [...newest.methods]);
    }
  }
  for (const [objectType, kept] of after) {
    const disabled = [...(live.get(objectType) ?? [])].filter((method) => !kept.includes(method));
    if (disabled.length > 0) {
      changes.push({ objectType, disabled, kept });
    }
  }
  return { changes, unreadable: false };
}

/**
 * The releases live on the primary origins: whether each pins a flow, and the
 * schema revisions it pins. Nothing when they could not be read.
 */
async function liveReleases(
  ctx: StepContext,
): Promise<{ pinsFlow: boolean; schemas: string[] }[] | undefined> {
  try {
    const deployments = await ctx.deployments.primary({ expand: ["release"] });
    return deployments.flatMap((deployment) => {
      const pointers = deployment.release?.pointers;
      if (pointers === undefined) {
        return [];
      }
      return [
        {
          pinsFlow: pointers.some((pointer) => pointer.kind === "flow_definition"),
          schemas: pointers
            .filter((pointer) => pointer.kind === "schema")
            .map((pointer) => pointer.revision_id),
        },
      ];
    });
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    return undefined;
  }
}

/**
 * Users who hold a credential of a method their schema loses and none of a
 * method it keeps. A user who holds no credential at all could not sign in
 * before either, so is not counted. The credential reads are a few requests per
 * user, so only the first users are asked, and the count says so.
 */
async function credentialWarnings(
  ctx: StepContext,
  changes: readonly MethodChange[],
  share: number,
): Promise<Scan> {
  // One schema at a time, so at most CONCURRENCY users are read at once.
  const scans = await mapBounded(
    [...changes],
    1,
    async ({ objectType, disabled, kept }): Promise<Scan> => {
      try {
        const read = await readUsers(
          ctx,
          [{ field: "schema_object_type", operation: "equals", value: objectType }, ACTIVE],
          share,
        );
        const checked = read.users.slice(0, LINK_CHECKS);
        const partial = read.truncated || read.users.length > LINK_CHECKS;
        const asked = [...disabled, ...kept];
        // Its own boundary per user: one failed read must not discard the
        // counts of the others, so it only makes the count a lower bound.
        let failed = false;
        const held = await mapBounded(checked, CONCURRENCY, async (user) => {
          try {
            return await ctx.users.credentials(user.id, asked);
          } catch (error) {
            if (isCancellation(error)) {
              throw error;
            }
            failed = true;
            return undefined;
          }
        });
        const stranded = held.filter(
          (credentials) =>
            credentials !== undefined &&
            disabled.some((method) => credentials.has(method)) &&
            !kept.some((method) => credentials.has(method)),
        ).length;
        if (stranded === 0) {
          return { warnings: [], partial: partial ? [quote(objectType)] : [], failed };
        }
        const methods = disabled.join(" or ");
        return {
          warnings: [
            `${count(stranded, partial || failed)} of ${count(read.users.length, read.truncated)} existing ${plural(read.users.length, "user")} of ${quote(objectType)} can only sign in with ${methods}, which this release disables, so they cannot sign in after it. Keep ${disabled.length === 1 ? methods : "them"} enabled until they have another way in.`,
          ],
          partial: [],
          failed,
        };
      } catch (error) {
        if (isCancellation(error)) {
          throw error;
        }
        // One schema's failed read must not discard the warnings of the others.
        return { warnings: [], partial: [], failed: true };
      }
    },
  );
  return merged(scans);
}

/**
 * The ways in a schema enables that a user holds a credential for. SSO is one
 * method: an identity link names a connection, not a provider slug, so a
 * schema that keeps any provider counts every linked user as having a way in.
 */
function credentialMethods(schema: Record<string, unknown>): Credential[] {
  return usableSignInMethods(schema).filter(
    (method): method is Credential =>
      method === "password" || method === "passkey" || method === "sso",
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
  // An explicit purpose change and a missing account (which continues as a
  // sign-up) leave the login path; a plain transition to any step stays on it.
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
      // The wire allows null for an absent flow or purpose.
      const sameFlow = transition.flow == null && transition.purpose == null;
      const signsUp = outcome === "user_not_found" || outcome === "sso_user_not_found";
      if (sameFlow && !signsUp && typeof transition.target === "string") {
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
    const page = await ctx.users.page({
      limit: Math.min(PAGE_SIZE, max - users.length),
      filter,
      ...(pageToken === undefined ? {} : { page_token: pageToken }),
    });
    users.push(...page.items);
    pageToken = page.next ?? undefined;
    // An empty page that still offers another is not progress.
    more = pageToken !== undefined && page.items.length > 0;
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

/** The project's schemas, by revision id and by object type. */
async function objectTypes(ctx: StepContext): Promise<Listing> {
  const byId = new Map<string, SchemaInfo>();
  const newest = new Map<string, SchemaInfo>();
  const listed = await ctx.schemas.list();
  for (const entry of listed) {
    const document = entry.schema as Record<string, unknown> | undefined;
    if (typeof document?.objectType !== "string") {
      continue;
    }
    const identifier = document["x-identifier"];
    const info: SchemaInfo = {
      objectType: document.objectType,
      methods: credentialMethods(document),
      ...(typeof identifier === "string" && identifier !== "" ? { identifier } : {}),
    };
    byId.set(entry.id, info);
    // The API lists schemas newest first, so the first revision of an object
    // type is its newest. Timestamps are not compared: their fractional digits
    // vary in length, so they do not sort as text.
    if (!newest.has(info.objectType)) {
      newest.set(info.objectType, info);
    }
  }
  return { byId, byObjectType: newest };
}

const quote = (value: string) => `"${value}"`;
const plural = (n: number, noun: string) =>
  new Intl.PluralRules("en").select(n) === "one" ? noun : `${noun}s`;
const count = (n: number, truncated: boolean) => (truncated ? `at least ${n}` : `${n}`);
