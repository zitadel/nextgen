import type {
  ListFlowDefinitions200FlowDefinitionsItem,
  ListFlowDefinitions200FlowDefinitionsItemFlowDefinition,
  ListFlowDefinitions200FlowDefinitionsItemFlowDefinitionStepsItem,
} from "@zitadel/api/generated/model";

/**
 * Reading a flow definition for the console's two login-flow screens.
 *
 * A flow definition is configuration, not a resource (decisions log D0a): the
 * screens show the document an operator applies through the CLI, so everything
 * here derives display strings from the wire shape and nothing here writes.
 *
 * The types are the generated ones, aliased. Orval names the same object once
 * per operation, so the list and the detail get different names for the
 * identical schema — the aliases pick the list's and let structural typing
 * carry the detail's, which keeps the screens off hand-written duplicates that
 * would drift from the spec.
 */

/** One entry from `GET /flow_definitions`. */
export type FlowDefinitionEntry = ListFlowDefinitions200FlowDefinitionsItem;

/** The definition document itself. */
export type FlowDefinition = ListFlowDefinitions200FlowDefinitionsItemFlowDefinition;

/** One step of a definition. */
export type FlowStep = ListFlowDefinitions200FlowDefinitionsItemFlowDefinitionStepsItem;

/**
 * The purposes a definition serves, in a fixed order rather than the JSON's.
 *
 * The design's annotation on the row pins this order so two rows stay
 * comparable at a glance — a definition that happens to list `register` first
 * should still read `Login + Register`.
 */
const PURPOSE_ORDER = ["login", "register", "recovery", "reauth", "profiling", "link_account"];

const PURPOSE_LABELS: Record<string, string> = {
  login: "Login",
  register: "Register",
  recovery: "Recovery",
  reauth: "Reauth",
  profiling: "Profiling",
  link_account: "Link account",
};

/**
 * `{ login, register }` → `Login + Register`.
 *
 * A purpose the console does not know a label for still shows, humanised from
 * its key: the enum can grow server-side, and dropping the unknown one would
 * silently under-report what a flow does.
 */
export function flowPurposeSummary(definition: FlowDefinition): string {
  const purposes = Object.keys(definition.purposes ?? {});
  const known = PURPOSE_ORDER.filter((purpose) => purposes.includes(purpose));
  const rest = purposes.filter((purpose) => !PURPOSE_ORDER.includes(purpose)).sort();
  return [...known, ...rest].map((purpose) => PURPOSE_LABELS[purpose] ?? humanise(purpose)).join(" + ");
}

/**
 * `default-login` → `Default login`.
 *
 * A definition's `name` is a slug (`^[a-z][a-z0-9-]*$`) and doubles as its
 * display label — the API has no separate display-name field — so the frames'
 * `Default login` is this, not a value the server sends.
 */
export function flowDisplayName(definition: FlowDefinition): string {
  return humanise(definition.name);
}

function humanise(value: string): string {
  const spaced = value.replace(/[-_]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Step names in the order the definition lists them.
 *
 * That order is the author's reading order, not the runtime sequence — real
 * sequencing comes from each step's transitions — which is why the row shows
 * them as a flat set of chips rather than as a numbered path.
 */
export function flowStepNames(definition: FlowDefinition): string[] {
  return (definition.steps ?? []).map((step) => step.name);
}

/** `submit, passkey, navigate` — the actions column of the steps table. */
export function stepActionNames(step: FlowStep): string {
  return (step.actions ?? []).map((action) => action.name).join(", ");
}

/** `email, givenName, familyName` — the fields column of the steps table. */
export function stepFieldNames(step: FlowStep): string {
  return (step.fields ?? []).join(", ");
}
