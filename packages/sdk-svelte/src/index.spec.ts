// @vitest-environment jsdom
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { render } from "@testing-library/svelte";
import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENT_HANDLERS,
} from "@zitadel/sdk-core/types";
import { type Component, createRawSnippet } from "svelte";
import { describe, expect, it, vi } from "vitest";

import { businessLocales } from "./lib/index";
import ZitadelLogin from "./lib/ZitadelLogin.svelte";
import ZitadelLogout from "./lib/ZitadelLogout.svelte";
import ZitadelSession from "./lib/ZitadelSession.svelte";
import LogoutTemplate from "./__tests__/LogoutTemplate.svelte";

const project = { projectId: "proj-test", proxyPath: "/__nextgen" };

describe("ZitadelLogin", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(ZitadelLogin, {
      props: { project, purpose: "login" },
    });
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(ZitadelLogin, {
      props: { projectId: "proj-test", proxyPath: "/__nextgen" },
    });
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards locales and lang to the widget", () => {
    const locales = { en: { "identifier.title": "Welcome back" } };
    const { container } = render(ZitadelLogin, {
      props: { project, locales, lang: "de" },
    });
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.locales).toBe(locales);
    expect(el!.lang).toBe("de");
  });

  it.each(Object.entries(ZITADEL_LOGIN_EVENT_HANDLERS))(
    "forwards %s to its callback",
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(ZitadelLogin, {
        props: { project, [handlerProp]: spy },
      });
      const el = container.querySelector("zitadel-login");
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("exposes the underlying element via getElement()", () => {
    const { component, container } = render(ZitadelLogin, {
      props: { project, purpose: "login" },
    });
    const el = component.getElement();
    expect(el?.tagName.toLowerCase()).toBe("zitadel-login");
    expect(el).toBe(container.querySelector("zitadel-login"));
  });
});

describe("ZitadelLogout", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(ZitadelLogout, { props: { project } });
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(ZitadelLogout, {
      props: { projectId: "proj-test", proxyPath: "/__nextgen" },
    });
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it.each(Object.entries(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    "forwards %s to its callback",
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(ZitadelLogout, {
        props: { project, [handlerProp]: spy },
      });
      const el = container.querySelector("zitadel-logout");
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("exposes the underlying element via getElement()", () => {
    const { component, container } = render(ZitadelLogout, {
      props: { project },
    });
    const el = component.getElement();
    expect(el?.tagName.toLowerCase()).toBe("zitadel-logout");
    expect(el).toBe(container.querySelector("zitadel-logout"));
  });
});

describe("ZitadelSession", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(ZitadelSession, { props: { project } });
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(ZitadelSession, {
      props: { projectId: "proj-test", proxyPath: "/__nextgen" },
    });
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards the surface variant/theme", () => {
    const { container } = render(ZitadelSession, {
      props: { project, variant: "page", theme: "light", suppressHeader: true },
    });
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el!.variant).toBe("page");
    expect(el!.theme).toBe("light");
    expect(el!.suppressHeader).toBe(true);
  });

  it.each(Object.entries(ZITADEL_SESSION_EVENT_HANDLERS))(
    "forwards %s to its callback",
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(ZitadelSession, {
        props: { project, [handlerProp]: spy },
      });
      const el = container.querySelector("zitadel-session");
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("exposes the underlying element via getElement()", () => {
    const { component, container } = render(ZitadelSession, {
      props: { project },
    });
    const el = component.getElement();
    expect(el?.tagName.toLowerCase()).toBe("zitadel-session");
    expect(el).toBe(container.querySelector("zitadel-session"));
  });
});

describe("businessLocales", () => {
  it("re-exports the business copy overlay from @zitadel/components", () => {
    expect(businessLocales).toBe(componentsBusinessLocales);
  });
});

// The element's own defaults, which the wrappers must leave in place when a
// prop is unset and restore when a prop is cleared.
const LOGIN_DEFAULTS = {
  purpose: "login",
  variant: "widget",
  theme: "",
  lang: "",
  suppressHeader: false,
  resumeFlowId: "",
} as const;
const LOGIN_VALUES = {
  purpose: "register",
  variant: "page",
  theme: "light",
  lang: "de",
  suppressHeader: true,
  resumeFlowId: "flow_123",
} as const;
const SESSION_DEFAULTS = {
  heading: "Signed in as",
  logoutLabel: "Sign out",
  variant: "widget",
  theme: "",
  suppressHeader: false,
} as const;
const SESSION_VALUES = {
  heading: "Welcome",
  logoutLabel: "Leave",
  variant: "page",
  theme: "dark",
  suppressHeader: true,
} as const;

describe.each([
  ["ZitadelLogin", "zitadel-login", ZitadelLogin, LOGIN_DEFAULTS, LOGIN_VALUES],
  ["ZitadelSession", "zitadel-session", ZitadelSession, SESSION_DEFAULTS, SESSION_VALUES],
  ["ZitadelLogout", "zitadel-logout", ZitadelLogout, { theme: "" }, { theme: "dark" }],
] as const)("%s element defaults", (_name, tag, component, defaults, values) => {
  const prop = (el: Element, key: string) => (el as unknown as Record<string, unknown>)[key];
  const Component = component as unknown as Component<Record<string, unknown>>;

  it.each(Object.entries(defaults))("keeps %s at its default when unset", (key, fallback) => {
    const { container } = render(Component, { props: { project } });
    expect(prop(container.querySelector(tag)!, key)).toBe(fallback);
  });

  it.each(Object.entries(defaults))(
    "restores %s to its default when cleared",
    async (key, fallback) => {
      const given = (values as Record<string, unknown>)[key];
      const { container, rerender } = render(Component, { props: { project, [key]: given } });
      expect(prop(container.querySelector(tag)!, key)).toBe(given);

      await rerender({ [key]: undefined });

      expect(prop(container.querySelector(tag)!, key)).toBe(fallback);
    },
  );
});

describe("ZitadelSession children", () => {
  // `<zitadel-session>` has no slot, so content passed in would never render.
  it("puts no children into the element", () => {
    const children = createRawSnippet(() => ({ render: () => "<span>extra</span>" }));
    const { container } = render(ZitadelSession as unknown as Component<Record<string, unknown>>, {
      props: { project, children },
    });
    expect(container.querySelector("zitadel-session")?.childElementCount).toBe(0);
  });
});

describe.each([
  ["ZitadelLogout", "zitadel-logout", ZitadelLogout],
  ["ZitadelLogin", "zitadel-login", ZitadelLogin],
] as const)("%s children", (_name, tag, component) => {
  it("renders children into the element's light DOM", () => {
    const children = createRawSnippet(() => ({
      render: () => '<span slot="attribution-trailing">extra</span>',
    }));
    const { container } = render(component as unknown as Component<Record<string, unknown>>, {
      props: { project, children },
    });
    expect(container.querySelector(`${tag} > span[slot="attribution-trailing"]`)).not.toBeNull();
  });
});

describe("ZitadelLogout template children", () => {
  it("projects a <template> child as the sign-out control", async () => {
    const children = createRawSnippet(() => ({
      render: () => '<template><button data-action="logout">Bye</button></template>',
    }));
    const { container } = render(ZitadelLogout, { props: { project, children } });
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout")!;
    await el.updateComplete;
    expect(el.querySelector("span [data-action='logout']")?.textContent).toBe("Bye");
  });
});

/** The text a `<template>` carries, wherever the renderer put its children. */
function templateText(host: Element): string {
  const template = host.querySelector("template");
  return `${template?.content.textContent ?? ""}${template?.textContent ?? ""}`;
}

describe("ZitadelLogout template placeholders", () => {
  // Svelte reads `{{display}}` as an expression; `{'{{display}}'}` is the
  // escape the README documents, so the element receives the placeholder.
  it("reach the element verbatim from a string expression", () => {
    const { container } = render(LogoutTemplate, { props: { project } });
    expect(templateText(container.querySelector("zitadel-logout")!)).toContain(
      "Sign out {{display}}",
    );
  });
});
