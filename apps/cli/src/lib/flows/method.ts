import type { FlowDefinition } from "./schema";
import type { AuthMethod, BuildArgs } from "./types";

/**
 * The pair of artifacts a flow builder emits: the flow_definition body
 * (the bytes written to `.zitadel/flows/<name>.json`) and the locale
 * fragment (the seed entries merged into `.zitadel/locales/en.json`).
 * Both objects are newly allocated on every build and may be retained
 * by callers without risk of internal mutation.
 */
export type FlowFragment = {
  readonly flow: FlowDefinition;
  readonly locale: Readonly<Record<string, string>>;
};

/**
 * The contract every auth method implements. `id` lets the registry
 * cross-check the key under which a method is registered; `build` is
 * the pure constructor invoked by the dispatcher.
 */
export interface FlowMethod {
  readonly id: AuthMethod;
  build(args: Readonly<BuildArgs>): FlowFragment;
}
