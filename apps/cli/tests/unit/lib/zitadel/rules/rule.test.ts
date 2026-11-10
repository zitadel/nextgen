import { describe, expect, it } from "vitest";

import { defineRule } from "@/lib/zitadel/rules/rule";
import type { Severity } from "@/lib/zitadel/rules/types";
import { aConfig } from "@tests/helpers/config";

/**
 * What the rules in these tests look at: a step in a file, with a cause.
 */
type Fact = {
  readonly file: string;
  readonly step: string;
  readonly cause: string;
  readonly bad: boolean;
};

/**
 * A fact about a step.
 *
 * @param step - The step.
 * @param cause - What the fact shares with the ones of the same mistake.
 * @param overrides - What to set in place of the defaults.
 * @returns The fact.
 */
function aFact(step: string, cause = "c", overrides: Partial<Fact> = {}): Fact {
  return { file: "a.json", step, cause, bad: true, ...overrides };
}

describe("defineRule", () => {
  describe("when it has no condition", () => {
    it("reports every fact, one issue each, in order", () => {
      const rule = defineRule<Fact>({
        id: "sso/duplicate-slug",
        severity: "error",
        each: () => {
          return [aFact("one"), aFact("two")];
        },
        file: (fact) => {
          return fact.file;
        },
        says: (fact) => {
          return `about ${fact.step}`;
        },
      });

      const issues = rule.check(aConfig(), {});

      expect(issues).toEqual([
        { severity: "error", rule: "sso/duplicate-slug", file: "a.json", message: "about one" },
        { severity: "error", rule: "sso/duplicate-slug", file: "a.json", message: "about two" },
      ]);
    });
  });

  describe("with a condition", () => {
    it("reports only the facts it holds for", () => {
      const rule = defineRule<Fact>({
        id: "sso/duplicate-slug",
        severity: "error",
        each: () => {
          return [aFact("kept"), aFact("dropped", "c", { bad: false })];
        },
        when: (fact) => {
          return fact.bad;
        },
        file: (fact) => {
          return fact.file;
        },
        says: (fact) => {
          return fact.step;
        },
      });

      const issues = rule.check(aConfig(), {});

      expect(issues).toMatchObject([{ message: "kept" }]);
    });
  });

  describe("with a function for a severity or an id", () => {
    it("asks it of each fact", () => {
      const rule = defineRule<Fact>({
        id: (fact) => {
          return fact.step === "one" ? "sso/duplicate-slug" : "sso/provider-id";
        },
        severity: (fact): Severity => {
          return fact.step === "one" ? "error" : "warning";
        },
        each: () => {
          return [aFact("one"), aFact("two")];
        },
        file: (fact) => {
          return fact.file;
        },
        says: (fact) => {
          return fact.step;
        },
      });

      const issues = rule.check(aConfig(), {});

      expect(issues).toMatchObject([
        { severity: "error", rule: "sso/duplicate-slug" },
        { severity: "warning", rule: "sso/provider-id" },
      ]);
    });
  });

  describe("with a slug", () => {
    it("names it in the issue", () => {
      const rule = defineRule<Fact>({
        id: "sso/duplicate-slug",
        severity: "error",
        each: () => {
          return [aFact("one")];
        },
        file: (fact) => {
          return fact.file;
        },
        slug: (fact) => {
          return fact.step;
        },
        says: () => {
          return "m";
        },
      });

      const issues = rule.check(aConfig(), {});

      expect(issues).toEqual([
        {
          severity: "error",
          rule: "sso/duplicate-slug",
          file: "a.json",
          slug: "one",
          message: "m",
        },
      ]);
    });
  });

  describe("with steps", () => {
    /**
     * A rule about steps that says where it found them.
     *
     * @param facts - The facts it looks at.
     * @returns The rule.
     */
    function aStepRule(facts: readonly Fact[]) {
      return defineRule<Fact>({
        id: "sso/outcome-routing",
        severity: "error",
        each: () => {
          return facts;
        },
        file: (fact) => {
          return fact.file;
        },
        steps: {
          step: (fact) => {
            return fact.step;
          },
          cause: (fact) => {
            return fact.cause;
          },
        },
        says: (fact, where) => {
          return `${where}: ${fact.cause}`;
        },
      });
    }

    it("reports steps with one cause in one file as one issue naming every step", () => {
      const rule = aStepRule([aFact("a"), aFact("b"), aFact("c")]);

      const issues = rule.check(aConfig(), {});

      expect(issues).toEqual([
        {
          severity: "error",
          rule: "sso/outcome-routing",
          file: "a.json",
          steps: ["a", "b", "c"],
          message: 'steps "a", "b", "c": c',
        },
      ]);
    });

    it("names a lone step in the singular", () => {
      const rule = aStepRule([aFact("a")]);

      const issues = rule.check(aConfig(), {});

      expect(issues).toMatchObject([{ steps: ["a"], message: 'step "a": c' }]);
    });

    it("keeps steps with different causes apart, in the order each was first found", () => {
      const rule = aStepRule([aFact("a", "x"), aFact("b", "y"), aFact("c", "x")]);

      const issues = rule.check(aConfig(), {});

      expect(issues).toMatchObject([
        { steps: ["a", "c"], message: 'steps "a", "c": x' },
        { steps: ["b"], message: 'step "b": y' },
      ]);
    });

    it("keeps the same cause in different files apart", () => {
      const rule = aStepRule([aFact("a"), aFact("b", "c", { file: "other.json" })]);

      const issues = rule.check(aConfig(), {});

      expect(issues).toMatchObject([
        { file: "a.json", steps: ["a"] },
        { file: "other.json", steps: ["b"] },
      ]);
    });

    it("reports nothing when no fact is a problem", () => {
      const rule = defineRule<Fact>({
        id: "sso/outcome-routing",
        severity: "error",
        each: () => {
          return [aFact("a", "c", { bad: false })];
        },
        when: (fact) => {
          return fact.bad;
        },
        file: (fact) => {
          return fact.file;
        },
        steps: {
          step: (fact) => {
            return fact.step;
          },
          cause: (fact) => {
            return fact.cause;
          },
        },
        says: () => {
          return "m";
        },
      });

      const issues = rule.check(aConfig(), {});

      expect(issues).toEqual([]);
    });
  });
});
