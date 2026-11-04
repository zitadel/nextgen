import { _resetConfigForTesting, configureZitadel } from "@zitadel/api/config";
import { serveMockFlowApi } from "@zitadel/api-mock/vitest-browser";
import type { LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";

/**
 * Focus on the consent step (ADR 081 §11), in Chromium: its first control
 * grants the consent, so the widget must not move focus there by itself after
 * the sign-in the visitor finished with Enter.
 */

const mock = serveMockFlowApi();
let login: ZitadelLogin;
let address: string;

beforeEach(() => {
  _resetConfigForTesting();
  address = location.href;
  // The page the server's authorization endpoint opens: the widget reads the
  // request from the URL.
  const url = new URL(address);
  url.searchParams.set("auth_request", "req_mock");
  history.replaceState(history.state, "", url);
  login = document.createElement("zitadel-login");
  login.project = configureZitadel({ proxyPath: "/__nextgen", projectId: "proj_demo" });
  document.body.appendChild(login);
});

afterEach(() => {
  login.remove();
  history.replaceState(history.state, "", address);
});

const submissions = () => mock.current.getCaptured().filter((r) => r.kind === "submitFlowStep");

describe("<zitadel-login> consent focus (chromium)", () => {
  it("leaves Allow unfocused after the sign-in, so its Enter cannot grant the consent", async () => {
    await page.getByTestId("zitadel-input-email").fill("ada@example.com");
    await userEvent.keyboard("{Enter}");
    const password = page.getByTestId("zitadel-input-password");
    await expect.element(password).toBeVisible();
    await password.fill("hunter2-password");
    await userEvent.keyboard("{Enter}");

    await expect.element(page.getByTestId("zitadel-consent")).toBeVisible();
    const allow = login.shadowRoot!.querySelector<LitElement>('zl-button[action="accept"]')!;
    await allow.updateComplete;
    // Past the point where a step swap moves focus: the step's atoms have
    // rendered, and the widget hydrates on the next turn.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(login.shadowRoot?.activeElement).not.toBe(allow);
    expect(submissions().map((r) => r.body.action)).toEqual(["submit", "submit"]);
    await vi.waitFor(() => expect(login.getAttribute("aria-busy")).toBe("false"));
  });
});
