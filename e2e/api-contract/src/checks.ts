/**
 * Every check this Schemathesis release offers by name. `--checks all` would
 * add a response time limit of 10 seconds, which makes a run depend on how
 * fast the machine and its network are (a fuzzed schema URL makes the server
 * fetch an arbitrary host); speed is not a contract property.
 */
export const CHECKS = [
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
 * A check that does not apply to one operation, by its `operationId`.
 * Schemathesis's `use_after_free` expects a `404` for a resource it deleted.
 * `DELETE /teams/{team_id}` deactivates the team and keeps it, and the
 * operation's description says `getTeam` still returns it with status
 * `deactivated`, so the `200` is the contract and not a leak. Every other
 * operation keeps the check.
 *
 * Schemathesis's `ignored_auth` check removes one credential and expects the
 * server to answer 401 or 403. An operation that accepts either a bearer or a
 * session cookie has two, and the check removes only one: the request it then
 * calls unauthenticated still carries the other, and the server correctly
 * accepts it. That is the check being wrong for such an operation, so
 * `exemptionsFor` switches it off for the operations that declare more than
 * one security alternative, and for no other.
 *
 * `submitFlowStep` documents its `400` as the step with an `error` field, but a
 * body that fails base validation (a missing or malformed body) is answered
 * with the plain error body. Declaring both shapes would turn the response
 * into a sum type in the generated server and client, so the response schema
 * check is off for this one operation until the two are reconciled.
 *
 * `rollbackDeployment` takes only a deployment id and a project, both of which
 * the stateful phase fills in from earlier responses. A "negative" request
 * therefore comes out identical to a valid one, and `negative_data_rejection`
 * flags the server for accepting what the spec does not call invalid. There is
 * no invalid input to send, so the check is off for this one operation.
 */
const EXEMPTIONS: readonly Exemption[] = [
  { operationId: "getTeam", check: "use_after_free" },
  { operationId: "submitFlowStep", check: "response_schema_conformance" },
  { operationId: "rollbackDeployment", check: "negative_data_rejection" },
];

export interface Exemption {
  operationId: string;
  check: string;
}

/** The checks to switch off for some of a family's operations, and for which. */
export function exemptionsFor(
  operations: readonly { id: string; alternatives: number }[],
): readonly Exemption[] {
  const ids = new Set(
    operations.map((operation) => {
      return operation.id;
    }),
  );
  return [
    ...EXEMPTIONS.filter((exemption) => {
      return ids.has(exemption.operationId);
    }),
    ...operations
      .filter((operation) => {
        return operation.alternatives > 1;
      })
      .map((operation) => {
        return { operationId: operation.id, check: "ignored_auth" };
      }),
  ];
}

const PRIMARY_ORIGIN =
  "a primary origin is an exact URL and `kind` decides that, a rule across two properties the generator does not honour";

/**
 * Operations the server may answer a schema-valid request with a 400, and why
 * the spec cannot say it. `positive_data_acceptance` expects no 400 from a
 * valid request; each of these refuses on a rule that no JSON Schema keyword
 * states, so the check is told to accept the 400 for them alone. Each line is
 * a reason to look at the server first: when it answers 404, or the rule
 * becomes a constraint, remove the line. A page token is not here: `hooks.py`
 * keeps one out of the requests, so every paged operation keeps the check.
 */
export const REFUSALS: Readonly<Record<string, string>> = {
  "POST /branding":
    "a colour is checked by value (hex, a CSS colour name or a colour function), which a pattern cannot state",
  "POST /flow_definitions": "the project the definition names must exist",
  "POST /policies": "`min_length` may not exceed `max_length`, which compares two properties",
  "POST /schemas": "the document must be a valid user schema, which the spec only mirrors",
  "POST /users": "the `schema` must name a schema that exists in the project",
  "POST /projects": PRIMARY_ORIGIN,
  "POST /projects/{project_id}/origins": PRIMARY_ORIGIN,
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
export function refusalsFor(
  operations: readonly { name: string; id: string }[],
): readonly string[] {
  return operations
    .filter((operation) => {
      return operation.name in REFUSALS;
    })
    .map((operation) => {
      return operation.id;
    });
}
