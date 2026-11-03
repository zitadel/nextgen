import { _resetConfigForTesting, configureZitadel } from "@zitadel/api/config";
import { PASSWORD_FIELD } from "@zitadel/api-mock";
import { serveMockFlowApi } from "@zitadel/api-mock/vitest-browser";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";

const mock = serveMockFlowApi();
let login: ZitadelLogin;

beforeEach(() => {
  _resetConfigForTesting();
  login = document.createElement("zitadel-login");
  login.project = configureZitadel({ proxyPath: "/__nextgen", projectId: "proj_demo" });
  document.body.appendChild(login);
});

afterEach(() => {
  login.remove();
});

const email = () => page.getByTestId("zitadel-input-email");
const password = () => page.getByTestId("zitadel-input-password");
const submit = () => page.getByTestId("zitadel-action-submit-button");
const submissions = () => mock.current.getCaptured().filter((r) => r.kind === "submitFlowStep");

async function expectPasswordFocus() {
  // Let the browser assertion wait for the API-driven step to render before
  // inspecting native focus; vi.waitFor's default 1s is not a network deadline.
  await expect.element(password()).toBeVisible();
  // document.activeElement is the login host; focus crosses two shadow roots.
  await vi.waitFor(() => {
    expect(login.shadowRoot?.activeElement?.shadowRoot?.activeElement).toBe(password().element());
  });
}

describe("<zitadel-login> submit failures and latency (chromium)", () => {
  it("wrong password: announces the error, refocuses the field and retries with Enter", async () => {
    const completed = vi.fn();
    login.addEventListener("zitadel-flow-complete", completed);
    // Real typing reaches the atoms' native inputs, which jsdom specs bypass
    // by dispatching zl-input on the orchestrator directly.
    const atomEvent = vi.fn();
    document.addEventListener("zl-input", atomEvent);
    document.addEventListener("zl-change", atomEvent);
    onTestFinished(() => {
      document.removeEventListener("zl-input", atomEvent);
      document.removeEventListener("zl-change", atomEvent);
    });

    await email().fill("alice@example.com");
    await userEvent.keyboard("{Enter}");
    await expectPasswordFocus();
    mock.current.rejectNextSubmit("error.invalid_credentials");
    await password().fill("incorrect-password");
    await userEvent.keyboard("{Enter}");

    await expect.element(page.getByRole("alert")).toBeVisible();
    // The alert's message is slotted from its host, outside the role node's textContent.
    await expect.element(page.getByText("Wrong email or password.")).toBeVisible();
    await expectPasswordFocus();
    await expect.element(submit()).toBeEnabled();
    expect(completed).not.toHaveBeenCalled();

    await password().fill("corrected-password");
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("You're signed in")).toBeVisible();
    expect(completed).toHaveBeenCalledOnce();

    expect(submissions().map((r) => r.body.fields)).toEqual([
      { email: "alice@example.com" },
      { [PASSWORD_FIELD]: "incorrect-password" },
      { [PASSWORD_FIELD]: "corrected-password" },
    ]);
    expect(atomEvent).not.toHaveBeenCalled();
  });

  it("slow submit: sends one request for repeated submits, shows busy state, and focuses the next step", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(release);
    mock.current.delayNextSubmitUntil(released);

    await email().fill("alice@example.com");
    const form = login.shadowRoot!.querySelector("form")!;
    // The second submit lands in the same tick, before the busy state renders.
    form.requestSubmit();
    form.requestSubmit();
    await vi.waitFor(() => expect(submissions()).toHaveLength(1));
    await expect.element(submit()).toBeDisabled();
    expect(form.getAttribute("aria-busy")).toBe("true");
    form.requestSubmit();
    await login.updateComplete;
    expect(submissions()).toHaveLength(1);

    release();
    await expectPasswordFocus();
    await expect.element(submit()).toBeEnabled();
    expect(login.shadowRoot!.querySelector("form")!.getAttribute("aria-busy")).toBe("false");
    expect(submissions()).toHaveLength(1);
  });
});
