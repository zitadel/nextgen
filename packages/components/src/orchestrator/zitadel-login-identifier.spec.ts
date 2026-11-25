import { clearBranding, setupMockHandlers, type MockHandle } from "@zitadel/api-mock";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import type { CreateFlow201, CreateFlow201StepFieldsItem } from "@zitadel/api/generated/model";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";

/**
 * The copy around the sign-in identifier when the user schema's
 * `x-identifier` is not an email address: steps as the server renders them
 * for a project that signs in by `employee_number`.
 */
const API_BASE = "https://identifier.test.invalid";

let mock: MockHandle = setupMockHandlers();
const server = setupServer(...mock.handlers);

let testProject = configureZitadel({ proxyPath: API_BASE, projectId: "demo-project" });

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(() => {
  _resetConfigForTesting();
  testProject = configureZitadel({ proxyPath: API_BASE, projectId: "demo-project" });
  mock = setupMockHandlers();
  server.resetHandlers(...mock.handlers);
  clearBranding();
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

type Step = CreateFlow201["step"];

/** The identifier field the server sends: `username` marks it, whatever its type. */
const EMPLOYEE_NUMBER = {
  name: "employee_number",
  type: "text",
  text_key: "identifier.field.employee_number",
  autocomplete: "username",
  required: true,
} as const;

function identifierStep(step: Partial<Step> = {}): Step {
  return {
    name: "identifier",
    texts: { title_key: "identifier.title", description_key: "identifier.description" },
    fields: [EMPLOYEE_NUMBER],
    actions: [
      { name: "submit", kind: "submit", text_key: "identifier.action.continue", primary: true },
    ],
    gates: {},
    ...step,
  };
}

/** Answers the next flow start with `step`. */
function serve(step: Step): void {
  const body: CreateFlow201 = { id: "flow_test", session_id: "sess_test", step, branding: {} };
  server.use(http.post("*/flows", () => HttpResponse.json(body, { status: 201 }), { once: true }));
}

async function waitFor<T>(probe: () => T | null | undefined, timeout = 10_000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error("waitFor timed out");
}

describe("<zitadel-login> with an identifier that is not an email", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  /** Mounts the element and waits for `ready` in its shadow root. */
  async function mount(
    ready: string,
    configure?: (element: ZitadelLogin) => void,
  ): Promise<ShadowRoot> {
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.project = testProject;
    configure?.(element);
    host.appendChild(element);
    await waitFor(() => element.shadowRoot?.querySelector(ready));
    return element.shadowRoot!;
  }

  function subtitle(root: ShadowRoot): string | null | undefined {
    return root.querySelector(".zl-card-subtitle")?.textContent;
  }

  it("describes the identifier step without naming the email", async () => {
    serve(identifierStep());

    const root = await mount('zl-field[name="employee_number"]');

    expect(subtitle(root)).toBe("Enter your details to continue");
    expect(root.querySelector('zl-field[name="employee_number"]')?.getAttribute("label")).toBe(
      "Employee number",
    );
  });

  it("does so on a step that offers sign-in providers too", async () => {
    serve(
      identifierStep({
        texts: { title_key: "identifier.title", description_key: "identifier.description.sso" },
        sso_providers: [{ id: "google", name: "Google", template: "google" }],
      }),
    );

    const root = await mount("zl-sso-providers");

    expect(subtitle(root)).toBe("Enter your details to continue");
  });

  it("shows the host's own description instead", async () => {
    serve(identifierStep());

    const root = await mount('zl-field[name="employee_number"]', (element) => {
      element.locales = { en: { "identifier.description": "Enter your employee number" } };
    });

    expect(subtitle(root)).toBe("Enter your employee number");
  });

  it("offers the passkey-first fallback without naming the email", async () => {
    serve(passkeyFirstStep());

    const root = await mount('zl-button[action="email_fallback"]');

    expect(root.querySelector('zl-button[action="email_fallback"]')?.getAttribute("label")).toBe(
      "Sign in another way",
    );
  });

  function notices(root: ShadowRoot): string[] {
    return Array.from(root.querySelectorAll("zl-alert[data-zl-step-message]"), (alert) =>
      (alert.textContent ?? "").trim(),
    );
  }

  /** The step a sign-in moves to when the typed identifier has no account. */
  function registerStep(identifier: CreateFlow201StepFieldsItem = EMPLOYEE_NUMBER): Step {
    return {
      name: "register",
      texts: { title_key: "register.title", description_key: "register.description" },
      fields: [{ ...identifier, text_key: `register.field.${identifier.name}` }],
      actions: [
        { name: "submit", kind: "submit", text_key: "register.action.submit", primary: true },
      ],
      gates: {},
      notice: "notice.user_not_found",
    };
  }

  describe("the notice that a sign-in moved to sign-up", () => {
    it("names no email", async () => {
      serve(registerStep());

      const root = await mount("zl-alert[data-zl-step-message]");

      expect(notices(root)).toEqual([
        "We couldn't find an account with those details, so you can create one now. Mistyped something? Fix it below.",
      ]);
    });

    it("still points at the email field where the identifier is an email", async () => {
      serve(
        registerStep({
          name: "email",
          type: "email",
          text_key: "register.field.email",
          autocomplete: "username",
          required: true,
        }),
      );

      const root = await mount("zl-alert[data-zl-step-message]");

      expect(notices(root)).toEqual([
        "We couldn't find an account for that email, so you can create one now. Mistyped it? Fix it in the email field below.",
      ]);
    });

    it("shows the host's own text instead", async () => {
      serve(registerStep());

      const root = await mount("zl-alert[data-zl-step-message]", (element) => {
        element.locales = { en: { "notice.user_not_found": "No employee has that number yet." } };
      });

      expect(notices(root)).toEqual(["No employee has that number yet."]);
    });

    it("stays hidden in every language when the host hides it in English", async () => {
      serve(registerStep());

      const root = await mount('zl-field[name="employee_number"]', (element) => {
        element.lang = "de";
        element.locales = { en: { "notice.user_not_found": "" } };
      });

      expect(notices(root)).toEqual([]);
    });
  });

  /** The password step, which carries the identifier but no field for it. */
  function passwordStep(step: Partial<Step> = {}): Step {
    return {
      name: "password",
      texts: { title_key: "password.title", description_key: "password.description" },
      fields: [
        {
          name: "password",
          type: "password",
          text_key: "password.field.password",
          autocomplete: "current-password",
          required: true,
        },
      ],
      actions: [
        { name: "submit", kind: "submit", text_key: "password.action.signin", primary: true },
      ],
      gates: {},
      identifier: { value: "EMP-1234", autocomplete: "username" },
      ...step,
    };
  }

  it("says a sign-up moved to sign-in without naming the email", async () => {
    serve(passwordStep({ notice: "notice.user_already_exists" }));

    const root = await mount("zl-alert[data-zl-step-message]");

    expect(notices(root)).toEqual([
      "An account with these details already exists. Sign in to continue.",
    ]);
  });

  it("rejects a wrong password without naming the email", async () => {
    serve(passwordStep({ error: "error.invalid_credentials" }));

    const root = await mount('zl-field[name="password"][error]');

    expect(root.querySelector('zl-field[name="password"]')?.getAttribute("error")).toBe(
      "Wrong password.",
    );
  });

  it("rejects an unknown passkey without naming the email", async () => {
    serve(passkeyFirstStep({ error: "error.passkey_not_registered" }));

    const root = await mount("zl-alert[data-zl-step-error]");

    expect(root.querySelector("zl-alert[data-zl-step-error]")?.textContent?.trim()).toBe(
      "This passkey is not registered. Please sign in another way.",
    );
  });
});

function passkeyFirstStep(step: Partial<Step> = {}): Step {
  return {
    name: "passkey-first",
    texts: { title_key: "passkey-first.title", description_key: "passkey-first.description" },
    fields: [],
    actions: [
      { name: "passkey", kind: "passkey", text_key: "passkey-first.action.passkey", primary: true },
      { name: "email_fallback", kind: "navigate", text_key: "passkey-first.action.email_fallback" },
    ],
    gates: {},
    ...step,
  };
}
