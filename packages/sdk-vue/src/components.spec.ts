// @vitest-environment jsdom
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { render, waitFor } from "@testing-library/vue";
import { _resetConfigForTesting, configureZitadel } from "@zitadel/api/config";
import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENT_HANDLERS,
  type ZitadelLoginConfig,
  type ZitadelLogoutConfig,
  type ZitadelSessionConfig,
  type WidgetTag,
  type WidgetName,
  widgetTags,
} from "@zitadel/sdk-core/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h, nextTick, shallowRef, type Ref } from "vue";
import { renderToString } from "vue/server-renderer";

import ZitadelLogin from "./components/ZitadelLogin";
import ZitadelLogout from "./components/ZitadelLogout";
import ZitadelSession from "./components/ZitadelSession";
import { businessLocales } from "./index";

import {
  describeServerRenderCases,
  describeServerStandardAttributes,
} from "@zitadel/framework-contract/server-render";
import {
  type Attributes,
  cssProperties,
  describeStandardAttributes,
} from "@zitadel/framework-contract/standard-attributes";

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
const handle = {
  projectId: "proj-handle",
  proxyPath: "/__handle",
  url: "https://auth.example.com",
};

// The markup a server would send: the browser parses attributes only, so these
// are all the element has at upgrade, before hydration hands it any property.
async function serverRender(
  component: typeof ZitadelLogin | typeof ZitadelLogout | typeof ZitadelSession,
  props: Record<string, unknown>,
): Promise<Element> {
  const html = await renderToString(createSSRApp({ render: () => h(component, props) }));
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild!;
}

function widgetIn<Tag extends WidgetTag>(root: ParentNode, tag: Tag): HTMLElementTagNameMap[Tag] {
  const element = root.querySelector(tag);
  if (!element) throw new Error(`no <${tag}> was rendered`);
  return element;
}

describe("ZitadelLogin", () => {
  it("keeps the properties the client render assigns", () => {
    const { container } = render(ZitadelLogin, { props: { project: handle } });
    const el = widgetIn(container, widgetTags.login);
    expect(el!.project).toBe(handle);
  });

  it("binds the project handle as a property", () => {
    const { container } = render(ZitadelLogin, {
      props: { project, purpose: "login" },
    });
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(ZitadelLogin, {
      props: { projectId: "proj-test", proxyPath: "/__nextgen" },
    });
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("declares resumeFlowId as a prop and forwards it to the widget", () => {
    const { container } = render(ZitadelLogin, {
      props: { project, resumeFlowId: "flow_123" },
    });
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(Object.keys(ZitadelLogin.props)).toContain("resumeFlowId");
    expect(el!.resumeFlowId).toBe("flow_123");
  });

  it("reads a null resumeFlowId as no handle", () => {
    const { container } = render(ZitadelLogin, {
      props: { project, resumeFlowId: null },
    });
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(el!.resumeFlowId).toBe("");
  });

  it("forwards locales and lang to the widget", () => {
    const locales = { en: { "identifier.title": "Welcome back" } };
    const { container } = render(ZitadelLogin, {
      props: { project, locales, lang: "de" },
    });
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
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
      const el = container.querySelector(widgetTags.login);
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("exposes the rendered element via the instance ref", () => {
    const { captured, container } = mountWithInstanceRef(ZitadelLogin);
    const element = captured.value!.element;
    expect(element).not.toBeNull();
    expect(element!.tagName.toLowerCase()).toBe(widgetTags.login);
    expect(element).toBe(container.querySelector(widgetTags.login));
  });
});

describe("ZitadelLogout", () => {
  it("keeps the properties the client render assigns", () => {
    const { container } = render(ZitadelLogout, { props: { project: handle } });
    const el = widgetIn(container, widgetTags.logout);
    expect(el!.project).toBe(handle);
  });

  it("binds the project handle as a property", () => {
    const { container } = render(ZitadelLogout, { props: { project } });
    const el = container.querySelector<ZitadelLogoutElement>(widgetTags.logout);
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(ZitadelLogout, {
      props: { projectId: "proj-test", proxyPath: "/__nextgen" },
    });
    const el = container.querySelector<ZitadelLogoutElement>(widgetTags.logout);
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
      const el = container.querySelector(widgetTags.logout);
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("exposes the rendered element via the instance ref", () => {
    const { captured, container } = mountWithInstanceRef(ZitadelLogout);
    const element = captured.value!.element;
    expect(element).not.toBeNull();
    expect(element!.tagName.toLowerCase()).toBe(widgetTags.logout);
    expect(element).toBe(container.querySelector(widgetTags.logout));
  });
});

describe("ZitadelSession", () => {
  it("keeps the properties the client render assigns", () => {
    const { container } = render(ZitadelSession, { props: { project: handle } });
    const el = widgetIn(container, widgetTags.session);
    expect(el!.project).toBe(handle);
  });

  it("binds the project handle as a property", () => {
    const { container } = render(ZitadelSession, { props: { project } });
    const el = container.querySelector<ZitadelSessionElement>(widgetTags.session);
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(ZitadelSession, {
      props: { projectId: "proj-test", proxyPath: "/__nextgen" },
    });
    const el = container.querySelector<ZitadelSessionElement>(widgetTags.session);
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards the surface variant/theme", () => {
    const { container } = render(ZitadelSession, {
      props: { project, variant: "page", theme: "light", suppressHeader: true },
    });
    const el = container.querySelector<ZitadelSessionElement>(widgetTags.session);
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
      const el = container.querySelector(widgetTags.session);
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("exposes the rendered element via the instance ref", () => {
    const { captured, container } = mountWithInstanceRef(ZitadelSession);
    const element = captured.value!.element;
    expect(element).not.toBeNull();
    expect(element!.tagName.toLowerCase()).toBe(widgetTags.session);
    expect(element).toBe(container.querySelector(widgetTags.session));
  });
});

describe("hydrating a server-rendered login", () => {
  afterEach(() => {
    _resetConfigForTesting();
    vi.restoreAllMocks();
  });

  it("starts its first flow with the purpose the server rendered", async () => {
    const globalProject = configureZitadel({
      projectId: "proj-global",
      proxyPath: "https://flow.test.invalid",
    });
    const fetched = vi.spyOn(globalThis, "fetch");
    const app = () =>
      createSSRApp({
        render: () => h(ZitadelLogin, { project: globalProject, purpose: "register" }),
      });
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = await renderToString(app());

    app().mount(host);

    await waitFor(() => expect(fetched).toHaveBeenCalled());
    const bodies = await Promise.all(
      fetched.mock.calls.map(async ([input, init]) =>
        JSON.parse(
          String(init?.body ?? (input instanceof Request ? await input.clone().text() : "null")),
        ),
      ),
    );
    const created = bodies.filter((body) => body?.project_id);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ purpose: "register" });
    host.remove();
  });

  it("loads the supplied flow on its first request instead of creating one", async () => {
    const globalProject = configureZitadel({
      projectId: "proj-global",
      proxyPath: "https://flow.test.invalid",
    });
    const fetched = vi.spyOn(globalThis, "fetch");
    const app = () =>
      createSSRApp({
        render: () => h(ZitadelLogin, { project: globalProject, resumeFlowId: "flow_123" }),
      });
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = await renderToString(app());
    const rendered = host.querySelector(widgetTags.login);
    expect(rendered?.getAttribute("resume-flow-id")).toBe("flow_123");
    const firstStep = new Promise((resolve) =>
      rendered?.addEventListener("zitadel-flow-step", resolve, { once: true }),
    );

    app().mount(host);

    await waitFor(() => expect(fetched).toHaveBeenCalled());
    const first = new Request(fetched.mock.calls[0]![0], fetched.mock.calls[0]![1]);
    expect(first.method).toBe("GET");
    expect(first.url).toContain("flow_123");
    expect(host.querySelector(widgetTags.login)).toBe(rendered);
    await firstStep;
    await rendered?.updateComplete;
    await Promise.all(fetched.mock.results.map((result) => result.value));
    expect(fetched).toHaveBeenCalledTimes(1);
    host.remove();
  });
});

describe("businessLocales", () => {
  it("re-exports the business copy overlay from @zitadel/components", () => {
    expect(businessLocales).toBe(componentsBusinessLocales);
  });
});

// Assigning `undefined` to a custom-element property overwrites its default,
// so an unset prop must leave the element's own default in place.
describe("unset props keep the element's defaults", () => {
  it.each([
    ["heading", "Signed in as"],
    ["logoutLabel", "Sign out"],
    ["variant", "widget"],
    ["theme", ""],
    ["suppressHeader", false],
  ] as const)("ZitadelSession keeps the default %s", (prop, expected) => {
    const { container } = render(ZitadelSession, { props: { project } });

    expect(widgetIn(container, widgetTags.session)[prop]).toBe(expected);
  });

  it.each([
    ["variant", "widget"],
    ["theme", ""],
    ["suppressHeader", false],
    ["lang", ""],
    ["suppressPasswordToggle", false],
  ] as const)("ZitadelLogin keeps the default %s", (prop, expected) => {
    const { container } = render(ZitadelLogin, { props: { project } });

    expect(widgetIn(container, widgetTags.login)[prop]).toBe(expected);
  });

  it("ZitadelLogout keeps the default theme", () => {
    const { container } = render(ZitadelLogout, { props: { project } });

    expect(widgetIn(container, widgetTags.logout).theme).toBe("");
  });
});

describe("props that become unset restore the element's defaults", () => {
  it.each([
    ["heading", "Custom", "Signed in as"],
    ["logoutLabel", "Leave", "Sign out"],
    ["variant", "page", "widget"],
    ["theme", "light", ""],
    ["suppressHeader", true, false],
  ] as const)("ZitadelSession restores the default %s", async (prop, given, expected) => {
    const { container, rerender } = render(ZitadelSession, { props: { project, [prop]: given } });
    const el = widgetIn(container, widgetTags.session);
    expect(el[prop]).toBe(given);

    await rerender({ [prop]: undefined });

    expect(el[prop]).toBe(expected);
  });

  it.each([
    ["variant", "page", "widget"],
    ["theme", "light", ""],
    ["suppressHeader", true, false],
    ["lang", "de", ""],
    ["suppressPasswordToggle", true, false],
  ] as const)("ZitadelLogin restores the default %s", async (prop, given, expected) => {
    const { container, rerender } = render(ZitadelLogin, { props: { project, [prop]: given } });
    const el = widgetIn(container, widgetTags.login);
    expect(el[prop]).toBe(given);

    await rerender({ [prop]: undefined });

    expect(el[prop]).toBe(expected);
  });

  it("ZitadelLogout restores the default theme", async () => {
    const { container, rerender } = render(ZitadelLogout, { props: { project, theme: "light" } });
    const el = widgetIn(container, widgetTags.logout);
    expect(el.theme).toBe("light");

    await rerender({ theme: undefined });

    expect(el.theme).toBe("");
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
  forcePostSignInUrl: true,
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
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    // Vue forwards an undeclared key to the root as an attribute, so a dropped prop declaration alone would not fail.
    expect(Object.keys(ZitadelLogin.props)).toEqual(
      expect.arrayContaining(Object.keys(loginConfig)),
    );
    expect(elementValues(el!, loginConfig)).toEqual(loginConfig);
  });

  it("forwards every ZitadelSessionConfig key to <zitadel-session>", () => {
    const { container } = render(ZitadelSession, { props: { ...sessionConfig } });
    const el = container.querySelector<ZitadelSessionElement>(widgetTags.session);
    // Vue forwards an undeclared key to the root as an attribute, so a dropped prop declaration alone would not fail.
    expect(Object.keys(ZitadelSession.props)).toEqual(
      expect.arrayContaining(Object.keys(sessionConfig)),
    );
    expect(elementValues(el!, sessionConfig)).toEqual(sessionConfig);
  });

  it("forwards every ZitadelLogoutConfig key to <zitadel-logout>", () => {
    const { container } = render(ZitadelLogout, { props: { ...logoutConfig } });
    const el = container.querySelector<ZitadelLogoutElement>(widgetTags.logout);
    // Vue forwards an undeclared key to the root as an attribute, so a dropped prop declaration alone would not fail.
    expect(Object.keys(ZitadelLogout.props)).toEqual(
      expect.arrayContaining(Object.keys(logoutConfig)),
    );
    expect(elementValues(el!, logoutConfig)).toEqual(logoutConfig);
  });
});

const SDK = "vue";

/** The attributes on the widget's element in the markup a server would send. */
async function renderAttributes(
  widget: "login" | "session" | "logout",
  props: Readonly<Record<string, unknown>>,
): Promise<Record<string, string>> {
  const component = { login: ZitadelLogin, session: ZitadelSession, logout: ZitadelLogout }[widget];
  const el = await serverRender(component, { ...props });
  return Object.fromEntries(el.getAttributeNames().map((n) => [n, el.getAttribute(n) ?? ""]));
}

describeServerRenderCases(SDK, renderAttributes);

// Vue's server renderer only strips the `^` force-attribute prefix from 3.5.27,
// and the peer range reaches back to 3.2, so the wrappers must not emit it
// where there is no DOM. The jsdom environment defines `document`, so remove it
// for the render to stand in for a server runtime.
describe("server-rendered markup carries no force-attribute prefix", () => {
  it.each([
    [
      "ZitadelLogin",
      ZitadelLogin,
      { project, variant: "page", theme: "dark", lang: "de" },
      ['variant="page"', 'theme="dark"', 'lang="de"'],
    ],
    ["ZitadelLogout", ZitadelLogout, { project, theme: "dark" }, ['theme="dark"']],
    [
      "ZitadelSession",
      ZitadelSession,
      { project, variant: "page", theme: "dark", heading: "Hi", logoutLabel: "Bye" },
      ['variant="page"', 'theme="dark"', 'heading="Hi"', 'logout-label="Bye"'],
    ],
  ] as const)("%s", async (_name, component, props, expected) => {
    vi.stubGlobal("document", undefined);
    const html = await renderToString(
      createSSRApp({ render: () => h(component as typeof ZitadelLogin, props) }),
    );
    vi.unstubAllGlobals();

    for (const attribute of expected) expect(html).toContain(attribute);
    expect(html).not.toContain("^");
  });

  // The installed Vue may already strip the prefix, which would hide a wrapper
  // that still emits it, so also check the keys the wrapper hands to Vue.
  it.each([
    ["ZitadelLogin", ZitadelLogin, { project, variant: "page", theme: "dark", lang: "de" }],
    ["ZitadelLogout", ZitadelLogout, { project, theme: "dark" }],
    [
      "ZitadelSession",
      ZitadelSession,
      { project, variant: "page", theme: "dark", heading: "Hi", logoutLabel: "Bye" },
    ],
  ] as const)("%s binds no key with the prefix without a DOM", (_name, component, props) => {
    vi.stubGlobal("document", undefined);
    const renderFn = (
      component as unknown as {
        setup: (p: unknown, ctx: unknown) => () => { props: Record<string, unknown> };
      }
    ).setup(props, { attrs: {}, emit: () => {}, expose: () => {} });
    const keys = Object.keys(renderFn().props);
    vi.unstubAllGlobals();

    expect(keys.filter((key) => key.startsWith("^"))).toEqual([]);
    expect(keys).toContain(_name === "ZitadelLogout" ? "theme" : "variant");
  });

  it("keeps the prefix where there is a DOM so an unset prop is removed, not blanked", () => {
    const renderFn = (
      ZitadelLogin as unknown as {
        setup: (p: unknown, ctx: unknown) => () => { props: Record<string, unknown> };
      }
    ).setup({ project }, { attrs: {}, emit: () => {}, expose: () => {} });

    expect(Object.keys(renderFn().props)).toEqual(
      expect.arrayContaining(["^lang", "^variant", "^theme"]),
    );
  });
});

type ForwardedAttributes = {
  class: string;
  style: string;
  id: string;
  title: string;
  slot: string;
  hidden: boolean;
  role: "region";
  tabindex: number;
  "aria-label": string;
};

type WidgetProps = {
  login: InstanceType<typeof ZitadelLogin>["$props"];
  logout: InstanceType<typeof ZitadelLogout>["$props"];
  session: InstanceType<typeof ZitadelSession>["$props"];
};

const staleOnRemoval: readonly string[] = [];

// Mounts a widget with the given attributes (named as the markup names them) and
// reaches its element through a `ref` on the component, the way a consumer does.
// `update` renders it again with other attributes.
async function mountWidget(widget: WidgetName, attributes: Attributes) {
  const Widget = { login: ZitadelLogin, logout: ZitadelLogout, session: ZitadelSession }[widget];
  const current = shallowRef(attributes);
  const captured = shallowRef<{ element: HTMLElement | null } | null>(null);
  const parent = defineComponent({
    setup: () => () => {
      const { style, ...rest } = current.value;
      return h(Widget, {
        ...rest,
        ...(typeof style === "string" ? { style: cssProperties(style) } : {}),
        ref: captured,
      });
    },
  });
  const { container } = render(parent);
  return {
    container,
    ref: () => captured.value?.element,
    update: async (next: Attributes) => {
      current.value = next;
      await nextTick();
    },
  };
}

describeStandardAttributes<ForwardedAttributes, WidgetProps>({
  mountWidget,
  staleOnRemoval,
  accepted: true,
  rejected: true,
});

describeServerStandardAttributes(renderAttributes);
