import { POLICY_META_SCHEMA } from "@zitadel/config/meta-schemas";

import type { SyncAction, SyncActionWarning } from "./types.js";

/** The rule name a below-recommended warning carries in `plan --json`. */
export const POLICY_BELOW_RECOMMENDED_RULE = "warn/policy-below-recommended-minimum";

/**
 * Annotate every policy this plan publishes with a warning per setting whose
 * value sits below the setting's `x-recommended-minimum`. The threshold
 * comes from the policy dialect (the wire schema, kept in parity with the
 * server's template), so the CLI never hardcodes a number: a value inside the
 * bounds but below the recommendation is legal, and the warning is the only
 * signal the developer gets.
 *
 * Mutates `actions` in place, like {@link annotateAssetWarnings} — the caller
 * (`buildSyncPlan`) owns the array it just built.
 */
export function annotatePolicyWarnings(actions: SyncAction[]): void {
  for (const action of actions) {
    if (action.kind !== "create" && action.kind !== "update" && action.kind !== "revise") {
      continue;
    }
    if (action.syncer.kind !== "policy") {
      continue;
    }
    const warnings = belowRecommended(action.content);
    if (warnings.length > 0) {
      action.warnings = [...(action.warnings ?? []), ...warnings];
    }
  }
}

/** The warnings one policy document earns, in setting order. */
export function belowRecommended(document: object): SyncActionWarning[] {
  const { operation, config } = document as { operation?: unknown; config?: unknown };
  if (typeof operation !== "string" || !isRecord(config)) {
    return [];
  }
  const settings = settingsOf(operation);
  const out: SyncActionWarning[] = [];
  for (const [name, setting] of Object.entries(settings)) {
    const recommended = setting["x-recommended-minimum"];
    const value = config[name];
    if (typeof recommended !== "number" || typeof value !== "number" || value >= recommended) {
      continue;
    }
    out.push({
      rule: POLICY_BELOW_RECOMMENDED_RULE,
      message:
        `config.${name} is ${value}, below the recommended minimum of ${recommended} for ` +
        `${operation}; the platform accepts it, but consider raising it.`,
    });
  }
  return out;
}

/**
 * The `config` property schemas of the union branch whose `operation` enum
 * names `operation`; empty for an operation the dialect does not know (the
 * server rejects that document anyway).
 */
function settingsOf(operation: string): Record<string, Record<string, unknown>> {
  const dialect = POLICY_META_SCHEMA as { $defs?: Record<string, unknown> };
  for (const branch of Object.values(dialect.$defs ?? {})) {
    if (!isRecord(branch) || !isRecord(branch.properties)) {
      continue;
    }
    const operationProperty = branch.properties.operation;
    const enumValues = isRecord(operationProperty) ? operationProperty.enum : undefined;
    if (!Array.isArray(enumValues) || !enumValues.includes(operation)) {
      continue;
    }
    const config = branch.properties.config;
    if (isRecord(config) && isRecord(config.properties)) {
      return config.properties as Record<string, Record<string, unknown>>;
    }
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
