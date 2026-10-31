import { join } from "node:path";

import { type ProjectTree, validateProject } from "@zitadel/config/validate";

import { ZitadelError } from "../../errors";
import { FLOWS_DIR } from "../../flows";
import { IDPS_DIR } from "../../idp";
import { type JsonDirEntry, readJsonDirEntries } from "../../json-dir";
import { SCHEMAS_DIR } from "../../user-schema";
import type { StepContext } from "../pipeline";
import { reportWarning } from "../../warnings";

/**
 * Cross-file checks on the SSO configuration, before anything is sent.
 *
 * A flow that offers a provider its schema does not list, or a schema that
 * lists a provider with no connection file, is only visible when the files are
 * read together, and the server would reveal it late or not at all. This reads
 * the whole of `.zitadel/` so the rules can see what each file points at, and
 * throws one `E_VALIDATION` naming every problem, so a deploy (or a dry run)
 * stops before any request.
 *
 * A deploy publishes everything under `.zitadel/`, so everything is judged;
 * there is no narrower set of files a deploy "touches".
 */
export async function validateSsoConsistency(
  cwd: string,
  suggest: StepContext["suggest"],
  deployed?: ReadonlySet<string>,
): Promise<void> {
  const [schemas, flows, connections] = await Promise.all([
    readJsonDirEntries(join(cwd, SCHEMAS_DIR)),
    readJsonDirEntries(join(cwd, FLOWS_DIR)),
    readJsonDirEntries(join(cwd, IDPS_DIR)),
  ]);
  const keyed = (dir: string, entries: ReadonlyArray<JsonDirEntry>) =>
    new Map(entries.map((entry) => [`${dir}/${entry.name}`, entry.body] as const));
  const schemaFiles = keyed(SCHEMAS_DIR, schemas);

  const tree: ProjectTree = {
    schemas: schemaFiles,
    flows: new Map(
      flows.map((flow) => {
        const path = `${FLOWS_DIR}/${flow.name}`;
        const schemaPath = pinnedSchemaPath(flow.body, schemaFiles);
        // Said aloud, because the alternative is a flow that passes by not being
        // checked: its schema may be one this project does not keep locally.
        if (schemaPath === undefined && offeredProviders(flow.body).length > 0) {
          reportWarning(
            `${path}: could not tell which local schema this flow pins, so its provider rules were not checked against a schema`,
          );
        }
        return [path, { body: flow.body, schemaPath }] as const;
      }),
    ),
    connections: keyed(IDPS_DIR, connections),
    ...(deployed ? { deployed } : {}),
  };

  const issues = validateProject(tree);

  // A warning-severity issue almost certainly does not do what was meant but
  // may be what the admin intends: a claim the scopes may not return, a claim
  // type that does not fit its property, a verification read from a claim
  // that is not a flag, or a subject_claim the user can change. It is worth
  // saying, but it must not stop a deploy, so it is reported as a non-blocking
  // warning and does not join the thrown error.
  for (const issue of issues.filter((entry) => entry.severity === "warning")) {
    reportWarning(`${issue.file}: ${issue.message}`);
  }

  // Only error-severity issues block. When every issue was a warning, the
  // deploy proceeds.
  const errors = issues.filter((entry) => entry.severity === "error");
  if (errors.length === 0) {
    return;
  }
  const noun = errors.length === 1 ? "issue" : "issues";
  throw new ZitadelError(
    "E_VALIDATION",
    `SSO configuration is not consistent (${errors.length} ${noun}):\n` +
      errors.map((issue) => `  - ${issue.file}: ${issue.message}`).join("\n"),
    {
      hint:
        "These checks read the schemas, flows and connection files together. " +
        "Fix the files named above, then check again; no changes were made. " +
        "Only the CLI makes these checks.",
      nextCommands: [suggest("deploy --dry-run")],
      details: {
        issues: errors.map(({ rule, file, steps, message }) => ({
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
 * The slugs of the connections the project already has on the server, or
 * `undefined` when it cannot say. Some advice only holds before a connection's
 * first deploy, so a server that does not answer only means that advice is
 * given anyway: it never fails the check.
 */
export async function deployedSlugs(
  ctx: Pick<StepContext, "client" | "projectId">,
): Promise<ReadonlySet<string> | undefined> {
  const slugs = new Set<string>();
  let pageToken: string | null | undefined;
  try {
    do {
      const page = await ctx.client.queryIdps(
        { limit: 100, ...(pageToken ? { page_token: pageToken } : {}) },
        { project_id: ctx.projectId },
      );
      for (const idp of page.idps) {
        slugs.add(idp.slug);
      }
      pageToken = page.next_page_token;
    } while (pageToken);
  } catch {
    return undefined;
  }
  return slugs;
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
 * be told. A flow names its schema by `objectType`; a schema's `$id` is also
 * accepted for a flow written against the URL form.
 */
function pinnedSchemaPath(flow: object, schemas: ReadonlyMap<string, object>): string | undefined {
  const ref = (flow as { user_schema?: unknown }).user_schema;
  if (typeof ref !== "string" || ref === "") {
    return undefined;
  }
  for (const [path, schema] of schemas) {
    const { $id, objectType } = schema as { $id?: unknown; objectType?: unknown };
    if ($id === ref || objectType === ref) {
      return path;
    }
  }
  return undefined;
}
