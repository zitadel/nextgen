import { basename } from "node:path";

import { type SsoConfigurationTree, validateSsoConfiguration } from "@zitadel/config/validate";

import { ZitadelError } from "../errors";
import { FLOWS_DIR } from "../flows";
import { IDPS_DIR } from "../idp";
import { SCHEMAS_DIR } from "../user-schema";
import { reportWarning } from "../warnings";
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
 * It runs only when this plan changes a schema, a flow or a connection, for the
 * same reason flow validation judges only the flows it uploads: an unchanged
 * project is never re-judged, so a rule added later cannot break one that was
 * already applied. Removing a file is a change: deleting a connection a schema
 * still lists is exactly the inconsistency this exists to stop.
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
  const changes = opts.actions.filter(
    (action) =>
      action.kind === "create" ||
      action.kind === "update" ||
      action.kind === "revise" ||
      action.kind === "delete",
  );
  if (!changes.some((action) => ["schema", "flow", "idp"].includes(action.syncer.kind))) {
    return;
  }
  const writes = changes.filter((action) => action.kind !== "delete");

  const inDir = (dir: string) =>
    new Map([...opts.scannedContents].filter(([path]) => path.startsWith(`${dir}/`)));
  const schemas = inDir(SCHEMAS_DIR);
  const repins = new Map(
    writes.flatMap((action) =>
      "repin" in action && action.repin ? [[action.path, action.repin.schemaPath] as const] : [],
    ),
  );

  const flows = new Map(
    [...inDir(FLOWS_DIR)].map(([path, body]) => {
      const schemaPath = pinnedSchemaPath(path, body, schemas, repins, opts.stateResources);
      // Said aloud, because the alternative is a flow that passes by not being
      // checked: its schema may be one this project does not keep locally.
      if (schemaPath === undefined && offersProviders(body)) {
        reportWarning(
          `${path}: could not tell which local schema this flow pins, so its provider rules were not checked against a schema`,
        );
      }
      return [path, { body, schemaPath }];
    }),
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
        "Fix the files named above and re-run plan; no changes were made. " +
        "Only the CLI makes these checks. Setting ZITADEL_SKIP_FLOW_VALIDATION skips them, " +
        "along with flow validation.",
      details: {
        issues: issues.map(({ rule, file, steps, message }) => ({
          rule,
          path: file,
          ...(steps === undefined ? {} : { steps }),
          message,
        })),
      },
    },
  );
}

/** Whether any step of a flow offers a provider. */
function offersProviders(flow: object): boolean {
  const steps = (flow as { steps?: unknown }).steps;
  return (
    Array.isArray(steps) &&
    steps.some(
      (step) =>
        typeof step === "object" &&
        step !== null &&
        Array.isArray((step as { sso_providers?: unknown }).sso_providers) &&
        (step as { sso_providers: unknown[] }).sso_providers.length > 0,
    )
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
  // The URL setup wrote names the schema by file, and only until it is applied.
  // Once the platform has given a schema an id, flows pin that id, so a URL
  // that merely ends in the same file name is another schema (a server-side
  // one this project does not keep) and must not be judged as this one.
  const named = [...schemas.keys()].filter(
    (path) => stateResources[path]?.id === undefined && ref.endsWith(`/${basename(path)}`),
  );
  return named.length === 1 ? named[0] : undefined;
}
