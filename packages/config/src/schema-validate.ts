/**
 * Plan-time port of the server's user-schema designation validator
 * (`validateUserSchemaDesignations` in `internal/domain/schema_designation.go`,
 * ADR 058 §1–§2): the property named by `x-identifier` must exist as a
 * reachable scalar leaf carrying project-scoped uniqueness, every `x-display`
 * entry must name a reachable scalar leaf, and a password-enabled schema must
 * designate an identifier. Without the port, `zitadel plan` accepts schema
 * files the server rejects with a 400 on apply.
 *
 * Contract with the Go source (the same contract `validate.ts` holds for the
 * flow validator):
 *
 * - Every rule id in {@link SCHEMA_DESIGNATION_RULES} names the Go function it
 *   ports (`goRef`); a drift-audit test asserts those functions still exist
 *   and that the shared message literals still match.
 * - Error messages mirror the Go detail strings verbatim — they are
 *   client-visible end to end, so a user who bypasses plan sees identical
 *   text from the server.
 * - Unlike the Go validator (fail-fast), this port collects every issue, the
 *   flow port's documented divergence.
 * - No skip escape hatch, deliberately: the branding refine (`schemas.ts`)
 *   sets the precedent for schema-level rules, and this port is four small
 *   functions with a case-for-case test mirror — plan must never accept what
 *   apply would reject.
 *
 * Lifecycle: a local-first interim like the flow port; the designed successor
 * is the server-side validate-only bundle endpoint (zitadel/nextgen#449).
 */

/**
 * Rule registry: rule id → the Go function it ports. Kept separate from
 * `FLOW_VALIDATION_RULES` — that registry's drift audit is exhaustive over
 * `flow_definition_validator.go` and must not learn about this file.
 */
export const SCHEMA_DESIGNATION_RULES = {
  "designation/password-requires-identifier": { goRef: "validateUserSchemaDesignations" },
  "designation/leaf": { goRef: "designatedLeaf" },
  "designation/object-shaped": { goRef: "isObjectShaped" },
  "designation/scalar-type": { goRef: "declaresScalarType" },
} as const;

/** One designation violation; `path` addresses the offending keyword. */
export interface DesignationIssue {
  path: (string | number)[];
  message: string;
}

const IDENTIFIER = "x-identifier";
const DISPLAY = "x-display";
const UNIQUE = "x-unique";
const AUTH_METHODS = "x-auth-methods";
const UNIQUE_SCOPE_PROJECT = "project";

/** The Go sentinel every detail string is prefixed with (`%w:` rendering). */
const PREFIX = "schema designation invalid";

/** Go `%q` — double-quoted string. */
function q(value: string): string {
  return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Mirrors `maputil.GetNested[bool]` + the password trigger: every level is
 * type-asserted, so a non-object `x-auth-methods` or non-boolean `enabled`
 * reads as disabled.
 */
function passwordEnabled(schema: Record<string, unknown>): boolean {
  if (!isPlainObject(schema[AUTH_METHODS])) return false;
  const password = (schema[AUTH_METHODS] as Record<string, unknown>).password;
  return isPlainObject(password) && password.enabled === true;
}

/**
 * Validate the designation rules on a parsed user-schema document. Returns
 * every violation; an empty array means the server-side validator would pass
 * the document too. The caller gates on `kind === "user-schema"` — the
 * `schema-url` union arm carries no document to check
 * (`internal/domain/schema_validator.go` gates identically).
 */
export function validateUserSchemaDesignations(
  schema: Record<string, unknown>,
): DesignationIssue[] {
  const issues: DesignationIssue[] = [];

  const identifier = typeof schema[IDENTIFIER] === "string" ? (schema[IDENTIFIER] as string) : "";
  const hasIdentifier = identifier !== "";

  // Password verification is unreachable without a prior identifier (the flow
  // state machine dispatches identifier before password). Passkey is
  // deliberately NOT in this trigger: discoverable credentials identify the
  // user through the assertion itself, so passkey-only (and API-managed)
  // schemas legitimately designate nothing. magic_link, otp and sso are
  // enable-able in the meta-schema but not in this trigger yet — ADR 058
  // defers them; extend the trigger when the Go source does (the drift audit
  // watches it).
  if (passwordEnabled(schema) && !hasIdentifier) {
    issues.push({
      path: [AUTH_METHODS, "password", "enabled"],
      message: `${PREFIX}: password authentication is enabled but the schema designates no ${q(IDENTIFIER)}`,
    });
  }

  if (hasIdentifier) {
    const leaf = designatedLeaf(schema, identifier, IDENTIFIER);
    if ("message" in leaf) {
      issues.push({ path: [IDENTIFIER], message: leaf.message });
    } else {
      const scope = typeof leaf.prop[UNIQUE] === "string" ? (leaf.prop[UNIQUE] as string) : "";
      if (scope !== UNIQUE_SCOPE_PROJECT) {
        issues.push({
          path: [IDENTIFIER],
          message: `${PREFIX}: ${q(IDENTIFIER)} property ${q(identifier)} must carry ${UNIQUE} ${q(UNIQUE_SCOPE_PROJECT)}, has ${q(scope)}`,
        });
      }
    }
  }

  // Read as the Go type assertion does: anything but an array is silently
  // skipped (the meta-schema types the keyword; this validator does not
  // re-report shapes).
  const display = schema[DISPLAY];
  if (Array.isArray(display)) {
    display.forEach((entry, i) => {
      if (typeof entry !== "string" || entry === "") {
        issues.push({
          path: [DISPLAY, i],
          message: `${PREFIX}: ${q(DISPLAY)} entries must be non-empty property paths`,
        });
        return;
      }
      const leaf = designatedLeaf(schema, entry, DISPLAY);
      if ("message" in leaf) {
        issues.push({ path: [DISPLAY, i], message: leaf.message });
      }
    });
  }

  return issues;
}

/**
 * Resolve a dot-separated attribute path to its property schema. The root and
 * every intermediate segment must be object-shaped — JSON Schema ignores a
 * `properties` map on a scalar-typed parent, so a path through one could
 * never exist on any valid user document — and the final segment must locally
 * declare a scalar type. Mirrors `designatedLeaf` exactly, including that a
 * missing `properties` map and a missing segment produce the same message,
 * always quoting the full path.
 */
function designatedLeaf(
  schema: Record<string, unknown>,
  path: string,
  keyword: string,
): { prop: Record<string, unknown> } | { message: string } {
  const unknown = { message: `${PREFIX}: ${q(keyword)} names unknown property ${q(path)}` };
  let current: Record<string, unknown> = schema;
  let parent = "the schema root";
  for (const segment of path.split(".")) {
    // The node being descended into must be able to hold object values —
    // this covers the schema root too, whose type the meta-schema does not
    // constrain.
    if (!isObjectShaped(current)) {
      return {
        message: `${PREFIX}: ${q(keyword)} path ${q(path)}: ${parent} is not an object`,
      };
    }
    const properties = current.properties;
    if (!isPlainObject(properties)) {
      return unknown;
    }
    // Own properties only: Go indexes a map, where an inherited name like
    // `toString` is simply absent.
    const next = Object.hasOwn(properties, segment) ? properties[segment] : undefined;
    if (!isPlainObject(next)) {
      return unknown;
    }
    current = next;
    parent = `segment ${q(segment)}`;
  }
  if (!declaresScalarType(current)) {
    return {
      message: `${PREFIX}: ${q(keyword)} property ${q(path)} must locally declare exactly one scalar type`,
    };
  }
  return { prop: current };
}

/**
 * Whether a property schema can hold object values: no `type` declared (its
 * `properties` map carries the intent), the type "object", or a union whose
 * only non-null entry is "object".
 */
function isObjectShaped(prop: Record<string, unknown>): boolean {
  const t = prop.type;
  if (t === undefined) return true;
  if (typeof t === "string") return t === "object";
  if (Array.isArray(t)) {
    let object = false;
    for (const entry of t) {
      if (entry === "object") object = true;
      else if (entry !== "null") return false;
    }
    return object;
  }
  return false;
}

const SCALARS = new Set(["string", "number", "integer", "boolean"]);

/**
 * Whether a property schema locally proves its values are non-null scalars
 * via the `type` keyword: one scalar type name, optionally in a union with
 * "null" (the nullable idiom); exactly one non-null type. JSON Schema
 * keywords are conjunctive, so a local scalar type cannot be widened by
 * `$ref`, `allOf`, or any other keyword the property carries; without the
 * local proof the shape is indeterminate.
 */
function declaresScalarType(prop: Record<string, unknown>): boolean {
  const t = prop.type;
  if (typeof t === "string") return SCALARS.has(t);
  if (Array.isArray(t)) {
    let nonNull = 0;
    for (const entry of t) {
      if (entry === "null") continue;
      if (typeof entry !== "string" || !SCALARS.has(entry)) return false;
      nonNull += 1;
    }
    return nonNull === 1;
  }
  return false;
}
