/**
 * Every widget event the `@zitadel/components` elements dispatch.
 *
 * `events.spec.ts` scans this package's source and fails when an element
 * dispatches a `zitadel-*` event missing here, or one listed here is no longer
 * dispatched. `@zitadel/sdk-core` checks its SPA event contract against this
 * list, so a new event fails there until every SDK wires it.
 */
export const DISPATCHED_EVENTS = [
  "zitadel-flow-complete",
  "zitadel-flow-error",
  "zitadel-flow-input",
  "zitadel-flow-redirect",
  "zitadel-flow-step",
  "zitadel-signout",
] as const;

export type DispatchedEvent = (typeof DISPATCHED_EVENTS)[number];
