import type { CreateFlow201 } from "@zitadel/api/generated/model";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import type { ZitadelProject } from "@zitadel/api/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";

/**
 * Real-browser checks for the in-page embedding contract: a host page that
 * places `<zitadel-login>` inside a section, sidebar, or modal (rather than
 * the scaffolded full-page login route) must be able to size the widget to
 * its content and drop the full-bleed background.
 *
 * The layout chrome defaults to a page-oriented shape — the shadow-internal
 * `.zl-mount` claims `min-height: 100vh` — and host CSS cannot reach into
 * the shadow root, so sizing is exposed as the `--zl-page-min-height`
 * custom property (custom properties inherit across the boundary). The
 * background needs no knob: document rules targeting the host element win
 * over `:host` rules in the cascade.
 */

const identifierStep: CreateFlow201 = {
  id: "flow_1",
  session_id: "sess_1",
  session_token: "tok_1",
  step: {
    name: "identifier",
    texts: { title_key: "identifier.title" },
    fields: [
      { name: "email", type: "email", text_key: "identifier.field.email", required: true },
    ],
    actions: [{ name: "submit", text_key: "submit.continue", primary: true }],
    gates: {},
  },
};

function installFlowFetchStub(responses: readonly CreateFlow201[]): { restore: () => void } {
  let cursor = 0;
  const fetchStub = vi.fn(async (): Promise<Response> => {
    const next = responses[Math.min(cursor, responses.length - 1)];
    cursor += 1;
    return new Response(JSON.stringify(next), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });
  const original = globalThis.fetch;
  globalThis.fetch = fetchStub as unknown as typeof fetch;
  return { restore: () => void (globalThis.fetch = original) };
}

async function waitFor<T>(probe: () => T | null | undefined, timeout = 3000): Promise<T> {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error("waitFor timed out");
}

describe("<zitadel-login> in-page embedding (chromium)", () => {
  let host: HTMLDivElement;
  let hostStyles: HTMLStyleElement;
  let stub: ReturnType<typeof installFlowFetchStub>;
  let project: ZitadelProject;

  beforeEach(() => {
    _resetConfigForTesting();
    project = configureZitadel({
      proxyPath: "/__nextgen",
      projectId: "embed-test",
      url: "http://localhost:4000",
    });
    // Host-page stylesheet, exactly what an embedding app would ship.
    hostStyles = document.createElement("style");
    hostStyles.textContent = `
      zitadel-login.zl-embedded {
        --zl-page-min-height: auto;
        background: transparent;
      }
    `;
    document.head.appendChild(hostStyles);
    host = document.createElement("div");
    host.style.width = "360px";
    document.body.appendChild(host);
    stub = installFlowFetchStub([identifierStep]);
  });

  afterEach(() => {
    host.remove();
    hostStyles.remove();
    stub.restore();
  });

  async function mount(className?: string): Promise<ZitadelLogin> {
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.project = project;
    if (className) {
      element.className = className;
    }
    host.appendChild(element);
    await waitFor(() => {
      const root = element.shadowRoot;
      return root && root.querySelector("zl-field") ? root : null;
    });
    await waitFor(() => (element.getAttribute("aria-busy") === "false" ? element : null));
    return element;
  }

  it("defaults to the page-oriented shape: the mount claims the viewport height", async () => {
    const element = await mount();
    const mountNode = element.shadowRoot?.querySelector(".zl-mount");
    expect(mountNode).toBeTruthy();
    const rect = (mountNode as HTMLElement).getBoundingClientRect();
    expect(rect.height).toBeGreaterThanOrEqual(window.innerHeight - 1);
  });

  it("sizes to content when the host page sets --zl-page-min-height: auto", async () => {
    const element = await mount("zl-embedded");
    const mountNode = element.shadowRoot?.querySelector(".zl-mount") as HTMLElement;
    // Chromium reports the computed value of `min-height: auto` as "0px" on
    // non-flex-items; either spelling means the 100vh default is gone.
    expect(["auto", "0px"]).toContain(getComputedStyle(mountNode).minHeight);
    // One email field + a submit renders far below the viewport height —
    // the widget now behaves like a card, not a page.
    const rect = element.getBoundingClientRect();
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.height).toBeLessThan(window.innerHeight * 0.9);
  });

  it("lets host CSS on the element drop the full-bleed background", async () => {
    const element = await mount("zl-embedded");
    // Document rules targeting the host element beat the :host default.
    expect(getComputedStyle(element).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });
});
