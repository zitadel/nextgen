import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { Component, type Type } from "@angular/core";
import { bootstrapApplication, By, provideClientHydration } from "@angular/platform-browser";
import { provideServerRendering, renderApplication } from "@angular/platform-server";
import { render } from "@testing-library/angular";
import { _resetConfigForTesting, configureZitadel } from "@zitadel/api/config";
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

/** Snapshots every readable global so it can be put back after a server render. */
function snapshotGlobals(): Map<PropertyKey, unknown> {
  const snapshot = new Map<PropertyKey, unknown>();
  for (const key of Reflect.ownKeys(globalThis)) {
    try {
      snapshot.set(key, (globalThis as Record<PropertyKey, unknown>)[key]);
    } catch {
      // A getter that throws on read is not something a render replaces.
    }
  }
  return snapshot;
}

/**
 * Renders `template` to a document string with the real Angular server
 * renderer. Angular's server platform assigns its DOM classes (`Event`,
 * `CustomEvent`, `Node`, ...) onto `globalThis` for the render, which would
 * replace jsdom's for every later test in this file, so they are put back
 * afterwards (by assignment, as jsdom's globals are accessors).
 */
async function serverRender(template: string, imports: Type<unknown>[] = []): Promise<string> {
  @Component({ selector: "app-root", standalone: true, imports, template })
  class Root {}
  const before = snapshotGlobals();
  try {
    return await renderApplication(
      (context) =>
        bootstrapApplication(
          Root,
          { providers: [provideServerRendering(), provideClientHydration()] },
          context,
        ),
      { document: "<!doctype html><html><head></head><body><app-root></app-root></body></html>" },
    );
  } finally {
    for (const key of Reflect.ownKeys(globalThis)) {
      if (!before.has(key)) Reflect.deleteProperty(globalThis, key);
    }
    for (const [key, value] of before) {
      const globals = globalThis as Record<PropertyKey, unknown>;
      if (Object.is(globals[key], value)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
      // A read-only or getter-only global is not one a render can have replaced.
      if (descriptor?.writable || descriptor?.set) globals[key] = value;
    }
  }
}

/** The attributes of the first `<tag>` in server-rendered HTML. */
function attributesOf(html: string, tag: string): Record<string, string> {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`).exec(html);
  expect(open, `<${tag}> missing from server HTML`).not.toBeNull();
  return Object.fromEntries(
    [...(open?.[1] ?? "").matchAll(/([a-z][\w-]*)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? ""]),
  );
}

describe("server-rendered widget config", () => {
  it("puts the login flow config into the server markup", async () => {
    const html = await serverRender(
      `<zitadel-auth-login purpose="register" flowName="signup" resumeFlowId="flow_123" postSignInUrl="/home" />`,
      [ZitadelLoginComponent],
    );
    expect(attributesOf(html, "zitadel-login")).toMatchObject({
      purpose: "register",
      "flow-name": "signup",
      "resume-flow-id": "flow_123",
      "post-sign-in-url": "/home",
    });
  });

  it("puts the session config into the server markup", async () => {
    const html = await serverRender(`<zitadel-auth-session postSignOutUrl="/bye" heading="Hi" />`, [
      ZitadelSessionComponent,
    ]);
    expect(attributesOf(html, "zitadel-session")).toMatchObject({
      "post-sign-out-url": "/bye",
      heading: "Hi",
    });
  });

  it("puts the standard attributes into the server markup of the widget element", async () => {
    const html = await serverRender(
      `<zitadel-auth-login class="probe" id="probe" data-testid="probe" aria-label="probe" />`,
      [ZitadelLoginComponent],
    );
    expect(attributesOf(html, "zitadel-login")).toMatchObject({
      class: "probe",
      id: "probe",
      "data-testid": "probe",
      "aria-label": "probe",
    });
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
    const template = `<zitadel-auth-login purpose="register" />`;
    const fetched = vi.spyOn(globalThis, "fetch");
    const html = await serverRender(template, [ZitadelLoginComponent]);
    document.body.innerHTML = html
      .slice(html.indexOf("<body"), html.indexOf("</body>"))
      .replace(/^<body[^>]*>/, "");
    const firstStep = new Promise((resolve) =>
      document
        .querySelector("zitadel-login")
        ?.addEventListener("zitadel-flow-step", resolve, { once: true }),
    );

    @Component({
      selector: "app-root",
      standalone: true,
      imports: [ZitadelLoginComponent],
      template,
    })
    class Root {}
    await bootstrapApplication(Root, { providers: [provideClientHydration()] });

    await firstStep;
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
    expect(globalProject.projectId).toBe("proj-global");
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
  ] as const)("ZitadelSession keeps the default %s", async (prop, expected) => {
    const { container } = await render(ZitadelSessionComponent, { inputs: { project } });

    expect(container.querySelector<ZitadelSessionElement>("zitadel-session")![prop]).toBe(expected);
  });

  it.each([
    ["variant", "widget"],
    ["theme", ""],
    ["suppressHeader", false],
    ["lang", ""],
    ["suppressPasswordToggle", false],
  ] as const)("ZitadelLogin keeps the default %s", async (prop, expected) => {
    const { container } = await render(ZitadelLoginComponent, { inputs: { project } });

    expect(container.querySelector<ZitadelLoginElement>("zitadel-login")![prop]).toBe(expected);
  });

  it("ZitadelLogout keeps the default theme", async () => {
    const { container } = await render(ZitadelLogoutComponent, { inputs: { project } });

    expect(container.querySelector<ZitadelLogoutElement>("zitadel-logout")!.theme).toBe("");
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
    const { container, rerender } = await render(ZitadelSessionComponent, {
      inputs: { project, [prop]: given },
    });
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session")!;
    expect(el[prop]).toBe(given);

    await rerender({ inputs: { [prop]: undefined } });

    expect(el[prop]).toBe(expected);
  });

  it.each([
    ["variant", "page", "widget"],
    ["theme", "light", ""],
    ["suppressHeader", true, false],
    ["lang", "de", ""],
    ["suppressPasswordToggle", true, false],
  ] as const)("ZitadelLogin restores the default %s", async (prop, given, expected) => {
    const { container, rerender } = await render(ZitadelLoginComponent, {
      inputs: { project, [prop]: given },
    });
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login")!;
    expect(el[prop]).toBe(given);

    await rerender({ inputs: { [prop]: undefined } });

    expect(el[prop]).toBe(expected);
  });

  it("ZitadelLogout restores the default theme", async () => {
    const { container, rerender } = await render(ZitadelLogoutComponent, {
      inputs: { project, theme: "light" },
    });
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout")!;
    expect(el.theme).toBe("light");

    await rerender({ inputs: { theme: undefined } });

    expect(el.theme).toBe("");
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
  forcePostSignInUrl: true,
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

type WidgetName = "ZitadelLogin" | "ZitadelLogout" | "ZitadelSession";

type StandardAttributes = {
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

// A template attribute is not typed, so there is no props type to check against.
type WidgetProps = Record<WidgetName, Partial<StandardAttributes>>;

type StandardProps = {
  [W in WidgetName]: {
    [K in keyof StandardAttributes]?: K extends keyof WidgetProps[W] ? WidgetProps[W][K] : never;
  };
};

// Mounts a widget with the given attributes (named as the markup names them) and
// reaches its element through the component's `element`, the way a consumer does
// after a `@ViewChild`.
async function mountWidget(widget: WidgetName, attributes: Record<string, unknown>) {
  const selector = {
    ZitadelLogin: "zitadel-auth-login",
    ZitadelLogout: "zitadel-auth-logout",
    ZitadelSession: "zitadel-auth-session",
  }[widget];
  const component = {
    ZitadelLogin: ZitadelLoginComponent,
    ZitadelLogout: ZitadelLogoutComponent,
    ZitadelSession: ZitadelSessionComponent,
  }[widget];
  const markup = Object.entries(attributes)
    .map(([name, value]) =>
      typeof value === "string" ? ` ${name}="${value}"` : ` [${name}]="${name}"`,
    )
    .join("");
  const bound = Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => typeof value !== "string"),
  );
  const { container, fixture } = await render(`<${selector}${markup}></${selector}>`, {
    imports: [component],
    componentProperties: bound,
  });
  await fixture.whenStable();
  const instance = fixture.debugElement.query(By.directive(component)).componentInstance as {
    element: HTMLElement | null;
  };
  return { container, ref: () => instance.element };
}

// standard-attributes:begin
const WIDGETS = ["ZitadelLogin", "ZitadelLogout", "ZitadelSession"] as const;
const WIDGET_TAGS = {
  ZitadelLogin: "zitadel-login",
  ZitadelLogout: "zitadel-logout",
  ZitadelSession: "zitadel-session",
} as const;

describe.each(WIDGETS)("%s standard attributes", (widget) => {
  const tag = WIDGET_TAGS[widget];

  it("forwards the class to the widget element", async () => {
    const { container } = await mountWidget(widget, { class: "probe" });
    expect(container.querySelector(tag)?.classList.contains("probe")).toBe(true);
  });

  it("forwards the style to the widget element", async () => {
    const { container } = await mountWidget(widget, { style: "color: red" });
    expect(container.querySelector<HTMLElement>(tag)?.style.color).toBe("red");
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
    const element = container.querySelector<HTMLElement>(tag);
    expect(element?.title).toBe("probe");
    expect(element?.getAttribute("role")).toBe("region");
    expect(element?.getAttribute("tabindex")).toBe("3");
    expect(element?.hidden).toBe(true);
  });

  it("forwards the slot to the widget element", async () => {
    const { container } = await mountWidget(widget, { slot: "probe" });
    expect(container.querySelector(tag)?.getAttribute("slot")).toBe("probe");
  });

  it("lets a widget prop win over a standard attribute of the same name", async () => {
    const { container } = await mountWidget(widget, {
      project: { projectId: "proj-test", url: "https://auth.example.com" },
      url: "https://other.example.com",
      id: "probe",
    });
    const element = container.querySelector<HTMLElement & { url?: string }>(tag);
    expect(element?.url).toBe("https://auth.example.com");
    expect(element?.id).toBe("probe");
  });

  it("gives access to the widget element through a ref", async () => {
    const { container, ref } = await mountWidget(widget, {});
    expect(ref()).toBe(container.querySelector(tag));
    expect(ref()?.tagName.toLowerCase()).toBe(tag);
  });
  it("accepts the standard attributes in its props", () => {
    const accepted: StandardProps = {} as Record<WidgetName, Partial<StandardAttributes>>;
    expect(accepted).toBeDefined();
  });
});
// standard-attributes:end
