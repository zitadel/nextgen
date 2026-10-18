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
} from "@zitadel/sdk-core/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { businessLocales } from "../public-api";
import { ZitadelLoginComponent } from "./zitadel-login.component";
import { ZitadelLogoutComponent } from "./zitadel-logout.component";
import { ZitadelSessionComponent } from "./zitadel-session.component";

const project = { projectId: "proj-test", proxyPath: "/__nextgen" };
const handle = {
  projectId: "proj-handle",
  proxyPath: "/__handle",
  url: "https://auth.example.com",
};

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
  it("writes the discrete config as attributes the element reads at upgrade", async () => {
    const { container } = await render(ZitadelLoginComponent, {
      inputs: { projectId: "proj-test", proxyPath: "/__nextgen" },
    });
    const el = container.querySelector("zitadel-login");
    expect(el!.getAttribute("project-id")).toBe("proj-test");
    expect(el!.getAttribute("proxy-path")).toBe("/__nextgen");
  });

  it("writes the project handle's fields as attributes", async () => {
    const { container } = await render(ZitadelLoginComponent, { inputs: { project: handle } });
    const el = container.querySelector("zitadel-login");
    expect(el!.getAttribute("project-id")).toBe("proj-handle");
    expect(el!.getAttribute("proxy-path")).toBe("/__handle");
    expect(el!.getAttribute("url")).toBe("https://auth.example.com");
  });

  it("lets the project handle win over conflicting discrete inputs", async () => {
    const { container } = await render(ZitadelLoginComponent, {
      inputs: { project: handle, projectId: "proj-other", proxyPath: "/__other" },
    });
    const el = container.querySelector("zitadel-login");
    expect(el!.getAttribute("project-id")).toBe("proj-handle");
    expect(el!.getAttribute("proxy-path")).toBe("/__handle");
  });

  it("writes no config attributes when none is given", async () => {
    const { container } = await render(ZitadelLoginComponent, { inputs: {} });
    const el = container.querySelector("zitadel-login");
    expect(el!.hasAttribute("project-id")).toBe(false);
    expect(el!.hasAttribute("proxy-path")).toBe(false);
    expect(el!.hasAttribute("url")).toBe(false);
  });

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
  it("writes the discrete config as attributes the element reads at upgrade", async () => {
    const { container } = await render(ZitadelLogoutComponent, {
      inputs: { projectId: "proj-test", proxyPath: "/__nextgen" },
    });
    const el = container.querySelector("zitadel-logout");
    expect(el!.getAttribute("project-id")).toBe("proj-test");
    expect(el!.getAttribute("proxy-path")).toBe("/__nextgen");
  });

  it("writes the project handle's fields as attributes", async () => {
    const { container } = await render(ZitadelLogoutComponent, { inputs: { project: handle } });
    const el = container.querySelector("zitadel-logout");
    expect(el!.getAttribute("project-id")).toBe("proj-handle");
    expect(el!.getAttribute("proxy-path")).toBe("/__handle");
    expect(el!.getAttribute("url")).toBe("https://auth.example.com");
  });

  it("lets the project handle win over conflicting discrete inputs", async () => {
    const { container } = await render(ZitadelLogoutComponent, {
      inputs: { project: handle, projectId: "proj-other", proxyPath: "/__other" },
    });
    const el = container.querySelector("zitadel-logout");
    expect(el!.getAttribute("project-id")).toBe("proj-handle");
    expect(el!.getAttribute("proxy-path")).toBe("/__handle");
  });

  it("writes no config attributes when none is given", async () => {
    const { container } = await render(ZitadelLogoutComponent, { inputs: {} });
    const el = container.querySelector("zitadel-logout");
    expect(el!.hasAttribute("project-id")).toBe(false);
    expect(el!.hasAttribute("proxy-path")).toBe(false);
    expect(el!.hasAttribute("url")).toBe(false);
  });

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
  it("writes the discrete config as attributes the element reads at upgrade", async () => {
    const { container } = await render(ZitadelSessionComponent, {
      inputs: { projectId: "proj-test", proxyPath: "/__nextgen" },
    });
    const el = container.querySelector("zitadel-session");
    expect(el!.getAttribute("project-id")).toBe("proj-test");
    expect(el!.getAttribute("proxy-path")).toBe("/__nextgen");
  });

  it("writes the project handle's fields as attributes", async () => {
    const { container } = await render(ZitadelSessionComponent, { inputs: { project: handle } });
    const el = container.querySelector("zitadel-session");
    expect(el!.getAttribute("project-id")).toBe("proj-handle");
    expect(el!.getAttribute("proxy-path")).toBe("/__handle");
    expect(el!.getAttribute("url")).toBe("https://auth.example.com");
  });

  it("lets the project handle win over conflicting discrete inputs", async () => {
    const { container } = await render(ZitadelSessionComponent, {
      inputs: { project: handle, projectId: "proj-other", proxyPath: "/__other" },
    });
    const el = container.querySelector("zitadel-session");
    expect(el!.getAttribute("project-id")).toBe("proj-handle");
    expect(el!.getAttribute("proxy-path")).toBe("/__handle");
  });

  it("writes no config attributes when none is given", async () => {
    const { container } = await render(ZitadelSessionComponent, { inputs: {} });
    const el = container.querySelector("zitadel-session");
    expect(el!.hasAttribute("project-id")).toBe(false);
    expect(el!.hasAttribute("proxy-path")).toBe(false);
    expect(el!.hasAttribute("url")).toBe(false);
  });

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
