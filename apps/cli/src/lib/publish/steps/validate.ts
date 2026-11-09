import { ZitadelError } from "@/lib/errors";
import type { Step, StepContext, StepResult } from "@/lib/publish/pipeline";
import { CONFIG_DIRECTORIES, type Issue } from "@/lib/zitadel";
import { brandingAssetWarnings } from "./asset-probe";
import { validateConnections } from "./idp-checks";

/**
 * Validate the configuration the way the server does before it builds the
 * release, so a misconfiguration fails here with the file named rather than as
 * a bulk `rel.invalid` from the server.
 *
 * Every rule about the files lives in the configuration library and runs in one
 * pass: each file's contract, the server's flow rules, the variables the
 * environment must hold, and how the files agree. What stays here needs the
 * server: a flow pinning a schema only the project holds, the variables a
 * connection names, and whether a branding asset URL serves an image.
 */
export const validateStep: Step = {
  name: "validate",
  runsFor: ["deploy", "preview"],
  async run(ctx: StepContext): Promise<StepResult> {
    const issues = ctx.config.validate({ store: ctx.store, environment: ctx.env });
    refuseErrors(ctx, [...issues, ...(await unresolvedSchemas(ctx))]);
    await validateConnections(ctx);
    const assetWarnings = await brandingAssetWarnings(
      ctx.bundle.branding === undefined ? [] : [ctx.bundle.branding],
    );
    const warnings = issues
      .filter((issue) => {
        return issue.severity === "warning";
      })
      .map((issue) => {
        return `${issue.file}: ${issue.message}`;
      });
    return { warnings: [...unpinnedFlows(ctx), ...warnings, ...assetWarnings] };
  },
};

/** A finding that only the server could make, about a flow's schema. */
type ServerFinding = Readonly<{ file: string; rule: string; message: string }>;

/**
 * Stop the deploy on every error, named in one `E_VALIDATION`, before anything
 * is sent.
 *
 * @param ctx - The step's context, for the commands a hint suggests.
 * @param findings - Every finding.
 * @throws ZitadelError `E_VALIDATION` when any finding is an error.
 */
function refuseErrors(ctx: StepContext, findings: readonly (Issue | ServerFinding)[]): void {
  const errors = findings.filter((finding) => {
    return !("severity" in finding) || finding.severity === "error";
  });
  if (errors.length === 0) {
    return;
  }
  const noun = errors.length === 1 ? "issue" : "issues";
  const literalSecret = errors.some((finding) => {
    return finding.rule === "connection/literal-secret";
  });
  throw new ZitadelError(
    "E_VALIDATION",
    `Configuration validation failed (${errors.length} ${noun}):\n` +
      errors
        .map((finding) => {
          return `  - ${finding.file}: ${finding.message}`;
        })
        .join("\n"),
    {
      hint: literalSecret
        ? `Publish a secret with \`${ctx.suggest("variable set NAME --secret")}\` and reference it as "\${{ NAME }}".`
        : "These are the same rules the server enforces. Fix the files named above and re-run; no changes were made.",
      details: {
        issues: errors.map((finding) => {
          return {
            rule: finding.rule,
            path: finding.file,
            ...("steps" in finding && finding.steps !== undefined ? { steps: finding.steps } : {}),
            message: finding.message,
          };
        }),
      },
    },
  );
}

/**
 * Flows that offer a provider but pin no local schema, said aloud because the
 * alternative is a flow that passes by not being checked.
 *
 * @param ctx - The step's context.
 * @returns One warning per such flow.
 */
function unpinnedFlows(ctx: StepContext): string[] {
  return ctx.config.flows
    .filter((flow) => {
      return ctx.config.schemaOf(flow) === undefined && flow.offers();
    })
    .map((flow) => {
      return `${flow.path}: could not tell which local schema this flow pins, so its provider rules were not checked against a schema`;
    });
}

/**
 * Flows whose `user_schema` names a schema neither the configuration nor the
 * project holds. The server pins the project's latest revision of a schema the
 * release leaves out and refuses the release when there is none, so a dry run
 * asks the project the same thing.
 *
 * Only an `objectType` reference is checked. A schema id (`sch_…` or a `$id`
 * URL) resolves through the server's built-in bases, and a `schema-url` entry
 * learns its `objectType` only when the server fetches it.
 *
 * @param ctx - The step's context.
 * @returns One finding per such flow.
 */
async function unresolvedSchemas(ctx: StepContext): Promise<ServerFinding[]> {
  const local = ctx.config.schemas.flatMap((schema) => {
    const objectType = schema.body.objectType;
    return typeof objectType === "string" ? [objectType] : [];
  });
  // A schema that learns its objectType only from the server could be the one.
  if (local.length !== ctx.config.schemas.length) {
    return [];
  }
  const findings: ServerFinding[] = [];
  for (const flow of ctx.config.flows) {
    const ref = flow.userSchema;
    if (ref === undefined || ctx.config.schemaOf(flow) !== undefined || isSchemaId(ref)) {
      continue;
    }
    // Through the schema service, which is bound to the project this run
    // addresses, so the step says which schema it is after and never which
    // endpoint answers.
    const page = await ctx.schemas.page({ object_type: ref, revisions: "latest", limit: 1 });
    if (page.items.length > 0) {
      continue;
    }
    const listed =
      local.length === 0
        ? "none"
        : local
            .map((objectType) => {
              return `"${objectType}"`;
            })
            .join(", ");
    findings.push({
      file: flow.path,
      rule: "release/user-schema-resolves",
      message: `user_schema "${ref}" is not the objectType of a schema in ${CONFIG_DIRECTORIES.schemas}/ (${listed}) or in the project.`,
    });
  }
  return findings;
}

/**
 * Whether a `user_schema` is a schema id rather than an `objectType`, told
 * apart as the server's `isUserSchemaID` does.
 *
 * @param ref - The reference.
 * @returns Whether it is an id.
 */
function isSchemaId(ref: string): boolean {
  return /^sch_./.test(ref) || /^[a-z][a-z0-9+.-]*:/i.test(ref);
}
