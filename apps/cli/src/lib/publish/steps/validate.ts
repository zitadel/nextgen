import { ZitadelError } from "@/lib/errors";
import { mapBounded } from "@/lib/map-bounded";
import type { Step, StepContext, StepResult } from "@/lib/publish/pipeline";
import { CONFIG_DIRECTORIES, type Issue, type RuleId, UserSchema } from "@/lib/zitadel";
import { brandingAssetWarnings } from "./asset-probe";
import { validateConnections } from "./idp-checks";

/**
 * The only rule whose advice depends on which connections the project already
 * has, and so is left out when they cannot be listed.
 */
export const DEPLOYED_DEPENDENT_RULE: RuleId = "sso/subject-claim-unstable";

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
    const found = ctx.config.validate({ store: ctx.store, environment: ctx.env });
    // Without the connections the project has, the advice would be given for
    // every one of them, deployed ones included, which could not follow it.
    const issues = found.filter((issue) => {
      return !(ctx.deployedUnknown === true && issue.rule === DEPLOYED_DEPENDENT_RULE);
    });
    // The local findings are refused before the server is asked anything, so
    // a server that cannot be reached never hides them.
    refuseErrors(ctx, issues);
    refuseErrors(ctx, await unresolvedSchemas(ctx));
    await validateConnections(ctx);
    const branding = ctx.bundle.branding;
    const brandings = branding === undefined ? [] : [branding];
    const assetWarnings = await brandingAssetWarnings(brandings);
    const warnings = issues
      .filter((issue) => {
        return issue.severity === "warning";
      })
      .map((issue) => {
        return `${issue.file}: ${issue.message}`;
      });
    return { warnings: [...warnings, ...assetWarnings] };
  },
};

/**
 * A finding that only the server could make, about a flow's schema.
 */
type ServerFinding = {
  readonly file: string;
  readonly rule: string;
  readonly message: string;
};

/**
 * A finding as `--json` lists it under `details.issues`.
 */
type ReportedFinding = {
  readonly rule: string;
  readonly path: string;
  readonly steps?: Issue["steps"];
  readonly message: string;
};

/**
 * One finding as `--json` lists it.
 *
 * @param finding - A rule's issue or a server finding.
 * @returns Its rule, file, steps when the rule named any, and message.
 */
function reported(finding: Issue | ServerFinding): ReportedFinding {
  const base = { rule: finding.rule, path: finding.file };
  if ("steps" in finding && finding.steps !== undefined) {
    return { ...base, steps: finding.steps, message: finding.message };
  }
  return { ...base, message: finding.message };
}

/**
 * Stop the deploy on every error, named in one `E_VALIDATION`, before anything
 * is sent.
 *
 * @param ctx - The step's context, for the commands a hint suggests.
 * @param findings - Every finding.
 * @throws {@link ZitadelError} `E_VALIDATION` when any finding is an error.
 */
function refuseErrors(ctx: StepContext, findings: readonly (Issue | ServerFinding)[]): void {
  const errors = findings.filter((finding) => {
    return !("severity" in finding) || finding.severity === "error";
  });
  if (errors.length === 0) {
    return;
  }
  const noun = new Intl.PluralRules("en").select(errors.length) === "one" ? "issue" : "issues";
  const literalSecret = errors.some((finding) => {
    return finding.rule === "connection/literal-secret";
  });
  const lines = errors.map((finding) => {
    return `  - ${finding.file}: ${finding.message}`;
  });
  // Any refused key may be one a newer server declares and this CLI's
  // meta-schema does not know yet, so the hint says what fixes that too.
  const refusedKey = errors.some((finding) => {
    return UserSchema.refusesKey(finding);
  });
  const fix = literalSecret
    ? `Publish a secret with \`${ctx.suggest("variable set NAME --secret")}\` and reference it as "\${{ NAME }}".`
    : "Fix the files named above and rerun; no changes were made.";
  const hint = refusedKey
    ? `${fix} A key a newer Zitadel server added needs a CLI as new as the server.`
    : fix;
  throw new ZitadelError(
    "E_VALIDATION",
    `Configuration validation failed (${errors.length} ${noun}):\n${lines.join("\n")}`,
    {
      hint,
      details: {
        issues: errors.map(reported),
      },
    },
  );
}

/**
 * Flows whose `user_schema` names a schema neither the configuration nor the
 * project holds.
 *
 * @remarks
 * The server pins the project's latest revision of a schema the release leaves
 * out and refuses the release when there is none, so a dry run asks the
 * project the same thing.
 *
 * Only an `objectType` reference is checked. A schema id (`sch_…` or a `$id`
 * URL) resolves through the server's built-in bases, and a `schema-url` entry
 * learns its `objectType` only when the server fetches it.
 *
 * @param ctx - The step's context.
 * @returns One finding per such flow.
 */
async function unresolvedSchemas(ctx: StepContext): Promise<readonly ServerFinding[]> {
  const local = ctx.config.schemas.all.flatMap((schema) => {
    const objectType = schema.objectType;
    if (objectType === undefined) {
      return [];
    }
    return [objectType];
  });
  // A schema that learns its objectType only from the server could be the one.
  if (local.length !== ctx.config.schemas.all.length) {
    return [];
  }
  const asked = ctx.config.flows.all.filter((flow) => {
    return (
      flow.userSchema !== undefined &&
      ctx.config.flows.findSchemaOf(flow) === undefined &&
      !flow.namesSchemaById
    );
  });
  const quoted = local.map((objectType) => {
    return `"${objectType}"`;
  });
  const listed = quoted.length === 0 ? "none" : quoted.join(", ");
  // One request at a time, so the step asks the project for one schema at once.
  const findings = await mapBounded(asked, 1, async (flow): Promise<readonly ServerFinding[]> => {
    const reference = flow.userSchema;
    if (reference === undefined) {
      return [];
    }
    // Through the schema service, which is bound to the project this run
    // addresses, so the step says which schema it is after and never which
    // endpoint answers.
    const page = await ctx.schemas.page({ object_type: reference, revisions: "latest", limit: 1 });
    if (page.items.length > 0) {
      return [];
    }
    return [
      {
        file: flow.path,
        rule: "release/user-schema-resolves",
        message: `user_schema "${reference}" is not the objectType of a schema in ${CONFIG_DIRECTORIES.schemas}/ (${listed}) or in the project.`,
      },
    ];
  });
  return findings.flat();
}
