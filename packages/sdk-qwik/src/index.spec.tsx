import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { $, component$, createSignal, render, type QRL, type Signal } from "@qwik.dev/core";
import { qrl } from "@qwik.dev/core/internal";
import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENT_HANDLERS,
} from "@zitadel/sdk-core/types";
import { describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";

import type { renderWidgets } from "./__tests__/ssr-fixture";

import { businessLocales, ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";

declare module "vitest/browser" {
  interface BrowserCommands {
    renderSsr: (name: "renderWidgets") => ReturnType<typeof renderWidgets>;
  }
}

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
  const deadline = Date.now() + 5000;
  while (!received.includes(detail)) {
    el.dispatchEvent(new CustomEvent(eventName, { detail }));
    if (received.includes(detail)) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`listener for "${eventName}" never forwarded within 5000ms`);
    }
    await macrotask();
  }
}

/**
 * Resolves once `el` has a listener for `eventName`, so a test can check what
 * the *first* event does rather than dispatching until something arrives.
 */
async function listenerAttached(
  el: Element,
  eventName: string,
  spy: { mock: { contexts: unknown[]; calls: unknown[][] } },
): Promise<void> {
  await vi.waitFor(() => {
    const attached = spy.mock.calls.some(
      (call, index) => call[0] === eventName && spy.mock.contexts[index] === el,
    );
    if (!attached) {
      throw new Error(`no "${eventName}" listener on the element yet`);
    }
  });
}

type Tag = "zitadel-login" | "zitadel-logout" | "zitadel-session";

/**
 * Renders one widget with the `set` props while `on` is true and the `cleared`
 * props once it goes false, through Qwik's normal re-render path (the same
 * element is updated, not replaced).
 */
const Toggled = component$<{
  on: Signal<boolean>;
  tag: Tag;
  set: Record<string, unknown>;
  cleared: Record<string, unknown>;
}>(({ on, tag, set, cleared }) => {
  const props = on.value ? set : cleared;
  if (tag === "zitadel-login") {
    return <ZitadelLogin {...props} />;
  }
  if (tag === "zitadel-logout") {
    return <ZitadelLogout {...props} />;
  }
  return <ZitadelSession {...props} />;
});

/**
 * Every defaulted widget prop, the value a test sets it to, and the default the
 * element must hold when the prop is unset or cleared. The wrapper forwards
 * props plainly; restoring the default is the element's job.
 */
const DEFAULTS: readonly [Tag, string, unknown, unknown][] = [
  ["zitadel-login", "purpose", "register", "login"],
  ["zitadel-login", "variant", "page", "widget"],
  ["zitadel-login", "theme", "dark", ""],
  ["zitadel-login", "lang", "de", ""],
  ["zitadel-login", "suppressHeader", true, false],
  ["zitadel-login", "resumeFlowId", "flow_123", ""],
  ["zitadel-session", "heading", "Hi", "Signed in as"],
  ["zitadel-session", "logoutLabel", "Leave", "Sign out"],
  ["zitadel-session", "variant", "page", "widget"],
  ["zitadel-session", "theme", "dark", ""],
  ["zitadel-session", "suppressHeader", true, false],
  ["zitadel-logout", "theme", "dark", ""],
];

describe.each(DEFAULTS)("<%s> %s", (tag, prop, value, fallback) => {
  it("keeps the element default when unset", async () => {
    const host = await renderWidget(
      <Toggled on={createSignal(true)} tag={tag} set={{ project }} cleared={{ project }} />,
    );
    const el = host.querySelector(tag) as unknown as Record<string, unknown>;
    expect(el[prop]).toEqual(fallback);
  });

  it("restores the element default when cleared", async () => {
    const on = createSignal(true);
    const host = await renderWidget(
      <Toggled on={on} tag={tag} set={{ project, [prop]: value }} cleared={{ project }} />,
    );
    const el = host.querySelector(tag) as unknown as Record<string, unknown>;
    await expect.poll(() => el[prop]).toEqual(value);
    on.value = false;
    await expect.poll(() => el[prop]).toEqual(fallback);
    expect(host.querySelector(tag)).toBe(el);
  });
});

/**
 * The property-only members (`attribute: false` on the element) have no
 * attribute Qwik could remove, so only the wrapper can clear them.
 */
describe.each([
  ["zitadel-login", { project }, { projectId: "proj-test", proxyPath: "/__nextgen" }, "project"],
  ["zitadel-logout", { project }, { projectId: "proj-test", proxyPath: "/__nextgen" }, "project"],
  ["zitadel-session", { project }, { projectId: "proj-test", proxyPath: "/__nextgen" }, "project"],
  [
    "zitadel-login",
    { project, locales: { en: { "identifier.title": "Hi" } } },
    { project },
    "locales",
  ],
] as const)("<%s> property-only %#", (tag, set, cleared, prop) => {
  it(`clears ${prop} when the prop is removed`, async () => {
    const on = createSignal(true);
    const host = await renderWidget(<Toggled on={on} tag={tag} set={set} cleared={cleared} />);
    const el = host.querySelector(tag) as unknown as Record<string, unknown>;
    await expect.poll(() => el[prop]).toEqual(set[prop as keyof typeof set]);
    on.value = false;
    await expect.poll(() => el[prop]).toBeUndefined();
    expect(host.querySelector(tag)).toBe(el);
  });
});

describe("ZitadelLogin", () => {
  it("emits its config as attributes, which survive SSR resume", async () => {
    const host = await renderWidget(
      <ZitadelLogin
        project={{ ...project, url: "http://auth.test" }}
        purpose="register"
        postSignInUrl="/profile"
        flowName="signup"
        resumeFlowId="flow_123"
        suppressHeader
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
        "resume-flow-id",
        "suppress-header",
      ]),
    ).toEqual({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      url: "http://auth.test",
      purpose: "register",
      "post-sign-in-url": "/profile",
      "flow-name": "signup",
      "resume-flow-id": "flow_123",
      "suppress-header": "",
    });
  });

  it("emits the discrete project id and proxy path as attributes", async () => {
    const host = await renderWidget(<ZitadelLogin projectId="proj-test" proxyPath="/__nextgen" />);

    expect(attributesOf(host, "zitadel-login", ["project-id", "proxy-path"])).toEqual({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
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
      // The mock API has no session, so the card leaves for this URL once it
      // loads; a fragment keeps the test page where it is.
      <ZitadelSession
        project={project}
        postSignOutUrl="#signed-out"
        heading="Hi"
        logoutLabel="Leave"
      />,
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
      "post-sign-out-url": "#signed-out",
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

describe.each([
  ...Object.entries(ZITADEL_LOGIN_EVENT_HANDLERS).map(
    ([event, handler]) => ["zitadel-login", event, handler] as const,
  ),
  ...Object.entries(ZITADEL_LOGOUT_EVENT_HANDLERS).map(
    ([event, handler]) => ["zitadel-logout", event, handler] as const,
  ),
  ...Object.entries(ZITADEL_SESSION_EVENT_HANDLERS).map(
    ([event, handler]) => ["zitadel-session", event, handler] as const,
  ),
])("<%s> %s", (tag, eventName, handlerProp) => {
  it("runs its loaded callback before dispatchEvent returns, so it beats the widget's navigation", async () => {
    const spy = vi.spyOn(HTMLElement.prototype, "addEventListener");
    try {
      const received: Record<string, unknown>[] = [];
      const callback = $((detail: Record<string, unknown>) => {
        received.push(detail);
      });
      const handler = { [`${handlerProp}$`]: callback };
      const host = await renderWidget(
        <Toggled on={createSignal(true)} tag={tag} set={{ project, ...handler }} cleared={{}} />,
      );
      const el = host.querySelector(tag)!;
      await listenerAttached(el, eventName, spy);
      // The visible task starts loading every handler; once loaded, the
      // listener calls it synchronously.
      await expect.poll(() => callback.resolved).toBeTruthy();
      const detail = { probe: eventName };
      el.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(received).toContain(detail);
    } finally {
      spy.mockRestore();
    }
  });
});

let serverRendered: ReturnType<typeof renderWidgets> | undefined;

/**
 * Mounts server-rendered markup the way a Qwik City page arrives: the HTML is
 * parsed into the document, then its inline qwikloader runs and resumes the
 * container. Scripts set through `innerHTML` never execute, so each is
 * re-created.
 */
async function resumeServerRendered(tag: Tag): Promise<HTMLElement> {
  serverRendered ??= commands.renderSsr("renderWidgets");
  const host = document.createElement("div");
  host.innerHTML = (await serverRendered)[tag];
  document.body.appendChild(host);
  for (const inert of host.querySelectorAll("script:not([type^='qwik/'])")) {
    const script = document.createElement("script");
    for (const { name, value } of inert.attributes) {
      script.setAttribute(name, value);
    }
    script.textContent = inert.textContent;
    inert.replaceWith(script);
  }
  return host;
}

/**
 * Under Qwik City the `ref` binder runs on the server and stores a `DomRef`;
 * only the resumed visible task can reach the element. These specs fail if that
 * chain breaks, which the client-`render` specs above cannot see.
 */
describe.each([
  ["zitadel-login", "zitadel-flow-step"],
  ["zitadel-logout", "zitadel-signout"],
  ["zitadel-session", "zitadel-signout"],
] as const)("<%s> resumed from server markup", (tag, eventName) => {
  it("applies the property-only project handle", async () => {
    const host = await resumeServerRendered(tag);
    const el = host.querySelector(tag) as unknown as Record<string, unknown>;
    await expect.poll(() => el.project).toEqual({ projectId: "proj-ssr", proxyPath: "/__nextgen" });
  });

  it(`forwards ${eventName} to the server-created handler QRL`, async () => {
    const received: Record<string, unknown>[] = [];
    const record = (event: Event): void => {
      received.push((event as CustomEvent<Record<string, unknown>>).detail);
    };
    document.addEventListener("ssr-forwarded", record);
    try {
      const host = await resumeServerRendered(tag);
      const detail = { probe: eventName };
      await dispatchUntilForwarded(host.querySelector(tag)!, eventName, detail, received);
      expect(received).toContain(detail);
    } finally {
      document.removeEventListener("ssr-forwarded", record);
    }
  });
});

/** Records every `eventName` the page sees, from before any widget mounts. */
function recordEvents(eventName: string): { details: unknown[]; stop: () => void } {
  const details: unknown[] = [];
  const record = (event: Event): void => {
    details.push((event as CustomEvent).detail);
  };
  document.addEventListener(eventName, record, true);
  return { details, stop: () => document.removeEventListener(eventName, record, true) };
}

/** Counts the `POST …/flow` requests (flow starts) the page sends from now on. */
function countFlowStarts(): () => number {
  const original = globalThis.fetch;
  let starts = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && /\/flow$/.test(url)) {
      starts += 1;
    }
    return original(input, init);
  });
  return () => starts;
}

/** Long enough for a restart the wrapper's late binding would trigger to have gone out. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 500));

describe("<zitadel-login> flow starts", () => {
  it("starts one flow on a client render with a project handle", async () => {
    const steps = recordEvents("zitadel-flow-step");
    try {
      const starts = countFlowStarts();
      await renderWidget(<ZitadelLogin project={project} purpose="register" />);
      await expect.poll(() => steps.details.length).toBeGreaterThan(0);
      await settle();
      expect(starts()).toBe(1);
    } finally {
      steps.stop();
    }
  });

  it("starts one flow when server markup with a project handle resumes", async () => {
    const steps = recordEvents("zitadel-flow-step");
    try {
      const starts = countFlowStarts();
      const host = await resumeServerRendered("zitadel-login");
      const el = host.querySelector("zitadel-login") as unknown as Record<string, unknown>;
      await expect.poll(() => el.project).toBeTruthy();
      await expect.poll(() => steps.details.length).toBeGreaterThan(0);
      await settle();
      expect(starts()).toBe(1);
    } finally {
      steps.stop();
    }
  });
});

/**
 * A handler QRL whose chunk takes `ms` to load, as a lazily fetched segment does
 * on a slow network.
 */
function slowHandler<D>(ms: number, received: unknown[]): QRL<(detail: D) => void> {
  const record = (detail: D): void => {
    received.push(detail);
  };
  return qrl(
    () =>
      new Promise<{ record: typeof record }>((resolve) =>
        setTimeout(() => resolve({ record }), ms),
      ),
    "record",
  );
}

describe("<zitadel-login> handlers that are still loading", () => {
  it("receive the first zitadel-flow-step", async () => {
    const steps = recordEvents("zitadel-flow-step");
    try {
      const received: unknown[] = [];
      await renderWidget(
        <ZitadelLogin project={project} onFlowStep$={slowHandler(400, received)} />,
      );
      await expect.poll(() => steps.details.length).toBeGreaterThan(0);
      await expect.poll(() => received[0]).toBe(steps.details[0]);
    } finally {
      steps.stop();
    }
  });

  it("receive a zitadel-flow-error the widget emits on startup", async () => {
    const errors = recordEvents("zitadel-flow-error");
    try {
      const received: unknown[] = [];
      await renderWidget(<ZitadelLogin onFlowError$={slowHandler(400, received)} />);
      await expect.poll(() => errors.details.length).toBeGreaterThan(0);
      await expect.poll(() => received[0]).toBe(errors.details[0]);
    } finally {
      errors.stop();
    }
  });
});

describe("children", () => {
  it("reach <zitadel-logout> before it connects, so its template mode projects them", async () => {
    const host = await renderWidget(
      <ZitadelLogout project={project}>
        <template>
          <button type="button" data-action="logout">
            {"Sign out {{display}}"}
          </button>
        </template>
      </ZitadelLogout>,
    );
    const el = host.querySelector("zitadel-logout");
    expect(el?.querySelector("template")).not.toBeNull();
    await expect.poll(() => el?.querySelector("span [data-action='logout']")).not.toBeNull();
  });

  it("fill <zitadel-login>'s attribution-trailing slot", async () => {
    const host = await renderWidget(
      <ZitadelLogin project={project}>
        <a slot="attribution-trailing" href="/help">
          Help
        </a>
      </ZitadelLogin>,
    );
    const link = host.querySelector("zitadel-login > a[slot='attribution-trailing']");
    expect(link).not.toBeNull();
    await expect.poll(() => link?.assignedSlot?.name).toBe("attribution-trailing");
  });
});

describe("businessLocales", () => {
  it("re-exports the business copy overlay from @zitadel/components", () => {
    expect(businessLocales).toBe(componentsBusinessLocales);
  });
});
