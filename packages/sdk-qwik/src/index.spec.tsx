import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { $, render, type Signal } from "@qwik.dev/core";
import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENT_HANDLERS,
} from "@zitadel/sdk-core/types";
import { describe, expect, it } from "vitest";

import { businessLocales, ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";

const project = { projectId: "proj-test", proxyPath: "/__nextgen" };

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Renders a widget into a fresh host attached to the document. Qwik 2's client
 * `render` finds its container via a `[q:container]` attribute selector that a
 * jsdom/domino selector engine cannot match — and the widgets wrap real Lit
 * custom elements that only upgrade in a real DOM — so this suite runs in a
 * browser (see vitest.config.ts) where `render`, element upgrade, and native
 * events all behave as in production. Returns the mounted host.
 */
async function renderWidget(jsx: Parameters<typeof render>[1]): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await render(host, jsx);
  return host;
}

/**
 * Qwik wires the widget's listeners in a `useVisibleTask$` that runs a turn
 * after `render` (eager `document-ready` strategy), so a single fixed delay
 * races the attachment. Instead, re-dispatch the event each turn until the
 * forwarded callback receives this exact `detail`, polling up to a generous
 * deadline. CustomEvents do not replay, so dispatching only after the listener
 * exists is essential — re-dispatching makes that deterministic without guessing
 * the timing. Matching by identity (not "something arrived") keeps the check
 * robust when the live widget emits its own event of the same name — e.g. the
 * `zitadel-flow-step` it fires when the mock API answers — alongside our probe.
 */
async function dispatchUntilForwarded(
  el: Element,
  eventName: string,
  detail: Record<string, unknown>,
  received: readonly Record<string, unknown>[],
): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!received.includes(detail)) {
    el.dispatchEvent(new CustomEvent(eventName, { detail }));
    if (received.includes(detail)) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`listener for "${eventName}" never forwarded within 1000ms`);
    }
    await macrotask();
  }
}

describe("ZitadelLogin", () => {
  it("binds the project handle as a property", async () => {
    const host = await renderWidget(<ZitadelLogin project={project} purpose="login" />);
    const el = host.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", async () => {
    const host = await renderWidget(<ZitadelLogin projectId="proj-test" proxyPath="/__nextgen" />);
    const el = host.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards locales and lang to the widget", async () => {
    const locales = { en: { "identifier.title": "Welcome back" } };
    const host = await renderWidget(<ZitadelLogin project={project} locales={locales} lang="de" />);
    const el = host.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.locales).toEqual(locales);
    expect(el!.lang).toBe("de");
  });

  it.each(Object.entries(ZITADEL_LOGIN_EVENT_HANDLERS))(
    "forwards %s to its callback",
    async (eventName, handlerProp) => {
      const received: Record<string, unknown>[] = [];
      const host = await renderWidget(
        <ZitadelLogin
          project={project}
          {...{
            [`${handlerProp}$`]: $((detail: Record<string, unknown>) => {
              received.push(detail);
            }),
          }}
        />,
      );
      const el = host.querySelector("zitadel-login");
      expect(el).not.toBeNull();
      const detail = { probe: eventName };
      await dispatchUntilForwarded(el!, eventName, detail, received);
      expect(received).toContain(detail);
    },
  );

  it("populates a consumer ref with the underlying element", async () => {
    const consumerRef = { value: undefined } as Signal<ZitadelLoginElement | undefined>;
    const host = await renderWidget(<ZitadelLogin project={project} ref={consumerRef} />);
    await macrotask();
    const el = host.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el).not.toBeNull();
    expect(consumerRef.value).toBe(el);
    expect(consumerRef.value?.tagName.toLowerCase()).toBe("zitadel-login");
  });
});

describe("ZitadelLogout", () => {
  it("binds the project handle as a property", async () => {
    const host = await renderWidget(<ZitadelLogout project={project} />);
    const el = host.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", async () => {
    const host = await renderWidget(<ZitadelLogout projectId="proj-test" proxyPath="/__nextgen" />);
    const el = host.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it.each(Object.entries(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    "forwards %s to its callback",
    async (eventName, handlerProp) => {
      const received: Record<string, unknown>[] = [];
      const host = await renderWidget(
        <ZitadelLogout
          project={project}
          {...{
            [`${handlerProp}$`]: $((detail: Record<string, unknown>) => {
              received.push(detail);
            }),
          }}
        />,
      );
      const el = host.querySelector("zitadel-logout");
      expect(el).not.toBeNull();
      const detail = { probe: eventName };
      await dispatchUntilForwarded(el!, eventName, detail, received);
      expect(received).toContain(detail);
    },
  );

  it("populates a consumer ref with the underlying element", async () => {
    const consumerRef = { value: undefined } as Signal<ZitadelLogoutElement | undefined>;
    const host = await renderWidget(<ZitadelLogout project={project} ref={consumerRef} />);
    await macrotask();
    const el = host.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el).not.toBeNull();
    expect(consumerRef.value).toBe(el);
    expect(consumerRef.value?.tagName.toLowerCase()).toBe("zitadel-logout");
  });
});

describe("ZitadelSession", () => {
  it("binds the project handle as a property", async () => {
    const host = await renderWidget(<ZitadelSession project={project} />);
    const el = host.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", async () => {
    const host = await renderWidget(
      <ZitadelSession projectId="proj-test" proxyPath="/__nextgen" />,
    );
    const el = host.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards the surface variant/theme", async () => {
    const host = await renderWidget(
      <ZitadelSession project={project} variant="page" theme="light" suppressHeader={true} />,
    );
    const el = host.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el!.variant).toBe("page");
    expect(el!.theme).toBe("light");
    expect(el!.suppressHeader).toBe(true);
  });

  it.each(Object.entries(ZITADEL_SESSION_EVENT_HANDLERS))(
    "forwards %s to its callback",
    async (eventName, handlerProp) => {
      const received: Record<string, unknown>[] = [];
      const host = await renderWidget(
        <ZitadelSession
          project={project}
          {...{
            [`${handlerProp}$`]: $((detail: Record<string, unknown>) => {
              received.push(detail);
            }),
          }}
        />,
      );
      const el = host.querySelector("zitadel-session");
      expect(el).not.toBeNull();
      const detail = { probe: eventName };
      await dispatchUntilForwarded(el!, eventName, detail, received);
      expect(received).toContain(detail);
    },
  );

  it("populates a consumer ref with the underlying element", async () => {
    const consumerRef = { value: undefined } as Signal<ZitadelSessionElement | undefined>;
    const host = await renderWidget(<ZitadelSession project={project} ref={consumerRef} />);
    await macrotask();
    const el = host.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el).not.toBeNull();
    expect(consumerRef.value).toBe(el);
    expect(consumerRef.value?.tagName.toLowerCase()).toBe("zitadel-session");
  });
});

describe("businessLocales", () => {
  it("re-exports the business copy overlay from @zitadel/components", () => {
    expect(businessLocales).toBe(componentsBusinessLocales);
  });
});
