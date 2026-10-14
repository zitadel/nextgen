// @vitest-environment jsdom
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { render } from "@testing-library/vue";
import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENT_HANDLERS,
} from "@zitadel/sdk-core/types";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, shallowRef, type Ref } from "vue";

import ZitadelLogin from "./components/ZitadelLogin";
import ZitadelLogout from "./components/ZitadelLogout";
import ZitadelSession from "./components/ZitadelSession";
import { businessLocales } from "./index";

// A consumer's `ref` on these components resolves to the component instance,
// whose `expose({ element })` surfaces the inner DOM node. Vue's exposed proxy
// auto-unwraps the exposed `Ref`, so the consumer reads the element directly as
// `r.value.element`. Mount the component under a parent that holds such a ref
// and forward the captured instance out, mirroring that consumer access.
function mountWithInstanceRef(
  child: typeof ZitadelLogin | typeof ZitadelLogout | typeof ZitadelSession,
): {
  captured: Ref<{ element: HTMLElement | null } | null>;
  container: Element;
} {
  const captured = shallowRef<{ element: HTMLElement | null } | null>(null);
  const parent = defineComponent({
    setup: () => () => h(child, { ref: captured }),
  });
  const { container } = render(parent);
  return { captured, container };
}

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
    // `toRaw` hands the widget the plain dictionaries, not Vue's proxy.
    expect(el!.locales).toEqual(locales);
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

  it("exposes the rendered element via the instance ref", () => {
    const { captured, container } = mountWithInstanceRef(ZitadelLogin);
    const element = captured.value!.element;
    expect(element).not.toBeNull();
    expect(element!.tagName.toLowerCase()).toBe("zitadel-login");
    expect(element).toBe(container.querySelector("zitadel-login"));
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

  it("exposes the rendered element via the instance ref", () => {
    const { captured, container } = mountWithInstanceRef(ZitadelLogout);
    const element = captured.value!.element;
    expect(element).not.toBeNull();
    expect(element!.tagName.toLowerCase()).toBe("zitadel-logout");
    expect(element).toBe(container.querySelector("zitadel-logout"));
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

  it("exposes the rendered element via the instance ref", () => {
    const { captured, container } = mountWithInstanceRef(ZitadelSession);
    const element = captured.value!.element;
    expect(element).not.toBeNull();
    expect(element!.tagName.toLowerCase()).toBe("zitadel-session");
    expect(element).toBe(container.querySelector("zitadel-session"));
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
} as const;
const LOGIN_VALUES = {
  purpose: "register",
  variant: "page",
  theme: "light",
  lang: "de",
  suppressHeader: true,
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

  it.each(Object.entries(defaults))("keeps %s at its default when unset", (key, fallback) => {
    const { container } = render(component, { props: { project } });
    expect(prop(container.querySelector(tag)!, key)).toBe(fallback);
  });

  it.each(Object.entries(defaults))(
    "restores %s to its default when cleared",
    async (key, fallback) => {
      const given = (values as Record<string, unknown>)[key];
      const { container, rerender } = render(component, { props: { project, [key]: given } });
      expect(prop(container.querySelector(tag)!, key)).toBe(given);

      await rerender({ project, [key]: undefined });

      expect(prop(container.querySelector(tag)!, key)).toBe(fallback);
    },
  );
});

describe.each([
  ["ZitadelLogout", "zitadel-logout", ZitadelLogout],
  ["ZitadelSession", "zitadel-session", ZitadelSession],
  ["ZitadelLogin", "zitadel-login", ZitadelLogin],
] as const)("%s slot content", (_name, tag, component) => {
  it("renders the default slot into the element's light DOM", () => {
    const { container } = render(component, {
      props: { project },
      slots: { default: () => h("span", { slot: "attribution-trailing" }, "extra") },
    });
    expect(container.querySelector(`${tag} > span[slot="attribution-trailing"]`)).not.toBeNull();
  });
});

describe("ZitadelLogout template slot", () => {
  it("projects a <template> child as the sign-out control", async () => {
    const { container } = render(ZitadelLogout, {
      props: { project },
      slots: {
        default: () => h("template", [h("button", { "data-action": "logout" }, "Bye")]),
      },
    });
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
  // Vue claims `{{display}}` as its own interpolation; `v-pre` is the escape
  // the README documents, so the element receives the literal placeholder.
  it("reach the element verbatim from a v-pre template", () => {
    const { container } = render(
      defineComponent({
        components: { ZitadelLogout },
        setup: () => ({ project }),
        template: `
          <ZitadelLogout :project="project">
            <template v-pre><button data-action="logout">Sign out {{display}}</button></template>
          </ZitadelLogout>
        `,
      }),
    );
    expect(templateText(container.querySelector("zitadel-logout")!)).toContain(
      "Sign out {{display}}",
    );
  });
});
