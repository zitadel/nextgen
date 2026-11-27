/**
 * The application rules: the files under `.zitadel/applications/` read
 * together, for what a release refuses across them and no single file can
 * show.
 *
 * @remarks
 * Layout: one file per rule, named for the rule's id without the
 * `application/` prefix, exporting one constant named for the id in upper
 * snake case. What two or more rules use lives in `shared.ts`. Each rule's
 * tests mirror it under
 * `tests/unit/lib/zitadel/rules/applications/`. The documentation standard is
 * the SSO rules' (`rules/sso/index.ts`).
 *
 * Report order: {@link APPLICATION_RULES} is the order the findings are
 * reported in, after the SSO rules.
 */
import type { Rule } from "@/lib/zitadel/rules/rule";
import { DUPLICATE_CLIENT_ID } from "@/lib/zitadel/rules/applications/duplicate-client-id";
import { DUPLICATE_SLUG } from "@/lib/zitadel/rules/applications/duplicate-slug";
import { SHARED_VARIABLE } from "@/lib/zitadel/rules/applications/shared-variable";

/**
 * The rules that hold the application files to one another.
 */
export const APPLICATION_RULES: readonly Rule[] = [
  DUPLICATE_SLUG,
  DUPLICATE_CLIENT_ID,
  SHARED_VARIABLE,
];
