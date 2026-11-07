import type { Family } from "./spec";

/**
 * Every check this Schemathesis release offers by name. `--checks all` would
 * add a response time limit of 10 seconds, which makes a run depend on how
 * fast the machine and its network are (a fuzzed schema URL makes the server
 * fetch an arbitrary host); speed is not a contract property.
 */
const CHECKS = [
  "not_a_server_error",
  "status_code_conformance",
  "content_type_conformance",
  "response_headers_conformance",
  "response_schema_conformance",
  "negative_data_rejection",
  "positive_data_acceptance",
  "missing_required_header",
  "unsupported_method",
  "allow_header_conformance",
  "use_after_free",
  "ensure_resource_availability",
  "ignored_auth",
  "object_level_authorization",
] as const;

/**
 * Schemathesis's `ignored_auth` check removes one credential and expects the
 * server to answer 401 or 403. An operation that accepts either a bearer or a
 * session cookie has two, and the check removes only one: the request it then
 * calls unauthenticated still carries the other, and the server correctly
 * accepts it. That is the check being wrong for these operations, not the
 * server, so the management family, whose operations mostly take both, runs
 * without it. The other families have a single credential and keep it.
 */
const WITHOUT_IGNORED_AUTH: readonly Family[] = ["management"];

/** The checks one family's run applies. */
export function checksFor(family: Family): readonly string[] {
  if (WITHOUT_IGNORED_AUTH.includes(family)) {
    return CHECKS.filter((check) => {
      return check !== "ignored_auth";
    });
  }
  return CHECKS;
}

/**
 * A check that does not apply to one operation, by its `operationId`.
 * Schemathesis's `use_after_free` expects a `404` for a resource it deleted.
 * `DELETE /teams/{team_id}` deactivates the team and keeps it, and the
 * operation's description says `getTeam` still returns it with status
 * `deactivated`, so the `200` is the contract and not a leak. Every other
 * operation keeps the check.
 */
export const EXEMPTIONS: readonly { operationId: string; check: string }[] = [
  { operationId: "getTeam", check: "use_after_free" },
];
