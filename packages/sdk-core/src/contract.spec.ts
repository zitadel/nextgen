import { DISPATCHED_EVENTS } from "@zitadel/components/events";
import { describe, expect, it } from "vitest";

import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGIN_EVENTS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENTS,
  ZITADEL_SESSION_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENTS,
} from "./types.js";

/**
 * The element↔contract drift guard.
 *
 * `@zitadel/components` publishes the widget events its elements dispatch
 * ({@link DISPATCHED_EVENTS}, checked against its own source by its
 * `events.spec.ts`). This asserts that set is EXACTLY the SPA contract
 * ({@link ZITADEL_LOGIN_EVENTS} + {@link ZITADEL_LOGOUT_EVENTS} +
 * {@link ZITADEL_SESSION_EVENTS}, deduped — `zitadel-signout` is shared by the
 * logout menu and the session card). Adding or removing a widget event in the
 * elements therefore fails here until the contract is updated — and updating
 * the contract forces every SDK (via their contract-driven forwarding tests) to
 * wire or drop the event.
 */
describe("SPA widget contract ↔ @zitadel/components", () => {
  it("declares exactly the events the elements dispatch", () => {
    const declared = [
      ...new Set([...ZITADEL_LOGIN_EVENTS, ...ZITADEL_LOGOUT_EVENTS, ...ZITADEL_SESSION_EVENTS]),
    ].sort();
    expect([...DISPATCHED_EVENTS].sort()).toEqual(declared);
  });

  it("maps every event to a distinct handler prop", () => {
    for (const handlers of [
      ZITADEL_LOGIN_EVENT_HANDLERS,
      ZITADEL_LOGOUT_EVENT_HANDLERS,
      ZITADEL_SESSION_EVENT_HANDLERS,
    ]) {
      const names = Object.values(handlers);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
