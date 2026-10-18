import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { render } from "@testing-library/angular";
import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENT_HANDLERS,
  type ZitadelLoginConfig,
  type ZitadelLogoutConfig,
  type ZitadelSessionConfig,
} from "@zitadel/sdk-core/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { businessLocales } from "../public-api";
import { ZitadelLoginComponent } from "./zitadel-login.component";
import { ZitadelLogoutComponent } from "./zitadel-logout.component";
import { ZitadelSessionComponent } from "./zitadel-session.component";

const project = { projectId: "proj-test", proxyPath: "/__nextgen" };

// `'zitadel-flow-step'` → `'flowStep'`: the camelCased `@Output()` name Angular
// exposes for the event (the `zitadel-` prefix dropped, the rest camelCased).
const outputName = (event: string): string =>
  event.replace(/^zitadel-/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// The dynamically-named `@Output()` is an EventEmitter we only `subscribe` to.
type SubscribableOutput = { subscribe(next: (detail: unknown) => void): void };

// Reads the `@Output()` an event maps to off a component instance, typed as a
// subscribable so the spec never reaches into `any`. A missing output (i.e. the
// component never re-emitted a contract event) fails here rather than silently
// passing.
const outputOf = (instance: object, event: string): SubscribableOutput => {
  const name = outputName(event);
  const output = (instance as Record<string, SubscribableOutput | undefined>)[name];
  if (!output) throw new Error(`component has no @Output() "${name}"`);
  return output;
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("ZitadelLogin", () => {
  it("binds the project handle as a property", async () => {
    const { container } = await render(ZitadelLoginComponent, {
      inputs: { project },
    });
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", async () => {
    const { container } = await render(ZitadelLoginComponent, {
      inputs: { projectId: "proj-test", proxyPath: "/__nextgen" },
    });
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards resumeFlowId to the widget", async () => {
    const { container } = await render(ZitadelLoginComponent, {
      inputs: { project, resumeFlowId: "flow_123" },
    });
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.resumeFlowId).toBe("flow_123");
  });

  it("reads a null resumeFlowId as no handle", async () => {
    const { container } = await render(ZitadelLoginComponent, {
      inputs: { project, resumeFlowId: null },
    });
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.resumeFlowId).toBe("");
  });

  it("forwards locales and lang to the widget", async () => {
    const locales = { en: { "identifier.title": "Welcome back" } };
    const { container } = await render(ZitadelLoginComponent, {
      inputs: { project, locales, lang: "de" },
    });
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.locales).toBe(locales);
    expect(el!.lang).toBe("de");
  });

  it.each(Object.keys(ZITADEL_LOGIN_EVENT_HANDLERS))(
    "forwards %s through its @Output",
    async (eventName) => {
      const { fixture, container } = await render(ZitadelLoginComponent, {
        inputs: { project },
      });
      const spy = vi.fn();
      outputOf(fixture.componentInstance, eventName).subscribe(spy);
      const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("exposes the underlying element via the element getter", async () => {
    const { fixture, container } = await render(ZitadelLoginComponent, {
      inputs: { project },
    });
    fixture.detectChanges();
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    const exposed = fixture.componentInstance.element;
    expect(exposed).not.toBeNull();
    expect(exposed!.tagName.toLowerCase()).toBe("zitadel-login");
    expect(exposed).toBe(el);
  });
});

describe("ZitadelLogout", () => {
  it("binds the project handle as a property", async () => {
    const { container } = await render(ZitadelLogoutComponent, {
      inputs: { project },
    });
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", async () => {
    const { container } = await render(ZitadelLogoutComponent, {
      inputs: { projectId: "proj-test", proxyPath: "/__nextgen" },
    });
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it.each(Object.keys(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    "forwards %s through its @Output",
    async (eventName) => {
      const { fixture, container } = await render(ZitadelLogoutComponent, {
        inputs: { project },
      });
      const spy = vi.fn();
      outputOf(fixture.componentInstance, eventName).subscribe(spy);
      const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("exposes the underlying element via the element getter", async () => {
    const { fixture, container } = await render(ZitadelLogoutComponent, {
      inputs: { project },
    });
    fixture.detectChanges();
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
    const exposed = fixture.componentInstance.element;
    expect(exposed).not.toBeNull();
    expect(exposed!.tagName.toLowerCase()).toBe("zitadel-logout");
    expect(exposed).toBe(el);
  });
});

describe("ZitadelSession", () => {
  it("binds the project handle as a property", async () => {
    const { container } = await render(ZitadelSessionComponent, {
      inputs: { project },
    });
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", async () => {
    const { container } = await render(ZitadelSessionComponent, {
      inputs: { projectId: "proj-test", proxyPath: "/__nextgen" },
    });
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards the surface variant/theme", async () => {
    const { container } = await render(ZitadelSessionComponent, {
      inputs: { project, variant: "page", theme: "light", suppressHeader: true },
    });
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el!.variant).toBe("page");
    expect(el!.theme).toBe("light");
    expect(el!.suppressHeader).toBe(true);
  });

  it.each(Object.keys(ZITADEL_SESSION_EVENT_HANDLERS))(
    "forwards %s through its @Output",
    async (eventName) => {
      const { fixture, container } = await render(ZitadelSessionComponent, {
        inputs: { project },
      });
      const spy = vi.fn();
      outputOf(fixture.componentInstance, eventName).subscribe(spy);
      const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("exposes the underlying element via the element getter", async () => {
    const { fixture, container } = await render(ZitadelSessionComponent, {
      inputs: { project },
    });
    fixture.detectChanges();
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    const exposed = fixture.componentInstance.element;
    expect(exposed).not.toBeNull();
    expect(exposed!.tagName.toLowerCase()).toBe("zitadel-session");
    expect(exposed).toBe(el);
  });
});

describe("businessLocales", () => {
  it("re-exports the business copy overlay from @zitadel/components", () => {
    expect(businessLocales).toBe(componentsBusinessLocales);
  });
});

// Every config key set to a distinct value. `Required<…>` makes `tsc` fail here
// when a key is added to a config type, so a new key cannot skip this check. The discrete
// `projectId` / `proxyPath` repeat the `project` handle's fields: the handle wins as an attribute.
const loginConfig: Required<ZitadelLoginConfig> = {
  project,
  projectId: project.projectId,
  proxyPath: project.proxyPath,
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
  projectId: project.projectId,
  proxyPath: project.proxyPath,
  postSignOutUrl: "/parity-after-sign-out",
  heading: "Parity heading",
  logoutLabel: "Parity sign out",
  variant: "page",
  theme: "dark",
  suppressHeader: true,
};

const logoutConfig: Required<ZitadelLogoutConfig> = {
  project,
  projectId: project.projectId,
  proxyPath: project.proxyPath,
  postSignOutUrl: "/parity-after-sign-out",
  theme: "dark",
};

// The element's value for each key, so a key the wrapper drops shows up by name.
const elementValues = (el: object, config: object): Record<string, unknown> =>
  Object.fromEntries(Object.keys(config).map((key) => [key, (el as Record<string, unknown>)[key]]));

describe("wrapper config parity", () => {
  it("forwards every ZitadelLoginConfig key to <zitadel-login>", async () => {
    const { container } = await render(ZitadelLoginComponent, { inputs: { ...loginConfig } });
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(elementValues(el!, loginConfig)).toEqual(loginConfig);
  });

  it("forwards every ZitadelSessionConfig key to <zitadel-session>", async () => {
    const { container } = await render(ZitadelSessionComponent, { inputs: { ...sessionConfig } });
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(elementValues(el!, sessionConfig)).toEqual(sessionConfig);
  });

  it("forwards every ZitadelLogoutConfig key to <zitadel-logout>", async () => {
    const { container } = await render(ZitadelLogoutComponent, { inputs: { ...logoutConfig } });
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(elementValues(el!, logoutConfig)).toEqual(logoutConfig);
  });
});

const SDK = "angular";

/** The attributes on the widget's element once the component has rendered. */
async function renderAttributes(
  widget: "login" | "session" | "logout",
  props: Readonly<Record<string, unknown>>,
): Promise<Record<string, string>> {
  const component = {
    login: ZitadelLoginComponent,
    session: ZitadelSessionComponent,
    logout: ZitadelLogoutComponent,
  }[widget] as typeof ZitadelLoginComponent;
  const { container } = await render(component, { inputs: { ...props } });
  const el = container.querySelector(`zitadel-${widget}`);
  expect(el, `<zitadel-${widget}> missing from the markup`).not.toBeNull();
  return Object.fromEntries(el!.getAttributeNames().map((n) => [n, el!.getAttribute(n) ?? ""]));
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
    absent: ["variant", "theme", "suppress-header", "suppress-password-toggle"],
  },
  {
    title: "leaves a false boolean option out of the login markup",
    widget: "login",
    props: { projectId: "p1", suppressHeader: false, suppressPasswordToggle: false },
    present: {},
    absent: ["suppress-header", "suppress-password-toggle"],
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
