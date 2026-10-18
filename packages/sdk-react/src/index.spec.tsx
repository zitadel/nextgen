// @vitest-environment jsdom
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { render, waitFor } from "@testing-library/react";
import { _resetConfigForTesting, configureZitadel } from "@zitadel/api/config";
import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENT_HANDLERS,
  type ZitadelLoginConfig,
  type ZitadelLogoutConfig,
  type ZitadelSessionConfig,
} from "@zitadel/sdk-core/types";
import * as React from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { businessLocales, ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";

// A representative project handle. The element still starts its flow before
// @lit/react binds this prop (see vitest.config.ts), so the expected mount-time
// rejection is ignored package-wide; these are light binding/event assertions.
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

  it("forwards resumeFlowId to the widget", () => {
    const { container } = render(<ZitadelLogin project={project} resumeFlowId="flow_123" />);
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.resumeFlowId).toBe("flow_123");
  });

  it("reads a null resumeFlowId as no handle", () => {
    const { container } = render(<ZitadelLogin project={project} resumeFlowId={null} />);
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.resumeFlowId).toBe("");
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

/** The attributes of the first `<tag>` in server-rendered HTML. */
function serverAttributes(tag: string, node: React.ReactElement): Record<string, string> {
  const html = renderToString(node);
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`).exec(html);
  expect(open, `<${tag}> missing from server HTML`).not.toBeNull();
  return Object.fromEntries(
    [...(open?.[1] ?? "").matchAll(/([a-z][\w-]*)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? ""]),
  );
}

describe("server-rendered widget config", () => {
  const handle = { projectId: "proj-test", proxyPath: "/__nextgen", url: "http://auth.test" };

  it("puts the login flow config into the server markup", () => {
    expect(
      serverAttributes(
        "zitadel-login",
        <ZitadelLogin project={handle} purpose="register" flowName="signup" />,
      ),
    ).toMatchObject({
      purpose: "register",
      "flow-name": "signup",
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      url: "http://auth.test",
    });
  });

  it("puts the discrete project props into the login markup", () => {
    expect(
      serverAttributes("zitadel-login", <ZitadelLogin projectId="p1" proxyPath="/px" />),
    ).toMatchObject({ purpose: "login", "project-id": "p1", "proxy-path": "/px" });
  });

  it.each([
    ["zitadel-login", (p: object) => <ZitadelLogin {...p} />],
    ["zitadel-session", (p: object) => <ZitadelSession {...p} />],
    ["zitadel-logout", (p: object) => <ZitadelLogout {...p} />],
  ])("leaves a keyed project handle out of the %s markup", (tag, widget) => {
    const attributes = serverAttributes(
      tag,
      widget({ project: { ...handle, publishableKey: "pk_test_123" }, projectId: "other" }),
    );
    expect(attributes).not.toHaveProperty("project-id");
    expect(attributes).not.toHaveProperty("proxy-path");
    expect(attributes).not.toHaveProperty("url");
  });

  it("puts the display options into the server markup", () => {
    expect(
      serverAttributes(
        "zitadel-login",
        <ZitadelLogin
          project={handle}
          variant="page"
          theme="dark"
          lang="de"
          suppressHeader
          suppressPasswordToggle
        />,
      ),
    ).toMatchObject({
      variant: "page",
      theme: "dark",
      lang: "de",
      "suppress-header": "",
      "suppress-password-toggle": "",
    });
    expect(
      serverAttributes(
        "zitadel-session",
        <ZitadelSession
          project={handle}
          heading="Hi"
          logoutLabel="Out"
          variant="page"
          suppressHeader
        />,
      ),
    ).toMatchObject({
      heading: "Hi",
      "logout-label": "Out",
      variant: "page",
      "suppress-header": "",
    });
  });

  it("puts the session config into the server markup", () => {
    expect(
      serverAttributes(
        "zitadel-session",
        <ZitadelSession project={handle} postSignOutUrl="/bye" />,
      ),
    ).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      url: "http://auth.test",
      "post-sign-out-url": "/bye",
    });
  });

  it("puts the logout config into the server markup", () => {
    expect(
      serverAttributes("zitadel-logout", <ZitadelLogout project={handle} postSignOutUrl="/bye" />),
    ).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      url: "http://auth.test",
      "post-sign-out-url": "/bye",
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
});

describe("businessLocales", () => {
  it("re-exports the business copy overlay from @zitadel/components", () => {
    expect(businessLocales).toBe(componentsBusinessLocales);
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
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(elementValues(el!, loginConfig)).toEqual(loginConfig);
  });

  it("forwards every ZitadelSessionConfig key to <zitadel-session>", () => {
    const { container } = render(<ZitadelSession {...sessionConfig} />);
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(elementValues(el!, sessionConfig)).toEqual(sessionConfig);
  });

  it("forwards every ZitadelLogoutConfig key to <zitadel-logout>", () => {
    const { container } = render(<ZitadelLogout {...logoutConfig} />);
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(elementValues(el!, logoutConfig)).toEqual(logoutConfig);
  });
});
