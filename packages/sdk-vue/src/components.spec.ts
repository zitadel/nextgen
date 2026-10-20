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
  widgetNames,
  widgetTags,
} from "@zitadel/sdk-core/types";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createSSRApp, defineComponent, h, nextTick, shallowRef, type Ref } from "vue";
import { renderToString } from "vue/server-renderer";

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

// server-render-cases:begin
// These cases are copied verbatim into every SDK spec that writes widget
// attributes into markup (see the drift check in sdk-core's contract.spec.ts).
// Each spec supplies its own `renderAttributes`; only that function differs.
type ServerRenderCase = {
  readonly title: string;
  readonly widget: "login" | "session" | "logout";
  readonly props: Readonly<Record<string, unknown>>;
  readonly present: Readonly<Record<string, string>>;
  readonly absent: readonly string[];
  /** SDKs whose markup does not do this yet: not covered, so the row is not run there. */
  readonly gaps?: readonly string[];
};

const SERVER_RENDER_HANDLE = {
  projectId: "proj-handle",
  proxyPath: "/__handle",
  url: "https://auth.example.com",
};

const SERVER_RENDER_CASES: readonly ServerRenderCase[] = [
  {
    title: "puts the discrete project props into the login markup",
    widget: "login",
    props: { projectId: "p1", proxyPath: "/px" },
    present: { "project-id": "p1", "proxy-path": "/px" },
    absent: ["url"],
  },
  {
    title: "puts the project handle into the login markup",
    widget: "login",
    props: { project: SERVER_RENDER_HANDLE },
    present: {
      "project-id": "proj-handle",
      "proxy-path": "/__handle",
      url: "https://auth.example.com",
    },
    absent: [],
    gaps: ["svelte"],
  },
  {
    title: "lets the project handle win over conflicting discrete props in the login markup",
    widget: "login",
    props: { project: SERVER_RENDER_HANDLE, projectId: "proj-other", proxyPath: "/__other" },
    present: { "project-id": "proj-handle", "proxy-path": "/__handle" },
    absent: [],
    gaps: ["svelte"],
  },
  {
    title: "writes nothing for no config in the login markup",
    widget: "login",
    props: {},
    present: {},
    absent: ["project-id", "proxy-path", "url", "flow-name", "resume-flow-id", "post-sign-in-url"],
  },
  {
    title: "puts the purpose into the login markup",
    widget: "login",
    props: { projectId: "p1", purpose: "register" },
    present: { purpose: "register" },
    absent: [],
    gaps: ["svelte"],
  },
  {
    title: "puts the default purpose into the login markup",
    widget: "login",
    props: { projectId: "p1" },
    present: { purpose: "login" },
    absent: [],
    gaps: ["svelte"],
  },
  {
    title: "puts the flow name into the login markup",
    widget: "login",
    props: { projectId: "p1", flowName: "signup" },
    present: { "flow-name": "signup" },
    absent: [],
  },
  {
    title: "puts the resume flow id into the login markup",
    widget: "login",
    props: { projectId: "p1", resumeFlowId: "flow_123" },
    present: { "resume-flow-id": "flow_123" },
    absent: [],
  },
  {
    title: "leaves an unset resume flow id out of the login markup",
    widget: "login",
    props: { projectId: "p1" },
    present: {},
    absent: ["resume-flow-id"],
  },
  {
    title: "leaves an empty resume flow id out of the login markup",
    widget: "login",
    props: { projectId: "p1", resumeFlowId: "" },
    present: {},
    absent: ["resume-flow-id"],
    gaps: ["vue", "angular", "svelte"],
  },
  {
    title: "puts the post-sign-in URL into the login markup",
    widget: "login",
    props: { projectId: "p1", postSignInUrl: "/home" },
    present: { "post-sign-in-url": "/home" },
    absent: [],
  },
  {
    title: "leaves an unset post-sign-in URL out of the login markup",
    widget: "login",
    props: { projectId: "p1" },
    present: {},
    absent: ["post-sign-in-url"],
  },
  {
    title: "puts the display options into the login markup",
    widget: "login",
    props: { projectId: "p1", variant: "page", theme: "dark" },
    present: { variant: "page", theme: "dark" },
    absent: [],
    gaps: ["react", "svelte"],
  },
  {
    title: "leaves unset display options out of the login markup",
    widget: "login",
    props: { projectId: "p1" },
    present: {},
    absent: [
      "variant",
      "theme",
      "suppress-header",
      "suppress-password-toggle",
      "force-post-sign-in-url",
    ],
  },
  {
    title: "leaves a false boolean option out of the login markup",
    widget: "login",
    props: {
      projectId: "p1",
      suppressHeader: false,
      suppressPasswordToggle: false,
      forcePostSignInUrl: false,
    },
    present: {},
    absent: ["suppress-header", "suppress-password-toggle", "force-post-sign-in-url"],
  },
  {
    title: "puts the discrete project props into the session markup",
    widget: "session",
    props: { projectId: "p1", proxyPath: "/px" },
    present: { "project-id": "p1", "proxy-path": "/px" },
    absent: ["url"],
  },
  {
    title: "puts the project handle into the session markup",
    widget: "session",
    props: { project: SERVER_RENDER_HANDLE },
    present: {
      "project-id": "proj-handle",
      "proxy-path": "/__handle",
      url: "https://auth.example.com",
    },
    absent: [],
    gaps: ["svelte"],
  },
  {
    title: "lets the project handle win over conflicting discrete props in the session markup",
    widget: "session",
    props: { project: SERVER_RENDER_HANDLE, projectId: "proj-other", proxyPath: "/__other" },
    present: { "project-id": "proj-handle", "proxy-path": "/__handle" },
    absent: [],
    gaps: ["svelte"],
  },
  {
    title: "writes nothing for no config in the session markup",
    widget: "session",
    props: {},
    present: {},
    absent: ["project-id", "proxy-path", "url", "post-sign-out-url"],
  },
  {
    title: "puts the post-sign-out URL into the session markup",
    widget: "session",
    props: { projectId: "p1", postSignOutUrl: "/bye" },
    present: { "post-sign-out-url": "/bye" },
    absent: [],
  },
  {
    title: "leaves a keyed project handle out of the session markup",
    widget: "session",
    props: {
      project: { ...SERVER_RENDER_HANDLE, publishableKey: "pk_test_123" },
      projectId: "proj-other",
    },
    present: {},
    absent: ["project-id", "proxy-path", "url"],
    gaps: ["vue", "angular", "svelte"],
  },
  {
    title: "leaves a keyed project handle out of the logout markup",
    widget: "logout",
    props: {
      project: { ...SERVER_RENDER_HANDLE, publishableKey: "pk_test_123" },
      projectId: "proj-other",
    },
    present: {},
    absent: ["project-id", "proxy-path", "url"],
    gaps: ["vue", "angular", "svelte"],
  },
  {
    title: "puts the discrete project props into the logout markup",
    widget: "logout",
    props: { projectId: "p1", proxyPath: "/px" },
    present: { "project-id": "p1", "proxy-path": "/px" },
    absent: ["url"],
  },
  {
    title: "puts the project handle into the logout markup",
    widget: "logout",
    props: { project: SERVER_RENDER_HANDLE },
    present: {
      "project-id": "proj-handle",
      "proxy-path": "/__handle",
      url: "https://auth.example.com",
    },
    absent: [],
    gaps: ["svelte"],
  },
  {
    title: "lets the project handle win over conflicting discrete props in the logout markup",
    widget: "logout",
    props: { project: SERVER_RENDER_HANDLE, projectId: "proj-other", proxyPath: "/__other" },
    present: { "project-id": "proj-handle", "proxy-path": "/__handle" },
    absent: [],
    gaps: ["svelte"],
  },
  {
    title: "writes nothing for no config in the logout markup",
    widget: "logout",
    props: {},
    present: {},
    absent: ["project-id", "proxy-path", "url", "post-sign-out-url"],
  },
  {
    title: "puts the post-sign-out URL into the logout markup",
    widget: "logout",
    props: { projectId: "p1", postSignOutUrl: "/bye" },
    present: { "post-sign-out-url": "/bye" },
    absent: [],
  },
];

describe("server-rendered widget config", () => {
  const covered = SERVER_RENDER_CASES.filter((c) => !c.gaps?.includes(SDK));

  it.each(covered)("$title", async ({ widget, props, present, absent }) => {
    const attributes = await renderAttributes(widget, props);
    expect(attributes).toMatchObject(present);
    for (const name of absent) expect(attributes).not.toHaveProperty(name);
  });
});
// server-render-cases:end

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

type Attributes = {
  readonly [name: string]: string | boolean | null | undefined;
};

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

// standard-attributes:begin
type StandardProps = {
  [W in WidgetName]: {
    [K in keyof ForwardedAttributes]?: K extends keyof WidgetProps[W] ? WidgetProps[W][K] : never;
  };
};

function cssProperties(style: string): Record<string, string> {
  const [property = "", value = ""] = style.split(":").map((part) => part.trim());
  return { [property]: value };
}

describe.each(widgetNames)("%s standard attributes", (widget) => {
  const tag = widgetTags[widget];

  it("forwards the class to the widget element", async () => {
    const { container } = await mountWidget(widget, { class: "probe" });
    expect(container.querySelector(tag)?.classList.contains("probe")).toBe(true);
  });

  it("forwards the style to the widget element", async () => {
    const { container } = await mountWidget(widget, { style: "color: red" });
    expect(container.querySelector(tag)?.style.color).toBe("red");
  });

  it("forwards the id to the widget element", async () => {
    const { container } = await mountWidget(widget, { id: "probe" });
    expect(container.querySelector(tag)?.id).toBe("probe");
  });

  it("forwards data attributes to the widget element", async () => {
    const { container } = await mountWidget(widget, { "data-testid": "probe" });
    expect(container.querySelector(tag)?.getAttribute("data-testid")).toBe("probe");
  });

  it("forwards aria attributes to the widget element", async () => {
    const { container } = await mountWidget(widget, { "aria-label": "probe" });
    expect(container.querySelector(tag)?.getAttribute("aria-label")).toBe("probe");
  });

  it("forwards the remaining standard attributes to the widget element", async () => {
    const { container } = await mountWidget(widget, {
      title: "probe",
      role: "region",
      tabindex: "3",
      hidden: "",
    });
    const element = container.querySelector(tag);
    expect(element?.title).toBe("probe");
    expect(element?.getAttribute("role")).toBe("region");
    expect(element?.getAttribute("tabindex")).toBe("3");
    expect(element?.hidden).toBe(true);
  });

  it("forwards the slot to the widget element", async () => {
    const { container } = await mountWidget(widget, { slot: "probe" });
    expect(container.querySelector(tag)?.getAttribute("slot")).toBe("probe");
  });

  it("renders a false aria or data attribute as the string false", async () => {
    const { container } = await mountWidget(widget, { "aria-hidden": false, "data-open": false });
    expect(container.querySelector(tag)?.getAttribute("aria-hidden")).toBe("false");
    expect(container.querySelector(tag)?.getAttribute("data-open")).toBe("false");
  });

  it("updates a forwarded attribute when the prop changes", async () => {
    const { container, update } = await mountWidget(widget, {
      class: "before",
      id: "before",
      title: "before",
      slot: "before",
      tabindex: "1",
      "aria-label": "before",
      "data-testid": "before",
    });
    await update({
      class: "after",
      id: "after",
      title: "after",
      slot: "after",
      tabindex: "2",
      "aria-label": "after",
      "data-testid": "after",
    });
    const element = container.querySelector(tag);
    expect(element?.classList.contains("before")).toBe(false);
    expect(element?.classList.contains("after")).toBe(true);
    for (const name of ["id", "title", "slot", "aria-label", "data-testid"]) {
      expect(element?.getAttribute(name)).toBe("after");
    }
    expect(element?.getAttribute("tabindex")).toBe("2");
  });

  it("removes a forwarded attribute when the prop is removed", async () => {
    const { container, update } = await mountWidget(widget, {
      class: "before",
      id: "before",
      title: "before",
      slot: "before",
      tabindex: "1",
      "aria-label": "before",
      "data-testid": "before",
    });
    const element = container.querySelector(tag);
    expect(element?.classList.contains("before")).toBe(true);
    for (const name of ["id", "title", "slot", "aria-label", "data-testid"]) {
      expect(element?.getAttribute(name)).toBe("before");
    }
    expect(element?.getAttribute("tabindex")).toBe("1");
    await update({});
    expect(element?.classList.contains("before")).toBe(false);
    for (const name of ["id", "title", "slot", "tabindex", "aria-label", "data-testid"]) {
      if (!staleOnRemoval.includes(name)) expect(element?.hasAttribute(name)).toBe(false);
    }
  });

  it("does not forward props outside the standard set", async () => {
    const { container } = await mountWidget(widget, {
      srcdoc: "probe",
      onclick: "probe",
      part: "probe",
      dir: "probe",
    });
    for (const name of ["srcdoc", "onclick", "part", "dir"]) {
      expect(container.querySelector(tag)?.hasAttribute(name)).toBe(false);
    }
  });

  it("gives access to the widget element through a ref", async () => {
    const { container, ref } = await mountWidget(widget, {});
    expect(ref()).toBe(container.querySelector(tag));
    expect(ref()?.tagName.toLowerCase()).toBe(tag);
  });

  it("accepts the standard attributes in its props", () => {
    const attributes: Partial<ForwardedAttributes> = {};
    const accepted: StandardProps = { login: attributes, logout: attributes, session: attributes };
    expect(accepted).toBeDefined();
  });

  it("rejects the attributes it does not forward in its props", () => {
    type Rejected = {
      [W in WidgetName]: Extract<"dir" | "classList" | "onClick", keyof WidgetProps[W]>;
    };
    expectTypeOf<Rejected>().toEqualTypeOf<Record<WidgetName, never>>();
  });
});
// standard-attributes:end

// standard-attributes-server:begin
describe.each(widgetNames)("%s server-rendered standard attributes", (widget) => {
  it("puts the standard attributes into the server markup", async () => {
    const attributes = await renderAttributes(widget, {
      id: "probe",
      title: "probe",
      slot: "probe",
      role: "region",
      tabindex: "3",
      "data-testid": "probe",
      "aria-label": "probe",
    });
    expect(attributes).toMatchObject({
      id: "probe",
      title: "probe",
      slot: "probe",
      role: "region",
      tabindex: "3",
      "data-testid": "probe",
      "aria-label": "probe",
    });
  });

  it("leaves props outside the standard set out of the server markup", async () => {
    const attributes = await renderAttributes(widget, {
      srcdoc: "probe",
      onclick: "probe",
      part: "probe",
      dir: "probe",
    });
    for (const name of ["srcdoc", "onclick", "part", "dir"]) {
      expect(attributes).not.toHaveProperty(name);
    }
  });
});
// standard-attributes-server:end
