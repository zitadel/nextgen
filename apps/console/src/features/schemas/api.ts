import { api } from "@/api/zitadel";
import { readAllPages } from "@/lib/paging";
import { ApiError } from "@zitadel/api/runtime/fetch";
import type { UserSchema, SchemaEntry, SchemaRevision } from "./model";

/**
 * Every page of the project's user schemas: the latest revision of each, or
 * every revision, of every object type or one; `inUse` also asks whether any
 * user is on each (`expand=in_use`).
 */
function listUserSchemas(
  projectId: string,
  options: { revisions: "latest" | "all"; objectType?: string; inUse?: boolean },
) {
  return readAllPages(async (pageToken) => {
    const page = await api.listSchemas({
      project_id: projectId,
      kind: "user-schema",
      revisions: options.revisions,
      ...(options.objectType ? { object_type: options.objectType } : {}),
      ...(options.inUse ? { expand: ["in_use" as const] } : {}),
      limit: 100,
      page_token: pageToken,
    });
    return { items: page.schemas, next: page.next_page_token };
  });
}

/** Every user schema in the project, at its latest revision. */
export async function fetchAllSchemas(projectId: string): Promise<SchemaEntry[]> {
  const entries = await listUserSchemas(projectId, { revisions: "latest" });
  return entries.map((entry) => ({
    id: entry.id,
    schema: entry.schema as UserSchema,
    createdAt: entry.metadata.created_at,
  }));
}

/** The id of a schema's newest revision, by its object type; `undefined` when it has none. */
export async function fetchLatestSchemaId(
  projectId: string,
  objectType: string,
): Promise<string | undefined> {
  const page = await api.listSchemas({
    project_id: projectId,
    kind: "user-schema",
    revisions: "latest",
    object_type: objectType,
    limit: 1,
  });
  return page.schemas[0]?.id;
}

/**
 * Every revision of one schema, newest first. Schemas are immutable, so a
 * revision is a schema of its own sharing the `objectType`; the history is the
 * list filtered to that type with `revisions: all`, in the server's order
 * (created at, then id, descending). The server calls a revision latest when
 * none of its type was created after it, so the first row is the server's
 * latest. `inUse` also asks whether any user is on each revision, which needs
 * read on the whole project; refused, the plain history stands in.
 */
export async function fetchSchemaRevisions(
  projectId: string,
  objectType: string,
  { inUse = false }: { inUse?: boolean } = {},
): Promise<SchemaRevision[]> {
  let entries: Awaited<ReturnType<typeof listUserSchemas>>;
  try {
    entries = await listUserSchemas(projectId, { revisions: "all", objectType, inUse });
  } catch (cause) {
    if (!inUse || !(cause instanceof ApiError) || cause.status !== 403) throw cause;
    entries = await listUserSchemas(projectId, { revisions: "all", objectType });
  }
  return entries.map((entry) => ({
    id: entry.id,
    createdAt: entry.metadata.created_at,
    ...(entry.metadata.in_use === undefined ? {} : { inUse: entry.metadata.in_use }),
  }));
}
