import { type FlowValidationIssue, validateFlowDefinition } from "@zitadel/config/validate";

import { ZitadelError } from "../../errors";
import { flowEnvRefs } from "../../flows";
import { reportWarning } from "../../warnings";
import type { Step, StepContext } from "../pipeline";
import { brandingAssetWarnings } from "./asset-probe";

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
  async run(ctx: StepContext): Promise<void> {
    assertEnvRefsResolve(ctx);
    validateFlows(ctx);
    for (const warning of await brandingAssetWarnings(ctx.bundle.brandings)) {
      reportWarning(warning);
    }
  },
};

/** The schema a flow's `user_schema` names, found by `objectType` in the bundle. */
function schemaFor(ctx: StepContext, flow: Record<string, unknown>): object | undefined {
  const ref = flow.user_schema;
  if (typeof ref !== "string" || ref === "") {
    return undefined;
  }
  return ctx.bundle.schemas.find((schema) => schema.objectType === ref);
}

/**
 * The semantic flow validation the server enforces when it builds the release:
 * errors aggregate into one `E_VALIDATION`, warnings are reported as they are
 * found. The schema a flow pins is resolved from the bundle so schema-aware
 * rules run.
 */
function validateFlows(ctx: StepContext): void {
  const failures: Array<{ handle: string; issue: FlowValidationIssue }> = [];
  for (const flow of ctx.bundle.flow_definitions) {
    const handle = typeof flow.name === "string" ? flow.name : "flow";
    for (const issue of validateFlowDefinition(flow, schemaFor(ctx, flow))) {
      if (issue.severity === "error") {
        failures.push({ handle, issue });
      } else {
        reportWarning(`${handle}: ${issue.message}`);
      }
    }
  }
  if (failures.length === 0) {
    return;
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
function assertEnvRefsResolve(ctx: StepContext): void {
  const missing = new Set<string>();
  for (const resource of [
    ...ctx.bundle.schemas,
    ...ctx.bundle.flow_definitions,
    ...ctx.bundle.brandings,
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
