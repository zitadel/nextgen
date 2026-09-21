import type {
  ListFlowDefinitions200FlowDefinitionsItem,
  ListFlowDefinitions200FlowDefinitionsItemFlowDefinition,
  ListFlowDefinitions200FlowDefinitionsItemFlowDefinitionStepsItem,
} from "@zitadel/api/generated/model";

/**
 * Display strings for the login-flow screens. Read-only: flow definitions are
 * configuration applied through the CLI (decisions log D0a).
 *
 * Orval names the same object once per operation, so these alias the list's
 * names and let structural typing carry the detail's.
 */

/** One entry from `GET /flow_definitions`. */
export type FlowDefinitionEntry = ListFlowDefinitions200FlowDefinitionsItem;

/** The definition document itself. */
export type FlowDefinition = ListFlowDefinitions200FlowDefinitionsItemFlowDefinition;

/** One step of a definition. */
export type FlowStep = ListFlowDefinitions200FlowDefinitionsItemFlowDefinitionStepsItem;

/** Fixed order, not the JSON's, so two rows stay comparable at a glance. */
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
 * `{ login, register }` → `Login + Register`. An unlabelled purpose still shows,
 * humanised — the enum can grow server-side and dropping it would under-report.
 */
export function flowPurposeSummary(definition: FlowDefinition): string {
  const purposes = Object.keys(definition.purposes ?? {});
  const known = PURPOSE_ORDER.filter((purpose) => purposes.includes(purpose));
  const rest = purposes.filter((purpose) => !PURPOSE_ORDER.includes(purpose)).sort();
  return [...known, ...rest].map((purpose) => PURPOSE_LABELS[purpose] ?? humanise(purpose)).join(" + ");
}

/** `default-login` → `Default login`. The API has no display-name field. */
export function flowDisplayName(definition: FlowDefinition): string {
  return humanise(definition.name);
}

function humanise(value: string): string {
  const spaced = value.replace(/[-_]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Step names in the definition's own order — the author's reading order, not the
 * runtime sequence, which comes from each step's transitions.
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
