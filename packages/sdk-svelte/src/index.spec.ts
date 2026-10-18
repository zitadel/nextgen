// @vitest-environment jsdom
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { svelte } from "@sveltejs/vite-plugin-svelte";
import { render } from "@testing-library/svelte";
import { _resetConfigForTesting, configureZitadel } from "@zitadel/api/config";
import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENT_HANDLERS,
} from "@zitadel/sdk-core/types";
import { hydrate, unmount } from "svelte";
import { createServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { businessLocales } from "./lib/index";
import ZitadelLogin from "./lib/ZitadelLogin.svelte";
import ZitadelLogout from "./lib/ZitadelLogout.svelte";
import ZitadelSession from "./lib/ZitadelSession.svelte";

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

  it("forwards resumeFlowId to the widget", () => {
    const { container } = render(ZitadelLogin, {
      props: { project, resumeFlowId: "flow_123" },
    });
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
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

    expect(container.querySelector<ZitadelSessionElement>("zitadel-session")![prop]).toBe(expected);
  });

  it.each([
    ["variant", "widget"],
    ["theme", ""],
    ["suppressHeader", false],
    ["lang", ""],
    ["suppressPasswordToggle", false],
  ] as const)("ZitadelLogin keeps the default %s", (prop, expected) => {
    const { container } = render(ZitadelLogin, { props: { project } });

    expect(container.querySelector<ZitadelLoginElement>("zitadel-login")![prop]).toBe(expected);
  });

  it("ZitadelLogout keeps the default theme", () => {
    const { container } = render(ZitadelLogout, { props: { project } });

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
    const { container, rerender } = render(ZitadelSession, { props: { project, [prop]: given } });
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session")!;
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
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login")!;
    expect(el[prop]).toBe(given);

    await rerender({ [prop]: undefined });

    expect(el[prop]).toBe(expected);
  });

  it("ZitadelLogout restores the default theme", async () => {
    const { container, rerender } = render(ZitadelLogout, { props: { project, theme: "light" } });
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout")!;
    expect(el.theme).toBe("light");

    await rerender({ theme: undefined });

    expect(el.theme).toBe("");
  });
});

/**
 * The login's server markup. The server compile of the component cannot share
 * a module graph with this file's browser compile, so a throwaway Vite server
 * loads it, and `svelte/server`, with the plugin's server build. The widget's
 * own module is kept out of that load (it is already registered in this jsdom
 * window).
 */
async function serverMarkup(props: Record<string, unknown>): Promise<string> {
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    plugins: [svelte()],
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    ssr: { external: ["@zitadel/components", "@zitadel/api"] },
  });
  const define = vi.spyOn(customElements, "define").mockImplementation(() => {});
  try {
    const { render: renderOnServer } = (await server.ssrLoadModule(
      "svelte/server",
    )) as typeof import("svelte/server");
    const { default: Login } = (await server.ssrLoadModule("/src/lib/ZitadelLogin.svelte")) as {
      default: typeof ZitadelLogin;
    };
    return renderOnServer(Login, { props }).body;
  } finally {
    define.mockRestore();
    await server.close();
  }
}

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
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = await serverMarkup({ project: globalProject, purpose: "register" });
    const firstStep = new Promise((resolve) =>
      host
        .querySelector("zitadel-login")
        ?.addEventListener("zitadel-flow-step", resolve, { once: true }),
    );

    const app = hydrate(ZitadelLogin, {
      target: host,
      props: { project: globalProject, purpose: "register" },
    });

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
    await unmount(app);
    host.remove();
  });
});
