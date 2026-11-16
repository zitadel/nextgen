// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { act, render, waitFor } from "@testing-library/react";
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
import * as React from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  businessLocales,
  ZitadelLogin,
  type ZitadelLoginReactProps,
  ZitadelLogout,
  type ZitadelLogoutReactProps,
  ZitadelSession,
  type ZitadelSessionReactProps,
} from "./index";

import {
  describeServerRenderCases,
  describeServerStandardAttributes,
} from "@zitadel/client-sdk-contract/server-render";
import {
  type Attributes,
  cssProperties,
  describeStandardAttributes,
} from "@zitadel/client-sdk-contract/standard-attributes";

// A representative project handle. The element still starts its flow before
// @lit/react binds this prop (see vitest.config.ts), so the expected mount-time
// rejection is ignored package-wide; these are light binding/event assertions.
const project = { projectId: "proj-test", proxyPath: "/__nextgen" };

function widgetIn<Tag extends WidgetTag>(root: ParentNode, tag: Tag): HTMLElementTagNameMap[Tag] {
  const element = root.querySelector(tag);
  if (!element) throw new Error(`no <${tag}> was rendered`);
  return element;
}

describe("ZitadelLogin", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(<ZitadelLogin project={project} purpose="login" />);
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(<ZitadelLogin projectId="proj-test" proxyPath="/__nextgen" />);
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards locales and lang to the widget", () => {
    const locales = { en: { "identifier.title": "Welcome back" } };
    const { container } = render(<ZitadelLogin project={project} locales={locales} lang="de" />);
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(el!.locales).toBe(locales);
    expect(el!.lang).toBe("de");
  });

  it("forwards resumeFlowId to the widget", () => {
    const { container } = render(<ZitadelLogin project={project} resumeFlowId="flow_123" />);
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(el!.resumeFlowId).toBe("flow_123");
  });

  it("reads a null resumeFlowId as no handle", () => {
    const { container } = render(<ZitadelLogin project={project} resumeFlowId={null} />);
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(el!.resumeFlowId).toBe("");
  });

  it("forwards the preview props to the widget", () => {
    const { container } = render(
      <ZitadelLogin project={project} previewState="success" previewSuccessStep="done" />,
    );
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(el!.previewState).toBe("success");
    expect(el!.previewSuccessStep).toBe("done");
  });

  it.each(Object.entries(ZITADEL_LOGIN_EVENT_HANDLERS))(
    "forwards %s to its callback",
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(<ZitadelLogin project={project} {...{ [handlerProp]: spy }} />);
      const el = container.querySelector(widgetTags.login);
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("forwards a ref to the underlying element", () => {
    const ref = React.createRef<ZitadelLoginElement>();
    const { container } = render(<ZitadelLogin ref={ref} project={project} />);
    expect(ref.current).toBe(container.querySelector(widgetTags.login));
    expect(ref.current?.tagName.toLowerCase()).toBe(widgetTags.login);
  });
});

describe("ZitadelLogout", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(<ZitadelLogout project={project} />);
    const el = container.querySelector<ZitadelLogoutElement>(widgetTags.logout);
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(<ZitadelLogout projectId="proj-test" proxyPath="/__nextgen" />);
    const el = container.querySelector<ZitadelLogoutElement>(widgetTags.logout);
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it.each(Object.entries(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    "forwards %s to its callback",
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(<ZitadelLogout project={project} {...{ [handlerProp]: spy }} />);
      const el = container.querySelector(widgetTags.logout);
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("passes an async callback's promise to the event's waitUntil", async () => {
    const ran = vi.fn();
    const registered: Array<Promise<unknown>> = [];
    const { container } = render(
      <ZitadelLogout project={project} onSignout={() => Promise.resolve().then(() => ran())} />,
    );
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

  it("forwards a ref to the underlying element", () => {
    const ref = React.createRef<ZitadelLogoutElement>();
    const { container } = render(<ZitadelLogout ref={ref} project={project} />);
    expect(ref.current).toBe(container.querySelector(widgetTags.logout));
    expect(ref.current?.tagName.toLowerCase()).toBe(widgetTags.logout);
  });
});

describe("ZitadelSession", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(<ZitadelSession project={project} />);
    const el = container.querySelector<ZitadelSessionElement>(widgetTags.session);
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(<ZitadelSession projectId="proj-test" proxyPath="/__nextgen" />);
    const el = container.querySelector<ZitadelSessionElement>(widgetTags.session);
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards the surface variant/theme", () => {
    const { container } = render(
      <ZitadelSession project={project} variant="page" theme="light" suppressHeader />,
    );
    const el = container.querySelector<ZitadelSessionElement>(widgetTags.session);
    expect(el!.variant).toBe("page");
    expect(el!.theme).toBe("light");
    expect(el!.suppressHeader).toBe(true);
  });

  it.each(Object.entries(ZITADEL_SESSION_EVENT_HANDLERS))(
    "forwards %s to its callback",
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(
        <ZitadelSession project={project} {...{ [handlerProp]: spy }} />,
      );
      const el = container.querySelector(widgetTags.session);
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("forwards a ref to the underlying element", () => {
    const ref = React.createRef<ZitadelSessionElement>();
    const { container } = render(<ZitadelSession ref={ref} project={project} />);
    expect(ref.current).toBe(container.querySelector(widgetTags.session));
    expect(ref.current?.tagName.toLowerCase()).toBe(widgetTags.session);
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
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = renderToString(<ZitadelLogin project={globalProject} purpose="register" />);

    hydrateRoot(host, <ZitadelLogin project={globalProject} purpose="register" />);

    await waitFor(() => expect(fetched).toHaveBeenCalled());
    const bodies = await Promise.all(
      fetched.mock.calls.map(async ([input, init]) =>
        JSON.parse(
          String(init?.body ?? (input instanceof Request ? await input.clone().text() : "null")),
        ),
      ),
    );
    const created = bodies.filter((body) => body?.project_id);
    expect(created[0]).toMatchObject({ purpose: "register" });
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
    const login = <ZitadelLogin project={globalProject} resumeFlowId="flow_123" />;
    host.innerHTML = renderToString(login);
    const rendered = host.querySelector(widgetTags.login);
    expect(rendered?.getAttribute("resume-flow-id")).toBe("flow_123");
    const firstStep = new Promise((resolve) =>
      rendered?.addEventListener("zitadel-flow-step", resolve, { once: true }),
    );

    await act(async () => {
      hydrateRoot(host, login);
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
    host.remove();
  });
});

describe("a login resumed to completion before it hydrates", () => {
  afterEach(() => {
    _resetConfigForTesting();
    vi.restoreAllMocks();
  });

  it("exchanges the handoff and navigates to the server-rendered post-sign-in URL", async () => {
    const globalProject = configureZitadel({
      projectId: "proj-global",
      proxyPath: "https://flow.test.invalid",
    });
    const exchanged: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "GET") {
        return Response.json({
          flow_id: "flow_123",
          step: { name: "done", complete: "show" },
          handoff_token: "handoff-token",
        });
      }
      exchanged.push(await request.text());
      return Response.json({});
    });
    const assign = vi.fn();
    const { location } = window;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...location, assign },
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    try {
      const login = (
        <ZitadelLogin project={globalProject} resumeFlowId="flow_123" postSignInUrl="/home" />
      );
      // The element upgrades from the server markup and finishes the flow
      // before React has hydrated anything.
      host.innerHTML = renderToString(login);
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/home"));
      expect(exchanged).toHaveLength(1);
      expect(exchanged[0]).toContain("handoff-token");

      hydrateRoot(host, login);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: location });
      host.remove();
    }
  });
});

describe("a login with a keyed project handle", () => {
  const keyed = {
    projectId: "proj-keyed",
    proxyPath: "https://flow.test.invalid",
    publishableKey: "pk_test_123",
  };

  afterEach(() => {
    _resetConfigForTesting();
    vi.restoreAllMocks();
  });

  it("renders no element on the server", () => {
    expect(renderToString(<ZitadelLogin project={keyed} />)).toBe("");
  });

  it("starts its first flow once, with the bearer, after mounting", async () => {
    const fetched = vi.spyOn(globalThis, "fetch");
    const host = document.createElement("div");
    document.body.appendChild(host);
    hydrateRoot(host, <ZitadelLogin project={keyed} />);

    await waitFor(() => expect(host.querySelector(widgetTags.login)).not.toBeNull());
    expect(widgetIn(host, widgetTags.login).project).toBe(keyed);
    await waitFor(() => expect(fetched).toHaveBeenCalled());
    expect(fetched).toHaveBeenCalledTimes(1);
    const [input, init] = fetched.mock.calls[0]!;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
    expect(headers.get("authorization")).toBe("Bearer pk_test_123");
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
    const { container } = render(<ZitadelSession project={project} />);

    expect(widgetIn(container, widgetTags.session)[prop]).toBe(expected);
  });

  it.each([
    ["variant", "widget"],
    ["theme", ""],
    ["suppressHeader", false],
    ["lang", ""],
    ["suppressPasswordToggle", false],
  ] as const)("ZitadelLogin keeps the default %s", (prop, expected) => {
    const { container } = render(<ZitadelLogin project={project} />);

    expect(widgetIn(container, widgetTags.login)[prop]).toBe(expected);
  });

  it("ZitadelLogout keeps the default theme", () => {
    const { container } = render(<ZitadelLogout project={project} />);

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
  ] as const)("ZitadelSession restores the default %s", (prop, given, expected) => {
    const { container, rerender } = render(
      <ZitadelSession project={project} {...{ [prop]: given }} />,
    );
    const el = widgetIn(container, widgetTags.session);
    expect(el[prop]).toBe(given);

    rerender(<ZitadelSession project={project} {...{ [prop]: undefined }} />);

    expect(el[prop]).toBe(expected);
  });

  it.each([
    ["variant", "page", "widget"],
    ["theme", "light", ""],
    ["suppressHeader", true, false],
    ["lang", "de", ""],
    ["suppressPasswordToggle", true, false],
  ] as const)("ZitadelLogin restores the default %s", (prop, given, expected) => {
    const { container, rerender } = render(
      <ZitadelLogin project={project} {...{ [prop]: given }} />,
    );
    const el = widgetIn(container, widgetTags.login);
    expect(el[prop]).toBe(given);

    rerender(<ZitadelLogin project={project} {...{ [prop]: undefined }} />);

    expect(el[prop]).toBe(expected);
  });

  it("ZitadelLogout restores the default theme", () => {
    const { container, rerender } = render(<ZitadelLogout project={project} theme="light" />);
    const el = widgetIn(container, widgetTags.logout);
    expect(el.theme).toBe("light");

    rerender(<ZitadelLogout project={project} theme={undefined} />);

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
    const { container } = render(<ZitadelLogin {...loginConfig} />);
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(elementValues(el!, loginConfig)).toEqual(loginConfig);
  });

  it("forwards every ZitadelSessionConfig key to <zitadel-session>", () => {
    const { container } = render(<ZitadelSession {...sessionConfig} />);
    const el = container.querySelector<ZitadelSessionElement>(widgetTags.session);
    expect(elementValues(el!, sessionConfig)).toEqual(sessionConfig);
  });

  it("forwards every ZitadelLogoutConfig key to <zitadel-logout>", () => {
    const { container } = render(<ZitadelLogout {...logoutConfig} />);
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
      react: ">=18",
      "react-dom": ">=18",
    });
  });
});

const SDK = "react";

/** The attributes on the widget's element in the markup a server would send. */
async function renderAttributes(
  widget: "login" | "session" | "logout",
  props: Readonly<Record<string, unknown>>,
): Promise<Record<string, string>> {
  const Widget = { login: ZitadelLogin, session: ZitadelSession, logout: ZitadelLogout }[
    widget
  ] as React.ElementType;
  // The server has no `document`, which is how the wrapper knows to write the markup out.
  vi.stubGlobal("document", undefined);
  const { tabindex, ...rest } = props;
  const html = renderToString(
    <Widget {...rest} {...(typeof tabindex === "string" ? { tabIndex: Number(tabindex) } : {})} />,
  );
  vi.unstubAllGlobals();
  const host = document.createElement("div");
  host.innerHTML = html;
  const el = host.firstElementChild;
  expect(el, `<zitadel-${widget}> missing from server HTML`).not.toBeNull();
  return Object.fromEntries(el!.getAttributeNames().map((n) => [n, el!.getAttribute(n) ?? ""]));
}

describeServerRenderCases(SDK, renderAttributes);

describe("server-rendered properties", () => {
  it("leaves the properties and the callbacks out of the server markup", async () => {
    const attributes = await renderAttributes("login", {
      project: { projectId: "p1", proxyPath: "/px" },
      variant: "page",
      locales: { en: {} },
      onFlowStep: () => undefined,
    });
    for (const name of ["variant", "locales", "onflowstep"]) {
      expect(attributes).not.toHaveProperty(name);
    }
    expect(Object.values(attributes).join(" ")).not.toContain("object Object");
  });
});

type ForwardedAttributes = {
  className: string;
  style: React.CSSProperties;
  id: string;
  title: string;
  slot: string;
  hidden: boolean;
  role: "region";
  tabIndex: number;
  "aria-label": string;
};

type WidgetProps = {
  login: ZitadelLoginReactProps;
  logout: ZitadelLogoutReactProps;
  session: ZitadelSessionReactProps;
};

const staleOnRemoval: readonly string[] = [];

// Mounts a widget with the given attributes (named as the markup names them) and
// reaches its element through a `ref`, the way a consumer does. `update` renders it
// again with other attributes.
async function mountWidget(widget: WidgetName, attributes: Attributes) {
  const Widget = { login: ZitadelLogin, logout: ZitadelLogout, session: ZitadelSession }[widget];
  let element: HTMLElement | null = null;
  const elementFor = ({ class: className, style, hidden, tabindex, ...rest }: Attributes) => (
    <Widget
      {...rest}
      {...(hidden === undefined ? {} : { hidden: hidden === "" })}
      {...(typeof tabindex === "string" ? { tabIndex: Number(tabindex) } : {})}
      {...(typeof className === "string" ? { className } : {})}
      {...(typeof style === "string" ? { style: cssProperties(style) } : {})}
      ref={(el: HTMLElement | null) => {
        element = el;
      }}
    />
  );
  const { container, rerender } = render(elementFor(attributes));
  return {
    container,
    ref: () => element,
    update: async (next: Attributes) => {
      rerender(elementFor(next));
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
