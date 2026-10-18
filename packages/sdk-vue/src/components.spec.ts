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
  type ZitadelLoginConfig,
  type ZitadelLogoutConfig,
  type ZitadelSessionConfig,
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

  it("declares resumeFlowId as a prop and forwards it to the widget", () => {
    const { container } = render(ZitadelLogin, {
      props: { project, resumeFlowId: "flow_123" },
    });
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(Object.keys(ZitadelLogin.props)).toContain("resumeFlowId");
    expect(el!.resumeFlowId).toBe("flow_123");
  });

  it("reads a null resumeFlowId as no handle", () => {
    const { container } = render(ZitadelLogin, {
      props: { project, resumeFlowId: null },
    });
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.resumeFlowId).toBe("");
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

// Every config key set to a distinct value. `Required<…>` makes `tsc` fail here
// when a key is added to a config type, so a new key cannot skip this check.
const loginConfig: Required<ZitadelLoginConfig> = {
  project,
  projectId: "proj-parity",
  proxyPath: "/__parity",
  variant: "page",
  theme: "dark",
  suppressHeader: true,
  suppressPasswordToggle: true,
  purpose: "register",
  flowName: "parity-flow",
  postSignInUrl: "/parity-after-login",
  resumeFlowId: "flow_parity",
  locales: { en: { "identifier.title": "Parity" } },
  lang: "de",
};

const sessionConfig: Required<ZitadelSessionConfig> = {
  project,
  projectId: "proj-parity",
  proxyPath: "/__parity",
  postSignOutUrl: "/parity-after-sign-out",
  heading: "Parity heading",
  logoutLabel: "Parity sign out",
  variant: "page",
  theme: "dark",
  suppressHeader: true,
};

const logoutConfig: Required<ZitadelLogoutConfig> = {
  project,
  projectId: "proj-parity",
  proxyPath: "/__parity",
  postSignOutUrl: "/parity-after-sign-out",
  theme: "dark",
};

// The element's value for each key, so a key the wrapper drops shows up by name.
const elementValues = (el: object, config: object): Record<string, unknown> =>
  Object.fromEntries(Object.keys(config).map((key) => [key, (el as Record<string, unknown>)[key]]));

describe("wrapper config parity", () => {
  it("forwards every ZitadelLoginConfig key to <zitadel-login>", () => {
    const { container } = render(ZitadelLogin, { props: { ...loginConfig } });
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(elementValues(el!, loginConfig)).toEqual(loginConfig);
  });

  it("forwards every ZitadelSessionConfig key to <zitadel-session>", () => {
    const { container } = render(ZitadelSession, { props: { ...sessionConfig } });
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(elementValues(el!, sessionConfig)).toEqual(sessionConfig);
  });

  it("forwards every ZitadelLogoutConfig key to <zitadel-logout>", () => {
    const { container } = render(ZitadelLogout, { props: { ...logoutConfig } });
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(elementValues(el!, logoutConfig)).toEqual(logoutConfig);
  });
});
