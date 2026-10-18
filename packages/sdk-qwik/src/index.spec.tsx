import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { $, render, type Signal } from "@qwik.dev/core";
import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENT_HANDLERS,
} from "@zitadel/sdk-core/types";
import { describe, expect, it, vi } from "vitest";

import { PasswordToggleHarness, ResumeFlowIdHarness } from "./__tests__/login-prop-harness";
import { SessionHeadingHarness } from "./__tests__/session-heading-harness";
import { UnsetPropHarness } from "./__tests__/unset-prop-harness";
import { businessLocales, ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";

const project = { projectId: "proj-test", proxyPath: "/__nextgen" };

/**
 * Under SSR (Qwik Router) Qwik resumes the server markup instead of re-running
 * the `ref` binder, so the widget boots from its attributes alone. These are the
 * attributes the server must emit; the client render emits the same ones.
 */
function attributesOf(host: HTMLElement, tag: string, names: readonly string[]) {
  const el = host.querySelector(tag);
  return Object.fromEntries(names.map((name) => [name, el?.getAttribute(name) ?? null]));
}

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Renders a widget into a fresh host attached to the document. Qwik 2's client
 * `render` finds its container via a `[q:container]` attribute selector that a
 * jsdom/domino selector engine cannot match — and the widgets wrap real Lit
 * custom elements that only upgrade in a real DOM — so this suite runs in a
 * browser (see vitest.config.ts) where `render`, element upgrade, and native
 * events all behave as in production. Returns the mounted host.
 */
async function renderWidget(jsx: Parameters<typeof render>[1]): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await render(host, jsx);
  return host;
}

/**
 * Qwik wires the widget's listeners in a `useVisibleTask$` that runs a turn
 * after `render` (eager `document-ready` strategy), so a single fixed delay
 * races the attachment. Instead, re-dispatch the event each turn until the
 * forwarded callback receives this exact `detail`, polling up to a generous
 * deadline. CustomEvents do not replay, so dispatching only after the listener
 * exists is essential — re-dispatching makes that deterministic without guessing
 * the timing. Matching by identity (not "something arrived") keeps the check
 * robust when the live widget emits its own event of the same name — e.g. the
 * `zitadel-flow-step` it fires when the mock API answers — alongside our probe.
 */
async function dispatchUntilForwarded(
  el: Element,
  eventName: string,
  detail: Record<string, unknown>,
  received: readonly Record<string, unknown>[],
): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!received.includes(detail)) {
    el.dispatchEvent(new CustomEvent(eventName, { detail }));
    if (received.includes(detail)) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`listener for "${eventName}" never forwarded within 1000ms`);
    }
    await macrotask();
  }
}

describe("ZitadelLogin", () => {
  it("emits its config as attributes, which survive SSR resume", async () => {
    const host = await renderWidget(
      <ZitadelLogin
        project={{ ...project, url: "http://auth.test" }}
        purpose="register"
        postSignInUrl="/profile"
        flowName="signup"
        suppressHeader
        suppressPasswordToggle
      />,
    );

    expect(
      attributesOf(host, "zitadel-login", [
        "project-id",
        "proxy-path",
        "url",
        "purpose",
        "post-sign-in-url",
        "flow-name",
        "suppress-header",
        "suppress-password-toggle",
      ]),
    ).toEqual({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      url: "http://auth.test",
      purpose: "register",
      "post-sign-in-url": "/profile",
      "flow-name": "signup",
      "suppress-header": "",
      "suppress-password-toggle": "",
    });
  });

  it("emits the discrete project id and proxy path as attributes", async () => {
    const host = await renderWidget(<ZitadelLogin projectId="proj-test" proxyPath="/__nextgen" />);

    expect(attributesOf(host, "zitadel-login", ["project-id", "proxy-path", "purpose"])).toEqual({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      purpose: "login",
    });
  });
  it("binds the project handle as a property", async () => {
    const host = await renderWidget(<ZitadelLogin project={project} purpose="login" />);
    const el = host.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", async () => {
    const host = await renderWidget(<ZitadelLogin projectId="proj-test" proxyPath="/__nextgen" />);
    const el = host.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards resumeFlowId to the widget", async () => {
    const host = await renderWidget(<ZitadelLogin project={project} resumeFlowId="flow_123" />);
    const el = host.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.resumeFlowId).toBe("flow_123");
  });

  it("reads a null resumeFlowId as no handle", async () => {
    const host = await renderWidget(<ZitadelLogin project={project} resumeFlowId={null} />);
    const el = host.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.resumeFlowId).toBe("");
  });

  it("forwards locales and lang to the widget", async () => {
    const locales = { en: { "identifier.title": "Welcome back" } };
    const host = await renderWidget(<ZitadelLogin project={project} locales={locales} lang="de" />);
    const el = host.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.locales).toEqual(locales);
    expect(el!.lang).toBe("de");
  });

  it.each(Object.entries(ZITADEL_LOGIN_EVENT_HANDLERS))(
    "forwards %s to its callback",
    async (eventName, handlerProp) => {
      const received: Record<string, unknown>[] = [];
      const host = await renderWidget(
        <ZitadelLogin
          project={project}
          {...{
            [`${handlerProp}$`]: $((detail: Record<string, unknown>) => {
              received.push(detail);
            }),
          }}
        />,
      );
      const el = host.querySelector("zitadel-login");
      expect(el).not.toBeNull();
      const detail = { probe: eventName };
      await dispatchUntilForwarded(el!, eventName, detail, received);
      expect(received).toContain(detail);
    },
  );

  it("populates a consumer ref with the underlying element", async () => {
    const consumerRef = { value: undefined } as Signal<ZitadelLoginElement | undefined>;
    const host = await renderWidget(<ZitadelLogin project={project} ref={consumerRef} />);
    await macrotask();
    const el = host.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el).not.toBeNull();
    expect(consumerRef.value).toBe(el);
    expect(consumerRef.value?.tagName.toLowerCase()).toBe("zitadel-login");
  });
});

describe("ZitadelLogout", () => {
  it("emits its config as attributes, which survive SSR resume", async () => {
    const host = await renderWidget(<ZitadelLogout project={project} postSignOutUrl="/login" />);

    expect(
      attributesOf(host, "zitadel-logout", ["project-id", "proxy-path", "post-sign-out-url"]),
    ).toEqual({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      "post-sign-out-url": "/login",
    });
  });
  it("binds the project handle as a property", async () => {
    const host = await renderWidget(<ZitadelLogout project={project} />);
    const el = host.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", async () => {
    const host = await renderWidget(<ZitadelLogout projectId="proj-test" proxyPath="/__nextgen" />);
    const el = host.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it.each(Object.entries(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    "forwards %s to its callback",
    async (eventName, handlerProp) => {
      const received: Record<string, unknown>[] = [];
      const host = await renderWidget(
        <ZitadelLogout
          project={project}
          {...{
            [`${handlerProp}$`]: $((detail: Record<string, unknown>) => {
              received.push(detail);
            }),
          }}
        />,
      );
      const el = host.querySelector("zitadel-logout");
      expect(el).not.toBeNull();
      const detail = { probe: eventName };
      await dispatchUntilForwarded(el!, eventName, detail, received);
      expect(received).toContain(detail);
    },
  );

  it("populates a consumer ref with the underlying element", async () => {
    const consumerRef = { value: undefined } as Signal<ZitadelLogoutElement | undefined>;
    const host = await renderWidget(<ZitadelLogout project={project} ref={consumerRef} />);
    await macrotask();
    const el = host.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el).not.toBeNull();
    expect(consumerRef.value).toBe(el);
    expect(consumerRef.value?.tagName.toLowerCase()).toBe("zitadel-logout");
  });
});

describe("ZitadelSession", () => {
  it("emits its config as attributes, which survive SSR resume", async () => {
    const host = await renderWidget(
      <ZitadelSession project={project} postSignOutUrl="/login" heading="Hi" logoutLabel="Leave" />,
    );

    expect(
      attributesOf(host, "zitadel-session", [
        "project-id",
        "proxy-path",
        "post-sign-out-url",
        "heading",
        "logout-label",
      ]),
    ).toEqual({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      "post-sign-out-url": "/login",
      heading: "Hi",
      "logout-label": "Leave",
    });
  });
  it("binds the project handle as a property", async () => {
    const host = await renderWidget(<ZitadelSession project={project} />);
    const el = host.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", async () => {
    const host = await renderWidget(
      <ZitadelSession projectId="proj-test" proxyPath="/__nextgen" />,
    );
    const el = host.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards the surface variant/theme", async () => {
    const host = await renderWidget(
      <ZitadelSession project={project} variant="page" theme="light" suppressHeader={true} />,
    );
    const el = host.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el!.variant).toBe("page");
    expect(el!.theme).toBe("light");
    expect(el!.suppressHeader).toBe(true);
  });

  it.each(Object.entries(ZITADEL_SESSION_EVENT_HANDLERS))(
    "forwards %s to its callback",
    async (eventName, handlerProp) => {
      const received: Record<string, unknown>[] = [];
      const host = await renderWidget(
        <ZitadelSession
          project={project}
          {...{
            [`${handlerProp}$`]: $((detail: Record<string, unknown>) => {
              received.push(detail);
            }),
          }}
        />,
      );
      const el = host.querySelector("zitadel-session");
      expect(el).not.toBeNull();
      const detail = { probe: eventName };
      await dispatchUntilForwarded(el!, eventName, detail, received);
      expect(received).toContain(detail);
    },
  );

  it("populates a consumer ref with the underlying element", async () => {
    const consumerRef = { value: undefined } as Signal<ZitadelSessionElement | undefined>;
    const host = await renderWidget(<ZitadelSession project={project} ref={consumerRef} />);
    await macrotask();
    const el = host.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el).not.toBeNull();
    expect(consumerRef.value).toBe(el);
    expect(consumerRef.value?.tagName.toLowerCase()).toBe("zitadel-session");
  });
});

describe("businessLocales", () => {
  it("re-exports the business copy overlay from @zitadel/components", () => {
    expect(businessLocales).toBe(componentsBusinessLocales);
  });
});

describe("ZitadelLogin suppressPasswordToggle", () => {
  it("returns to the default when the prop goes from true back to unset", async () => {
    const host = await renderWidget(<PasswordToggleHarness />);
    const el = () => host.querySelector<ZitadelLoginElement>("zitadel-login")!;
    await expect.poll(() => el().suppressPasswordToggle).toBe(true);

    await expect.poll(() => window.__unsetSuppressPasswordToggle).toBeTypeOf("function");
    window.__unsetSuppressPasswordToggle!();
    await expect.poll(() => el().suppressPasswordToggle).toBe(false);
  });
});

describe("ZitadelSession heading and logoutLabel", () => {
  it("returns to the widget defaults when the props go from a string back to unset", async () => {
    const host = await renderWidget(<SessionHeadingHarness />);
    const el = () => host.querySelector<ZitadelSessionElement>("zitadel-session")!;
    await expect.poll(() => el().heading).toBe("Hi");
    expect(el().logoutLabel).toBe("Hi");

    await expect.poll(() => window.__unsetSessionLabels).toBeTypeOf("function");
    window.__unsetSessionLabels!();
    await expect.poll(() => el().heading).toBe("Signed in as");
    expect(el().logoutLabel).toBe("Sign out");
  });
});

describe("resumed server markup", () => {
  it("starts a register flow from the attributes alone, before any binder runs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const host = document.createElement("div");
    document.body.appendChild(host);
    // What Qwik Router sends and then resumes: attributes only, no `ref` binder
    // and no property handle (see index.server.spec.tsx for the server HTML).
    host.innerHTML =
      '<zitadel-login project-id="proj-test" proxy-path="/__resumed" purpose="register"></zitadel-login>';

    await expect
      .poll(() => fetchSpy.mock.calls.find(([input]) => String(input).includes("/__resumed")))
      .toBeDefined();
    const [input, init] = fetchSpy.mock.calls.find(([i]) => String(i).includes("/__resumed"))!;
    expect(String(input)).toContain("/__resumed/");
    expect(JSON.parse(String(init?.body))).toEqual({
      purpose: "register",
      project_id: "proj-test",
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
  ] as const)("ZitadelSession keeps the default %s", async (prop, expected) => {
    const host = await renderWidget(<ZitadelSession project={project} />);
    await macrotask();

    expect(host.querySelector<ZitadelSessionElement>("zitadel-session")![prop]).toBe(expected);
  });

  it.each([
    ["variant", "widget"],
    ["theme", ""],
    ["suppressHeader", false],
    ["lang", ""],
    ["suppressPasswordToggle", false],
  ] as const)("ZitadelLogin keeps the default %s", async (prop, expected) => {
    const host = await renderWidget(<ZitadelLogin project={project} />);
    await macrotask();

    expect(host.querySelector<ZitadelLoginElement>("zitadel-login")![prop]).toBe(expected);
  });

  it("ZitadelLogout keeps the default theme", async () => {
    const host = await renderWidget(<ZitadelLogout project={project} />);
    await macrotask();

    expect(host.querySelector<ZitadelLogoutElement>("zitadel-logout")!.theme).toBe("");
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
    const host = await renderWidget(
      <UnsetPropHarness widget="session" prop={prop} given={given} />,
    );
    const el = () => host.querySelector<ZitadelSessionElement>("zitadel-session")!;
    await expect.poll(() => el()[prop]).toBe(given);

    await expect.poll(() => window.__unsetProp).toBeTypeOf("function");
    window.__unsetProp!();
    await expect.poll(() => el()[prop]).toBe(expected);
  });

  it.each([
    ["variant", "page", "widget"],
    ["theme", "light", ""],
    ["suppressHeader", true, false],
    ["lang", "de", ""],
  ] as const)("ZitadelLogin restores the default %s", async (prop, given, expected) => {
    const host = await renderWidget(<UnsetPropHarness widget="login" prop={prop} given={given} />);
    const el = () => host.querySelector<ZitadelLoginElement>("zitadel-login")!;
    await expect.poll(() => el()[prop]).toBe(given);

    await expect.poll(() => window.__unsetProp).toBeTypeOf("function");
    window.__unsetProp!();
    await expect.poll(() => el()[prop]).toBe(expected);
  });

  it("ZitadelLogout restores the default theme", async () => {
    const host = await renderWidget(
      <UnsetPropHarness widget="logout" prop="theme" given="light" />,
    );
    const el = () => host.querySelector<ZitadelLogoutElement>("zitadel-logout")!;
    await expect.poll(() => el().theme).toBe("light");

    await expect.poll(() => window.__unsetProp).toBeTypeOf("function");
    window.__unsetProp!();
    await expect.poll(() => el().theme).toBe("");
  });
});

describe("ZitadelLogin resumeFlowId", () => {
  it("drops the handle when the prop goes from a value back to unset", async () => {
    const host = await renderWidget(<ResumeFlowIdHarness />);
    const el = () => host.querySelector<ZitadelLoginElement>("zitadel-login")!;
    await expect.poll(() => el().resumeFlowId).toBe("flow_123");

    await expect.poll(() => window.__unsetResumeFlowId).toBeTypeOf("function");
    window.__unsetResumeFlowId!();
    await expect.poll(() => el().resumeFlowId).toBe("");
  });
});
