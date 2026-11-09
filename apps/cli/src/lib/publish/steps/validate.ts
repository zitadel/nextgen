import { schemaFileIssues } from "@zitadel/config/meta-schemas";
import { type FlowValidationIssue, validateFlowDefinition } from "@zitadel/config/validate";
import { brandingConfigSchema, flowConfigSchema } from "@zitadel/config/schemas";

import { assertNoLegacyTemplateKey, readDescriptorTemplate } from "@/lib/branding";
import { ZitadelError, errorMessage } from "@/lib/errors";
import { tryCatch } from "@/lib/try-catch";
import { flowEnvRefs } from "@/lib/flows";
import { POLICIES_DIR, policyFileIssues } from "@/lib/policies";
import { SCHEMAS_DIR, schemaFileFailures } from "@/lib/user-schema";
import type { Step, StepContext, StepResult } from "@/lib/publish/pipeline";
import { brandingAssetWarnings } from "./asset-probe";
import { validateConnections } from "./idp-checks";
import { validateSsoConsistency } from "./sso-consistency";
import { validateLoginTemplate } from "@zitadel/config/template";

/**
 * Validate the bundle the way the server does before it builds the release, so
 * a misconfiguration fails here with the file named rather than as a bulk
 * `rel.invalid` from the server. Two checks the server cannot run live earn
 * their place: every `${VAR}` / `*_env` reference must resolve in the running
 * environment, and every branding asset URL must actually serve an image.
 *
 * Moved out of the sync engine, where it validated a diff; here it validates
 * the bundle a deploy (and, later, a preview) assembles.
 */
export const validateStep: Step = {
  name: "validate",
  runsFor: ["deploy", "preview"],
  async run(ctx: StepContext): Promise<StepResult> {
    assertEnvRefsResolve(ctx);
    // Structural parsing first: `validateFlowDefinition` is the semantic
    // validator and assumes its input already parsed against `flowConfigSchema`,
    // so a flow missing a required `name`/`status`/`user_schema` has to be
    // rejected here, not left to fail at release creation after the IdP step
    // has already written.
    validateBundleShapes(ctx);
    const flowWarnings = await validateFlows(ctx);
    await validateConnections(ctx);
    const ssoWarnings = await validateSsoConsistency(ctx.cwd);
    const assetWarnings = await brandingAssetWarnings(brandingsOf(ctx));
    return { warnings: [...flowWarnings, ...ssoWarnings, ...assetWarnings] };
  },
};

/**
 * Parse every schema, flow, policy and branding descriptor against the same Zod
 * the server enforces, and every user schema against its meta-schema too
 * (`schemaFileIssues`), before any writing step runs. Without this a malformed
 * schema, flow or branding only fails at `createRelease`, after the IdP-sync
 * step has already written — leaving a half-applied deploy. Errors across
 * every bundle kind aggregate into one `E_VALIDATION`. Branding is parsed from
 * the descriptor as authored (not the inlined wire body), so a `$file` that
 * cannot be read is reported here rather than silently dropped.
 */
function validateBundleShapes(ctx: StepContext): void {
  const failures: string[] = [];
  failures.push(...schemaFileFailures(ctx.bundle.schemas));
  // Any refused key may be one a newer server declares and this CLI's
  // meta-schema does not know yet, so the hint says what fixes that too.
  const refusedKey = ctx.bundle.schemas.some((schema) =>
    schemaFileIssues(schema).some((issue) => issue.key !== undefined),
  );
  ctx.bundle.flow_definitions.forEach((flow, index) => {
    const result = flowConfigSchema.safeParse(flow);
    if (!result.success) {
      const handle = typeof flow.name === "string" ? flow.name : `flow #${index + 1}`;
      for (const issue of result.error.issues) {
        failures.push(`${handle}: ${issue.path.join(".") || "(root)"} ${issue.message}`);
      }
    }
  });
  // A policy file is reported by its path: its operation names it, and a
  // file named after another operation is itself the problem.
  (ctx.bundle.policies ?? []).forEach((policy, index) => {
    const file = `${POLICIES_DIR}/${ctx.policyFiles[index] ?? "(unnamed)"}`;
    failures.push(...policyFileIssues(policy, file));
  });
  ctx.brandingSources.forEach((descriptor, index) => {
    const handle = `branding #${index + 1}`;
    // The retired `liquid_template_file` key gets its migration, not the bare
    // unrecognised-key error the schema would give.
    try {
      assertNoLegacyTemplateKey(descriptor);
    } catch (error) {
      const hint = error instanceof ZitadelError && error.hint ? ` ${error.hint}` : "";
      failures.push(`${handle}: ${errorMessage(error)}.${hint}`);
      return;
    }
    const result = brandingConfigSchema.safeParse(descriptor);
    if (!result.success) {
      for (const issue of result.error.issues) {
        failures.push(`${handle}: ${issue.path.join(".") || "(root)"} ${issue.message}`);
      }
    }
    // An unreadable `$file` reference throws here; the wire bundle dropped it,
    // so this is the only place the deploy can still catch it.
    const [error, template] = tryCatch(readDescriptorTemplate, ctx.cwd, descriptor);
    if (error) {
      failures.push(`${handle}: ${error.message}`);
    }
    // The login template runs through the same LiquidJS rules the server
    // applies (`no-script-tag`, `mandatory-gates`, ...), so a dry run, which
    // makes no server call, still catches a template the release would refuse.
    if (template !== undefined) {
      for (const issue of validateLoginTemplate(template)) {
        if (issue.severity === "error") {
          failures.push(`${handle}: template ${issue.rule}: ${issue.message}`);
        }
      }
    }
  });
  if (failures.length === 0) {
    return;
  }
  const noun = failures.length === 1 ? "issue" : "issues";
  throw new ZitadelError(
    "E_VALIDATION",
    `Configuration validation failed (${failures.length} ${noun}):\n` +
      failures.map((failure) => `  - ${failure}`).join("\n"),
    {
      hint:
        "These are the same rules the server enforces. Fix the file(s) and re-run." +
        (refusedKey ? " A key a newer Zitadel server added needs a CLI as new as the server." : ""),
      details: { issues: failures },
    },
  );
}

/** The schema a flow's `user_schema` names, found by `objectType` in the bundle. */
function schemaFor(ctx: StepContext, flow: Record<string, unknown>): object | undefined {
  const ref = flow.user_schema;
  if (typeof ref !== "string" || ref === "") {
    return undefined;
  }
  return ctx.bundle.schemas.find((schema) => schema.objectType === ref);
}

/**
 * A flow whose `user_schema` names a schema neither the bundle nor the project
 * holds. The server pins the project's latest revision of a schema the bundle
 * leaves out (`autoPinReferences`) and refuses the release when there is none
 * (`rel.unresolved_reference`), so a dry run asks the project the same thing.
 *
 * Only an `objectType` reference is checked. A schema id (`sch_…` or a `$id`
 * URL) resolves through the server's built-in bases, and a bundled
 * `schema-url` entry learns its `objectType` only when the server fetches it,
 * so a flow could name either without the bundle or the project listing it.
 */
async function unresolvedSchema(
  ctx: StepContext,
  flow: Record<string, unknown>,
  bundled: object | undefined,
): Promise<FlowFailure | undefined> {
  const ref = flow.user_schema;
  if (typeof ref !== "string" || ref === "" || bundled !== undefined || isSchemaID(ref)) {
    return undefined;
  }
  if (ctx.bundle.schemas.some((schema) => typeof schema.objectType !== "string")) {
    return undefined;
  }
  // Through the schema service, which is bound to the project this run
  // addresses, so the step says which schema it is after and never which
  // endpoint answers.
  const page = await ctx.schemas.page({
    object_type: ref,
    revisions: "latest",
    limit: 1,
  });
  if (page.items.length > 0) {
    return undefined;
  }
  const local = ctx.bundle.schemas
    .map((schema) => schema.objectType)
    .filter((objectType): objectType is string => typeof objectType === "string");
  const listed =
    local.length === 0 ? "none" : local.map((objectType) => `"${objectType}"`).join(", ");
  return {
    rule: USER_SCHEMA_RESOLVES,
    message: `user_schema "${ref}" is not the objectType of a schema in ${SCHEMAS_DIR}/ (${listed}) or in the project.`,
  };
}

/** A `user_schema` that is a schema id rather than an `objectType`, told apart as the server's `isUserSchemaID` does. */
function isSchemaID(ref: string): boolean {
  return /^sch_./.test(ref) || /^[a-z][a-z0-9+.-]*:/i.test(ref);
}

/** The CLI's own rule id for {@link unresolvedSchema}; the others are `validateFlowDefinition`'s. */
const USER_SCHEMA_RESOLVES = "release/user-schema-resolves";

type FlowFailure = Pick<FlowValidationIssue, "message" | "step"> & {
  rule: FlowValidationIssue["rule"] | typeof USER_SCHEMA_RESOLVES;
};

/**
 * The semantic flow validation the server enforces when it builds the release:
 * errors aggregate into one `E_VALIDATION`, and warnings are returned. The
 * schema a flow pins is resolved from the bundle so schema-aware rules run; a
 * schema only the project holds skips them, and one neither holds is refused.
 */
async function validateFlows(ctx: StepContext): Promise<readonly string[]> {
  const warnings: string[] = [];
  const failures: Array<{ handle: string; issue: FlowFailure }> = [];
  for (const flow of ctx.bundle.flow_definitions) {
    const handle = typeof flow.name === "string" ? flow.name : "flow";
    const schema = schemaFor(ctx, flow);
    const unresolved = await unresolvedSchema(ctx, flow, schema);
    if (unresolved !== undefined) {
      failures.push({ handle, issue: unresolved });
      continue;
    }
    for (const issue of validateFlowDefinition(flow, schema)) {
      if (issue.severity === "error") {
        failures.push({ handle, issue });
      } else {
        warnings.push(`${handle}: ${issue.message}`);
      }
    }
  }
  if (failures.length === 0) {
    return warnings;
  }
  const noun = failures.length === 1 ? "issue" : "issues";
  throw new ZitadelError(
    "E_VALIDATION",
    `Flow validation failed (${failures.length} ${noun}):\n` +
      failures.map(({ handle, issue }) => `  - ${handle}: ${issue.message}`).join("\n"),
    {
      hint: "These are the same rules the server enforces. Fix the flow definition(s) and re-run.",
      details: {
        issues: failures.map(({ handle, issue }) => ({
          handle,
          rule: issue.rule,
          message: issue.message,
          ...(issue.step === undefined ? {} : { step: issue.step }),
        })),
      },
    },
  );
}

/**
 * Fail when a `${VAR}` or `*_env` reference names an environment variable the
 * running environment does not hold: the deploy would otherwise send the
 * placeholder literally, and the login page would never resolve it. The server
 * cannot check this — the references point at the deployer's environment.
 */
/** The bundle's branding as a list, empty when it carries none. */
function brandingsOf(ctx: StepContext): Record<string, unknown>[] {
  return ctx.bundle.branding === undefined ? [] : [ctx.bundle.branding];
}

function assertEnvRefsResolve(ctx: StepContext): void {
  const missing = new Set<string>();
  for (const resource of [
    ...ctx.bundle.schemas,
    ...ctx.bundle.flow_definitions,
    ...brandingsOf(ctx),
  ]) {
    for (const name of flowEnvRefs(resource)) {
      if (!ctx.env[name]) {
        missing.add(name);
      }
    }
  }
  if (missing.size > 0) {
    throw new ZitadelError(
      "E_VALIDATION",
      `Missing environment variables: ${[...missing].sort().join(", ")}`,
    );
  }
}
