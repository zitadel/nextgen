import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { Component, type Type } from "@angular/core";
import { bootstrapApplication, provideClientHydration } from "@angular/platform-browser";
import { provideServerRendering, renderApplication } from "@angular/platform-server";
import { render } from "@testing-library/angular";
import { _resetConfigForTesting, configureZitadel } from "@zitadel/api/config";
import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENT_HANDLERS,
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
