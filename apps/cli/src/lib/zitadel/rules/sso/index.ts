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
