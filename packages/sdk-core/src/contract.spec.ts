// @vitest-environment jsdom
import { ZitadelLogin, ZitadelLogout, ZitadelSession } from "@zitadel/components";
import { DISPATCHED_EVENTS } from "@zitadel/components/events";
import { describe, expect, it } from "vitest";

import { WIDGET_ATTRIBUTES } from "./attributes.js";
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

/**
 * The element↔config drift guard for properties.
 *
 * The SPA SDK wrappers take their props from the config types in `types.ts`,
 * while the elements' real public properties are the Lit reactive properties
 * in `@zitadel/components`. Nothing tied the two together, so a property added
 * to an element (`resumeFlowId`) was silently missing from every wrapper. This
 * lives here, not in `@zitadel/components`, because the dependency points this
 * way: `sdk-core` already depends on the components (for the event guard
 * above) and the components never import `sdk-core`.
 *
 * A key added to or removed from a config type fails `tsc` until the rules in
 * `attributes.ts` are updated, and the runtime tests then compare the rules
 * with the element's `elementProperties`. A public element property
 * that is not a config key must be listed in `*_ELEMENT_ONLY` with a reason.
 */

/** The config keys of a widget: its attribute rules, less the handle-only `url`. */
function configKeys(widget: keyof typeof WIDGET_ATTRIBUTES): Record<string, true> {
  return Object.fromEntries(
    Object.keys(WIDGET_ATTRIBUTES[widget])
      .filter((key) => key !== "url")
      .map((key) => [key, true]),
  );
}

const URL_REASON =
  "declarative full backend URL for plain HTML pages; SPA wrappers configure the backend through project or proxyPath";

const LOGIN_ELEMENT_ONLY: Record<string, string> = {
  url: URL_REASON,
  previewState: "operator preview mode, not part of the shared login config",
  previewSuccessStep: "operator preview mode, not part of the shared login config",
};

const SESSION_ELEMENT_ONLY: Record<string, string> = { url: URL_REASON };

const LOGOUT_ELEMENT_ONLY: Record<string, string> = { url: URL_REASON };

type Declaration = { state?: boolean };
type ElementCtor = (typeof ZitadelLogin | typeof ZitadelSession | typeof ZitadelLogout) & {
  elementProperties: Map<PropertyKey, Declaration>;
};

/** Public reactive property names of an element (`@state` ones are internal). */
function publicProperties(ctor: ElementCtor, tag: string): string[] {
  // Force Lit finalization so `elementProperties` is fully populated.
  document.createElement(tag);
  const names: string[] = [];
  for (const [prop, decl] of ctor.elementProperties) {
    if (!decl.state) names.push(String(prop));
  }
  return names;
}

describe("config types ↔ element properties", () => {
  describe.each([
    ["zitadel-login", ZitadelLogin, "login", LOGIN_ELEMENT_ONLY],
    ["zitadel-session", ZitadelSession, "session", SESSION_ELEMENT_ONLY],
    ["zitadel-logout", ZitadelLogout, "logout", LOGOUT_ELEMENT_ONLY],
  ] as const)("<%s>", (tag, ctor, widget, elementOnly) => {
    const keys = configKeys(widget);
    const properties = publicProperties(ctor as ElementCtor, tag);

    it("has public properties to compare", () => {
      expect(properties.length).toBeGreaterThan(0);
    });

    it("represents every public property as a config key or a justified exclusion", () => {
      const unaccounted = properties.filter((name) => !(name in keys) && !(name in elementOnly));
      expect(unaccounted).toEqual([]);
    });

    it("backs every config key with an element property", () => {
      const missing = Object.keys(keys).filter((key) => !properties.includes(key));
      expect(missing).toEqual([]);
    });

    it("lists only real element properties that are not config keys as exclusions", () => {
      const stale = Object.keys(elementOnly).filter(
        (name) => !properties.includes(name) || name in keys,
      );
      expect(stale).toEqual([]);
    });

    it("writes every attribute under a name the element observes", () => {
      document.createElement(tag);
      const observed = (ctor as unknown as { observedAttributes: string[] }).observedAttributes;
      const written = Object.values(WIDGET_ATTRIBUTES[widget]).flatMap((rule) =>
        rule ? [rule.attribute] : [],
      );
      expect(written.filter((name) => !observed.includes(name))).toEqual([]);
    });

    it("gives every exclusion a reason", () => {
      for (const [name, reason] of Object.entries(elementOnly)) {
        expect(reason.trim(), `reason for ${name}`).not.toBe("");
      }
    });
  });
});
