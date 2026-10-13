import { basename } from "node:path";

import { type SsoConfigurationTree, validateSsoConfiguration } from "@zitadel/config/validate";

import { ZitadelError } from "../errors";
import { FLOWS_DIR } from "../flows";
import { IDPS_DIR } from "../idp";
import { SCHEMAS_DIR } from "../user-schema";
import type { ResourceEntry, SyncAction } from "./types.js";

/**
 * Cross-file checks on the SSO configuration, before anything is sent.
 *
 * A flow that offers a provider its schema does not list, or a schema that
 * lists a provider with no connection file, is only visible when the files are
 * read together, and the server would reveal it mid-apply or not at all. This
 * reads the whole working tree and throws one E_VALIDATION naming every
 * problem, so `plan` and `apply` both stop before any request.
 *
 * It runs only when this plan touches a schema, a flow or a connection, for the
 * same reason flow validation judges only the flows it uploads: an unchanged
 * project is never re-judged, so a rule added later cannot break one that was
 * already applied.
 */
export function validatePlannedSso(opts: {
  actions: SyncAction[];
  scannedContents: ReadonlyMap<string, object>;
  stateResources: Readonly<Record<string, ResourceEntry>>;
}): void {
  // Already announced once by flow validation, which runs first.
  if (process.env.ZITADEL_SKIP_FLOW_VALIDATION) {
    return;
  }
  const writes = opts.actions.filter(
    (action) => action.kind === "create" || action.kind === "update" || action.kind === "revise",
  );
  if (!writes.some((action) => ["schema", "flow", "idp"].includes(action.syncer.kind))) {
    return;
  }

  const inDir = (dir: string) =>
    new Map([...opts.scannedContents].filter(([path]) => path.startsWith(`${dir}/`)));
  const schemas = inDir(SCHEMAS_DIR);
  const repins = new Map(
    writes.flatMap((action) =>
      "repin" in action && action.repin ? [[action.path, action.repin.schemaPath] as const] : [],
    ),
  );

  const flows = new Map(
    [...inDir(FLOWS_DIR)].map(([path, body]) => [
      path,
      { body, schemaPath: pinnedSchemaPath(path, body, schemas, repins, opts.stateResources) },
    ]),
  );
  const tree: SsoConfigurationTree = { schemas, flows, connections: inDir(IDPS_DIR) };

  const issues = validateSsoConfiguration(tree);
  if (issues.length === 0) {
    return;
  }
  const noun = issues.length === 1 ? "issue" : "issues";
  throw new ZitadelError(
    "E_VALIDATION",
    `SSO configuration is not consistent (${issues.length} ${noun}):\n` +
      issues.map((issue) => `  - ${issue.file}: ${issue.message}`).join("\n"),
    {
      hint:
        "These checks read the schemas, flows and connection files together. " +
        "Fix the files named above and run plan again; nothing was sent.",
      details: {
        issues: issues.map(({ rule, file, step, message }) => ({
          rule,
          file,
          ...(step === undefined ? {} : { step }),
          message,
        })),
      },
    },
  );
}

/**
 * The local schema a flow's `user_schema` pins, or `undefined` when it cannot
 * be told. Before the first apply the flow names the schema by the URL setup
 * wrote, afterwards by the id the platform assigned, and a re-pin in this plan
 * names the file outright.
 */
function pinnedSchemaPath(
  flowPath: string,
  flow: object,
  schemas: ReadonlyMap<string, object>,
  repins: ReadonlyMap<string, string>,
  stateResources: Readonly<Record<string, ResourceEntry>>,
): string | undefined {
  const repinned = repins.get(flowPath);
  if (repinned !== undefined) {
    return repinned;
  }
  const ref = (flow as { user_schema?: unknown }).user_schema;
  if (typeof ref !== "string" || ref === "") {
    return undefined;
  }
  for (const [path, schema] of schemas) {
    if (stateResources[path]?.id === ref || (schema as { $id?: unknown }).$id === ref) {
      return path;
    }
  }
  const named = [...schemas.keys()].filter((path) => ref.endsWith(`/${basename(path)}`));
  return named.length === 1 ? named[0] : undefined;
}
