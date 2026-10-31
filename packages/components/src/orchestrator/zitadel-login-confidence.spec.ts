import { _resetConfigForTesting, configureZitadel } from "@zitadel/api/config";
import { PASSWORD_FIELD } from "@zitadel/api-mock";
import { serveMockFlowApi } from "@zitadel/api-mock/vitest";
import { expect, it, onTestFinished, vi } from "vitest";

import "./zitadel-login.js";

const mock = serveMockFlowApi();

it("login confidence: failed exchange reports an error and never navigates or paints success", async () => {
  _resetConfigForTesting();
  const project = configureZitadel({
    proxyPath: "https://flow.test.invalid",
    projectId: "proj_demo",
  });
  const originalLocation = window.location;
  const navigate = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, assign: navigate },
  });
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const login = document.createElement("zitadel-login");
  onTestFinished(() => {
    login.remove();
    logged.mockRestore();
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });
  login.project = project;
  login.postSignInUrl = "/admin";
  const complete = vi.fn();
  const error = vi.fn();
  login.addEventListener("zitadel-flow-complete", complete);
  login.addEventListener("zitadel-flow-error", error);
  mock.current.failNextExchange();
  document.body.appendChild(login);

  async function submit(name: string, value: string) {
    await vi.waitFor(() =>
      expect(login.shadowRoot?.querySelector(`zl-field[name="${name}"]`)).toBeTruthy(),
    );
    login.shadowRoot!.dispatchEvent(new CustomEvent("zl-input", { detail: { name, value } }));
    login.shadowRoot!.dispatchEvent(new CustomEvent("zl-submit", { detail: { action: "submit" } }));
  }

  await submit("email", "alice@example.com");
  await submit(PASSWORD_FIELD, "correct-password");
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  await login.updateComplete;

  // Completion describes the flow, before its handoff has become a session.
  expect(complete).toHaveBeenCalledOnce();
  expect(mock.current.getCaptured().filter((r) => r.kind === "exchangeHandoff")).toHaveLength(1);
  expect(navigate).not.toHaveBeenCalled();
  expect(login.shadowRoot!.querySelector("zl-alert")?.textContent).toContain(
    "Session exchange is temporarily unavailable.",
  );
  expect(login.shadowRoot!.textContent).not.toContain("You're signed in");
  expect(login.getAttribute("aria-busy")).toBe("false");
});
