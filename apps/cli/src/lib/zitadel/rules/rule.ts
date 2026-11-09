import type { ZitadelConfig } from "@/lib/zitadel/config";
import type { Issue, RuleId, Severity, ValidationContext } from "@/lib/zitadel/rules/types";

/**
 * A rule about flow steps.
 *
 * @remarks
 * Steps with the same cause are one mistake: they are reported together, as
 * one issue naming every step.
 *
 * @typeParam Fact - What the rule looks at.
 */
export type StepGrouping<Fact> = {
  /**
   * The step a fact is about.
   */
  readonly step: (fact: Fact) => string;

  /**
   * What two facts share when they are the same mistake.
   */
  readonly cause: (fact: Fact) => string;
};

/**
 * One rule, stated declaratively: for each fact in the configuration, when the
 * condition holds, say this.
 *
 * @typeParam Fact - What the rule looks at.
 */
export type RuleSpec<Fact> = {
  /**
   * The rule's id, or, for a rule that reports several (such as the server's
   * flow rules), the id each fact breaks.
   */
  readonly id: RuleId | ((fact: Fact) => RuleId);

  /**
   * How serious the rule's findings are, or how serious each fact is for a
   * rule whose facts differ.
   */
  readonly severity: Severity | ((fact: Fact) => Severity);

  /**
   * The facts the rule looks at, given what the run knows beyond the files.
   */
  readonly each: (config: ZitadelConfig, context: ValidationContext) => readonly Fact[];

  /**
   * Whether a fact is a problem. Every fact is when there is no condition.
   */
  readonly when?: (fact: Fact) => boolean;

  /**
   * The file the problem is in.
   */
  readonly file: (fact: Fact) => string;

  /**
   * The connection slug the problem is about, when it is about one.
   */
  readonly slug?: (fact: Fact) => string;

  /**
   * How facts about steps group into one issue, for a rule about steps.
   */
  readonly steps?: StepGrouping<Fact>;

  /**
   * What to say.
   *
   * @remarks
   * `where` names the steps (`step "a"` or `steps "a", "b"`) for a rule about
   * steps, and is empty otherwise.
   */
  readonly says: (fact: Fact, where: string) => string;
};

/**
 * A rule ready to run: the check that finds its issues.
 */
export type Rule = {
  /**
   * Find the rule's issues in a configuration.
   */
  readonly check: (config: ZitadelConfig, context: ValidationContext) => readonly Issue[];
};

/**
 * Facts that are one mistake: the first, which speaks for them, and every step.
 *
 * @typeParam Fact - What the rule looks at.
 */
type Group<Fact> = {
  /**
   * The fact that speaks for the group.
   */
  readonly first: Fact;

  /**
   * The step of every fact in the group, in the order they were found.
   */
  readonly steps: readonly string[];
};

/**
 * Make a rule from its statement.
 *
 * @param spec - What the rule looks at, when it fires and what it says.
 * @returns The rule.
 */
export function defineRule<Fact>(spec: RuleSpec<Fact>): Rule {
  return {
    check: (config, context) => {
      const problems = spec.each(config, context).filter((fact) => {
        return spec.when === undefined || spec.when(fact);
      });
      const grouping = spec.steps;
      if (grouping === undefined) {
        return problems.map((fact) => {
          return issueOf(spec, fact, undefined);
        });
      }
      return groupByCause(problems, spec.file, grouping).map((group) => {
        return issueOf(spec, group.first, group.steps);
      });
    },
  };
}

/**
 * Group facts by the file they are in and their cause, in the order each
 * group was first found.
 *
 * @param facts - The facts that are problems.
 * @param file - The file each is in.
 * @param grouping - Each fact's step and cause.
 * @returns The groups.
 */
function groupByCause<Fact>(
  facts: readonly Fact[],
  file: (fact: Fact) => string,
  grouping: StepGrouping<Fact>,
): readonly Group<Fact>[] {
  const keyOf = (fact: Fact): string => {
    return JSON.stringify([file(fact), grouping.cause(fact)]);
  };
  const keys = [...new Set(facts.map(keyOf))];
  return keys.flatMap((key) => {
    const members = facts.filter((fact) => {
      return keyOf(fact) === key;
    });
    const first = members[0];
    if (first === undefined) {
      return [];
    }
    return [{ first, steps: members.map(grouping.step) }];
  });
}

/**
 * One issue, from the fact that speaks for it.
 *
 * @param spec - The rule.
 * @param fact - The fact that speaks for the issue.
 * @param steps - The steps it covers, for a rule about steps.
 * @returns The issue.
 */
function issueOf<Fact>(
  spec: RuleSpec<Fact>,
  fact: Fact,
  steps: readonly string[] | undefined,
): Issue {
  const severity = typeof spec.severity === "function" ? spec.severity(fact) : spec.severity;
  const rule = typeof spec.id === "function" ? spec.id(fact) : spec.id;
  const file = spec.file(fact);
  const slug = spec.slug?.(fact);
  if (steps === undefined && slug === undefined) {
    return { severity, rule, file, message: spec.says(fact, "") };
  }
  if (steps === undefined) {
    return { severity, rule, file, slug, message: spec.says(fact, "") };
  }
  const message = spec.says(fact, stepsText(steps));
  if (slug === undefined) {
    return { severity, rule, file, steps, message };
  }
  return { severity, rule, file, steps, slug, message };
}

/**
 * Steps as a message names them.
 *
 * @param steps - The steps.
 * @returns `step "a"`, or `steps "a", "b"` when there are several.
 */
function stepsText(steps: readonly string[]): string {
  const quoted = steps.map((step) => {
    return JSON.stringify(step);
  });
  const only = quoted[0];
  if (quoted.length === 1 && only !== undefined) {
    return `step ${only}`;
  }
  return `steps ${quoted.join(", ")}`;
}
