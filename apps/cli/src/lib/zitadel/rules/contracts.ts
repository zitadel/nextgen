/**
 * The rules each file is held to on its own: the contract the server enforces
 * for its kind, and what a file of that kind must never hold.
 *
 * @remarks
 * A file its contract refuses is a {@link BrokenFile}, which carries its own
 * findings; a document says what else is wrong with it through its own
 * `check`. This list only says which kinds are held, and in what order their
 * findings are reported. Which rules a kind breaks is the file's to say, so
 * none of its findings can be left out here. The same rules decide what
 * {@link ZitadelConfig.load} refuses, so a file that loads is one that
 * validates, and the other way round.
 */

import type { ZitadelConfig } from "@/lib/zitadel/config";
import type { ConfigDocument, DocumentKind } from "@/lib/zitadel/resources/document";
import type { Rule } from "@/lib/zitadel/rules/rule";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";

/**
 * One file's findings about itself, and where it is.
 */
type FileFindings = {
  /**
   * The project-relative path of the file.
   */
  readonly path: string;

  /**
   * What is wrong with the file on its own.
   */
  readonly issues: readonly Issue[];
};

/**
 * The rule that holds one kind of file to its contract and to the rules its
 * documents check themselves against.
 *
 * @remarks
 * Every finding a broken file carries and every finding a document reports is
 * kept. The files are taken in path order, the order a store reads them in
 * and the connections are held in, so a broken file's findings fall where the
 * file does. They are grouped rule by rule, in the order the files first
 * report each rule, and within a rule in the order of the files, so one
 * mistake made in several files reads as one run of lines.
 *
 * @param kind - The kind of file.
 * @param documents - The documents of that kind.
 * @returns The rule.
 */
function documentRule(
  kind: DocumentKind,
  documents: (config: ZitadelConfig) => readonly ConfigDocument[],
): Rule {
  return {
    check: (config: ZitadelConfig, context: ValidationContext) => {
      const checked = documents(config).map((document): FileFindings => {
        return { path: document.path, issues: document.check(context) };
      });
      const broken = config.broken
        .filter((file) => {
          return file.kind === kind;
        })
        .map((file): FileFindings => {
          return { path: file.path, issues: file.issues };
        });
      // The spread makes a fresh list, so sorting it changes nothing anyone else holds.
      // Paths compare by code unit, as the store sorts them, never by the host's locale.
      const files = [...checked, ...broken].sort((a, b) => {
        if (a.path < b.path) {
          return -1;
        }
        if (a.path > b.path) {
          return 1;
        }
        return 0;
      });
      const issues = files.flatMap((file) => {
        return file.issues;
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
 * The rules every file is held to on its own, one per kind a release carries.
 */
export const CONTRACT_RULES: readonly Rule[] = [
  documentRule("schema", (config) => {
    return config.schemas.all;
  }),
  documentRule("flow", (config) => {
    return config.flows.all;
  }),
  documentRule("connection", (config) => {
    return config.connections.all;
  }),
  documentRule("policy", (config) => {
    return config.policies.all;
  }),
  documentRule("branding", (config) => {
    return config.branding.all;
  }),
];
