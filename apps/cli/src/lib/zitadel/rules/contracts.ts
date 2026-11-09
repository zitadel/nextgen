/**
 * The rules each file is held to on its own: the contract the server enforces
 * for its kind, and what a file of that kind must never hold.
 *
 * @remarks
 * Each document says what is wrong with it through its own `check`; this
 * list only says which kinds are held, and in what order their findings are
 * reported. Which rules a kind breaks is the document's to say, so none of its
 * findings can be left out here. The same rules decide what {@link ZitadelConfig.load}
 * refuses, so a file that loads is one that validates, and the other way round.
 */

import type { ZitadelConfig } from "@/lib/zitadel/config";
import type { ConfigDocument } from "@/lib/zitadel/resources/document";
import type { Rule } from "@/lib/zitadel/rules/rule";

/**
 * The rule that holds one kind of file to the rules its documents check
 * themselves against.
 *
 * @remarks
 * Every finding a document reports is kept. They are grouped rule by rule, in
 * the order the documents first report each rule, and within a rule in the
 * order of the documents, so one mistake made in several files reads as one
 * run of lines.
 *
 * @param documents - The documents of that kind.
 * @returns The rule.
 */
function documentRule(documents: (config: ZitadelConfig) => readonly ConfigDocument[]): Rule {
  return {
    check: (config, context) => {
      const issues = documents(config).flatMap((document) => {
        return document.check(context);
      });
      const rules = new Set(
        issues.map((issue) => {
          return issue.rule;
        }),
      );
      return [...rules].flatMap((rule) => {
        return issues.filter((issue) => {
          return issue.rule === rule;
        });
      });
    },
  };
}

/**
 * The rules every file is held to on its own, one per kind.
 */
export const CONTRACT_RULES: readonly Rule[] = [
  documentRule((config) => {
    return config.schemas.all;
  }),
  documentRule((config) => {
    return config.flows.all;
  }),
  documentRule((config) => {
    return config.connections.all;
  }),
  documentRule((config) => {
    return config.policies.all;
  }),
  documentRule((config) => {
    return config.branding.all;
  }),
];
