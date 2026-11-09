/**
 * The server's flow rules, run on the login flows a user schema edit touches:
 * the edit is refused when a flow would stop validating after it, or cannot be
 * judged because a flow already fails. `deploy` would reject either, so the
 * edit is refused before anything is written.
 */

import { flowConfigSchema } from "@zitadel/config/schemas";
import { type FlowValidationIssue, validateFlowDefinition } from "@zitadel/config/validate";

import { BrokenFlowsError } from "@/lib/zitadel/errors";
import { type Flow, type MethodUse, PASSWORD_FIELD } from "@/lib/zitadel/flows/flow";
import type { SchemaEdit, ToggleableMethod } from "@/lib/zitadel/schemas/types";

/** A flow rule's finding, and the flow file it is in. */
export type FlowIssue = Readonly<{ path: string; issue: FlowValidationIssue }>;

/**
 * A step that uses a method being disabled, the flow file it is in, and the
 * transitions into it that outlive the edit: those from a step that is itself
 * left with nothing go with that step.
 */
export type FlowMethodUse = MethodUse &
  Readonly<{ path: string; staying: MethodUse["targetedBy"] }>;

/** What a change does to the flows that run against its schema. */
export type FlowCheck = Readonly<{
  /**
   * Errors a flow already has that stop the server's rules short of the ones
   * that read the schema, so whether the change breaks it cannot be told.
   */
  unchecked: readonly FlowIssue[];
  /** The errors the change brings. One a flow already had is not the change's. */
  introduced: readonly FlowIssue[];
}>;

/**
 * Refuse a schema edit that would make a flow stop validating, or that cannot
 * be judged because a flow already fails in a way that hides it. An edit that
 * changes nothing breaks nothing.
 *
 * @param edit - The edit.
 * @throws {@link BrokenFlowsError} Naming every issue.
 */
export function assertFlowsIntact(edit: SchemaEdit): void {
  const introduced = checkedIssues(edit);
  if (introduced.length === 0) {
    return;
  }
  throw new BrokenFlowsError({
    file: edit.edited.path,
    heading: "A login flow would stop validating after this change:",
    hint: "Fix the steps named above, then run the command again.",
    issues: introduced,
  });
}

/**
 * Refuse turning off a method a flow still uses. Flows are not edited for the
 * developer (ADR 070 §2), so the refusal says what the edit takes: for each
 * step that uses the method, what it keeps without it, whether it is a
 * purpose's entry step, and which transitions lead to it.
 *
 * @param edit - The edit that turns the method off.
 * @param method - The method.
 * @throws {@link BrokenFlowsError} Naming every step that uses it.
 */
export function assertMethodUnused(edit: SchemaEdit, method: ToggleableMethod): void {
  const introduced = checkedIssues(edit);
  if (introduced.length === 0) {
    return;
  }
  // Only the steps an introduced issue names: one that already failed for
  // another reason is `deploy`'s to report.
  const used = edit.after.flows.for(edit.edited).flatMap((flow) => {
    return flow
      .methodUses(method, edit.edited.usableMethods)
      .filter((use) => {
        return introduced.some(({ path, issue }) => {
          return path === flow.path && issue.step === use.step;
        });
      })
      .map((use) => {
        return { path: flow.path, ...use };
      });
  });
  const uses = used.map((use) => {
    const staying = use.targetedBy.filter(({ step }) => {
      return !used.some((other) => {
        return other.path === use.path && other.step === step && other.keeps.length === 0;
      });
    });
    return { ...use, staying };
  });
  throw new BrokenFlowsError({
    file: edit.edited.path,
    heading: `Disabling ${method} in ${edit.edited.path} would break a login flow that still uses it:`,
    hint: disableHint(method, uses),
    issues: introduced,
    uses,
  });
}

/**
 * The errors an edit brings to the flows that run against its schema. A flow
 * that cannot be checked at all is refused first.
 *
 * @param edit - The edit.
 * @returns The errors it brings; none when it changes nothing.
 * @throws {@link BrokenFlowsError} When a flow cannot be checked.
 */
function checkedIssues(edit: SchemaEdit): readonly FlowIssue[] {
  if (edit.after.changedDocuments.length === 0) {
    return [];
  }
  const checks = edit.after.flows.for(edit.edited).map((flow) => {
    const previous = edit.before.flows.get(flow.path);
    return checkFlow(flow, previous?.body ?? flow.body, edit.original.body, edit.edited.body);
  });
  const unchecked = checks.flatMap((check) => {
    return check.unchecked;
  });
  if (unchecked.length > 0) {
    throw new BrokenFlowsError({
      file: edit.edited.path,
      heading: "A login flow has errors, so it cannot be checked against the changed schema:",
      hint: "Fix those errors first (`zitadel deploy --dry-run` reports them too), then run the command again.",
      issues: unchecked,
    });
  }
  return checks.flatMap((check) => {
    return check.introduced;
  });
}

/**
 * What the developer edits before disabling, naming only the edits these steps
 * need: a step left with nothing goes, so what leads to it changes too.
 *
 * @param method - The method being disabled.
 * @param uses - The steps that use it.
 * @returns The hint.
 */
function disableHint(method: ToggleableMethod, uses: readonly FlowMethodUse[]): string {
  const emptied = uses.filter((use) => {
    return use.keeps.length === 0;
  });
  const removed = {
    password: `${PASSWORD_FIELD} field`,
    passkey: "passkey actions and their transitions",
  }[method];
  const parts = [
    `Edit those steps first; login flows are not edited for you. From each step, remove its ${removed}.`,
  ];
  if (emptied.length > 0) {
    const incoming = emptied.flatMap((use) => {
      return use.staying;
    });
    const fixes: string[] = [];
    if (
      incoming.some(({ purpose }) => {
        return purpose !== undefined;
      })
    ) {
      fixes.push(
        "retarget the transitions listed for it (one marked via purposes.<key> follows that key instead)",
      );
    } else if (incoming.length > 0) {
      fixes.push("retarget the transitions listed for it");
    }
    if (
      emptied.some((use) => {
        return use.entryFor.length > 0;
      })
    ) {
      fixes.push("point the purposes key it is the entry step of at another step");
    }
    if (fixes.length > 0) {
      parts.push(`Delete a step left with no field or sign-in method: ${fixes.join(", and ")}.`);
    } else {
      parts.push("Delete a step left with no field or sign-in method.");
    }
  }
  parts.push("`zitadel deploy --dry-run` checks the edited flow; then run the command again.");
  return parts.join(" ");
}

/**
 * What a change does to one flow. The flow is held to its contract first, as
 * `deploy` holds it, because the server's rules read a malformed shape
 * leniently; then to the rules that need no schema, which must pass before the
 * ones that read the schema run at all.
 *
 * @param flow - The flow as the change leaves it.
 * @param previous - The flow's body before the change.
 * @param before - The schema's body before the change.
 * @param after - The schema's body after the change.
 * @returns What it cannot judge, and what the change brings.
 */
function checkFlow(flow: Flow, previous: object, before: object, after: object): FlowCheck {
  const shape = flowConfigSchema.safeParse(flow.body);
  if (!shape.success) {
    return {
      unchecked: shape.error.issues.map((issue) => {
        return {
          path: flow.path,
          issue: {
            severity: "error",
            rule: "definition",
            message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
          },
        };
      }),
      introduced: [],
    };
  }
  const errors = (issues: readonly FlowValidationIssue[]): FlowValidationIssue[] => {
    return issues.filter((issue) => {
      return issue.severity === "error";
    });
  };
  const structural = errors(validateFlowDefinition(flow.body));
  if (structural.length > 0) {
    return {
      unchecked: structural.map((issue) => {
        return { path: flow.path, issue };
      }),
      introduced: [],
    };
  }
  const keyOf = (issue: FlowValidationIssue): string => {
    return `${issue.rule}\u0000${issue.message}`;
  };
  const existing = new Set(errors(validateFlowDefinition(previous, before)).map(keyOf));
  return {
    unchecked: [],
    introduced: errors(validateFlowDefinition(flow.body, after))
      .filter((issue) => {
        return !existing.has(keyOf(issue));
      })
      .map((issue) => {
        return { path: flow.path, issue };
      }),
  };
}
