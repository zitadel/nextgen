import type { ZitadelClient } from "../../api-client";
import { reportWarning } from "../../warnings";
import type { Step, StepContext } from "../pipeline";

/** Users read per page, and the most this check reads in all. */
const PAGE_SIZE = 100;
const SCAN_CAP = 1000;
/** Identity-link reads in flight at once. */
const CONCURRENCY = 10;

type QueriedUser = Awaited<ReturnType<ZitadelClient["queryUsers"]>>["users"][number];
type UserFilter = { field: string; operation: string; value: string };

/**
 * Warn when this deploy leaves users who exist today unable to sign in. A
 * deploy that passes validation can still lock people out, because the flow
 * and the schema are judged without the users they will meet:
 *
 * - a schema whose `x-identifier` names a property that users of that schema
 *   do not carry sends them to registration when they type their old identifier;
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
  const schemas = new Map<string, Record<string, unknown>>();
  for (const schema of ctx.bundle.schemas) {
    if (typeof schema.objectType === "string") schemas.set(schema.objectType, schema);
  }
  // A flow's `user_schema` is an object type, or a schema id or `$id` URL that
  // the server resolves to one.
  const byId = new Map<string, string>();
  for (const schema of ctx.bundle.schemas) {
    if (typeof schema.$id === "string" && typeof schema.objectType === "string") {
      byId.set(schema.$id, schema.objectType);
    }
  }
  const names = await objectTypes(ctx);
  const resolve = (ref: string) =>
    schemas.has(ref) ? ref : (byId.get(ref) ?? names.get(ref) ?? ref);
  const flows = ctx.bundle.flow_definitions.flatMap((flow) =>
    typeof flow.name === "string" && typeof flow.user_schema === "string"
      ? [{ name: flow.name, schema: resolve(flow.user_schema) }]
      : [],
  );
  const warnings: string[] = [];

  // Case 1: the schema's identifier is a property its users lack.
  for (const objectType of new Set(flows.map((flow) => flow.schema))) {
    const identifier = schemas.get(objectType)?.["x-identifier"];
    if (typeof identifier !== "string" || identifier === "") continue;
    const { users, truncated } = await readUsers(ctx, [
      { field: "schema_object_type", operation: "equals", value: objectType },
    ]);
    const missing = users.filter((user) => !carries(user, identifier));
    if (missing.length === 0) continue;
    warnings.push(
      `${count(missing.length, truncated)} of ${count(users.length, truncated)} existing ${plural(users.length, "user")} of ${quote(objectType)} ${missing.length === 1 ? "has" : "have"} no ${quote(identifier)}, the identifier the schema now signs in with, so they cannot sign in with a password. Move each to the new revision and set it in one update: zitadel users update <user_id> --schema <revision_id> --attributes ${identifier}=<value>`,
    );
  }

  // Case 2: users on a schema no flow serves any more, with a provider linked.
  const served = [...new Set(flows.map((flow) => flow.schema))];
  if (served.length === 0) return warnings;
  const { users: stranded, truncated } = await readUsers(
    ctx,
    served.map((value) => ({ field: "schema_object_type", operation: "not_equals", value })),
  );
  const hasLink = await inBatches(stranded, async (user) => {
    const { identity_links: links } = await ctx.client.listUserIdentityLinks(user.id, {
      limit: 1,
    });
    return links.length > 0;
  });
  // Revisions of one schema share an object type, so they are one count.
  const linked = new Map<string, number>();
  stranded.forEach((user, index) => {
    if (!hasLink[index]) return;
    const name = names.get(user.schema) ?? user.schema;
    linked.set(name, (linked.get(name) ?? 0) + 1);
  });
  for (const [name, total] of linked) {
    warnings.push(
      `${count(total, truncated)} existing ${plural(total, "user")} of ${quote(name)} ${total === 1 ? "has" : "have"} an SSO link, but no flow in this release uses that schema, so they cannot sign in with SSO. Passkey sign-in is not affected. Users cannot move between schemas, so keep or restore a flow on ${quote(name)}.`,
    );
  }
  return warnings;
}

/** Run `task` over `items`, a few at a time, keeping the results in order. */
async function inBatches<T, R>(items: readonly T[], task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += CONCURRENCY) {
    results.push(...(await Promise.all(items.slice(start, start + CONCURRENCY).map(task))));
  }
  return results;
}

async function readUsers(
  ctx: StepContext,
  filter: UserFilter[],
): Promise<{ users: QueriedUser[]; truncated: boolean }> {
  const users: QueriedUser[] = [];
  let pageToken: string | undefined;
  do {
    const page = await ctx.client.queryUsers(
      {
        limit: PAGE_SIZE,
        filter,
        ...(pageToken === undefined ? {} : { page_token: pageToken }),
      } as never,
      { project_id: ctx.projectId },
    );
    users.push(...page.users);
    pageToken = page.next_page_token ?? undefined;
  } while (pageToken !== undefined && users.length < SCAN_CAP);
  return { users, truncated: pageToken !== undefined };
}

/** Whether the user holds a value at the (dotted) attribute path. */
function carries(user: QueriedUser, path: string): boolean {
  let node: unknown = user.attributes;
  for (const key of path.split(".")) {
    if (typeof node !== "object" || node === null) return false;
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
