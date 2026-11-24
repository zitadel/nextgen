/**
 * The SSO rules: user schemas, login flows and connection files read
 * together.
 *
 * No single file can show that a flow step offers a provider its schema does
 * not list, or that a schema lists a provider with no connection file; those
 * mistakes only show when the files are read together. Every message names
 * the file and, where it applies, the steps and the slug or key at fault, and
 * what to change.
 *
 * Each mistake is reported once, at its cause: a typo is named with what it
 * most likely meant, and what follows from it is not reported again.
 *
 * @remarks
 * Layout: one file per rule, named for the rule's id without the `sso/`
 * prefix (`sso/claim-needs-scope` is `claim-needs-scope.ts`), exporting one
 * constant named for the id in upper snake case (`CLAIM_NEEDS_SCOPE`). A file
 * whose rule reads two kinds of file exports an array with one `defineRule`
 * per kind, and spreads into {@link SSO_RULES}. What two or more rules use
 * lives in `shared.ts`; whatever one rule uses lives in its own file. Each
 * rule's tests mirror it under `tests/unit/lib/zitadel/rules/sso/`.
 *
 * Report order: {@link SSO_RULES} is the order the findings are reported in,
 * after the contract, flow and environment rules. It runs from the checks on
 * the connection files themselves (duplicate slugs, shared variables), through
 * provider names and routing in the flows, to the claim mappings and the
 * properties they name, with errors and warnings interleaved by subject. The
 * order is part of what a developer sees, so a new rule goes where its subject
 * reads naturally and an existing rule is never moved without its tests.
 *
 * Documentation standard: every exported rule constant, and every
 * `defineRule` inside an array, carries one TSDoc block of this shape, in
 * plain prose, with a heading omitted when it has nothing to say. The first
 * sentence says what mistake the rule finds, as the developer would put it.
 * Then `@remarks` holds separate paragraphs that start with these labels, in
 * this order: `Why it matters:` (the consequence at sign-in or deploy, and
 * why the rule is only a warning or an error), `Reported once:` (which rule
 * or contract reports it instead, or when the rule stays silent, and why),
 * `Fix:` (what the message tells the developer to change) and `Origin:` (the
 * pull requests and issues and the design-doc section it came from). Keep
 * inline comments inside a rule for a line of code that is not obvious, never
 * for what the rule is for.
 */
import type { Rule } from "@/lib/zitadel/rules/rule";
import { DUPLICATE_SLUG } from "@/lib/zitadel/rules/sso/duplicate-slug";
import { SHARED_VARIABLE } from "@/lib/zitadel/rules/sso/shared-variable";
import { DUPLICATE_PROVIDER } from "@/lib/zitadel/rules/sso/duplicate-provider";
import { CONNECTION_RESOLVES } from "@/lib/zitadel/rules/sso/connection-resolves";
import { FLOW_ENABLES_SSO } from "@/lib/zitadel/rules/sso/flow-enables-sso";
import { PROVIDER_ID } from "@/lib/zitadel/rules/sso/provider-id";
import { OUTCOME_ROUTING } from "@/lib/zitadel/rules/sso/outcome-routing";
import { COLLECTION_CONFLICT_ROUTING } from "@/lib/zitadel/rules/sso/collection-conflict-routing";
import { EMPTY_CLAIM_MAPPING } from "@/lib/zitadel/rules/sso/empty-claim-mapping";
import { UNMAPPED_VERIFICATION_KEY } from "@/lib/zitadel/rules/sso/unmapped-verification-key";
import { CLAIM_NEEDS_SCOPE } from "@/lib/zitadel/rules/sso/claim-needs-scope";
import { VERIFICATION_SOURCE_NOT_BOOLEAN } from "@/lib/zitadel/rules/sso/verification-source-not-boolean";
import { CLAIM_NAME_WHITESPACE } from "@/lib/zitadel/rules/sso/claim-name-whitespace";
import { SUBJECT_CLAIM_UNSTABLE } from "@/lib/zitadel/rules/sso/subject-claim-unstable";
import { CLAIM_TYPE_MISMATCH } from "@/lib/zitadel/rules/sso/claim-type-mismatch";
import { ORPHANED_MAPPING_TARGET } from "@/lib/zitadel/rules/sso/orphaned-mapping-target";
import { ORPHANED_VERIFICATION_KEY } from "@/lib/zitadel/rules/sso/orphaned-verification-key";
import { INERT_CONNECTION } from "@/lib/zitadel/rules/sso/inert-connection";
import { DEAD_CAPABILITY } from "@/lib/zitadel/rules/sso/dead-capability";
import { UNREFERENCED_TYPO_GUARD } from "@/lib/zitadel/rules/sso/unreferenced-typo-guard";
import { MISSING_MAPPING_TARGET } from "@/lib/zitadel/rules/sso/missing-mapping-target";
import { EMPTY_VERIFIED_CLAIMS } from "@/lib/zitadel/rules/sso/empty-verified-claims";
import { IMPOSSIBLE_REGISTRATION } from "@/lib/zitadel/rules/sso/impossible-registration";
import { IMPOSSIBLE_AUTO_CREATION_DATA } from "@/lib/zitadel/rules/sso/impossible-auto-creation-data";
import { IMPOSSIBLE_AUTO_CREATION_VERIFICATION } from "@/lib/zitadel/rules/sso/impossible-auto-creation-verification";

/**
 * Every SSO rule, in the order they report.
 */
export const SSO_RULES: readonly Rule[] = [
  DUPLICATE_SLUG,
  SHARED_VARIABLE,
  ...DUPLICATE_PROVIDER,
  ...CONNECTION_RESOLVES,
  FLOW_ENABLES_SSO,
  PROVIDER_ID,
  OUTCOME_ROUTING,
  COLLECTION_CONFLICT_ROUTING,
  EMPTY_CLAIM_MAPPING,
  UNMAPPED_VERIFICATION_KEY,
  CLAIM_NEEDS_SCOPE,
  VERIFICATION_SOURCE_NOT_BOOLEAN,
  CLAIM_NAME_WHITESPACE,
  SUBJECT_CLAIM_UNSTABLE,
  CLAIM_TYPE_MISMATCH,
  ORPHANED_MAPPING_TARGET,
  ORPHANED_VERIFICATION_KEY,
  INERT_CONNECTION,
  DEAD_CAPABILITY,
  UNREFERENCED_TYPO_GUARD,
  MISSING_MAPPING_TARGET,
  EMPTY_VERIFIED_CLAIMS,
  IMPOSSIBLE_REGISTRATION,
  IMPOSSIBLE_AUTO_CREATION_DATA,
  IMPOSSIBLE_AUTO_CREATION_VERIFICATION,
];
