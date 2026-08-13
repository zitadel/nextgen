// @vitest-environment jsdom
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { $, render, type Signal } from "@builder.io/qwik";
import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENT_HANDLERS,
} from "@zitadel/sdk-core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { businessLocales, ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";

const project = { projectId: "proj-test", proxyPath: "/__nextgen" };

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Qwik wires the widget's listeners in a `useVisibleTask$` that runs a turn
 * after `render` (eager `document-ready` strategy), so a single fixed delay
 * races the attachment. Instead, re-dispatch the event each turn until the
 * forwarded callback fires, polling up to a generous deadline. CustomEvents do
 * not replay, so dispatching only after the listener exists is essential —
 * re-dispatching makes that deterministic without guessing the timing. Returns
 * the detail the callback received (the listener forwards `event.detail`).
 */
async function dispatchUntilForwarded(
  el: Element,
  eventName: string,
  detail: Record<string, unknown>,
  received: readonly Record<string, unknown>[],
): Promise<void> {
  const deadline = Date.now() + 1000;
  while (received.length === 0) {
    el.dispatchEvent(new CustomEvent(eventName, { detail }));
    if (received.length > 0) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`listener for "${eventName}" never forwarded within 1000ms`);
    }
    await macrotask();
  }
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("no network"))),
  );
});

describe("ZitadelLogin", () => {
  it("binds the project handle as a property", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await render(host, <ZitadelLogin project={project} purpose="login" />);
    const el = host.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await render(host, <ZitadelLogin projectId="proj-test" proxyPath="/__nextgen" />);
    const el = host.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards locales and lang to the widget", async () => {
    const locales = { en: { "identifier.title": "Welcome back" } };
    const host = document.createElement("div");
    document.body.appendChild(host);
    await render(host, <ZitadelLogin project={project} locales={locales} lang="de" />);
    const el = host.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.locales).toEqual(locales);
    expect(el!.lang).toBe("de");
  });

  it.each(Object.entries(ZITADEL_LOGIN_EVENT_HANDLERS))(
    "forwards %s to its callback",
    async (eventName, handlerProp) => {
      const received: Record<string, unknown>[] = [];
      const host = document.createElement("div");
      document.body.appendChild(host);
      await render(
        host,
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
      expect(received[received.length - 1]).toBe(detail);
    },
  );

  it("populates a consumer ref with the underlying element", async () => {
    const consumerRef = { value: undefined } as Signal<ZitadelLoginElement | undefined>;
    const host = document.createElement("div");
    document.body.appendChild(host);
    await render(host, <ZitadelLogin project={project} ref={consumerRef} />);
    await macrotask();
    const el = host.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el).not.toBeNull();
    expect(consumerRef.value).toBe(el);
    expect(consumerRef.value?.tagName.toLowerCase()).toBe("zitadel-login");
  });
});

describe("ZitadelLogout", () => {
  it("binds the project handle as a property", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await render(host, <ZitadelLogout project={project} />);
    const el = host.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await render(host, <ZitadelLogout projectId="proj-test" proxyPath="/__nextgen" />);
    const el = host.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it.each(Object.entries(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    "forwards %s to its callback",
    async (eventName, handlerProp) => {
      const received: Record<string, unknown>[] = [];
      const host = document.createElement("div");
      document.body.appendChild(host);
      await render(
        host,
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
      expect(received[received.length - 1]).toBe(detail);
    },
  );

  it("populates a consumer ref with the underlying element", async () => {
    const consumerRef = { value: undefined } as Signal<ZitadelLogoutElement | undefined>;
    const host = document.createElement("div");
    document.body.appendChild(host);
    await render(host, <ZitadelLogout project={project} ref={consumerRef} />);
    await macrotask();
    const el = host.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el).not.toBeNull();
    expect(consumerRef.value).toBe(el);
    expect(consumerRef.value?.tagName.toLowerCase()).toBe("zitadel-logout");
  });
});

describe("ZitadelSession", () => {
  it("binds the project handle as a property", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await render(host, <ZitadelSession project={project} />);
    const el = host.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await render(host, <ZitadelSession projectId="proj-test" proxyPath="/__nextgen" />);
    const el = host.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards the surface variant/theme", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await render(
      host,
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
      const host = document.createElement("div");
      document.body.appendChild(host);
      await render(
        host,
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
      expect(received[received.length - 1]).toBe(detail);
    },
  );

  it("populates a consumer ref with the underlying element", async () => {
    const consumerRef = { value: undefined } as Signal<ZitadelSessionElement | undefined>;
    const host = document.createElement("div");
    document.body.appendChild(host);
    await render(host, <ZitadelSession project={project} ref={consumerRef} />);
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
