import { clearBranding, setupMockHandlers, type MockHandle } from "@zitadel/api-mock";
import type { CreateFlow201 } from "@zitadel/api/generated/model";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";

/**
 * The code behind a generic step error, which only a local development
 * deployment sends. Driven by the shared mock flow, with one submit answered
 * by an override, since the mock never sends the code.
 */
const API_BASE = "https://error-code.test.invalid";

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
  mock.reset();
  server.resetHandlers(...mock.handlers);
  clearBranding();
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

async function waitFor<T>(probe: () => T | null | undefined, timeout = 1500): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error("waitFor timed out");
}

function type(element: ZitadelLogin, name: string, value: string): void {
  element.shadowRoot?.dispatchEvent(
    new CustomEvent("zl-input", { bubbles: true, composed: true, detail: { name, value } }),
  );
}

function submit(element: ZitadelLogin, action = "submit"): void {
  element.shadowRoot?.dispatchEvent(
    new CustomEvent("zl-submit", { bubbles: true, composed: true, detail: { action } }),
  );
}

function query(element: ZitadelLogin, selector: string): HTMLElement | null {
  return element.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
}

function attach(host: HTMLElement, configure?: (element: ZitadelLogin) => void): ZitadelLogin {
  const element = document.createElement("zitadel-login") as ZitadelLogin;
  element.purpose = "login";
  element.project = testProject;
  configure?.(element);
  host.appendChild(element);
  return element;
}

async function mount(host: HTMLElement): Promise<ZitadelLogin> {
  const element = attach(host);
  await waitFor(() => query(element, 'zl-field[name="email"]'));
  return element;
}

describe("<zitadel-login> on a development deployment", () => {
  let host: HTMLDivElement;

  beforeAll(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.innerHTML = "";
  });

  describe("the code behind a generic error", () => {
    /** The step the flow started on, answered again with `extra` on it. */
    function answerSubmitWith(base: CreateFlow201, extra: Partial<CreateFlow201["step"]>) {
      server.use(
        http.post(
          "*/flow/:id/submit",
          () => HttpResponse.json({ ...base, step: { ...base.step, ...extra } }),
          { once: true },
        ),
      );
    }

    async function startedFlow(): Promise<{ element: ZitadelLogin; base: CreateFlow201 }> {
      let base: CreateFlow201 | undefined;
      const record = async ({ request, response }: { request: Request; response: Response }) => {
        if (request.method === "POST" && new URL(request.url).pathname.endsWith("/flow")) {
          base = (await response.clone().json()) as CreateFlow201;
        }
      };
      server.events.on("response:mocked", record);
      try {
        const element = await mount(host);
        await waitFor(() => base);
        return { element, base: base as CreateFlow201 };
      } finally {
        server.events.removeListener("response:mocked", record);
      }
    }

    it("goes under the message when the deployment sends it", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const { element, base } = await startedFlow();
        answerSubmitWith(base, {
          error: "error.sso_unavailable",
          error_code: "idp.discovery_failed",
        });
        type(element, "email", "alice@acme.com");
        submit(element);

        const detail = await waitFor(() => query(element, 'zl-alert [slot="detail"]'));
        expect(detail.textContent).toBe("Error code: idp.discovery_failed");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("idp.discovery_failed"));
      } finally {
        warn.mockRestore();
      }
    });

    it("leaves the message alone without it", async () => {
      const { element, base } = await startedFlow();
      answerSubmitWith(base, { error: "error.sso_unavailable" });
      type(element, "email", "alice@acme.com");
      submit(element);

      const alert = await waitFor(() => query(element, "zl-alert"));
      expect(alert.querySelector('[slot="detail"]')).toBeNull();
    });
  });
});
