/**
 * The server's own rules for a login flow, run against the user schema the
 * flow pins: on every flow when the configuration is validated, and on the
 * flows a user schema edit touches before the edit is made. A flow that
 * offers a provider but pins no local schema is said aloud too, since its
 * provider rules are then not checked against a schema.
 *
 * @remarks
 * Both run the same port `deploy` has always run, with the server's messages,
 * so a dry run says what the server would say, and both judge a body as its
 * contract does, without the editor-only `$schema` pointer. An edit is refused
 * when a flow would stop validating after it, or cannot be judged because a
 * flow already fails: `deploy` would reject either, so the edit is refused
 * before anything is written.
 */

import { type FlowValidationIssue, validateFlowDefinition } from "@zitadel/config/validate";

import { BrokenFlowsError } from "@/lib/zitadel/errors";
import type { Flow } from "@/lib/zitadel/resources/flows/flow";
import { PASSWORD_FIELD } from "@/lib/zitadel/resources/flows/types";
import type { SchemaEdit, ToggleableMethod } from "@/lib/zitadel/resources/schemas/types";
import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import type { FlowCheck, FlowIssue, FlowMethodUse } from "@/lib/zitadel/rules/types";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * One finding of the server's flow rules about one flow.
 */
type FlowFinding = {
  /**
   * The flow the finding is about.
   */
  readonly flow: Flow;

  /**
   * What the server's rules found.
   */
  readonly issue: FlowValidationIssue;
};

/**
 * What a step loses when each method is disabled, as the hint names it.
 */
const REMOVED_PART = {
  password: `${PASSWORD_FIELD} field`,
  passkey: "passkey actions and their transitions",
} as const satisfies Record<ToggleableMethod, string>;

/**
 * The server's flow rules, as one rule that reports each under the server's
 * own id, and the warning for a flow offering a provider that pins no local
 * schema.
 */
export const FLOW_RULES: readonly Rule[] = [
  defineRule({
    id: (finding: FlowFinding) => {
      return finding.issue.rule;
    },
    severity: (finding: FlowFinding) => {
      return finding.issue.severity;
    },
    // The flow rules assume a flow its contract takes, which every flow and
    // schema of a configuration is: a file its contract refuses is a broken
    // file, reported by its contract rule and never judged here.
    each: (config) => {
      return config.flows.all.flatMap((flow): readonly FlowFinding[] => {
        const pinned = config.flows.findSchemaOf(flow);
        return validateFlowDefinition(flow.contractBody, pinned?.contractBody).map((issue) => {
          return { flow, issue };
        });
      });
    },
    file: (finding: FlowFinding) => {
      return finding.flow.path;
    },
    says: (finding: FlowFinding) => {
      return finding.issue.message;
    },
  }),
  defineRule({
    id: "flow/unpinned-schema",
    severity: "warning",
    // A flow that offers a provider is held to the provider rules against the
    // schema it pins. When no local schema is the one, those rules pass by not
    // running, which is said aloud rather than left to look like a pass.
    each: (config) => {
      return config.flows.all.filter((flow) => {
        return config.flows.findSchemaOf(flow) === undefined && flow.offersSso;
      });
    },
    file: (flow) => {
      return flow.path;
    },
    says: () => {
      return "could not tell which local schema this flow pins, so its provider rules were not checked against a schema";
    },
  }),
];

/**
 * Refuse a schema edit that would make a flow stop validating, or that cannot
 * be judged because a flow already fails in a way that hides it.
 *
 * @remarks
 * An edit that changes nothing breaks nothing.
 *
 * @param edit - The edit.
 * @throws {@link BrokenFlowsError} When a flow cannot be checked, or the edit
 *   breaks one, naming every issue.
 */
export function assertFlowsIntact(edit: SchemaEdit): void {
  const introduced = checkedIssues(edit);
  if (introduced.length === 0) {
    return;
  }
  throw new BrokenFlowsError({
    kind: "broken",
    file: edit.edited.path,
    heading: "A login flow would stop validating after this change:",
    hint: "Fix the steps named above, then run the command again.",
    issues: introduced,
  });
}

/**
 * Refuse turning off a method a flow still uses.
 *
 * @remarks
 * Flows are not edited for the developer (ADR 070 §2), so the refusal says
 * what the edit takes: for each step that uses the method, what it keeps
 * without it, whether it is a purpose's entry step, and which transitions lead
 * to it.
 *
 * @param edit - The edit that turns the method off.
 * @param method - The method.
 * @throws {@link BrokenFlowsError} When a flow cannot be checked, or a step
 *   still uses the method, naming every step that uses it.
 */
export function assertMethodUnused(edit: SchemaEdit, method: ToggleableMethod): void {
  const introduced = checkedIssues(edit);
  if (introduced.length === 0) {
    return;
  }
  // Only the steps an introduced issue names: one that already failed for
  // another reason is `deploy`'s to report.
  const used = edit.after.flows.findForSchema(edit.edited).flatMap((flow) => {
    return flow
      .findMethodUses(method, edit.edited.usableMethods)
      .filter((use) => {
        return introduced.some((item) => {
          return item.path === flow.path && item.issue.step === use.step;
        });
      })
      .map((use) => {
        return { path: flow.path, ...use };
      });
  });
  const uses = used.map((use): FlowMethodUse => {
    const staying = use.targetedBy.filter((item) => {
      return !used.some((other) => {
        return other.path === use.path && other.step === item.step && other.keeps.length === 0;
      });
    });
    return { ...use, staying };
  });
  throw new BrokenFlowsError({
    kind: "method-in-use",
    file: edit.edited.path,
    heading: `Disabling ${method} in ${edit.edited.path} would break a login flow that still uses it:`,
    hint: disableHint(method, uses),
    issues: introduced,
    uses,
  });
}

/**
 * The errors an edit brings to the flows that run against its schema.
 *
 * @remarks
 * A flow that cannot be checked at all is refused first.
 *
 * @param edit - The edit.
 * @returns The errors it brings; none when it changes nothing.
 * @throws {@link BrokenFlowsError} When a flow cannot be checked.
 */
function checkedIssues(edit: SchemaEdit): readonly FlowIssue[] {
  if (edit.after.changedDocuments.length === 0) {
    return [];
  }
  const checks = edit.after.flows.findForSchema(edit.edited).map((flow) => {
    const previous = edit.before.flows.get(flow.path);
    return checkFlow(
      flow,
      previous?.contractBody ?? flow.contractBody,
      edit.original.contractBody,
      edit.edited.contractBody,
    );
  });
  const unchecked = checks.flatMap((check) => {
    if (check.kind !== "unchecked") {
      return [];
    }
    return check.issues;
  });
  if (unchecked.length > 0) {
    throw new BrokenFlowsError({
      kind: "broken",
      file: edit.edited.path,
      heading: "A login flow has errors, so it cannot be checked against the changed schema:",
      hint: "Fix those errors first (`zitadel deploy --dry-run` reports them too), then run the command again.",
      issues: unchecked,
    });
  }
  return checks.flatMap((check) => {
    if (check.kind !== "checked") {
      return [];
    }
    return check.introduced;
  });
}

/**
 * What the developer edits before disabling.
 *
 * @remarks
 * Only the edits these steps need are named: a step left with nothing goes, so
 * what leads to it changes too.
 *
 * @param method - The method being disabled.
 * @param uses - The steps that use it.
 * @returns The hint.
 */
function disableHint(method: ToggleableMethod, uses: readonly FlowMethodUse[]): string {
  const removed = REMOVED_PART[method];
  const emptied = uses.filter((use) => {
    return use.keeps.length === 0;
  });
  const incoming = emptied.flatMap((use) => {
    return use.staying;
  });
  const viaPurpose = incoming.some((item) => {
    return item.purpose !== undefined;
  });
  const retarget = viaPurpose
    ? "retarget the transitions listed for it (one marked via purposes.<key> follows that key instead)"
    : "retarget the transitions listed for it";
  const isEntry = emptied.some((use) => {
    return use.entryFor.length > 0;
  });
  const repoint = "point the purposes key it is the entry step of at another step";
  const retargets = incoming.length > 0 ? [retarget] : [];
  const repoints = isEntry ? [repoint] : [];
  const fixes = [...retargets, ...repoints];
  const deletion =
    fixes.length > 0
      ? `Delete a step left with no field or sign-in method: ${fixes.join(", and ")}.`
      : "Delete a step left with no field or sign-in method.";
  const deletions = emptied.length > 0 ? [deletion] : [];
  return [
    `Edit those steps first; login flows are not edited for you. From each step, remove its ${removed}.`,
    ...deletions,
    "`zitadel deploy --dry-run` checks the edited flow; then run the command again.",
  ].join(" ");
}

/**
 * Only the errors among a validator's findings.
 *
 * @param issues - What the validator found.
 * @returns The errors, in order.
 */
function errorsAmong(issues: readonly FlowValidationIssue[]): readonly FlowValidationIssue[] {
  return issues.filter((issue) => {
    return issue.severity === "error";
  });
}

/**
 * What tells one finding from another across two runs of the validator.
 *
 * @param issue - A finding.
 * @returns Its rule and message.
 */
function keyOf(issue: FlowValidationIssue): string {
  return `${issue.rule}\u0000${issue.message}`;
}

/**
 * What a change does to one flow.
 *
 * @remarks
 * The flow is a document, so its contract already took it, as `deploy` holds
 * it to; it is held to the rules that need no schema first, which must pass
 * before the ones that read the schema run at all.
 *
 * @param flow - The flow as the change leaves it.
 * @param previous - The flow's body before the change, as its rules judge it.
 * @param before - The schema's body before the change, as its rules judge it.
 * @param after - The schema's body after the change, as its rules judge it.
 * @returns What it cannot judge, or what the change brings.
 */
function checkFlow(
  flow: Flow,
  previous: JsonObject,
  before: JsonObject,
  after: JsonObject,
): FlowCheck {
  const structural = errorsAmong(validateFlowDefinition(flow.contractBody));
  if (structural.length > 0) {
    const issues = structural.map((issue): FlowIssue => {
      return { path: flow.path, issue };
    });
    return { kind: "unchecked", issues };
  }
  const existing = new Set(errorsAmong(validateFlowDefinition(previous, before)).map(keyOf));
  const introduced = errorsAmong(validateFlowDefinition(flow.contractBody, after))
    .filter((issue) => {
      return !existing.has(keyOf(issue));
    })
    .map((issue): FlowIssue => {
      return { path: flow.path, issue };
    });
  return { kind: "checked", introduced };
}
