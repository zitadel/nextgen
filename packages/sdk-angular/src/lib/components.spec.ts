import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { Component, CUSTOM_ELEMENTS_SCHEMA } from "@angular/core";
import { render } from "@testing-library/angular";
import { _resetConfigForTesting } from "@zitadel/api/config";
import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENT_HANDLERS,
} from "@zitadel/sdk-core/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { businessLocales, configureZitadel, getZitadelConfig } from "../public-api";
import { ZitadelLoginComponent } from "./zitadel-login.component";
import { ZitadelLogoutComponent } from "./zitadel-logout.component";
import { ZitadelSessionComponent } from "./zitadel-session.component";

const project = { projectId: "proj-test", proxyPath: "/__nextgen" };

@Component({
  standalone: true,
  imports: [ZitadelLogoutComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<zitadel-auth-logout [project]="project"
    ><template ngNonBindable
      ><b>{{initial}}</b><button data-action="logout">Bye</button></template
    ></zitadel-auth-logout
  >`,
})
class LogoutWithTemplate {
  project = project;
}

@Component({
  standalone: true,
  imports: [ZitadelLoginComponent],
  template: `<zitadel-auth-login [project]="project"
    ><span slot="attribution-trailing">Ours</span></zitadel-auth-login
  >`,
})
class LoginWithAttribution {
  project = project;
}

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
  _resetConfigForTesting();
  document.body.innerHTML = "";
});

const locales = { en: { "identifier.title": "Welcome back" } };

// One row per input: the value the wrapper is given and the element property
// it must land on (`project` and `locales` are compared by identity).
const loginInputs: ReadonlyArray<readonly [string, unknown]> = [
  ["purpose", "register"],
  ["flowName", "passkey-only"],
  ["postSignInUrl", "/home"],
  ["variant", "page"],
  ["theme", "light"],
  ["suppressHeader", true],
  ["lang", "de"],
  ["locales", locales],
  ["projectId", "proj-other"],
  ["proxyPath", "/__other"],
];

const logoutInputs: ReadonlyArray<readonly [string, unknown]> = [
  ["postSignOutUrl", "/bye"],
  ["theme", "dark"],
];

const sessionInputs: ReadonlyArray<readonly [string, unknown]> = [
  ["postSignOutUrl", "/bye"],
  ["heading", "Welcome"],
  ["logoutLabel", "Leave"],
  ["variant", "page"],
  ["theme", "light"],
  ["suppressHeader", true],
];

// The element defaults a wrapper must leave in place when an input is unset,
// and restore when a set input is cleared.
const loginDefaults: ReadonlyArray<readonly [string, unknown, unknown]> = [
  ["purpose", "register", "login"],
  ["variant", "page", "widget"],
  ["theme", "light", ""],
  ["lang", "de", ""],
  ["suppressHeader", true, false],
];

const logoutDefaults: ReadonlyArray<readonly [string, unknown, unknown]> = [["theme", "dark", ""]];

const sessionDefaults: ReadonlyArray<readonly [string, unknown, unknown]> = [
  ["heading", "Welcome", "Signed in as"],
  ["logoutLabel", "Leave", "Sign out"],
  ["variant", "page", "widget"],
  ["theme", "light", ""],
  ["suppressHeader", true, false],
];

// Reads a property off the rendered custom element by name.
const propOf = (el: Element | null, name: string): unknown =>
  (el as unknown as Record<string, unknown> | null)?.[name];

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

  it("records the configureZitadel() handle as the global config", () => {
    const handle = configureZitadel({ projectId: "proj-test", proxyPath: "/__nextgen" });
    expect(getZitadelConfig()).toBe(handle);
  });

  it("keeps the publishable key on the configureZitadel() handle", () => {
    const handle = configureZitadel({ projectId: "proj-test", publishableKey: "pk_test" });
    expect(handle.publishableKey).toBe("pk_test");
  });

  it("starts from the configureZitadel() handle when no [project] is bound", async () => {
    configureZitadel({ projectId: "proj-test", proxyPath: "/__nextgen" });
    const { container } = await render(ZitadelLoginComponent);
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    await el!.updateComplete;
    expect(el!.shadowRoot!.textContent).not.toContain("requires a configured project");
  });

  it("projects its content into the element", async () => {
    const { container } = await render(LoginWithAttribution);
    const el = container.querySelector("zitadel-login");
    expect(el!.querySelector('[slot="attribution-trailing"]')?.textContent).toBe("Ours");
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

  it.each(loginInputs)("forwards %s to the element", async (name, value) => {
    const { container } = await render(ZitadelLoginComponent, {
      inputs: { project, [name]: value },
    });
    expect(propOf(container.querySelector("zitadel-login"), name)).toBe(value);
  });

  it.each(loginDefaults)("keeps the %s default when unset", async (name, _set, fallback) => {
    const { container } = await render(ZitadelLoginComponent, { inputs: { project } });
    expect(propOf(container.querySelector("zitadel-login"), name)).toBe(fallback);
  });

  it.each(loginDefaults)("restores the %s default when cleared", async (name, value, fallback) => {
    const { fixture, container } = await render(ZitadelLoginComponent, {
      inputs: { project, [name]: value },
    });
    fixture.componentRef.setInput(name, undefined);
    fixture.detectChanges();
    expect(propOf(container.querySelector("zitadel-login"), name)).toBe(fallback);
  });

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

  it.each(logoutInputs)("forwards %s to the element", async (name, value) => {
    const { container } = await render(ZitadelLogoutComponent, {
      inputs: { project, [name]: value },
    });
    expect(propOf(container.querySelector("zitadel-logout"), name)).toBe(value);
  });

  it.each(logoutDefaults)("keeps the %s default when unset", async (name, _set, fallback) => {
    const { container } = await render(ZitadelLogoutComponent, { inputs: { project } });
    expect(propOf(container.querySelector("zitadel-logout"), name)).toBe(fallback);
  });

  it.each(logoutDefaults)("restores the %s default when cleared", async (name, value, fallback) => {
    const { fixture, container } = await render(ZitadelLogoutComponent, {
      inputs: { project, [name]: value },
    });
    fixture.componentRef.setInput(name, undefined);
    fixture.detectChanges();
    expect(propOf(container.querySelector("zitadel-logout"), name)).toBe(fallback);
  });

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

describe("ZitadelLogout template mode", () => {
  it("receives the projected <template> child", async () => {
    const { container } = await render(LogoutWithTemplate);
    const el = container.querySelector("zitadel-logout");
    expect(el!.querySelector("template")).not.toBeNull();
  });

  it("renders the projected template into its light DOM", async () => {
    const { container } = await render(LogoutWithTemplate);
    const el = container.querySelector("zitadel-logout");
    expect(el!.querySelector("span [data-action='logout']")?.textContent).toBe("Bye");
  });

  it("leaves the template placeholders for the element to fill", async () => {
    const { container } = await render(LogoutWithTemplate);
    const el = container.querySelector("zitadel-logout");
    expect(el!.querySelector("span b")?.textContent).toBe("?");
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

  it.each(sessionInputs)("forwards %s to the element", async (name, value) => {
    const { container } = await render(ZitadelSessionComponent, {
      inputs: { project, [name]: value },
    });
    expect(propOf(container.querySelector("zitadel-session"), name)).toBe(value);
  });

  it.each(sessionDefaults)("keeps the %s default when unset", async (name, _set, fallback) => {
    const { container } = await render(ZitadelSessionComponent, { inputs: { project } });
    expect(propOf(container.querySelector("zitadel-session"), name)).toBe(fallback);
  });

  it.each(sessionDefaults)(
    "restores the %s default when cleared",
    async (name, value, fallback) => {
      const { fixture, container } = await render(ZitadelSessionComponent, {
        inputs: { project, [name]: value },
      });
      fixture.componentRef.setInput(name, undefined);
      fixture.detectChanges();
      expect(propOf(container.querySelector("zitadel-session"), name)).toBe(fallback);
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
