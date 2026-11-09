/**
 * Login flows under `.zitadel/flows/`, their steps, and the schema each runs
 * against.
 */
export { Flows } from "@/lib/zitadel/resources/flows/collection";
export { Flow } from "@/lib/zitadel/resources/flows/flow";
export type { Step } from "@/lib/zitadel/resources/flows/step";
export {
  PASSWORD_FIELD,
  type IncomingTransition,
  type MethodUse,
  type Offer,
  type SignUpGap,
  type Transition,
} from "@/lib/zitadel/resources/flows/types";
