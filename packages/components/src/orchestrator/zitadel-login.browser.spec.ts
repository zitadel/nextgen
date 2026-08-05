import type { CreateFlow201 } from "@zitadel/api/generated/model";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import type { ZitadelProject } from "@zitadel/api/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";

/**
 * Real-browser checks for the orchestrator-side a11y / form-participation
 * contract. Tests that need the FACE platform live here; the unit suite
 * keeps the rendering / Liquid / sanitiser specs that work in jsdom.
 *
 * The orchestrator calls the typed `@zitadel/api` client
 * directly. This suite swaps `globalThis.fetch` for a queue of pre-baked
 * `CreateFlow201` payloads — equivalent to swapping the previous
 * `transport` property, one level lower in the stack. Fetch is stubbed
 * (rather than running `msw/browser`) because vitest's browser provider
 * has no out-of-the-box service-worker registration; the unit suite
 * covers the MSW-handler-driven contract.
 */

const identifierStep: CreateFlow201 = {
  id: "flow_1",
  session_id: "sess_1",
  session_token: "tok_1",
  step: {
    name: "identifier",
    texts: { title_key: "identifier.title" },
    fields: [
      {
        name: "email",
        type: "email",
        text_key: "identifier.field.email",
        required: true,
      },
      {
        name: "password",
        type: "password",
        text_key: "identifier.field.password",
        required: true,
      },
    ],
    actions: [{ name: "submit", kind: "submit", text_key: "submit.signin", primary: true }],
    gates: {},
  },
};

const passkeyUpsellStep: CreateFlow201 = {
  id: "flow_1",
  session_id: "sess_1",
  session_token: "tok_2",
  step: {
    name: "passkey-upsell",
    texts: { title_key: "passkey-upsell.title" },
    fields: [],
    actions: [
      { name: "setup", kind: "passkey_register", text_key: "passkey-upsell.action.setup", primary: true },
      { name: "skip", kind: "navigate", text_key: "passkey-upsell.action.skip" },
    ],
    gates: {},
  },
};

async function fillSignInFields(
  root: ShadowRoot,
  email = "alice@acme.com",
  password = "hunter2",
): Promise<void> {
  const fields = root.querySelectorAll("zl-field") as NodeListOf<
    HTMLElement & { value: string; updateComplete: Promise<unknown> }
  >;
  fields[0]!.value = email;
  fields[1]!.value = password;
  await fields[0]!.updateComplete;
  await fields[1]!.updateComplete;
  root.dispatchEvent(
    new CustomEvent("zl-input", {
      bubbles: true,
      composed: true,
      detail: { name: "email", value: email },
    }),
  );
  root.dispatchEvent(
    new CustomEvent("zl-input", {
      bubbles: true,
      composed: true,
      detail: { name: "password", value: password },
    }),
  );
}

async function fillNativeField(root: ShadowRoot, name: string, value: string): Promise<void> {
  const field = root.querySelector(`zl-field[name="${name}"]`) as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await field.updateComplete;
  const input = field.shadowRoot?.querySelector("input") as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await field.updateComplete;
}

async function setNativeFieldValue(root: ShadowRoot, name: string, value: string): Promise<void> {
  const field = root.querySelector(`zl-field[name="${name}"]`) as HTMLElement & {
    updateComplete: Promise<unknown>;
    value: string;
  };
  await field.updateComplete;
  const input = field.shadowRoot?.querySelector("input") as HTMLInputElement;
  input.value = value;
  expect(field.value).not.toBe(value);
}

async function waitFor<T>(probe: () => T | null | undefined, timeout = 1500): Promise<T> {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error("waitFor timed out");
}

/**
 * Stubs `globalThis.fetch` to return a queue of pre-built `CreateFlow201`
 * JSON bodies. Each network call (regardless of URL) drains one entry from
 * the queue; the last entry is replayed if the queue is exhausted, matching
 * how the WalkingFixtureTransport used to behave.
 */
function installFlowFetchStub(responses: readonly CreateFlow201[]): {
  calls: { url: string; init: RequestInit | undefined }[];
  restore: () => void;
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let cursor = 0;
  const fetchStub = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      const next = responses[Math.min(cursor, responses.length - 1)];
      cursor += 1;
      return new Response(JSON.stringify(next), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  );
  const original = globalThis.fetch;
  globalThis.fetch = fetchStub as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe("<zitadel-login> form + focus (chromium)", () => {
  let host: HTMLDivElement;
  let stub: ReturnType<typeof installFlowFetchStub>;
  let testProject: ZitadelProject;

  beforeEach(() => {
    _resetConfigForTesting();
    testProject = configureZitadel({ proxyPath: "/__nextgen", projectId: "test-project", url: "http://localhost:4000" });
    host = document.createElement("div");
    document.body.appendChild(host);
    stub = installFlowFetchStub([identifierStep, passkeyUpsellStep]);
  });

  afterEach(() => {
    host.remove();
    stub.restore();
  });

  async function mount(): Promise<ZitadelLogin> {
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.project = testProject;
    host.appendChild(element);
    await waitFor(() => {
      const root = element.shadowRoot;
      return root && root.querySelectorAll("zl-field").length === 2 ? root : null;
    });
    await waitFor(() =>
      element.getAttribute("aria-busy") === "false" ? element : null,
    );
    return element;
  }

  it("renders the step inside a real <form>", async () => {
    const element = await mount();
    const form = element.shadowRoot?.querySelector("form");
    expect(form).toBeTruthy();
    expect(form?.querySelectorAll("zl-field").length).toBe(2);
  });

  it("walks to the next step on orchestrated submit", async () => {
    const element = await mount();
    const root = element.shadowRoot!;
    await fillSignInFields(root);
    root.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );
    await waitFor(() => {
      const title = element.shadowRoot?.querySelector(".zl-card-title");
      return title?.textContent?.includes("Sign in faster") ? title : null;
    });
  });

  it("submits values filled through native input events", async () => {
    const element = await mount();
    const root = element.shadowRoot!;
    const emailField = root.querySelector('[data-testid="zitadel-field-email"]') as
      | (HTMLElement & { updateComplete: Promise<unknown> })
      | null;
    if (!emailField) {
      throw new Error("Expected email field host hook to render");
    }
    await emailField.updateComplete;
    expect(emailField.shadowRoot?.querySelector("input")?.getAttribute("data-testid")).toBe(
      "zitadel-input-email",
    );
    await fillNativeField(root, "email", "alice@acme.com");
    await fillNativeField(root, "password", "hunter2");
    const submit = root.querySelector('zl-button[action="submit"]') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await submit.updateComplete;
    expect(submit.shadowRoot?.querySelector("button")?.getAttribute("data-testid")).toBe(
      "zitadel-action-submit-button",
    );
    submit.shadowRoot?.querySelector("button")?.click();

    await waitFor(() => {
      const title = element.shadowRoot?.querySelector(".zl-card-title");
      return title?.textContent?.includes("Sign in faster") ? title : null;
    });
    const body = JSON.parse(String(stub.calls[1]?.init?.body ?? "{}")) as {
      fields?: Record<string, string>;
    };
    expect(body.fields).toEqual({ email: "alice@acme.com", password: "hunter2" });
  });

  it("captures native input values before submit even when automation did not emit input events", async () => {
    const element = await mount();
    const root = element.shadowRoot;
    expect(root).toBeTruthy();
    if (!root) return;
    await setNativeFieldValue(root, "email", "alice@acme.com");
    await setNativeFieldValue(root, "password", "hunter2");
    const submit = root.querySelector('zl-button[action="submit"]') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await submit.updateComplete;
    submit.shadowRoot?.querySelector("button")?.click();

    await waitFor(() => {
      const title = element.shadowRoot?.querySelector(".zl-card-title");
      return title?.textContent?.includes("Sign in faster") ? title : null;
    });
    const body = JSON.parse(String(stub.calls[1]?.init?.body ?? "{}")) as {
      fields?: Record<string, string>;
    };
    expect(body.fields).toEqual({ email: "alice@acme.com", password: "hunter2" });
  });

  it("submits the step's primary action on Enter inside a field", async () => {
    // Covers the orchestrator half of Enter-to-submit: `<zl-field>`
    // forwards Enter to `form.requestSubmit()` (zl-field.browser.spec),
    // and `handleFormSubmit` falls back to the first primary action
    // because Enter provides no submitter.
    const element = await mount();
    const root = element.shadowRoot!;
    await fillNativeField(root, "email", "alice@acme.com");
    await fillNativeField(root, "password", "hunter2");

    const emailField = root.querySelector('[data-testid="zitadel-field-email"]') as
      | (HTMLElement & { updateComplete: Promise<unknown> })
      | null;
    if (!emailField) {
      throw new Error("Expected email field host hook to render");
    }
    await emailField.updateComplete;
    const input = emailField.shadowRoot?.querySelector("input");
    if (!input) {
      throw new Error("Expected native input inside the email field");
    }
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );

    await waitFor(() => {
      const title = element.shadowRoot?.querySelector(".zl-card-title");
      return title?.textContent?.includes("Sign in faster") ? title : null;
    });
    // Exactly one step submission (calls[0] is the flow create), carrying
    // the primary action and the typed values.
    expect(stub.calls).toHaveLength(2);
    const enterBody = JSON.parse(String(stub.calls[1]?.init?.body ?? "{}")) as {
      action?: string;
      fields?: Record<string, string>;
    };
    expect(enterBody.action).toBe("submit");
    expect(enterBody.fields).toEqual({ email: "alice@acme.com", password: "hunter2" });
  });

  it("submits the current field value, not a stale cached one", async () => {
    const element = await mount();
    const root = element.shadowRoot!;
    await fillNativeField(root, "email", "alice@acme.com");
    await fillNativeField(root, "password", "hunter2");
    // Re-type the password: the submit must carry the live value read from the
    // atom at submit time, not the first value cached in `formValues`.
    await fillNativeField(root, "password", "hunter3");
    const submit = root.querySelector('zl-button[action="submit"]') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await submit.updateComplete;
    submit.shadowRoot?.querySelector("button")?.click();

    await waitFor(() => {
      const title = element.shadowRoot?.querySelector(".zl-card-title");
      return title?.textContent?.includes("Sign in faster") ? title : null;
    });
    const body = JSON.parse(String(stub.calls[1]?.init?.body ?? "{}")) as {
      fields?: Record<string, string>;
    };
    expect(body.fields).toEqual({ email: "alice@acme.com", password: "hunter3" });
  });

  it("ignores a duplicate submit while the first request is in-flight", async () => {
    const element = await mount();
    const root = element.shadowRoot!;
    await fillSignInFields(root);
    const event = new CustomEvent("zl-submit", {
      bubbles: true,
      composed: true,
      detail: { action: "submit" },
    });
    root.dispatchEvent(event);
    root.dispatchEvent(event);
    await waitFor(() => {
      const title = element.shadowRoot?.querySelector(".zl-card-title");
      return title?.textContent?.includes("Sign in faster") ? title : null;
    });
    expect(stub.calls).toHaveLength(2);
  });

  it("moves focus to the first focusable control after a step swap", async () => {
    const element = await mount();
    const root = element.shadowRoot!;
    await fillSignInFields(root);
    root.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );
    await waitFor(() => {
      const title = element.shadowRoot?.querySelector(".zl-card-title");
      return title?.textContent?.includes("Sign in faster") ? title : null;
    });
    // Focus moves once the new step's markup has committed (rAF today;
    // `await this.updateComplete` after the Phase 5 refactor). Poll until it
    // lands so this pins the behaviour regardless of the scheduling mechanism.
    const primary = element.shadowRoot?.querySelector('zl-button[hierarchy="primary"]');
    expect(primary).toBeTruthy();
    await waitFor(() => (element.shadowRoot?.activeElement === primary ? primary : null));
    expect(element.shadowRoot?.activeElement).toBe(primary);
  });

  // Regression: a required <zl-select> must gate submission client-side just
  // like a required <zl-field>. The submit-type <zl-button> delegates to
  // form.requestSubmit() (no parallel `zl-submit`), and the orchestrator
  // blocks the empty required field, surfacing a styled, localised error
  // inline on the control through the server's own `error.<field>_required`
  // dialect — not a native browser bubble and not a form-level banner.
  const registerSelectStep: CreateFlow201 = {
    id: "flow_1",
    session_id: "sess_1",
    session_token: "tok_1",
    step: {
      name: "register",
      texts: { title_key: "register.title" },
      fields: [
        {
          name: "favoriteColor",
          type: "select",
          text_key: "register.field.favoriteColor",
          required: true,
          validation: { enum: ["Red", "Green", "Blue"] },
        },
      ],
      actions: [{ name: "submit", kind: "submit", text_key: "submit.register", primary: true }],
      gates: {},
    },
  };

  async function mountRegisterSelect(): Promise<ZitadelLogin> {
    stub.restore();
    stub = installFlowFetchStub([registerSelectStep, passkeyUpsellStep]);
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "register";
    element.project = testProject;
    host.appendChild(element);
    await waitFor(() => (element.shadowRoot?.querySelector("zl-select") ? element : null));
    await waitFor(() => (element.getAttribute("aria-busy") === "false" ? element : null));
    return element;
  }

  it("blocks submit and shows a styled required error inline on the select", async () => {
    const element = await mountRegisterSelect();
    const root = element.shadowRoot!;
    const submit = root.querySelector('zl-button[action="submit"]') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await submit.updateComplete;
    submit.shadowRoot?.querySelector("button")?.click();
    // Give any (unwanted) async submit a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 150));
    // Only the initial flow-create call happened; the submit was blocked by
    // the client-side required check on the empty select.
    expect(stub.calls).toHaveLength(1);
    // The error routes inline onto the select (localised via the
    // `error.field_required` fallback), not a form-level <zl-alert> banner and
    // not a native browser validation bubble.
    const select = await waitFor(() => {
      const el = root.querySelector('zl-select[name="favoriteColor"]');
      return el?.getAttribute("error") ? el : null;
    });
    expect(select?.getAttribute("error") ?? "").toContain("required");
    expect(root.querySelector("zl-alert[severity='error']")).toBeNull();
  });

  it("submits once a required select has a chosen value", async () => {
    const element = await mountRegisterSelect();
    const root = element.shadowRoot!;
    const select = root.querySelector('zl-select[name="favoriteColor"]') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await select.updateComplete;
    const native = select.shadowRoot?.querySelector("select") as HTMLSelectElement;
    native.value = "Green";
    native.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await select.updateComplete;

    const submit = root.querySelector('zl-button[action="submit"]') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await submit.updateComplete;
    submit.shadowRoot?.querySelector("button")?.click();

    await waitFor(() => (stub.calls.length > 1 ? stub.calls : null));
    const body = JSON.parse(String(stub.calls[1]?.init?.body ?? "{}")) as {
      fields?: Record<string, string>;
    };
    expect(body.fields).toEqual({ favoriteColor: "Green" });
  });

  // A required checkbox must NOT gate submission: it always has a value
  // (`false` when unticked), so it submits real `false` rather than blocking.
  // A must-accept boolean is a schema concern (`const: true`), not this gate.
  const registerCheckboxStep: CreateFlow201 = {
    id: "flow_1",
    session_id: "sess_1",
    session_token: "tok_1",
    step: {
      name: "register",
      texts: { title_key: "register.title" },
      fields: [
        {
          name: "terms",
          type: "checkbox",
          text_key: "register.field.terms",
          required: true,
        },
      ],
      actions: [{ name: "submit", kind: "submit", text_key: "submit.register", primary: true }],
      gates: {},
    },
  };

  it("submits a required, unticked checkbox as false instead of blocking", async () => {
    stub.restore();
    stub = installFlowFetchStub([registerCheckboxStep, passkeyUpsellStep]);
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "register";
    element.project = testProject;
    host.appendChild(element);
    const root = element.shadowRoot!;
    await waitFor(() => (root.querySelector("zl-checkbox") ? element : null));
    await waitFor(() => (element.getAttribute("aria-busy") === "false" ? element : null));

    const submit = root.querySelector('zl-button[action="submit"]') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await submit.updateComplete;
    submit.shadowRoot?.querySelector("button")?.click();

    await waitFor(() => (stub.calls.length > 1 ? stub.calls : null));
    const body = JSON.parse(String(stub.calls[1]?.init?.body ?? "{}")) as {
      fields?: Record<string, unknown>;
    };
    expect(body.fields).toEqual({ terms: false });
    expect(root.querySelector('zl-checkbox[name="terms"]')?.getAttribute("error")).toBeFalsy();
  });

  // Regression: frameworks like @lit/react attach the element first and
  // assign object properties (`branding`, `locale`) afterwards. The
  // orchestrator must defer flow-start until properties have been applied.
  it("starts the flow when project is set after attach (React-style)", async () => {
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    host.appendChild(element);
    // Property assigned after the element is in the DOM, simulating @lit/react.
    element.project = testProject;
    await waitFor(() => element.shadowRoot?.querySelectorAll("zl-field").length === 2);
    const fields = element.shadowRoot?.querySelectorAll("zl-field");
    expect(fields?.[0]?.getAttribute("name")).toBe("email");
    expect(fields?.[1]?.getAttribute("name")).toBe("password");
  });
});
