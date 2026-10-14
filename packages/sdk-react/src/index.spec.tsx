// @vitest-environment jsdom
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENT_HANDLERS,
} from "@zitadel/sdk-core/types";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { businessLocales, ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";

// A representative project handle. `@lit/react` binds it in a layout effect,
// before the element's first update starts the flow.
const project = { projectId: "proj-test", proxyPath: "/__nextgen" };

describe("ZitadelLogin", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(<ZitadelLogin project={project} purpose="login" />);
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(<ZitadelLogin projectId="proj-test" proxyPath="/__nextgen" />);
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards locales and lang to the widget", () => {
    const locales = { en: { "identifier.title": "Welcome back" } };
    const { container } = render(<ZitadelLogin project={project} locales={locales} lang="de" />);
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.locales).toBe(locales);
    expect(el!.lang).toBe("de");
  });

  it("forwards the preview props to the widget", () => {
    const { container } = render(
      <ZitadelLogin project={project} previewState="success" previewSuccessStep="done" />,
    );
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.previewState).toBe("success");
    expect(el!.previewSuccessStep).toBe("done");
  });

  it.each(Object.entries(ZITADEL_LOGIN_EVENT_HANDLERS))(
    "forwards %s to its callback",
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(<ZitadelLogin project={project} {...{ [handlerProp]: spy }} />);
      const el = container.querySelector("zitadel-login");
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("forwards a ref to the underlying element", () => {
    const ref = React.createRef<ZitadelLoginElement>();
    const { container } = render(<ZitadelLogin ref={ref} project={project} />);
    expect(ref.current).toBe(container.querySelector("zitadel-login"));
    expect(ref.current?.tagName.toLowerCase()).toBe("zitadel-login");
  });
});

describe("ZitadelLogout", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(<ZitadelLogout project={project} />);
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(<ZitadelLogout projectId="proj-test" proxyPath="/__nextgen" />);
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it.each(Object.entries(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    "forwards %s to its callback",
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(<ZitadelLogout project={project} {...{ [handlerProp]: spy }} />);
      const el = container.querySelector("zitadel-logout");
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("forwards a ref to the underlying element", () => {
    const ref = React.createRef<ZitadelLogoutElement>();
    const { container } = render(<ZitadelLogout ref={ref} project={project} />);
    expect(ref.current).toBe(container.querySelector("zitadel-logout"));
    expect(ref.current?.tagName.toLowerCase()).toBe("zitadel-logout");
  });
});

describe("ZitadelSession", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(<ZitadelSession project={project} />);
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(<ZitadelSession projectId="proj-test" proxyPath="/__nextgen" />);
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards the surface variant/theme", () => {
    const { container } = render(
      <ZitadelSession project={project} variant="page" theme="light" suppressHeader />,
    );
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
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
      const el = container.querySelector("zitadel-session");
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("forwards a ref to the underlying element", () => {
    const ref = React.createRef<ZitadelSessionElement>();
    const { container } = render(<ZitadelSession ref={ref} project={project} />);
    expect(ref.current).toBe(container.querySelector("zitadel-session"));
    expect(ref.current?.tagName.toLowerCase()).toBe("zitadel-session");
  });
});

describe("businessLocales", () => {
  it("re-exports the business copy overlay from @zitadel/components", () => {
    expect(businessLocales).toBe(componentsBusinessLocales);
  });
});

// The element's own defaults, which every wrapper must leave in place when a
// prop is unset and restore when a prop is cleared.
const LOGIN_DEFAULTS = {
  purpose: "login",
  variant: "widget",
  theme: "",
  lang: "",
  suppressHeader: false,
} as const;
const LOGIN_VALUES = {
  purpose: "register",
  variant: "page",
  theme: "light",
  lang: "de",
  suppressHeader: true,
} as const;
const SESSION_DEFAULTS = {
  heading: "Signed in as",
  logoutLabel: "Sign out",
  variant: "widget",
  theme: "",
  suppressHeader: false,
} as const;
const SESSION_VALUES = {
  heading: "Welcome",
  logoutLabel: "Leave",
  variant: "page",
  theme: "dark",
  suppressHeader: true,
} as const;

describe.each([
  ["ZitadelLogin", "zitadel-login", ZitadelLogin, LOGIN_DEFAULTS, LOGIN_VALUES],
  ["ZitadelSession", "zitadel-session", ZitadelSession, SESSION_DEFAULTS, SESSION_VALUES],
  ["ZitadelLogout", "zitadel-logout", ZitadelLogout, { theme: "" }, { theme: "dark" }],
] as const)("%s element defaults", (_name, tag, Component, defaults, values) => {
  const Wrapper = Component as React.ComponentType<Record<string, unknown>>;
  const prop = (el: Element, key: string) => (el as unknown as Record<string, unknown>)[key];

  it.each(Object.entries(defaults))("keeps %s at its default when unset", (key, fallback) => {
    const { container } = render(<Wrapper project={project} />);
    expect(prop(container.querySelector(tag)!, key)).toBe(fallback);
  });

  it.each(Object.entries(defaults))(
    "keeps %s at its default when passed undefined",
    (key, fallback) => {
      const { container } = render(<Wrapper project={project} {...{ [key]: undefined }} />);
      expect(prop(container.querySelector(tag)!, key)).toBe(fallback);
    },
  );

  it.each(Object.entries(defaults))("restores %s to its default when cleared", (key, fallback) => {
    const given = (values as Record<string, unknown>)[key];
    const { container, rerender } = render(<Wrapper project={project} {...{ [key]: given }} />);
    expect(prop(container.querySelector(tag)!, key)).toBe(given);

    rerender(<Wrapper project={project} />);

    expect(prop(container.querySelector(tag)!, key)).toBe(fallback);
  });
});

describe.each([
  ["ZitadelLogout", "zitadel-logout", ZitadelLogout],
  ["ZitadelSession", "zitadel-session", ZitadelSession],
  ["ZitadelLogin", "zitadel-login", ZitadelLogin],
] as const)("%s children", (_name, tag, Component) => {
  const Wrapper = Component as React.ComponentType<Record<string, unknown>>;

  it("renders children into the element's light DOM", () => {
    const { container } = render(
      <Wrapper project={project}>
        <span slot="attribution-trailing">extra</span>
      </Wrapper>,
    );
    expect(container.querySelector(`${tag} > span[slot="attribution-trailing"]`)).not.toBeNull();
  });
});

describe("ZitadelLogout template children", () => {
  it("projects a <template> child as the sign-out control", async () => {
    const { container } = render(
      <ZitadelLogout project={project}>
        <template>
          <button type="button" data-action="logout">
            Bye
          </button>
        </template>
      </ZitadelLogout>,
    );
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout")!;
    await el.updateComplete;
    expect(el.querySelector("span [data-action='logout']")?.textContent).toBe("Bye");
  });
});

describe("published build", () => {
  // Next's App Router renders server components with the `react-server`
  // build of React, which has no `useRef`/`useLayoutEffect`; the directive
  // makes the bundle a client boundary instead of a crash.
  it("keeps the use client directive at the top of dist/index.js", () => {
    const bundle = readFileSync(join(process.cwd(), "dist/index.js"), "utf8");
    expect(bundle.trimStart().startsWith('"use client"')).toBe(true);
  });
});
