import type { CreateFlow201, CreateFlow201Step } from "@zitadel/api/generated/model";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import type { ZitadelProject } from "@zitadel/api/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { DISPATCHED_EVENTS } from "../events.js";
import { manifestRegistry } from "../manifests.js";

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
        autocomplete: "username",
        required: true,
      },
      {
        name: "password",
        type: "password",
        text_key: "identifier.field.password",
        autocomplete: "current-password",
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
      {
        name: "setup",
        kind: "passkey_register",
        text_key: "passkey-upsell.action.setup",
        primary: true,
      },
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
 * the queue; the last entry is replayed if the queue is exhausted.
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
    testProject = configureZitadel({
      proxyPath: "/__nextgen",
      projectId: "test-project",
      url: "http://localhost:4000",
    });
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
    await waitFor(() => (element.getAttribute("aria-busy") === "false" ? element : null));
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

  // A required <zl-select> must gate submission client-side just
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

  // Frameworks like @lit/react attach the element first and
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

/**
 * A password step reached from an identifier step: it collects only the
 * password, so the engine hands back the identifier it already has for the
 * form to carry beside it.
 */
const pairedPasswordStep: CreateFlow201 = {
  id: "flow_1",
  session_id: "sess_1",
  session_token: "tok_1",
  step: {
    name: "password",
    texts: { title_key: "password.title" },
    fields: [
      {
        name: "x-auth-methods#password",
        type: "password",
        text_key: "identifier.field.password",
        autocomplete: "current-password",
        required: true,
      },
    ],
    identifier: { value: "alice@example.com", autocomplete: "username" },
    actions: [
      { name: "submit", kind: "submit", text_key: "submit.signin", primary: true },
      { name: "back", kind: "back", text_key: "action.back" },
    ],
    gates: {},
  },
};

/** The same step with nothing collected upstream — no pairing to do. */
const unpairedPasswordStep: CreateFlow201 = {
  ...pairedPasswordStep,
  step: { ...pairedPasswordStep.step, identifier: undefined },
};

describe("<zitadel-login> paired identifier (chromium)", () => {
  let host: HTMLDivElement;
  let stub: ReturnType<typeof installFlowFetchStub>;
  let testProject: ZitadelProject;

  function setup(responses: readonly CreateFlow201[]): void {
    _resetConfigForTesting();
    testProject = configureZitadel({
      proxyPath: "/__nextgen",
      projectId: "test-project",
      url: "http://localhost:4000",
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    stub = installFlowFetchStub(responses);
  }

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
      return root?.querySelector("zl-field") ? root : null;
    });
    await waitFor(() => (element.getAttribute("aria-busy") === "false" ? element : null));
    return element;
  }

  it("renders it as a nameless read-only control inside the form", async () => {
    setup([pairedPasswordStep]);
    const element = await mount();
    const form = element.shadowRoot?.querySelector("form");
    const paired = form?.querySelector<HTMLInputElement>('input[autocomplete="username"]');

    expect(paired).toBeTruthy();
    expect(paired?.value).toBe("alice@example.com");
    // As an attribute, not just a property: a manager reading the markup has
    // to find the address there. A `.value` binding leaves it absent.
    expect(paired?.getAttribute("value")).toBe("alice@example.com");
    expect(paired?.readOnly).toBe(true);
    // No name: a nameless control is left out of every submission, which is
    // what keeps it from reaching the engine as a field the step never declared.
    expect(paired?.hasAttribute("name")).toBe(false);
    // A manager has to see a credential-shaped control, so it is clipped rather
    // than `display:none` or `type="hidden"`.
    expect(paired?.type).toBe("text");
    expect(paired?.getAttribute("aria-hidden")).toBe("true");
    expect(paired?.tabIndex).toBe(-1);
  });

  it("renders nothing when the step carries no identifier", async () => {
    setup([unpairedPasswordStep]);
    const element = await mount();
    const form = element.shadowRoot?.querySelector("form");
    expect(form?.querySelector('input[autocomplete="username"]')).toBeNull();
  });

  it("comes back on a reload, which re-renders the step from flow state", async () => {
    // A reload loses `formValues` — the widget keeps collected values in memory
    // only — so the pairing has to survive on what GET /flow/{id} returns.
    setup([pairedPasswordStep]);
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.project = testProject;
    element.resumeFlowId = "flow_1";
    host.appendChild(element);
    await waitFor(() => {
      const root = element.shadowRoot;
      return root?.querySelector("zl-field") ? root : null;
    });

    const resumed = stub.calls.find((call) => (call.init?.method ?? "GET") === "GET");
    expect(resumed?.url).toContain("/flow/flow_1");
    const paired = element.shadowRoot
      ?.querySelector("form")
      ?.querySelector<HTMLInputElement>('input[autocomplete="username"]');
    expect(paired?.getAttribute("value")).toBe("alice@example.com");
  });

  it("disappears when back lands on a step that collects the identifier itself", async () => {
    setup([pairedPasswordStep, identifierStep]);
    const element = await mount();
    const root = element.shadowRoot!;
    expect(root.querySelector('input[part="paired-identifier"]')).toBeTruthy();

    root.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "back" },
      }),
    );
    await waitFor(() =>
      element.shadowRoot?.querySelectorAll("zl-field").length === 2 ? element : null,
    );
    // That step renders the identifier as a real field, so a second copy would
    // be a duplicate the manager has to choose between.
    expect(element.shadowRoot?.querySelector('input[part="paired-identifier"]')).toBeNull();
  });

  it("hands focus to the step's first control when the host is focused", async () => {
    // It is the shadow root's first focusable element, so `delegatesFocus`
    // sends host focus to it.
    setup([pairedPasswordStep]);
    const element = await mount();
    (document.activeElement as HTMLElement | null)?.blur();

    element.focus();
    expect(element.shadowRoot?.activeElement?.tagName).toBe("ZL-FIELD");
  });

  it("follows the server when a second identifier replaces the first", async () => {
    // Back, then a different address: the control must not keep the old one.
    // It reads `step.identifier` rather than the cross-step `formValues` cache,
    // where earlier entries win on conflict.
    const second: CreateFlow201 = {
      ...pairedPasswordStep,
      step: {
        ...pairedPasswordStep.step,
        identifier: { value: "bob@example.com", autocomplete: "username" },
      },
    };
    setup([pairedPasswordStep, second]);
    const element = await mount();
    const root = element.shadowRoot!;
    await fillNativeField(root, "x-auth-methods#password", "hunter2");
    root.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );
    await waitFor(() => {
      const paired = element.shadowRoot?.querySelector<HTMLInputElement>(
        'input[autocomplete="username"]',
      );
      return paired?.getAttribute("value") === "bob@example.com" ? paired : null;
    });
  });

  it("keeps it out of the submitted fields", async () => {
    setup([pairedPasswordStep]);
    const element = await mount();
    const root = element.shadowRoot!;
    await fillNativeField(root, "x-auth-methods#password", "hunter2");
    root.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: "submit" },
      }),
    );
    const submit = await waitFor(() =>
      stub.calls.find((call) => call.init?.method === "POST" && call.url.includes("/submit")),
    );
    const body = JSON.parse(String(submit.init?.body)) as { fields: Record<string, unknown> };
    expect(body.fields).toHaveProperty("x-auth-methods#password", "hunter2");
    expect(Object.keys(body.fields)).toEqual(["x-auth-methods#password"]);
  });
});

/**
 * What a script on the page can observe while a visitor signs in.
 *
 * Listeners sit on `window` and `document`, in the capture and the bubble
 * phase, for every event the widget can emit: the public `zitadel-*` events,
 * every atom event the manifests declare, and the `input` and `change` the
 * atoms re-publish. Typing goes through the real keyboard into the real
 * `<zl-field>`. The browser's own trusted events (key presses and the native
 * `input` of a keystroke) are not the widget's to withhold, so they are left
 * out; everything the widget dispatches itself must carry no secret.
 */
describe("<zitadel-login> what the page can observe while signing in (chromium)", () => {
  const PASSWORD = "Zq9#vLx!k2";
  const NEW_PASSWORD = "Wm4$pTn@8d";
  const PIN = "7391-Rk5";
  const PASTED = "Pa5ted&Secret1";
  const AUTOFILLED = "Au7ofill%Sec2";
  const REVEALED = "Rv6ealed^Ty3";
  const PASSKEY_SIGNATURE = "Qw8sig-proof-Mk3Xq";
  const SECRETS = [
    PASSWORD,
    NEW_PASSWORD,
    PIN,
    PASTED,
    AUTOFILLED,
    REVEALED,
    PASSKEY_SIGNATURE,
    btoa(PASSKEY_SIGNATURE).replace(/=+$/, ""),
  ];

  const EVENT_TYPES = [
    ...new Set<string>([
      ...DISPATCHED_EVENTS,
      ...manifestRegistry.flatMap((manifest) => manifest.events),
      "input",
      "change",
    ]),
  ];

  interface Observation {
    readonly type: string;
    /** Dispatched by the widget: not the browser's, and not on the native input. */
    readonly byWidget: boolean;
    readonly stage: string;
    readonly detail: string;
    readonly data: string | null | undefined;
  }

  function step(name: string, fields: CreateFlow201Step["fields"]): CreateFlow201 {
    return {
      id: "flow_1",
      session_id: "sess_1",
      session_token: `tok_${name}`,
      step: {
        name,
        texts: { title_key: "identifier.title" },
        fields,
        actions: [{ name: "submit", kind: "submit", text_key: "submit.signin", primary: true }],
        gates: {},
      },
    };
  }

  const identifier = step("identifier", [
    {
      name: "email",
      type: "email",
      text_key: "identifier.field.email",
      autocomplete: "username",
      required: true,
    },
  ]);
  const password = step("password", [
    {
      name: "password",
      type: "password",
      text_key: "identifier.field.password",
      autocomplete: "current-password",
      required: true,
    },
  ]);
  const register = step("register", [
    {
      name: "new_password",
      type: "password",
      text_key: "identifier.field.password",
      autocomplete: "new-password",
      required: true,
    },
    { name: "pin", type: "text", text_key: "identifier.field.email" },
    {
      name: "nickname",
      type: "text",
      text_key: "identifier.field.email",
      autocomplete: "nickname",
    },
    { name: "newsletter", type: "checkbox", text_key: "identifier.field.email" },
  ]);

  let host: HTMLDivElement;
  let stub: ReturnType<typeof installFlowFetchStub>;
  let observations: Observation[];
  let stage: string;
  let stopObserving: () => void;
  let credentials: PropertyDescriptor | undefined;

  beforeEach(() => {
    _resetConfigForTesting();
    configureZitadel({ proxyPath: "/__nextgen", projectId: "test-project" });
    host = document.createElement("div");
    document.body.appendChild(host);
    stub = installFlowFetchStub([identifier, password, register, passkeyUpsellStep]);

    observations = [];
    stage = "start";
    const stops: (() => void)[] = [];
    for (const target of [window, document]) {
      for (const capture of [true, false]) {
        for (const type of EVENT_TYPES) {
          const listener = (event: Event): void => {
            observations.push({
              type,
              byWidget: !event.isTrusted && !(event.composedPath()[0] instanceof HTMLInputElement),
              stage,
              detail: event instanceof CustomEvent ? JSON.stringify(event.detail) : "",
              data: event instanceof InputEvent ? event.data : undefined,
            });
          };
          target.addEventListener(type, listener, capture);
          stops.push(() => target.removeEventListener(type, listener, capture));
        }
      }
    }
    stopObserving = () => {
      for (const stop of stops) stop();
    };

    credentials = Object.getOwnPropertyDescriptor(navigator, "credentials");
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        get: async () => ({
          id: "cred-id",
          rawId: new TextEncoder().encode("rawid").buffer,
          type: "public-key",
          response: {
            clientDataJSON: new TextEncoder().encode("{}").buffer,
            authenticatorData: new TextEncoder().encode("authdata").buffer,
            signature: new TextEncoder().encode(PASSKEY_SIGNATURE).buffer,
          },
        }),
      },
    });
  });

  afterEach(() => {
    stopObserving();
    host.remove();
    stub.restore();
    if (credentials) Object.defineProperty(navigator, "credentials", credentials);
  });

  function nativeInput(element: ZitadelLogin, name: string): HTMLInputElement | undefined {
    return (
      element.shadowRoot
        ?.querySelector(`zl-field[name="${name}"]`)
        ?.shadowRoot?.querySelector("input") ?? undefined
    );
  }

  async function focusField(element: ZitadelLogin, name: string): Promise<HTMLInputElement> {
    const input = await waitFor(() => nativeInput(element, name));
    input.focus();
    return input;
  }

  async function submitStep(element: ZitadelLogin): Promise<void> {
    const button = await waitFor(() =>
      element.shadowRoot
        ?.querySelector('zl-button[action="submit"]')
        ?.shadowRoot?.querySelector("button"),
    );
    button.click();
  }

  function leaks(observation: Observation): string[] {
    const haystack = `${observation.detail}${observation.data ?? ""}`;
    return SECRETS.flatMap((secret) =>
      Array.from({ length: secret.length - 2 }, (_unused, index) =>
        secret.slice(0, index + 3),
      ).filter((prefix) => haystack.includes(prefix)),
    );
  }

  it("shows the page no secret across a whole sign-in and sign-up", async () => {
    const element = document.createElement("zitadel-login");
    element.purpose = "login";
    element.project = configureZitadel({ proxyPath: "/__nextgen", projectId: "test-project" });
    host.appendChild(element);

    stage = "identifier";
    await focusField(element, "email");
    await userEvent.keyboard("alice@acme.com");
    await submitStep(element);

    stage = "password";
    const typed = await focusField(element, "password");
    await userEvent.keyboard(PASSWORD);
    await userEvent.keyboard("{Backspace}{Backspace}");
    await userEvent.keyboard(PASSWORD.slice(-2));
    const toggle = await waitFor(() =>
      element.shadowRoot
        ?.querySelector('zl-field[name="password"]')
        ?.shadowRoot?.querySelector<HTMLButtonElement>('[part~="password-toggle"]'),
    );
    toggle.click();
    await waitFor(() => (typed.type === "text" ? typed : null));
    await userEvent.keyboard(REVEALED);
    typed.type = "text";
    typed.value = "";
    typed.value = PASTED;
    typed.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: PASTED,
        inputType: "insertFromPaste",
      }),
    );
    typed.value = AUTOFILLED;
    typed.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    typed.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await submitStep(element);

    stage = "register";
    await focusField(element, "new_password");
    await userEvent.keyboard(NEW_PASSWORD);
    await focusField(element, "pin");
    await userEvent.keyboard(PIN);
    stage = "nickname";
    await focusField(element, "nickname");
    await userEvent.keyboard("ally");
    stage = "checkbox";
    const newsletter = await waitFor(() =>
      element.shadowRoot
        ?.querySelector('zl-checkbox[name="newsletter"]')
        ?.shadowRoot?.querySelector("input"),
    );
    newsletter.click();
    stage = "register-submit";
    await submitStep(element);

    stage = "passkey";
    await waitFor(() => element.shadowRoot?.querySelector('zl-button[action="setup"]'));
    const passkey = document.createElement("zl-passkey");
    passkey.challengeId = "ch_1";
    passkey.method = "passkey";
    passkey.options = { challenge: "AAAA" };
    element.shadowRoot?.appendChild(passkey);
    await waitFor(() => (stub.calls.length >= 5 ? stub.calls : null));
    expect(String(stub.calls[4]?.init?.body)).toContain("challenge_response");

    const seen = observations.filter((observation) => observation.byWidget);
    expect(seen.length).toBeGreaterThan(0);

    expect(seen.flatMap(leaks)).toEqual([]);

    const secretStages = new Set(["password", "register", "passkey"]);
    const published = seen.filter(
      (observation) => observation.type === "input" && secretStages.has(observation.stage),
    );
    expect(published.length).toBeGreaterThan(0);
    expect(published.every((observation) => observation.data === null)).toBe(true);

    const flowInputs = seen.filter((observation) => observation.type === "zitadel-flow-input");
    expect(
      flowInputs.some((observation) => observation.detail.includes('"value":"alice@acme.com"')),
    ).toBe(true);
    expect(
      flowInputs
        .filter(
          (observation) =>
            secretStages.has(observation.stage) && observation.detail.includes('"name":"password"'),
        )
        .every((observation) => observation.detail === '{"name":"password","secret":true}'),
    ).toBe(true);
    expect(
      flowInputs.some(
        (observation) =>
          observation.detail.includes('"name":"nickname"') &&
          observation.detail.includes('"value":"ally"'),
      ),
    ).toBe(true);

    expect(seen.some((observation) => observation.type === "zitadel-flow-step")).toBe(true);
    expect(observations.filter((observation) => observation.type === "zl-input")).toEqual([]);
    expect(observations.filter((observation) => observation.type === "zl-change")).toEqual([]);
    expect(String(stub.calls[3]?.init?.body)).toContain('"newsletter":true');
    expect(observations.filter((observation) => observation.type === "zl-passkey-result")).toEqual(
      [],
    );
  });
});
