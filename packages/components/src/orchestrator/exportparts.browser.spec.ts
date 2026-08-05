import type { CreateFlow201 } from "@zitadel/api/generated/model";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import type { ZitadelProject } from "@zitadel/api/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";
import { exportpartsFor } from "./exportparts.js";

/**
 * Real-browser checks for override-ladder Tier 2 through the orchestrator:
 * a host page restyles atom internals with
 * `zitadel-login::part(<atom>-<part>)`. Atoms stamp `part="..."` inside
 * their own shadow roots; the orchestrator forwards them across its
 * boundary by stamping manifest-derived `exportparts` after every render —
 * including atoms the mandatory-gates patcher appends after sanitisation,
 * which never appear in the authored template at all.
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
    actions: [{ name: "submit", kind: "submit", text_key: "submit.continue", primary: true }],
    gates: {},
  },
};

/**
 * Renders the field but no button: the primary submit reaching the DOM at
 * all is the mandatory-gates patcher's doing.
 */
const buttonlessTemplate = `<div>{% for f in fields %}<zl-field name="{{ f.name }}" label="{{ f.text_key | t }}" type="{{ f.type }}"></zl-field>{% endfor %}{% mandatory_gates %}</div>`;

const patchedStep: CreateFlow201 = {
  ...identifierStep,
  branding: { layout: "centered", liquid_template: buttonlessTemplate },
} as unknown as CreateFlow201;

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

describe("<zitadel-login> ::part() forwarding (chromium)", () => {
  let host: HTMLDivElement;
  let hostStyles: HTMLStyleElement;
  let stub: ReturnType<typeof installFlowFetchStub> | undefined;
  let project: ZitadelProject;

  beforeEach(() => {
    _resetConfigForTesting();
    project = configureZitadel({
      proxyPath: "/__nextgen",
      projectId: "parts-test",
      url: "http://localhost:4000",
    });
    // Host-page stylesheet, exactly what an embedding app would ship.
    hostStyles = document.createElement("style");
    hostStyles.textContent = `
      zitadel-login::part(field-input) {
        text-transform: uppercase;
        letter-spacing: 3px;
      }
      zitadel-login::part(button-root) {
        border-radius: 0px;
      }
    `;
    document.head.appendChild(hostStyles);
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    hostStyles.remove();
    stub?.restore();
  });

  async function mount(response: CreateFlow201): Promise<ZitadelLogin> {
    stub = installFlowFetchStub([response]);
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.project = project;
    host.appendChild(element);
    await waitFor(() => (element.shadowRoot?.querySelector("zl-field") ? element : null));
    await waitFor(() => (element.getAttribute("aria-busy") === "false" ? element : null));
    return element;
  }

  it("host-page ::part() restyles a template-rendered atom's internals", async () => {
    const element = await mount(identifierStep);
    const field = element.shadowRoot?.querySelector("zl-field") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    expect(field.getAttribute("exportparts")).toBe(exportpartsFor("zl-field"));
    await field.updateComplete;
    const input = field.shadowRoot?.querySelector('[part="input"]') as HTMLElement;
    expect(input).toBeTruthy();
    const style = getComputedStyle(input);
    expect(style.textTransform).toBe("uppercase");
    expect(style.letterSpacing).toBe("3px");
  });

  it("forwarding covers atoms appended by the mandatory-gates patcher", async () => {
    const element = await mount(patchedStep);
    const button = (await waitFor(() =>
      element.shadowRoot?.querySelector('zl-button[hierarchy="primary"]'),
    )) as HTMLElement & { updateComplete: Promise<unknown> };
    expect(button.getAttribute("exportparts")).toBe(exportpartsFor("zl-button"));
    await button.updateComplete;
    const root = button.shadowRoot?.querySelector('[part="root"]') as HTMLElement;
    expect(root).toBeTruthy();
    expect(getComputedStyle(root).borderRadius).toBe("0px");
  });

  it("part-less atoms stay unstamped", async () => {
    const element = await mount(identifierStep);
    // The attribution pill renders a zl-icon (no declared parts) in the
    // orchestrator's shadow root.
    for (const icon of element.shadowRoot?.querySelectorAll("zl-icon") ?? []) {
      expect(icon.hasAttribute("exportparts")).toBe(false);
    }
  });
});
