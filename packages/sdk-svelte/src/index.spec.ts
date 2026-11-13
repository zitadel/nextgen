// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { svelte } from "@sveltejs/vite-plugin-svelte";
import { render, waitFor } from "@testing-library/svelte";
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
import type { Component } from "svelte";
import { hydrate, unmount } from "svelte";
import { createServer } from "vite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { businessLocales } from "./lib/index";
import type {
  ZitadelLoginSvelteProps,
  ZitadelLogoutSvelteProps,
  ZitadelSessionSvelteProps,
} from "./lib/types";
import ZitadelLogin from "./lib/ZitadelLogin.svelte";
import ZitadelLogout from "./lib/ZitadelLogout.svelte";
import ZitadelSession from "./lib/ZitadelSession.svelte";

import { describeServerRenderCases } from "@zitadel/framework-contract/server-render";
import {
  type Attributes,
  cssProperties,
  describeStandardAttributes,
} from "@zitadel/framework-contract/standard-attributes";

const project = { projectId: "proj-test", proxyPath: "/__nextgen" };

function widgetIn<Tag extends WidgetTag>(root: ParentNode, tag: Tag): HTMLElementTagNameMap[Tag] {
  const element = root.querySelector(tag);
  if (!element) throw new Error(`no <${tag}> was rendered`);
  return element;
}

describe("ZitadelLogin", () => {
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

  it("forwards resumeFlowId to the widget", () => {
    const { container } = render(ZitadelLogin, {
      props: { project, resumeFlowId: "flow_123" },
    });
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
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
      const el = container.querySelector(widgetTags.login);
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
    expect(el?.tagName.toLowerCase()).toBe(widgetTags.login);
    expect(el).toBe(container.querySelector(widgetTags.login));
  });
});

describe("ZitadelLogout", () => {
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

  it("passes an async callback's promise to the event's waitUntil", async () => {
    const ran = vi.fn();
    const registered: Array<Promise<unknown>> = [];
    const { container } = render(ZitadelLogout, {
      props: { project, onSignout: () => Promise.resolve().then(() => ran()) },
    });
    const el = widgetIn(container, widgetTags.logout);
    el.dispatchEvent(
      new CustomEvent("zitadel-signout", {
        detail: { waitUntil: (work: Promise<unknown>) => registered.push(work) },
      }),
    );
    expect(registered).toHaveLength(1);
    await registered[0];
    expect(ran).toHaveBeenCalledOnce();
  });

  it("exposes the underlying element via getElement()", () => {
    const { component, container } = render(ZitadelLogout, {
      props: { project },
    });
    const el = component.getElement();
    expect(el?.tagName.toLowerCase()).toBe(widgetTags.logout);
    expect(el).toBe(container.querySelector(widgetTags.logout));
  });
});

describe("ZitadelSession", () => {
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

  it("exposes the underlying element via getElement()", () => {
    const { component, container } = render(ZitadelSession, {
      props: { project },
    });
    const el = component.getElement();
    expect(el?.tagName.toLowerCase()).toBe(widgetTags.session);
    expect(el).toBe(container.querySelector(widgetTags.session));
  });
});

describe("businessLocales", () => {
  it("re-exports the business copy overlay from @zitadel/components", () => {
    expect(businessLocales).toBe(componentsBusinessLocales);
  });
});

// Every config key set to a distinct value. `Required<…>` makes `tsc` fail here
// when a key is added to a config type, so a new key cannot skip this check.
// The handle carries the same coordinates as the discrete props: the handle wins
// for the project attributes, so a different handle would mask the discrete props.
const parityProject = { projectId: "proj-parity", proxyPath: "/__parity" };

const loginConfig: Required<ZitadelLoginConfig> = {
  project: parityProject,
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
  project: parityProject,
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
  project: parityProject,
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
    expect(elementValues(el!, loginConfig)).toEqual(loginConfig);
  });

  it("forwards every ZitadelSessionConfig key to <zitadel-session>", () => {
    const { container } = render(ZitadelSession, { props: { ...sessionConfig } });
    const el = container.querySelector<ZitadelSessionElement>(widgetTags.session);
    expect(elementValues(el!, sessionConfig)).toEqual(sessionConfig);
  });

  it("forwards every ZitadelLogoutConfig key to <zitadel-logout>", () => {
    const { container } = render(ZitadelLogout, { props: { ...logoutConfig } });
    const el = container.querySelector<ZitadelLogoutElement>(widgetTags.logout);
    expect(elementValues(el!, logoutConfig)).toEqual(logoutConfig);
  });
});

// The package ships only what its build emits, so an `exports` target the build
// misses breaks every consumer that imports it. `test` runs after `build`.
describe("package manifest", () => {
  const packageRoot = resolve(import.meta.dirname, "..");
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
    main?: string;
    module?: string;
    types?: string;
    exports: unknown;
    peerDependencies: Record<string, string>;
  };

  function targets(value: unknown): string[] {
    if (typeof value === "string") return value.startsWith("./") ? [value] : [];
    if (value && typeof value === "object") return Object.values(value).flatMap(targets);
    return [];
  }

  it("ships every exports target in dist", () => {
    const declared = targets([manifest.exports, manifest.main, manifest.module, manifest.types]);
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((file) => !existsSync(resolve(packageRoot, file)))).toEqual([]);
  });

  it("declares its supported peer ranges", () => {
    expect(manifest.peerDependencies).toEqual({
      svelte: "^5.0.0",
    });
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

/**
 * Loads the login's server build and returns its server render. The server
 * compile of the component cannot share a module graph with this file's
 * browser compile, so a throwaway Vite server loads it, and `svelte/server`,
 * with the plugin's server build. The widget's own module is kept out of that
 * load (it is already registered in this jsdom window).
 */
async function loadServerMarkup(): Promise<(props: Record<string, unknown>) => string> {
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
    return (props) => {
      // A real server has no `document`, which `onClient` reads to leave the
      // property-only `project` handle out of the markup.
      const document = Object.getOwnPropertyDescriptor(globalThis, "document");
      Reflect.deleteProperty(globalThis, "document");
      try {
        return renderOnServer(Login, { props }).body;
      } finally {
        if (document) Object.defineProperty(globalThis, "document", document);
      }
    };
  } finally {
    define.mockRestore();
    await server.close();
  }
}

describe("hydrating a server-rendered login", () => {
  let serverMarkup: (props: Record<string, unknown>) => string;

  // The server build loads once, here, so each test's 5 s budget covers only
  // the hydration. On a cold, loaded CI runner the load takes 4 s or more (the
  // Vite server pre-bundles Svelte first); this hook's budget only bounds a hang.
  beforeAll(async () => {
    serverMarkup = await loadServerMarkup();
  }, 60_000);

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
    const markup = serverMarkup({ project: globalProject, purpose: "register" });
    expect(markup).not.toContain("[object Object]");
    host.innerHTML = markup;
    const firstStep = new Promise((resolve) =>
      host
        .querySelector(widgetTags.login)
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

  it("loads the supplied flow on its first request instead of creating one", async () => {
    const globalProject = configureZitadel({
      projectId: "proj-global",
      proxyPath: "https://flow.test.invalid",
    });
    const fetched = vi.spyOn(globalThis, "fetch");
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = serverMarkup({ project: globalProject, resumeFlowId: "flow_123" });
    const rendered = host.querySelector(widgetTags.login);
    expect(rendered?.getAttribute("resume-flow-id")).toBe("flow_123");
    const firstStep = new Promise((resolve) =>
      rendered?.addEventListener("zitadel-flow-step", resolve, { once: true }),
    );

    const app = hydrate(ZitadelLogin, {
      target: host,
      props: { project: globalProject, resumeFlowId: "flow_123" },
    });

    await waitFor(() => expect(fetched).toHaveBeenCalled());
    const first = new Request(fetched.mock.calls[0]![0], fetched.mock.calls[0]![1]);
    expect(first.method).toBe("GET");
    expect(first.url).toContain("flow_123");
    expect(host.querySelector(widgetTags.login)).toBe(rendered);
    await firstStep;
    await rendered?.updateComplete;
    await Promise.all(fetched.mock.results.map((result) => result.value));
    expect(fetched).toHaveBeenCalledTimes(1);
    await unmount(app);
    host.remove();
  });
});

const SDK = "svelte";

/** The attributes on the widget's element once the component has rendered. */
async function renderAttributes(
  widget: "login" | "session" | "logout",
  props: Readonly<Record<string, unknown>>,
): Promise<Record<string, string>> {
  const component = { login: ZitadelLogin, session: ZitadelSession, logout: ZitadelLogout }[
    widget
  ] as Component<Record<string, unknown>>;
  const { container } = render(component, { props: { ...props } });
  const el = container.querySelector(`zitadel-${widget}`);
  expect(el, `<zitadel-${widget}> missing from the markup`).not.toBeNull();
  return Object.fromEntries(el!.getAttributeNames().map((n) => [n, el!.getAttribute(n) ?? ""]));
}

describeServerRenderCases(SDK, renderAttributes);

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
  login: ZitadelLoginSvelteProps;
  logout: ZitadelLogoutSvelteProps;
  session: ZitadelSessionSvelteProps;
};

// Svelte assigns `title` to the element as a property and leaves "null" there when it is removed.
const staleOnRemoval: readonly string[] = ["title"];

// Mounts a widget with the given attributes (named as the markup names them) and
// reaches its element through the component's `getElement()`, the way a consumer
// does after `bind:this`. `update` renders it again with other attributes.
async function mountWidget(widget: WidgetName, attributes: Attributes) {
  const propsOf = ({ style, hidden, ...rest }: Attributes) => {
    // Svelte takes the style as a string.
    const declarations = typeof style === "string" ? Object.entries(cssProperties(style)) : [];
    return {
      ...rest,
      ...(hidden === undefined ? {} : { hidden: hidden === "" }),
      ...(declarations.length === 0
        ? {}
        : { style: declarations.map(([property, value]) => `${property}: ${value}`).join("; ") }),
    };
  };
  const props = propsOf(attributes);
  const { container, component, rerender } = {
    login: () => render(ZitadelLogin, { props }),
    logout: () => render(ZitadelLogout, { props }),
    session: () => render(ZitadelSession, { props }),
  }[widget]();
  return {
    container,
    ref: () => component.getElement(),
    update: async (next: Attributes) => {
      // A rerender sets the props it is given, so a removed one is set to undefined.
      const removed = Object.fromEntries(Object.keys(attributes).map((name) => [name, undefined]));
      await rerender({ ...removed, ...propsOf(next) });
    },
  };
}

describeStandardAttributes<ForwardedAttributes, WidgetProps>({
  mountWidget,
  staleOnRemoval,
  accepted: true,
  rejected: true,
});
