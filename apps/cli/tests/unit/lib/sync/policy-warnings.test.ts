import { describe, expect, it } from "vitest";

import {
  POLICY_BELOW_RECOMMENDED_RULE,
  annotatePolicyWarnings,
  belowRecommended,
} from "../../../../src/lib/sync/policy-warnings";
import type { ResourceSyncer, SyncAction } from "../../../../src/lib/sync/types";

const instance = (minLength: number) => ({
  kind: "policy",
  operation: "user.password.save",
  config: { min_length: minLength, history_depth: 0 },
});

describe("belowRecommended", () => {
  it("warns when a setting sits below the dialect's recommended minimum", () => {
    const warnings = belowRecommended(instance(10));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.rule).toBe(POLICY_BELOW_RECOMMENDED_RULE);
    expect(warnings[0]?.message).toContain("config.min_length is 10");
    expect(warnings[0]?.message).toContain("recommended minimum of 15");
  });

  it("is silent at or above the recommendation, and for an omitted setting", () => {
    expect(belowRecommended(instance(15))).toEqual([]);
    expect(belowRecommended(instance(20))).toEqual([]);
    expect(
      belowRecommended({ kind: "policy", operation: "user.password.save", config: {} }),
    ).toEqual([]);
  });

  it("knows nothing about an operation outside the dialect", () => {
    expect(
      belowRecommended({ kind: "policy", operation: "user.unknown", config: { min_length: 1 } }),
    ).toEqual([]);
  });
});

describe("annotatePolicyWarnings", () => {
  const syncer = (kind: string) => ({ kind }) as unknown as ResourceSyncer;

  it("annotates only policy uploads, keeping earlier warnings", () => {
    const actions: SyncAction[] = [
      {
        kind: "create",
        path: ".zitadel/policies/user.password.save.json",
        syncer: syncer("policy"),
        content: instance(8),
        hash: "h",
        warnings: [{ rule: "warn/earlier", message: "kept" }],
      },
      {
        kind: "create",
        path: ".zitadel/flows/login.json",
        syncer: syncer("flow"),
        content: instance(8),
        hash: "h",
      },
      {
        kind: "skip",
        path: ".zitadel/policies/other.json",
        syncer: syncer("policy"),
        reason: "no-change",
      } as SyncAction,
    ];

    annotatePolicyWarnings(actions);

    const policy = actions[0];
    expect(policy?.kind === "create" && policy.warnings?.map((w) => w.rule)).toEqual([
      "warn/earlier",
      POLICY_BELOW_RECOMMENDED_RULE,
    ]);
    const flow = actions[1];
    expect(flow?.kind === "create" && flow.warnings).toBeUndefined();
  });
});
