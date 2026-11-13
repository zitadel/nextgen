// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
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
import { describe, expect, it, vi } from "vitest";

import {
  businessLocales,
  ZitadelLogin,
  type ZitadelLoginSolidProps,
  ZitadelLogout,
  type ZitadelLogoutSolidProps,
  ZitadelSession,
  type ZitadelSessionSolidProps,
} from "./index";

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
    const { container } = render(() => <ZitadelLogin project={project} purpose="login" />);
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(() => (
      <ZitadelLogin projectId="proj-test" proxyPath="/__nextgen" />
    ));
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards resumeFlowId to the widget", () => {
    const { container } = render(() => <ZitadelLogin project={project} resumeFlowId="flow_123" />);
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(el!.resumeFlowId).toBe("flow_123");
  });

  it("reads a null resumeFlowId as no handle", () => {
    const { container } = render(() => <ZitadelLogin project={project} resumeFlowId={null} />);
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(el!.resumeFlowId).toBe("");
  });

  it("forwards locales and lang to the widget", () => {
    const locales = { en: { "identifier.title": "Welcome back" } };
    const { container } = render(() => (
      <ZitadelLogin project={project} locales={locales} lang="de" />
    ));
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(el!.locales).toBe(locales);
    expect(el!.lang).toBe("de");
  });

  it.each(Object.entries(ZITADEL_LOGIN_EVENT_HANDLERS))(
    "forwards %s to its callback",
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(() => (
        <ZitadelLogin project={project} {...{ [handlerProp]: spy }} />
      ));
      const el = container.querySelector(widgetTags.login);
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("forwards the ref to the underlying element", () => {
    let captured: ZitadelLoginElement | undefined;
    const { container } = render(() => (
      <ZitadelLogin
        ref={(e) => {
          captured = e;
        }}
        project={project}
      />
    ));
    expect(captured).toBe(container.querySelector(widgetTags.login));
    expect(captured?.tagName.toLowerCase()).toBe(widgetTags.login);
  });
});

describe("ZitadelLogout", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(() => <ZitadelLogout project={project} />);
    const el = container.querySelector<ZitadelLogoutElement>(widgetTags.logout);
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(() => (
      <ZitadelLogout projectId="proj-test" proxyPath="/__nextgen" />
    ));
    const el = container.querySelector<ZitadelLogoutElement>(widgetTags.logout);
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it.each(Object.entries(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    "forwards %s to its callback",
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(() => (
        <ZitadelLogout project={project} {...{ [handlerProp]: spy }} />
      ));
      const el = container.querySelector(widgetTags.logout);
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("passes an async callback's promise to the event's waitUntil", async () => {
    const ran = vi.fn();
    const registered: Array<Promise<unknown>> = [];
    const { container } = render(() => (
      <ZitadelLogout project={project} onSignout={() => Promise.resolve().then(() => ran())} />
    ));
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

  it("forwards the ref to the underlying element", () => {
    let captured: ZitadelLogoutElement | undefined;
    const { container } = render(() => (
      <ZitadelLogout
        ref={(e) => {
          captured = e;
        }}
        project={project}
      />
    ));
    expect(captured).toBe(container.querySelector(widgetTags.logout));
    expect(captured?.tagName.toLowerCase()).toBe(widgetTags.logout);
  });
});

describe("ZitadelSession", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(() => <ZitadelSession project={project} />);
    const el = container.querySelector<ZitadelSessionElement>(widgetTags.session);
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(() => (
      <ZitadelSession projectId="proj-test" proxyPath="/__nextgen" />
    ));
    const el = container.querySelector<ZitadelSessionElement>(widgetTags.session);
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards the surface variant/theme", () => {
    const { container } = render(() => (
      <ZitadelSession project={project} variant="page" theme="light" suppressHeader />
    ));
    const el = container.querySelector<ZitadelSessionElement>(widgetTags.session);
    expect(el!.variant).toBe("page");
    expect(el!.theme).toBe("light");
    expect(el!.suppressHeader).toBe(true);
  });

  it.each(Object.entries(ZITADEL_SESSION_EVENT_HANDLERS))(
    "forwards %s to its callback",
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(() => (
        <ZitadelSession project={project} {...{ [handlerProp]: spy }} />
      ));
      const el = container.querySelector(widgetTags.session);
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("forwards the ref to the underlying element", () => {
    let captured: ZitadelSessionElement | undefined;
    const { container } = render(() => (
      <ZitadelSession
        ref={(e) => {
          captured = e;
        }}
        project={project}
      />
    ));
    expect(captured).toBe(container.querySelector(widgetTags.session));
    expect(captured?.tagName.toLowerCase()).toBe(widgetTags.session);
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
    const { container } = render(() => <ZitadelSession project={project} />);

    expect(widgetIn(container, widgetTags.session)[prop]).toBe(expected);
  });

  it.each([
    ["variant", "widget"],
    ["theme", ""],
    ["suppressHeader", false],
    ["lang", ""],
    ["suppressPasswordToggle", false],
  ] as const)("ZitadelLogin keeps the default %s", (prop, expected) => {
    const { container } = render(() => <ZitadelLogin project={project} />);

    expect(widgetIn(container, widgetTags.login)[prop]).toBe(expected);
  });

  it("ZitadelLogout keeps the default theme", () => {
    const { container } = render(() => <ZitadelLogout project={project} />);

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
    const [value, setValue] = createSignal<unknown>(given);
    const { container } = render(() => (
      <ZitadelSession
        project={project}
        {...({
          get [prop]() {
            return value();
          },
        } as object)}
      />
    ));
    const el = widgetIn(container, widgetTags.session);
    expect(el[prop]).toBe(given);

    setValue(undefined);

    expect(el[prop]).toBe(expected);
  });

  it.each([
    ["variant", "page", "widget"],
    ["theme", "light", ""],
    ["suppressHeader", true, false],
    ["lang", "de", ""],
    ["suppressPasswordToggle", true, false],
  ] as const)("ZitadelLogin restores the default %s", (prop, given, expected) => {
    const [value, setValue] = createSignal<unknown>(given);
    const { container } = render(() => (
      <ZitadelLogin
        project={project}
        {...({
          get [prop]() {
            return value();
          },
        } as object)}
      />
    ));
    const el = widgetIn(container, widgetTags.login);
    expect(el[prop]).toBe(given);

    setValue(undefined);

    expect(el[prop]).toBe(expected);
  });

  it("ZitadelLogout restores the default theme", () => {
    const [theme, setTheme] = createSignal<"light" | undefined>("light");
    const { container } = render(() => <ZitadelLogout project={project} theme={theme()} />);
    const el = widgetIn(container, widgetTags.logout);
    expect(el.theme).toBe("light");

    setTheme(undefined);

    expect(el.theme).toBe("");
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

// The spreads copy the config because Solid writes the element `ref` back into
// a spread object, which would otherwise leak into the expected values.
// The element's value for each key, so a key the wrapper drops shows up by name.
const elementValues = (el: object, config: object): Record<string, unknown> =>
  Object.fromEntries(Object.keys(config).map((key) => [key, (el as Record<string, unknown>)[key]]));

describe("wrapper config parity", () => {
  it("forwards every ZitadelLoginConfig key to <zitadel-login>", () => {
    const { container } = render(() => <ZitadelLogin {...{ ...loginConfig }} />);
    const el = container.querySelector<ZitadelLoginElement>(widgetTags.login);
    expect(elementValues(el!, loginConfig)).toEqual(loginConfig);
  });

  it("forwards every ZitadelSessionConfig key to <zitadel-session>", () => {
    const { container } = render(() => <ZitadelSession {...{ ...sessionConfig }} />);
    const el = container.querySelector<ZitadelSessionElement>(widgetTags.session);
    expect(elementValues(el!, sessionConfig)).toEqual(sessionConfig);
  });

  it("forwards every ZitadelLogoutConfig key to <zitadel-logout>", () => {
    const { container } = render(() => <ZitadelLogout {...{ ...logoutConfig }} />);
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
      "solid-js": ">=1.6",
    });
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
  login: ZitadelLoginSolidProps;
  logout: ZitadelLogoutSolidProps;
  session: ZitadelSessionSolidProps;
};

const staleOnRemoval: readonly string[] = [];

// Mounts a widget with the given attributes (named as the markup names them) and
// reaches its element through a `ref`, the way a consumer does. `update` renders it
// again with other attributes.
async function mountWidget(widget: WidgetName, attributes: Attributes) {
  const Widget = { login: ZitadelLogin, logout: ZitadelLogout, session: ZitadelSession }[widget];
  const [current, setCurrent] = createSignal(attributes);
  const propsOf = ({ style, hidden, ...rest }: Attributes) => ({
    ...rest,
    ...(hidden === undefined ? {} : { hidden: hidden === "" }),
    ...(typeof style === "string" ? { style: cssProperties(style) } : {}),
  });
  let element: HTMLElement | undefined;
  const { container } = render(() => (
    <Widget
      {...propsOf(current())}
      ref={(el: HTMLElement) => {
        element = el;
      }}
    />
  ));
  return {
    container,
    ref: () => element,
    update: async (next: Attributes) => {
      setCurrent(next);
    },
  };
}

describeStandardAttributes<ForwardedAttributes, WidgetProps>({
  mountWidget,
  staleOnRemoval,
  accepted: true,
  rejected: true,
});
