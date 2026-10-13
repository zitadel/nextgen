import { basename } from "node:path";

import { type ProjectTree, validateProject } from "@zitadel/config/validate";

import { ZitadelError } from "../errors";
import { FLOWS_DIR } from "../flows";
import { IDPS_DIR } from "../idp";
import { SCHEMAS_DIR } from "../user-schema";
import { reportWarning } from "../warnings";
import { isUnsupportedDeletion, type UnsupportedDeletion } from "./plan-renderer.js";
import type { ResourceEntry, SyncAction } from "./types.js";

/**
 * Cross-file checks on the SSO configuration, before anything is sent.
 *
 * A flow that offers a provider its schema does not list, or a schema that
 * lists a provider with no connection file, is only visible when the files are
 * read together, and the server would reveal it mid-apply or not at all. This
 * reads the whole working tree, so the rules can see what each file points at,
 * and throws one E_VALIDATION naming every problem it reports, so `plan` and
 * `apply` both stop before any request.
 *
 * It reports only what this plan touches: the files it writes and the files
 * those reference or are referenced by. An applied project is never re-judged
 * for a file nobody edited, so a rule added later cannot stop an unrelated
 * connection edit, and a plan with no edits does not fail on a rule change.
 *
 * A removed file whose resource the platform keeps is the one exception to
 * "touches": a schema that still lists a connection with no file is
 * inconsistent however it got there, and stays reported until it is fixed.
 */
export async function validatePlannedSso(opts: {
  actions: SyncAction[];
  scannedContents: ReadonlyMap<string, object>;
  stateResources: Readonly<Record<string, ResourceEntry>>;
  /** What names the resource a kept removal left on the platform, read only when it is needed. */
  slugOfKept?: (kept: UnsupportedDeletion) => Promise<string | undefined>;
}): Promise<void> {
  // Already announced once by flow validation, which runs first.
  if (process.env.ZITADEL_SKIP_FLOW_VALIDATION) {
    return;
  }
  const writes = opts.actions.filter(
    (action) =>
      (action.kind === "create" || action.kind === "update" || action.kind === "revise") &&
      ["schema", "flow", "idp"].includes(action.syncer.kind),
  );
  const keptRemovals = opts.actions.filter(
    (action): action is UnsupportedDeletion =>
      isUnsupportedDeletion(action) && action.syncer.kind === "idp",
  );
  if (writes.length === 0 && keptRemovals.length === 0) {
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
    [...inDir(FLOWS_DIR)].map(([path, body]) => {
      const schemaPath = pinnedSchemaPath(path, body, schemas, repins, opts.stateResources);
      // Said aloud, because the alternative is a flow that passes by not being
      // checked: its schema may be one this project does not keep locally.
      if (schemaPath === undefined && offeredProviders(body).length > 0) {
        reportWarning(
          `${path}: could not tell which local schema this flow pins, so its provider rules were not checked against a schema`,
        );
      }
      return [path, { body, schemaPath }];
    }),
  );
  const tree: ProjectTree = { schemas, flows, connections: inDir(IDPS_DIR) };

  const written = writes.map((action) => action.path);
  const relevant = touchedFiles(written, tree);
  const connectionEdited = written.some((path) => tree.connections.has(path));
  const found = validateProject(tree);
  // A connection stands against every other one only where they collide.
  const collisions = new Set<string>(["sso/duplicate-slug", "sso/shared-variable"]);
  // A kept removal leaves its connection on the platform: a schema or flow that
  // still names that slug with no file is inconsistent however it got there.
  const keptSlugs =
    keptRemovals.length > 0 && found.some((issue) => issue.rule === "sso/connection-resolves")
      ? new Set(await Promise.all(keptRemovals.map((kept) => opts.slugOfKept?.(kept))))
      : new Set<string | undefined>();
  const issues = found.filter(
    (issue) =>
      relevant.has(issue.file) ||
      (connectionEdited && collisions.has(issue.rule) && tree.connections.has(issue.file)) ||
      (issue.rule === "sso/connection-resolves" && keptSlugs.has(issue.slug)),
  );
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

/**
 * The files a plan touches and the files they point at or are pointed at by:
 * a connection and the schemas and flows that name its slug, a schema and the
 * connections it lists and the flows pinned to it, a flow and its schema and the
 * connections it offers.
 */
function touchedFiles(written: readonly string[], tree: ProjectTree): Set<string> {
  const related = new Set(written);
  const slugOf = (body: object) => (body as { slug?: unknown }).slug;
  const connectionsListing = (slugs: readonly string[]) =>
    [...tree.connections].filter(([, body]) => slugs.includes(slugOf(body) as string));
  for (const path of written) {
    if (tree.connections.has(path)) {
      const slug = slugOf(tree.connections.get(path) as object);
      for (const [schemaPath, schema] of tree.schemas) {
        if (schemaProviders(schema).includes(slug as string)) {
          related.add(schemaPath);
        }
      }
      for (const [flowPath, { body }] of tree.flows) {
        if (offeredProviders(body).includes(slug as string)) {
          related.add(flowPath);
        }
      }
    }
    const schema = tree.schemas.get(path);
    if (schema !== undefined) {
      for (const [connectionPath] of connectionsListing(schemaProviders(schema))) {
        related.add(connectionPath);
      }
      for (const [flowPath, flow] of tree.flows) {
        if (flow.schemaPath === path) {
          related.add(flowPath);
        }
      }
    }
    const flow = tree.flows.get(path);
    if (flow !== undefined) {
      if (flow.schemaPath !== undefined) {
        related.add(flow.schemaPath);
      }
      for (const [connectionPath] of connectionsListing(offeredProviders(flow.body))) {
        related.add(connectionPath);
      }
    }
  }
  return related;
}

/** The provider slugs a schema lists in `x-auth-methods.sso.providers`. */
function schemaProviders(schema: object): string[] {
  const methods = (schema as { "x-auth-methods"?: { sso?: { providers?: unknown } } })[
    "x-auth-methods"
  ];
  const providers = methods?.sso?.providers;
  return Array.isArray(providers)
    ? providers.filter((item): item is string => typeof item === "string")
    : [];
}

/** The provider slugs the steps of a flow offer. */
function offeredProviders(flow: object): string[] {
  const steps = (flow as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) {
    return [];
  }
  return steps.flatMap((step) => {
    const providers =
      typeof step === "object" && step !== null
        ? (step as { sso_providers?: unknown }).sso_providers
        : undefined;
    return Array.isArray(providers)
      ? providers.filter((item): item is string => typeof item === "string")
      : [];
  });
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
