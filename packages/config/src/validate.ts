/**
 * Plan-time port of the server's flow-definition validator
 * (`internal/domain/flow_definition_validator.go`). The CLI runs it in
 * `buildSyncPlan` so every rule the server enforces on apply speaks up
 * at plan time — with the same words — before anything mutates.
 *
 * Contract with the Go source:
 *
 * - Every rule id in {@link FLOW_VALIDATION_RULES} names the Go function
 *   it ports (`goRef`); a drift-audit test asserts those functions still
 *   exist and that the shared literals below still match.
 * - Error messages mirror the Go detail strings verbatim, so a user who
 *   bypasses plan sees identical text from the server.
 * - Unlike the Go validator (fail-fast), this port collects every issue.
 *   Later phases are gated on earlier phases being clean so one defect
 *   does not cascade into noise (a BFS over duplicate step names is
 *   ill-defined).
 *
 * Scope cuts (server/service-side, not portable): pivot/switch targets
 * must name an active flow definition in the same project (needs the
 * DB); the user schema itself is assumed meta-schema-valid.
 *
 * Lifecycle: this port is a local-first interim, not a second source of
 * truth to grow. Its designed successor is the server-side validate-only
 * bundle endpoint (zitadel/nextgen#449); once plan can ask the server,
 * this file, its drift audit, and the keep-in-sync comment on the Go
 * validator all go away. New rules land in Go first and are ported here
 * only until then.
 */

export type FlowValidationSeverity = "error" | "warning";

export type FlowValidationIssue = {
  severity: FlowValidationSeverity;
  /** Stable rule id from {@link FLOW_VALIDATION_RULES}. */
  rule: FlowValidationRuleId;
  /** Mirrors the Go `ErrFlowDefinitionInvalid` detail string where a Go rule exists. */
  message: string;
  /** Step the issue is anchored to, when applicable. */
  step?: string;
};

/**
 * Rule registry: rule id → the Go function it ports. `goRef: null` marks
 * CLI-only guidance with no server counterpart.
 */
export const FLOW_VALIDATION_RULES = {
  "step-names": { goRef: "stepNamesMap" },
  definition: { goRef: "validateDefinition" },
  steps: { goRef: "validateSteps" },
  graph: { goRef: "validateGraph" },
  cycles: { goRef: "validateCycles" },
  "flip-table": { goRef: "validateFlipTableCoverage" },
  "schema/required-fields": { goRef: "validateRequiredUserSchemaFields" },
  "schema/fields-resolve": { goRef: "resolveAllStepFields" },
  "schema/passkey-actions": { goRef: "validatePasskeyActionsEnabled" },
  "schema/on-success-manifest": { goRef: "validateOnSuccessManifests" },
  "warn/password-without-identifier": { goRef: null },
} as const;

export type FlowValidationRuleId = keyof typeof FLOW_VALIDATION_RULES;

/** Mirrors `reservedOutcomes` in flow_definition_validator.go. */
export const RESERVED_OUTCOMES = ["user_not_found", "user_already_exists", "callback"] as const;

/** Mirrors the `FlowDefinitionPurpose` enum (snake transform) in flow_definition.go. */
export const FLOW_PURPOSES = [
  "login",
  "register",
  "recovery",
  "profiling",
  "reauth",
  "link_account",
] as const;

/** Mirrors `purposeFlipTargets` in flow_definition_validator.go. */
export const PURPOSE_FLIP_TARGETS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  login: { user_not_found: "register" },
  register: { user_already_exists: "login" },
};

/** Mirrors `flipOutcomeImpacts` in flow_definition_validator.go (verbatim). */
const FLIP_OUTCOME_IMPACTS: Readonly<Record<string, string>> = {
  user_not_found:
    "someone without an account gets stuck at sign-in instead of being routed to registration",
  user_already_exists:
    "someone who already has an account gets stuck at registration instead of being routed to sign-in",
};

/** Action kinds a flow author may declare; `back` is engine-injected. */
const DECLARABLE_ACTION_KINDS = new Set(["submit", "passkey", "passkey_register", "navigate"]);

/** Mirrors `flowBackActionName` in flow_state_machine.go. */
const BACK_ACTION_NAME = "back";

/** Mirrors `authMethodPrefix` in flow_definition.go. */
const AUTH_METHOD_PREFIX = "x-auth-methods#";

/** Mirrors `ManifestForOnSuccess` in flow_on_success.go. */
const ON_SUCCESS_MANIFESTS: Readonly<Record<string, readonly FieldChallenge[]>> = {
  create_user: ["identifier", "password"],
};

type FieldChallenge = "identifier" | "password";

/**
 * Validate a flow-definition config body (the `.zitadel/flows/*.json`
 * content) against the rules the server enforces on apply. `schema` is
 * the content of the user schema the flow's `user_schema` pins; when
 * omitted, schema-dependent rules are skipped. Pure — collects all
 * issues, never throws.
 */
export function validateFlowDefinition(flow: object, schema?: object): FlowValidationIssue[] {
  const def = readFlow(flow);
  const issues: FlowValidationIssue[] = [];

  // Phase 1 — step names (everything else keys off them).
  const stepNames = new Set<string>();
  for (const step of def.steps) {
    if (stepNames.has(step.name)) {
      issues.push(error("step-names", `duplicate step name ${q(step.name)}`, step.name));
    }
    stepNames.add(step.name);
  }

  // Phase 2 — purposes.
  if (def.purposes.size === 0) {
    issues.push(error("definition", "no purposes defined"));
  }
  for (const [purpose, entryStep] of def.purposes) {
    if (!(FLOW_PURPOSES as readonly string[]).includes(purpose)) {
      issues.push(error("definition", `'${purpose}' is not a valid purpose`));
      continue;
    }
    if (entryStep === "") {
      issues.push(error("definition", `initial step for purpose '${purpose}' is empty`));
      continue;
    }
    if (!stepNames.has(entryStep)) {
      issues.push(
        error("definition", `purpose ${q(purpose)} targets unknown entry-point step ${q(entryStep)}`),
      );
    }
  }

  // Phase 3 — per-step structure.
  for (const step of def.steps) {
    issues.push(...validateStep(step));
  }

  // Graph phases are ill-defined over broken structure — gate on 1–3.
  if (issues.length === 0) {
    issues.push(...validateGraph(def, stepNames));
    if (issues.length === 0) {
      issues.push(...validateCycles(def));
    }
    issues.push(...validateFlipTableCoverage(def));
  }

  // Schema-dependent phases: only meaningful over structurally sound
  // steps, and only when the paired schema content is available.
  if (schema !== undefined && issues.length === 0) {
    issues.push(...validateAgainstSchema(def, schema));
  }

  return issues;
}

// ── internal flow reading ────────────────────────────────────────────────────

type FlowStep = {
  name: string;
  fields: string[];
  actions: { name: string; kind: string }[];
  gateCount: number;
  ssoProviderCount: number;
  transitions: Map<string, { target: string; action: string | null; purpose: string | null }>;
  onSuccess: string | undefined;
  terminal: boolean;
};

type FlowDef = {
  purposes: Map<string, string>;
  steps: FlowStep[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Coerce raw parsed JSON into the internal shape. Callers usually run
 * the Zod config schema first; the defensive reads keep the standalone
 * API from crashing on malformed input (it reports rule violations on
 * whatever is readable instead).
 */
function readFlow(flow: object): FlowDef {
  const raw = flow as Record<string, unknown>;

  const purposes = new Map<string, string>();
  if (isPlainObject(raw.purposes)) {
    for (const [purpose, entry] of Object.entries(raw.purposes)) {
      purposes.set(purpose, str(entry));
    }
  }

  const steps: FlowStep[] = [];
  if (Array.isArray(raw.steps)) {
    for (const value of raw.steps) {
      if (!isPlainObject(value)) continue;
      const transitions = new Map<
        string,
        { target: string; action: string | null; purpose: string | null }
      >();
      if (isPlainObject(value.transitions)) {
        for (const [key, t] of Object.entries(value.transitions)) {
          const entry = isPlainObject(t) ? t : {};
          transitions.set(key, {
            target: str(entry.target),
            action: typeof entry.action === "string" ? entry.action : null,
            purpose: typeof entry.purpose === "string" ? entry.purpose : null,
          });
        }
      }
      steps.push({
        name: str(value.name),
        fields: Array.isArray(value.fields) ? value.fields.map(str) : [],
        actions: Array.isArray(value.actions)
          ? value.actions
              .filter(isPlainObject)
              .map((a) => ({ name: str(a.name), kind: str(a.kind) }))
          : [],
        gateCount: isPlainObject(value.gates) ? Object.keys(value.gates).length : 0,
        ssoProviderCount: Array.isArray(value.sso_providers) ? value.sso_providers.length : 0,
        transitions,
        onSuccess: typeof value.on_success === "string" ? value.on_success : undefined,
        terminal: value.complete !== undefined && value.complete !== null,
      });
    }
  }

  return { purposes, steps };
}

/** Go `%q` — double-quoted string. */
function q(value: string): string {
  return JSON.stringify(value);
}

function error(rule: FlowValidationRuleId, message: string, step?: string): FlowValidationIssue {
  return step === undefined
    ? { severity: "error", rule, message }
    : { severity: "error", rule, message, step };
}

// ── phase 3: per-step structure (validateSteps + uniqueNonEmptyFields) ──────

function validateStep(step: FlowStep): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  const name = step.name;

  if (step.terminal) {
    if (
      step.fields.length > 0 ||
      step.actions.length > 0 ||
      step.transitions.size > 0 ||
      step.gateCount > 0 ||
      step.ssoProviderCount > 0
    ) {
      issues.push(
        error(
          "steps",
          `step ${q(name)} is terminal (complete is set) but has fields, actions, transitions, gates, or sso_providers`,
          name,
        ),
      );
    }
    return issues;
  }

  const seenFields = new Set<string>();
  for (const field of step.fields) {
    if (field === "") {
      issues.push(error("steps", `step ${q(name)}: field entry is empty`, name));
      continue;
    }
    if (seenFields.has(field)) {
      issues.push(error("steps", `step ${q(name)}: duplicate field ${q(field)}`, name));
    }
    seenFields.add(field);
  }

  const actionNames = new Set<string>();
  for (const action of step.actions) {
    if (action.name === "") {
      issues.push(error("steps", `step ${q(name)}: action has empty name`, name));
      continue;
    }
    if (actionNames.has(action.name)) {
      issues.push(error("steps", `step ${q(name)}: duplicate action ${q(action.name)}`, name));
      continue;
    }
    if (action.kind === "" || (action.kind !== "back" && !DECLARABLE_ACTION_KINDS.has(action.kind))) {
      issues.push(error("steps", `step ${q(name)}: action ${q(action.name)} has no kind`, name));
    } else if (action.kind === "back") {
      issues.push(
        error(
          "steps",
          `step ${q(name)}: action ${q(action.name)} has kind=back, which is engine-injected and cannot be declared`,
          name,
        ),
      );
    }
    if (action.name === BACK_ACTION_NAME) {
      issues.push(
        error(
          "steps",
          `step ${q(name)}: action name ${q(action.name)} is reserved for engine-injected back navigation`,
          name,
        ),
      );
    }
    actionNames.add(action.name);
  }

  const hasCallback = step.transitions.has("callback");
  if (
    step.fields.length === 0 &&
    step.actions.length === 0 &&
    step.ssoProviderCount === 0 &&
    step.gateCount === 0 &&
    !hasCallback
  ) {
    issues.push(
      error(
        "steps",
        `step ${q(name)} is non-terminal but has no fields, actions, sso_providers, gates, or transitions.callback`,
        name,
      ),
    );
  }

  if (step.ssoProviderCount > 0 && !hasCallback) {
    issues.push(
      error("steps", `step ${q(name)}: has sso_providers but is missing transitions.callback`, name),
    );
  }

  for (const actionName of actionNames) {
    if (!step.transitions.has(actionName)) {
      issues.push(
        error("steps", `step ${q(name)}: action ${q(actionName)} has no matching transition`, name),
      );
    }
  }

  for (const transitionKey of step.transitions.keys()) {
    if (!actionNames.has(transitionKey) && !(RESERVED_OUTCOMES as readonly string[]).includes(transitionKey)) {
      issues.push(
        error(
          "steps",
          `step ${q(name)}: transition key ${q(transitionKey)} is not an action name or reserved outcome (user_not_found, user_already_exists, callback)`,
          name,
        ),
      );
    }
  }

  return issues;
}

// ── phase 4: graph / cycles / flip table ─────────────────────────────────────

/** A transition with no cross-flow action targets a step in this flow. */
function isCurrentFlow(t: { action: string | null }): boolean {
  return t.action === null;
}

/** Adjacency over local (current-flow) transitions: step → target steps. */
function localAdjacency(def: FlowDef): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const step of def.steps) {
    for (const t of step.transitions.values()) {
      if (isCurrentFlow(t)) {
        const targets = adj.get(step.name) ?? [];
        targets.push(t.target);
        adj.set(step.name, targets);
      }
    }
  }
  return adj;
}

/** Reverse adjacency over local transitions: target step → source steps. */
function reverseAdjacency(def: FlowDef): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const step of def.steps) {
    for (const t of step.transitions.values()) {
      if (isCurrentFlow(t)) {
        const sources = reverse.get(t.target) ?? [];
        sources.push(step.name);
        reverse.set(t.target, sources);
      }
    }
  }
  return reverse;
}

/** BFS from `start` over `adj`, accumulating into `visited`. */
function bfs(start: string, adj: Map<string, string[]>, visited: Set<string>): void {
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    queue.push(...(adj.get(current) ?? []));
  }
}

function validateGraph(def: FlowDef, stepNames: Set<string>): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];

  for (const step of def.steps) {
    for (const [key, t] of step.transitions) {
      if (t.purpose !== null) {
        // Local re-purposing: never combined with a cross-flow action,
        // only to a purpose this definition serves, and only to that
        // purpose's entry step. Mirrors the server-side validator.
        if (t.action !== null) {
          issues.push(
            error(
              "graph",
              `step ${q(step.name)}: transition ${q(key)} declares both purpose and action; a transition either re-purposes locally or targets another flow`,
              step.name,
            ),
          );
        } else if (!(FLOW_PURPOSES as readonly string[]).includes(t.purpose)) {
          // Verbatim-identical to the Go validator's message (which cannot
          // print the raw value — its parse layer rejects it earlier).
          issues.push(
            error(
              "graph",
              `step ${q(step.name)}: transition ${q(key)} has invalid purpose`,
              step.name,
            ),
          );
        } else {
          const entry = def.purposes.get(t.purpose);
          if (entry === undefined) {
            issues.push(
              error(
                "graph",
                `step ${q(step.name)}: transition ${q(key)} re-purposes to ${q(t.purpose)}, which this definition does not serve`,
                step.name,
              ),
            );
          } else if (t.target !== entry) {
            issues.push(
              error(
                "graph",
                `step ${q(step.name)}: transition ${q(key)} re-purposes to ${q(t.purpose)} but targets ${q(t.target)}; it must target that purpose's entry step ${q(entry)}`,
                step.name,
              ),
            );
          }
        }
      }
      if (isCurrentFlow(t)) {
        if (!stepNames.has(t.target)) {
          issues.push(
            error(
              "graph",
              `step ${q(step.name)}: transition ${q(key)} targets unknown step ${q(t.target)}`,
              step.name,
            ),
          );
        }
      } else if (t.action !== "switch" && t.action !== "pivot") {
        issues.push(
          error(
            "graph",
            `step ${q(step.name)}: transition ${q(key)} has invalid action ${q(t.action ?? "")}`,
            step.name,
          ),
        );
      }
    }
  }

  for (const step of def.steps) {
    if (!step.terminal && step.transitions.size === 0) {
      issues.push(
        error("graph", `step ${q(step.name)} is non-terminal but has no outgoing transitions`, step.name),
      );
    }
  }

  const reachable = new Set<string>();
  const adj = localAdjacency(def);
  for (const entryStep of def.purposes.values()) {
    bfs(entryStep, adj, reachable);
  }
  for (const step of def.steps) {
    if (!reachable.has(step.name)) {
      issues.push(error("graph", `step ${q(step.name)} is unreachable from any entry point`, step.name));
    }
  }

  return issues;
}

function validateCycles(def: FlowDef): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  const reverse = reverseAdjacency(def);

  // Seed: escape nodes (terminal, or a switch/pivot out); BFS backwards.
  const safe = new Set<string>();
  const queue: string[] = [];
  for (const step of def.steps) {
    const escapes =
      step.terminal || [...step.transitions.values()].some((t) => !isCurrentFlow(t));
    if (escapes) {
      safe.add(step.name);
      queue.push(step.name);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === undefined) continue;
    for (const pred of reverse.get(current) ?? []) {
      if (!safe.has(pred)) {
        safe.add(pred);
        queue.push(pred);
      }
    }
  }

  for (const step of def.steps) {
    if (!step.terminal && !safe.has(step.name)) {
      issues.push(
        error(
          "cycles",
          `step ${q(step.name)} is trapped: no path to a terminal step or another flow`,
          step.name,
        ),
      );
    }
  }
  return issues;
}

function validateFlipTableCoverage(def: FlowDef): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  for (const [purpose, entryStepName] of def.purposes) {
    const flipTargets = PURPOSE_FLIP_TARGETS[purpose];
    if (flipTargets === undefined) continue;
    const entry = def.steps.find((s) => s.name === entryStepName);
    if (entry === undefined) continue;
    for (const [outcome, targetPurpose] of Object.entries(flipTargets)) {
      if (!def.purposes.has(targetPurpose)) continue;
      if (!entry.transitions.has(outcome)) {
        issues.push(
          error(
            "flip-table",
            `step ${q(entry.name)}: entry step for purpose ${q(purpose)} must wire ${q(outcome)} transition because ${q(targetPurpose)} is also a purpose: without it, ${FLIP_OUTCOME_IMPACTS[outcome]}`,
            entry.name,
          ),
        );
      }
    }
  }
  return issues;
}

// ── phase 5: schema-dependent rules ──────────────────────────────────────────

function schemaProperties(schema: Record<string, unknown>): Record<string, unknown> | undefined {
  return isPlainObject(schema.properties) ? schema.properties : undefined;
}

function schemaRequired(schema: Record<string, unknown>): string[] {
  return Array.isArray(schema.required) ? schema.required.map(str).filter((n) => n !== "") : [];
}

/**
 * Mirrors `schemaReader.RequiredPaths`: every name in `required`,
 * recursed through the nested `required` of each required object. A
 * required object declaring no `required` of its own ends the descent at
 * the object itself.
 *
 * An optional object contributes its own `required` too once it appears
 * in `materialized`. It only exists in the document because something
 * beneath it was collected, and from that point document validation
 * enforces the rest of its `required` list.
 */
function requiredPaths(
  schema: Record<string, unknown>,
  materialized: ReadonlySet<string>,
  prefix = "",
): string[] {
  const properties = schemaProperties(schema);
  const required = schemaRequired(schema);
  // A set, like the Go `map[string]struct{}`, so a name repeated in
  // `required` yields the path once.
  const out = new Set<string>();

  for (const name of required) {
    const path = prefix === "" ? name : `${prefix}.${name}`;
    const property =
      properties !== undefined && Object.hasOwn(properties, name) ? properties[name] : undefined;
    if (!isPlainObject(property) || schemaRequired(property).length === 0) {
      out.add(path);
      continue;
    }
    for (const nested of requiredPaths(property, materialized, path)) out.add(nested);
  }

  // An optional object is invisible to the loop above, so descend into
  // the ones a collected field materializes.
  for (const [name, property] of Object.entries(properties ?? {})) {
    if (required.includes(name) || !isPlainObject(property)) continue;
    const path = prefix === "" ? name : `${prefix}.${name}`;
    if (!materialized.has(path)) continue;
    for (const nested of requiredPaths(property, materialized, path)) out.add(nested);
  }

  return [...out];
}

/** Mirrors `xAuthMethodsReader.IsEnabled` in flow_field_resolver_schema.go. */
function authMethodEnabled(schema: Record<string, unknown>, method: string): boolean {
  if (!isPlainObject(schema["x-auth-methods"])) return false;
  const entry = schema["x-auth-methods"][method];
  return isPlainObject(entry) && entry.enabled === true;
}

/**
 * Resolve one step field to its challenge, mirroring the subset of
 * `SchemaFieldResolver.Resolve` the validator needs. Returns either the
 * challenge (or null for none) or the Go-verbatim resolution error.
 */
function resolveFieldChallenge(
  field: string,
  properties: Record<string, unknown>,
  schema: Record<string, unknown>,
): { challenge: FieldChallenge | null } | { message: string } {
  if (field.startsWith(AUTH_METHOD_PREFIX)) {
    const method = field.slice(AUTH_METHOD_PREFIX.length);
    // Mirrors deriveAuthMethodType: only password is field-shaped today.
    if (method !== "password") {
      return { message: `unknown field type for ${q(field)}` };
    }
    if (!authMethodEnabled(schema, method)) {
      // Surfaced by resolveAllStepFields' enabled-method cross-check.
      return { message: `${q(method)} is not an enabled authentication method` };
    }
    return { challenge: "password" };
  }

  // Mirrors walkUserProperty: a nested property is addressed by its
  // dotted path, descending one `properties` level per segment.
  const segments = field.split(".");
  let property: unknown = undefined;
  let level: Record<string, unknown> | undefined = properties;
  for (const [i, segment] of segments.entries()) {
    // Own properties only: Go indexes a map, where an inherited name like
    // `toString` is simply absent.
    property = level !== undefined && Object.hasOwn(level, segment) ? level[segment] : undefined;
    if (property === undefined) {
      return { message: `flow field: not a property in the user schema: ${q(field)}` };
    }
    const nested = isPlainObject(property) ? schemaProperties(property) : undefined;
    if (i < segments.length - 1 && nested === undefined) {
      return { message: `flow field: not a property in the user schema: ${q(field)}` };
    }
    level = nested;
  }

  if (!isPlainObject(property)) {
    return { challenge: null };
  }

  // Mirrors schemaReader.JSONType: the nullable idiom `["null", X]`
  // reduces to X; any other multi-entry union is unsupported. Go reduces
  // before it tests for a composite, so the union error wins and the
  // object/array test below reads the reduced type rather than the union.
  let jsonType = property.type;
  if (Array.isArray(jsonType)) {
    const nonNull = jsonType.filter((t) => t !== "null");
    if (nonNull.length > 1) {
      return { message: `flow field: unsupported JSON type: [${jsonType.map(str).join(" ")}]` };
    }
    // Undefined when every entry was "null", matching Go's empty-string case.
    jsonType = nonNull[0];
  }

  // Mirrors deriveUserPropertyType: an object or array has no
  // field-shaped input. A property carrying `properties` is an object,
  // and one carrying `items` is an array, even when it omits the `type`
  // keyword.
  if (
    jsonType === "object" ||
    jsonType === "array" ||
    schemaProperties(property) !== undefined ||
    "items" in property
  ) {
    return {
      message: `flow field: not a scalar property, name a nested leaf instead: ${q(field)}`,
    };
  }

  // Mirrors deriveIdentifierChallenge: the field naming the schema-root
  // `x-identifier` designation is the identifier (ADR 057); other
  // properties — unique or not — carry no identifier challenge.
  const identifier = schema["x-identifier"];
  if (typeof identifier === "string" && identifier !== "" && field === identifier) {
    return { challenge: "identifier" };
  }
  return { challenge: null };
}

function validateAgainstSchema(def: FlowDef, schema: object): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  const raw = schema as Record<string, unknown>;

  const properties = schemaProperties(raw);
  if (properties === undefined) {
    issues.push(error("schema/fields-resolve", "user schema has no properties"));
    return issues;
  }

  // Required-fields coverage (validateRequiredUserSchemaFields).
  // Collecting `address.street` covers the leaf and every object above
  // it, since an object materializes once one of its children is
  // collected. The same prefixes are what the schema treats as
  // materialized, so an optional object's own `required` list comes into
  // force here too.
  const covered = new Set<string>();
  for (const step of def.steps) {
    for (const field of step.fields) {
      let path = "";
      for (const node of field.split(".")) {
        path = path === "" ? node : `${path}.${node}`;
        covered.add(path);
      }
    }
  }
  const missing = requiredPaths(raw, covered)
    .filter((field) => !covered.has(field))
    .sort();
  if (missing.length > 0) {
    issues.push(
      error(
        "schema/required-fields",
        `required fields [${missing.join(" ")}] in user schema are missing in the flow definition steps`,
      ),
    );
  }

  // Field resolution (resolveAllStepFields), collecting challenges for
  // the manifest and warning rules below.
  const challengesByStep = new Map<string, Set<FieldChallenge>>();
  let resolutionFailed = false;
  for (const step of def.steps) {
    const challenges = new Set<FieldChallenge>();
    for (const field of step.fields) {
      const resolved = resolveFieldChallenge(field, properties, raw);
      if ("message" in resolved) {
        issues.push(
          error("schema/fields-resolve", `step ${q(step.name)}: ${resolved.message}`, step.name),
        );
        resolutionFailed = true;
        continue;
      }
      if (resolved.challenge !== null) {
        challenges.add(resolved.challenge);
      }
    }
    challengesByStep.set(step.name, challenges);
  }

  // Passkey enablement (validatePasskeyActionsEnabled): passkey is
  // action-shaped, not field-shaped, so the per-field enabled-method
  // check above never sees it.
  if (!authMethodEnabled(raw, "passkey")) {
    for (const step of def.steps) {
      for (const action of step.actions) {
        if (action.kind === "passkey" || action.kind === "passkey_register") {
          issues.push(
            error(
              "schema/passkey-actions",
              `step ${q(step.name)}: action ${q(action.name)} offers passkey but "passkey" is not an enabled authentication method`,
              step.name,
            ),
          );
        }
      }
    }
  }

  if (resolutionFailed) {
    return issues;
  }

  // on_success manifests (validateOnSuccessManifests): every kind the
  // mutation needs must be collected on the step or upstream.
  const reverse = reverseAdjacency(def);
  for (const step of def.steps) {
    if (step.onSuccess === undefined) continue;
    const manifest = ON_SUCCESS_MANIFESTS[step.onSuccess];
    if (manifest === undefined) continue;
    const upstream = new Set<string>();
    bfs(step.name, reverse, upstream);
    for (const kind of manifest) {
      const established = [...upstream].some((name) => challengesByStep.get(name)?.has(kind));
      if (!established) {
        issues.push(
          error(
            "schema/on-success-manifest",
            `step ${q(step.name)}: on_success ${step.onSuccess} requires ${q(kind)} to be collected upstream`,
            step.name,
          ),
        );
      }
    }
  }

  // CLI-only guidance (no Go counterpart): a password collected on the
  // login path with no identifier upstream leaves the engine unable to
  // resolve which user to challenge. Path-sensitive: walk forward from
  // the login entry and stop at any step that collects an identifier
  // (every route through it is covered), so an identifier on a
  // *different* route — e.g. only on the register-purpose chain into a
  // shared step — cannot mask a login route that never collects one.
  const loginEntry = def.purposes.get("login");
  if (loginEntry !== undefined) {
    const adj = localAdjacency(def);
    const identifierFree = new Set<string>();
    const queue = [loginEntry];
    for (let head = 0; head < queue.length; head += 1) {
      const name = queue[head];
      if (name === undefined || identifierFree.has(name)) continue;
      if (challengesByStep.get(name)?.has("identifier")) continue;
      identifierFree.add(name);
      queue.push(...(adj.get(name) ?? []));
    }
    for (const step of def.steps) {
      if (!identifierFree.has(step.name)) continue;
      if (!challengesByStep.get(step.name)?.has("password")) continue;
      issues.push({
        severity: "warning",
        rule: "warn/password-without-identifier",
        message: `step ${q(step.name)} collects ${AUTH_METHOD_PREFIX}password on the login path but no upstream step collects an identifier field — the engine cannot resolve which user to challenge`,
        step: step.name,
      });
    }
  }

  return issues;
}
