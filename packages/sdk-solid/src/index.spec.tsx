// @vitest-environment jsdom
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { render } from "@solidjs/testing-library";
import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENT_HANDLERS,
} from "@zitadel/sdk-core/types";
import { type Component, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import { businessLocales, ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";

const project = { projectId: "proj-test", proxyPath: "/__nextgen" };

describe("ZitadelLogin", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(() => <ZitadelLogin project={project} purpose="login" />);
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(() => (
      <ZitadelLogin projectId="proj-test" proxyPath="/__nextgen" />
    ));
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards locales and lang to the widget", () => {
    const locales = { en: { "identifier.title": "Welcome back" } };
    const { container } = render(() => (
      <ZitadelLogin project={project} locales={locales} lang="de" />
    ));
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
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
      const el = container.querySelector("zitadel-login");
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("renders children into the element for its attribution-trailing slot", () => {
    const { container } = render(() => (
      <ZitadelLogin project={project}>
        <span slot="attribution-trailing">Terms</span>
      </ZitadelLogin>
    ));
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.querySelector('[slot="attribution-trailing"]')?.textContent).toBe("Terms");
  });

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
    expect(captured).toBe(container.querySelector("zitadel-login"));
    expect(captured?.tagName.toLowerCase()).toBe("zitadel-login");
  });
});

describe("ZitadelLogout", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(() => <ZitadelLogout project={project} />);
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(() => (
      <ZitadelLogout projectId="proj-test" proxyPath="/__nextgen" />
    ));
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
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
      const el = container.querySelector("zitadel-logout");
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("passes a <template> child to the element before it connects", () => {
    const { container } = render(() => (
      <ZitadelLogout project={project}>
        <template>
          <button type="button" data-action="logout">
            {"Sign out {{display}}"}
          </button>
        </template>
      </ZitadelLogout>
    ));
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el!.querySelector("template")).not.toBeNull();
    expect(el!.querySelector("span [data-action='logout']")).not.toBeNull();
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
    expect(captured).toBe(container.querySelector("zitadel-logout"));
    expect(captured?.tagName.toLowerCase()).toBe("zitadel-logout");
  });
});

describe("ZitadelSession", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(() => <ZitadelSession project={project} />);
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(() => (
      <ZitadelSession projectId="proj-test" proxyPath="/__nextgen" />
    ));
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards the surface variant/theme", () => {
    const { container } = render(() => (
      <ZitadelSession project={project} variant="page" theme="light" suppressHeader />
    ));
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
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
      const el = container.querySelector("zitadel-session");
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
    expect(captured).toBe(container.querySelector("zitadel-session"));
    expect(captured?.tagName.toLowerCase()).toBe("zitadel-session");
  });
});

// Element defaults the wrappers must leave alone: unset props are never
// assigned, and a prop cleared back to `undefined` is forwarded as-is so the
// element restores its own default.
const defaults: {
  name: string;
  Wrapper: Component<Record<string, unknown>>;
  tag: string;
  prop: string;
  value: unknown;
  fallback: unknown;
}[] = [
  {
    name: "ZitadelLogin",
    Wrapper: ZitadelLogin,
    tag: "zitadel-login",
    prop: "purpose",
    value: "register",
    fallback: "login",
  },
  {
    name: "ZitadelLogin",
    Wrapper: ZitadelLogin,
    tag: "zitadel-login",
    prop: "variant",
    value: "page",
    fallback: "widget",
  },
  {
    name: "ZitadelLogin",
    Wrapper: ZitadelLogin,
    tag: "zitadel-login",
    prop: "theme",
    value: "dark",
    fallback: "",
  },
  {
    name: "ZitadelLogin",
    Wrapper: ZitadelLogin,
    tag: "zitadel-login",
    prop: "lang",
    value: "de",
    fallback: "",
  },
  {
    name: "ZitadelLogin",
    Wrapper: ZitadelLogin,
    tag: "zitadel-login",
    prop: "suppressHeader",
    value: true,
    fallback: false,
  },
  {
    name: "ZitadelLogin",
    Wrapper: ZitadelLogin,
    tag: "zitadel-login",
    prop: "resumeFlowId",
    value: "flow_123",
    fallback: "",
  },
  {
    name: "ZitadelSession",
    Wrapper: ZitadelSession,
    tag: "zitadel-session",
    prop: "heading",
    value: "Hi",
    fallback: "Signed in as",
  },
  {
    name: "ZitadelSession",
    Wrapper: ZitadelSession,
    tag: "zitadel-session",
    prop: "logoutLabel",
    value: "Bye",
    fallback: "Sign out",
  },
  {
    name: "ZitadelSession",
    Wrapper: ZitadelSession,
    tag: "zitadel-session",
    prop: "variant",
    value: "page",
    fallback: "widget",
  },
  {
    name: "ZitadelSession",
    Wrapper: ZitadelSession,
    tag: "zitadel-session",
    prop: "theme",
    value: "dark",
    fallback: "",
  },
  {
    name: "ZitadelSession",
    Wrapper: ZitadelSession,
    tag: "zitadel-session",
    prop: "suppressHeader",
    value: true,
    fallback: false,
  },
  {
    name: "ZitadelLogout",
    Wrapper: ZitadelLogout,
    tag: "zitadel-logout",
    prop: "theme",
    value: "dark",
    fallback: "",
  },
];

describe("element defaults", () => {
  it.each(defaults)(
    "$name keeps $prop at $fallback when unset",
    ({ Wrapper, tag, prop, fallback }) => {
      const { container } = render(() => <Wrapper project={project} />);
      const el = container.querySelector(tag) as unknown as Record<string, unknown>;
      expect(el[prop]).toBe(fallback);
    },
  );

  it.each(defaults)(
    "$name restores $prop to $fallback when cleared",
    ({ Wrapper, tag, prop, value, fallback }) => {
      const [current, setCurrent] = createSignal<unknown>(value);
      const { container } = render(() => (
        <Wrapper
          project={project}
          {...{
            get [prop]() {
              return current();
            },
          }}
        />
      ));
      const el = container.querySelector(tag) as unknown as Record<string, unknown>;
      expect(el[prop]).toBe(value);
      setCurrent(undefined);
      expect(el[prop]).toBe(fallback);
    },
  );
});

describe("businessLocales", () => {
  it("re-exports the business copy overlay from @zitadel/components", () => {
    expect(businessLocales).toBe(componentsBusinessLocales);
  });
});
