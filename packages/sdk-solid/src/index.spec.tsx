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
  widgetNames,
  widgetTags,
} from "@zitadel/sdk-core/types";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  businessLocales,
  ZitadelLogin,
  type ZitadelLoginSolidProps,
  ZitadelLogout,
  type ZitadelLogoutSolidProps,
  ZitadelSession,
  type ZitadelSessionSolidProps,
} from "./index";

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

type Attributes = {
  readonly [name: string]: string | boolean | null | undefined;
};

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
