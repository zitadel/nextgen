import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zitadel-login.js";
import { WalkingFixtureTransport } from "./transport.js";
import type { FlowDefinition } from "./transport.js";
import type { ZitadelLogin } from "./zitadel-login.js";

/**
 * Real-browser checks for the orchestrator-side a11y / form-participation
 * contract. Tests that need the FACE platform live here; the unit suite
 * keeps the rendering / Liquid / sanitiser specs that work in jsdom.
 */
const flow: FlowDefinition = {
  name: "default-login",
  purposes: ["login"],
  initial_steps: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      type: "identifier",
      texts: { title_key: "identifier.title" },
      fields: {
        email: {
          type: "email",
          text_key: "identifier.field.email",
          required: true,
          autocomplete: "username",
        },
      },
      actions: { submit: { text_key: "submit.continue", primary: true } },
      transitions: { submit: "password" },
    },
    {
      name: "password",
      type: "credential",
      texts: { title_key: "password.title" },
      fields: {
        password: {
          type: "password",
          text_key: "password.field.password",
          required: true,
          autocomplete: "current-password",
        },
      },
      actions: { submit: { text_key: "submit.signin", primary: true } },
      transitions: { submit: "done" },
    },
    { name: "done", type: "complete", texts: { title_key: "complete.title" } },
  ],
};

async function waitFor<T>(probe: () => T | null | undefined, timeout = 1500): Promise<T> {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error("waitFor timed out");
}

describe("<zitadel-login> form + focus (chromium)", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  async function mount(): Promise<ZitadelLogin> {
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.transport = new WalkingFixtureTransport({ flow });
    element.purpose = "login";
    host.appendChild(element);
    await waitFor(() => element.shadowRoot?.querySelector("zl-field"));
    return element;
  }

  it("renders the step inside a real <form>", async () => {
    const element = await mount();
    const form = element.shadowRoot?.querySelector("form");
    expect(form).toBeTruthy();
    expect(form?.querySelector("zl-field")).toBeTruthy();
  });

  it("intercepts native submit and walks to the next step", async () => {
    const element = await mount();
    const field = element.shadowRoot!.querySelector("zl-field") as HTMLElement & {
      value: string;
      updateComplete: Promise<unknown>;
    };
    field.value = "alice@acme.com";
    await field.updateComplete;
    const form = element.shadowRoot!.querySelector("form") as HTMLFormElement;
    form.requestSubmit();
    await waitFor(() => {
      const next = element.shadowRoot?.querySelector("zl-field");
      return next?.getAttribute("name") === "password" ? next : null;
    });
    const passwordField = element.shadowRoot?.querySelector("zl-field");
    expect(passwordField?.getAttribute("name")).toBe("password");
  });

  it("moves focus to the first field after a step swap", async () => {
    const element = await mount();
    const field = element.shadowRoot!.querySelector("zl-field") as HTMLElement & {
      value: string;
      updateComplete: Promise<unknown>;
    };
    field.value = "alice@acme.com";
    await field.updateComplete;
    const form = element.shadowRoot!.querySelector("form") as HTMLFormElement;
    form.requestSubmit();
    await waitFor(() => {
      const next = element.shadowRoot?.querySelector("zl-field");
      return next?.getAttribute("name") === "password" ? next : null;
    });
    // Allow the rAF in moveFocusToFirstField to fire.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const passwordField = element.shadowRoot?.querySelector("zl-field") as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const innerInput = passwordField.shadowRoot?.querySelector("input");
    expect(passwordField.shadowRoot?.activeElement).toBe(innerInput);
  });
});
