import type { ZitadelConfig } from "@/lib/zitadel/config";
import type { Issue, RuleId, Severity, ValidationContext } from "@/lib/zitadel/rules/types";

/**
 * A rule about flow steps.
 *
 * @remarks
 * Steps with the same cause are one mistake: they are reported together, as
 * one issue naming every step.
 */
export type StepGrouping<Fact> = Readonly<{
  /**
   * The step a fact is about.
   */
  step: (fact: Fact) => string;
  /**
   * What two facts share when they are the same mistake.
   */
  cause: (fact: Fact) => string;
}>;

/**
 * One rule, stated declaratively: for each fact in the configuration, when the
 * condition holds, say this.
 */
export type RuleSpec<Fact> = Readonly<{
  /**
   * The rule's id.
   */
  id: RuleId;
  /**
   * How serious the rule's findings are.
   */
  severity: Severity;
  /**
   * The facts the rule looks at, given what the run knows beyond the files.
   */
  each: (config: ZitadelConfig, context: ValidationContext) => readonly Fact[];
  /**
   * Whether a fact is a problem. Every fact is when there is no condition.
   */
  when?: (fact: Fact) => boolean;
  /**
   * The file the problem is in.
   */
  file: (fact: Fact) => string;
  /**
   * The connection slug the problem is about, when it is about one.
   */
  slug?: (fact: Fact) => string;
  /**
   * How facts about steps group into one issue, for a rule about steps.
   */
  steps?: StepGrouping<Fact>;
  /**
   * The rule a fact breaks, for a rule that reports several, such as the
   * server's flow rules.
   */
  rule?: (fact: Fact) => RuleId;
  /**
   * How serious a fact is, for a rule whose facts differ.
   */
  severityOf?: (fact: Fact) => Severity;
  /**
   * What to say.
   *
   * @remarks
   * `where` names the steps (`step "a"` or `steps "a", "b"`) for a rule about
   * steps, and is empty otherwise.
   */
  says: (fact: Fact, where: string) => string;
}>;

/**
 * A rule ready to run: the check that finds its issues.
 */
export type Rule = Readonly<{
  /**
   * Find the rule's issues in a configuration.
   */
  check: (config: ZitadelConfig, context: ValidationContext) => readonly Issue[];
}>;

/**
 * Facts that are one mistake: the first, which speaks for them, and every step.
 */
type Group<Fact> = Readonly<{
  /**
   * The fact that speaks for the group.
   */
  first: Fact;
  /**
   * The step of every fact in the group, in the order they were found.
   */
  steps: readonly string[];
}>;

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
      if (spec.steps === undefined) {
        return problems.map((fact) => {
          return issueOf(spec, fact, undefined);
        });
      }
      return groupByCause(problems, spec.file, spec.steps).map((group) => {
        return issueOf(spec, group.first, group.steps);
      });
    },
  };
}

/**
 * Facts grouped by the file they are in and their cause, in the order each
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
): Group<Fact>[] {
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
  const where = steps === undefined ? "" : stepsText(steps);
  const stepsPart = steps === undefined ? {} : { steps };
  const slugPart = spec.slug === undefined ? {} : { slug: spec.slug(fact) };
  return {
    severity: spec.severityOf?.(fact) ?? spec.severity,
    rule: spec.rule?.(fact) ?? spec.id,
    file: spec.file(fact),
    ...stepsPart,
    ...slugPart,
    message: spec.says(fact, where),
  };
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
  if (quoted.length === 1) {
    return `step ${quoted.join("")}`;
  }
  return `steps ${quoted.join(", ")}`;
}
