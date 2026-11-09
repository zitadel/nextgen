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

import { flowConfigSchema, schemaConfigSchema } from "@zitadel/config/schemas";
import { type FlowValidationIssue, validateFlowDefinition } from "@zitadel/config/validate";

import { BrokenFlowsError } from "@/lib/zitadel/errors";
import type { Flow } from "@/lib/zitadel/resources/flows/flow";
import { PASSWORD_FIELD } from "@/lib/zitadel/resources/flows/types";
import type { SchemaEdit, ToggleableMethod } from "@/lib/zitadel/resources/schemas/types";
import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import type { FlowCheck, FlowIssue, FlowMethodUse } from "@/lib/zitadel/rules/types";

/**
 * One finding of the server's flow rules about one flow.
 */
type FlowFinding = Readonly<{
  /**
   * The flow the finding is about.
   */
  flow: Flow;

  /**
   * What the server's rules found.
   */
  issue: FlowValidationIssue;
}>;

/**
 * The server's flow rules, as one rule that reports each under the server's
 * own id, and the warning for a flow offering a provider that pins no local
 * schema.
 */
export const FLOW_RULES: readonly Rule[] = [
  defineRule({
    id: "contract/flow",
    severity: "error",
    // The flow rules assume a flow its contract takes, so a flow the contract
    // refuses is reported there and not judged here; so is a schema, which is
    // then left out and the schema-aware rules skipped.
    each: (config) => {
      return config.flows.all.flatMap((flow): FlowFinding[] => {
        if (!flowConfigSchema.safeParse(flow.contractBody).success) {
          return [];
        }
        const pinned = config.flows.schemaOf(flow);
        const schema =
          pinned !== undefined && schemaConfigSchema.safeParse(pinned.contractBody).success
            ? pinned.contractBody
            : undefined;
        return validateFlowDefinition(flow.contractBody, schema).map((issue) => {
          return { flow, issue };
        });
      });
    },
    rule: (finding) => {
      return finding.issue.rule;
    },
    severityOf: (finding) => {
      return finding.issue.severity;
    },
    file: (finding) => {
      return finding.flow.path;
    },
    says: (finding) => {
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
        return config.flows.schemaOf(flow) === undefined && flow.offers();
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
  const used = edit.after.flows.for(edit.edited).flatMap((flow) => {
    return flow
      .methodUses(method, edit.edited.usableMethods)
      .filter((use) => {
        return introduced.some((item) => {
          const { path, issue } = item;
          return path === flow.path && issue.step === use.step;
        });
      })
      .map((use) => {
        return { path: flow.path, ...use };
      });
  });
  const uses = used.map((use) => {
    const staying = use.targetedBy.filter((item) => {
      const { step } = item;
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
  const checks = edit.after.flows.for(edit.edited).map((flow) => {
    const previous = edit.before.flows.get(flow.path);
    return checkFlow(
      flow,
      previous?.contractBody ?? flow.contractBody,
      edit.original.contractBody,
      edit.edited.contractBody,
    );
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
  const removed = {
    password: `${PASSWORD_FIELD} field`,
    passkey: "passkey actions and their transitions",
  }[method];
  const emptied = uses.filter((use) => {
    return use.keeps.length === 0;
  });
  const incoming = emptied.flatMap((use) => {
    return use.staying;
  });
  const viaPurpose = incoming.some((item) => {
    const { purpose } = item;
    return purpose !== undefined;
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
 * What a change does to one flow.
 *
 * @remarks
 * The flow is held to its contract first, as `deploy` holds it, because the
 * server's rules read a malformed shape leniently; then to the rules that need
 * no schema, which must pass before the ones that read the schema run at all.
 *
 * @param flow - The flow as the change leaves it.
 * @param previous - The flow's body before the change, as its rules judge it.
 * @param before - The schema's body before the change, as its rules judge it.
 * @param after - The schema's body after the change, as its rules judge it.
 * @returns What it cannot judge, and what the change brings.
 */
function checkFlow(flow: Flow, previous: object, before: object, after: object): FlowCheck {
  const shape = flowConfigSchema.safeParse(flow.contractBody);
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
  const structural = errors(validateFlowDefinition(flow.contractBody));
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
    introduced: errors(validateFlowDefinition(flow.contractBody, after))
      .filter((issue) => {
        return !existing.has(keyOf(issue));
      })
      .map((issue) => {
        return { path: flow.path, issue };
      }),
  };
}
