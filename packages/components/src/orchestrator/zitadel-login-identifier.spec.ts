import { clearBranding, setupMockHandlers, type MockHandle } from "@zitadel/api-mock";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import type { CreateFlow201 } from "@zitadel/api/generated/model";
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
    serve({
      name: "passkey-first",
      texts: { title_key: "passkey-first.title", description_key: "passkey-first.description" },
      fields: [],
      actions: [
        {
          name: "passkey",
          kind: "passkey",
          text_key: "passkey-first.action.passkey",
          primary: true,
        },
        {
          name: "email_fallback",
          kind: "navigate",
          text_key: "passkey-first.action.email_fallback",
        },
      ],
      gates: {},
    });

    const root = await mount('zl-button[action="email_fallback"]');

    expect(root.querySelector('zl-button[action="email_fallback"]')?.getAttribute("label")).toBe(
      "Sign in another way",
    );
  });
});
