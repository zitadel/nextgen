import { ssoRules } from "./sso.js";
import type { ProjectIssue, ProjectTree } from "./types.js";

/**
 * Validate the whole project: every rule that needs more than one flow.
 *
 * Pure: collects every issue and never throws. Rule groups run independently,
 * so adding one is a new entry here and a new file beside `sso.ts`.
 */
export function validateProject(tree: ProjectTree): ProjectIssue[] {
  return [...ssoRules(tree)];
}
