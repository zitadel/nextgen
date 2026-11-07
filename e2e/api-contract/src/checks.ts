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

const MISSING_PROJECT =
  "a create in a project that does not exist is answered 400, so as not to say which projects exist (authz.go)";

/**
 * Operations the server may answer a schema-valid request with a 400, and why
 * the spec cannot say it. `positive_data_acceptance` expects no 400 from a
 * valid request; each of these refuses on a rule that no JSON Schema keyword
 * states, so the check is told to accept the 400 for them alone. Each line is
 * a reason to look at the server first: when it answers 404, or the rule
 * becomes a constraint, remove the line.
 */
export const REFUSALS: Readonly<Record<string, string>> = {
  "POST /branding": MISSING_PROJECT,
  "POST /flow_definitions": MISSING_PROJECT,
  "POST /policies": MISSING_PROJECT,
  "POST /schemas": MISSING_PROJECT,
  "POST /users": MISSING_PROJECT,
  "POST /policies/evaluate":
    "`min_length` may not exceed `max_length`, which compares two properties",
  "POST /deployments":
    "a preview ttl is at most 365 days and a preview URL must be a host that parses, limits no pattern states exactly",
  "POST /grants": "`expires_at` must be in the future, which depends on the clock",
  "POST /releases": "every pinned revision must already exist in the project",
  "POST /releases/build":
    "each bundled schema is checked against the user-schema meta schema, which the spec only mirrors",
  "POST /sessions/exchange": "an unknown, used or expired handoff token is `400` by contract",
  "PATCH /projects/{project_id}":
    "the parameters a hashing algorithm takes, and their limits, depend on the algorithm and the deployment",
  "POST /idps":
    "the endpoints of an OIDC connection are all set or none, which compares properties",
  "POST /deployments/{deployment_id}/rollback": "a project with no primary origin cannot roll back",
};

/** The refusing operations among a family's. */
export function refusalsFor(operations: readonly { name: string }[]): readonly string[] {
  return operations
    .map((operation) => {
      return operation.name;
    })
    .filter((name) => {
      return name in REFUSALS;
    });
}
