/**
 * The rules each file is held to on its own: the contract the server enforces
 * for its kind, and what a file of that kind must never hold.
 *
 * @remarks
 * Each document says what is wrong with it through its own `problems`; this
 * list only says which kinds are held to which rules, and in what order their
 * findings are reported. The same rules decide what {@link ZitadelConfig.load}
 * refuses, so a file that loads is one that validates, and the other way round.
 */

import type { ZitadelConfig } from "@/lib/zitadel/config";
import type { ConfigDocument } from "@/lib/zitadel/document";
import type { Rule } from "@/lib/zitadel/rules/rule";
import type { RuleId } from "@/lib/zitadel/rules/types";

/**
 * The rule that holds one kind of file to the rules its documents check
 * themselves against.
 *
 * @remarks
 * Findings are reported rule by rule, in the order given, and within a rule in
 * the order of the documents, so one mistake made in several files reads as
 * one run of lines.
 *
 * @param ids - The rules, in the order their findings are reported. A finding
 *   of any other rule is left to the rule list that owns it.
 * @param documents - The documents of that kind.
 * @returns The rule.
 */
function documentRule(
  ids: readonly RuleId[],
  documents: (config: ZitadelConfig) => readonly ConfigDocument[],
): Rule {
  return {
    check: (config, context) => {
      const issues = documents(config).flatMap((document) => {
        return document.problems(context);
      });
      return ids.flatMap((id) => {
        return issues.filter((issue) => {
          return issue.rule === id;
        });
      });
    },
  };
}

/**
 * The rules every file is held to on its own, one per kind.
 */
export const CONTRACT_RULES: readonly Rule[] = [
  documentRule(["contract/schema"], (config) => {
    return config.schemas;
  }),
  documentRule(["contract/flow"], (config) => {
    return config.flows;
  }),
  documentRule(
    ["contract/connection", "connection/literal-secret", "connection/endpoints"],
    (config) => {
      return config.connections;
    },
  ),
  documentRule(["contract/policy"], (config) => {
    return config.policies;
  }),
  documentRule(
    [
      "branding/legacy-template-key",
      "contract/branding",
      "branding/template-file",
      "branding/template",
    ],
    (config) => {
      return config.brandings;
    },
  ),
];
