/**
 * Liquid template context contract.
 *
 * The orchestrator feeds tenant Liquid templates a stable, renderer-friendly
 * projection of the wire `CreateFlow201` shape. Capability arrays
 * (`fields`, `actions`) and the gates object are typed straight from
 * the orval-generated wire so templates iterate over the same schema the
 * server promises.
 *
 * The orchestrator owns these projections that don't exist on the wire:
 *
 * 1. `errors` — lifted from `step.error: string | null` so templates iterate
 *    uniformly even though the wire only carries one error string.
 * 2. `messages` — populated by orchestrator decoration hooks (info banners,
 *    sticky notices); not on the wire.
 * 3. `identity` — resolved client-side for greet-by-name; not on the wire.
 */
import type {
  CreateFlow201Step,
  CreateFlow201StepActionsItem,
  CreateFlow201StepChallenge,
  CreateFlow201StepFieldsItem,
  CreateFlow201StepGates,
  CreateFlow201StepSsoProvidersItem,
} from "@zitadel/api/generated/model";

import type { Branding } from "./branding.js";

export type FlowMessage = {
  level: "info" | "warning";
  text_key: string;
};

export type FlowError = {
  code?: string;
  text_key?: string;
  message?: string;
  /**
   * Name of the step field this error targets. When set (and the step renders
   * that field), the template routes the error inline under the control via
   * the `fieldError` filter; when absent it renders in the form-level banner
   * (`formLevelError`). See `localiseFlowErrorKeys` in `liquid.ts`.
   */
  field?: string;
};

export type FlowIdentity = {
  display_name?: string;
  email_address?: string;
  avatar_url?: string;
};

/**
 * Liquid render context. The orchestrator builds this from the wire
 * `CreateFlow201` payload before invoking the engine.
 *
 * Capability dictionaries point at the orval wire shapes directly. The only
 * client-only pieces are `messages`, `identity`, `errors`, the resolved
 * `branding` (v2 superset), and `loading`.
 */
export type LiquidContext = {
  step: Pick<CreateFlow201Step, "name" | "complete" | "texts">;
  fields: readonly CreateFlow201StepFieldsItem[];
  actions: readonly CreateFlow201StepActionsItem[];
  gates: CreateFlow201StepGates;
  sso_providers: readonly CreateFlow201StepSsoProvidersItem[];
  challenge: CreateFlow201StepChallenge | null;
  messages: readonly FlowMessage[];
  identity: FlowIdentity | null;
  errors: readonly FlowError[];
  branding: Branding | Record<string, never>;
  loading: boolean;
};
