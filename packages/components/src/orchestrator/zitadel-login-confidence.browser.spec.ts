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

describe("login confidence", () => {
  it("wrong password: announces the error, keeps a keyboard retry usable, and exposes no password events", async () => {
    const completed = vi.fn();
    login.addEventListener("zitadel-flow-complete", completed);
    const publicInputs: unknown[] = [];
    const onInput = (event: Event) => publicInputs.push((event as CustomEvent).detail);
    const privateInput = vi.fn();
    document.addEventListener("zitadel-flow-input", onInput);
    document.addEventListener("zl-input", privateInput);
    document.addEventListener("zl-change", privateInput);
    onTestFinished(() => {
      document.removeEventListener("zitadel-flow-input", onInput);
      document.removeEventListener("zl-input", privateInput);
      document.removeEventListener("zl-change", privateInput);
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
    expect(mock.current.getCaptured().some((r) => r.kind === "exchangeHandoff")).toBe(false);

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
    expect(publicInputs).toContainEqual({ name: "email", value: "alice@example.com" });
    expect(publicInputs).not.toContainEqual(expect.objectContaining({ name: PASSWORD_FIELD }));
    expect(privateInput).not.toHaveBeenCalled();
  });

  it("slow submit: shows busy state, ignores repeated submission, and advances with focus once released", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(release);
    mock.current.delayNextSubmitUntil(released);

    await email().fill("alice@example.com");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(submissions()).toHaveLength(1));
    await expect.element(submit()).toBeDisabled();
    const form = login.shadowRoot!.querySelector("form")!;
    expect(form.getAttribute("aria-busy")).toBe("true");

    // Exercise the native form path even if a second submit was queued before
    // the disabled button painted. The submit guard must hold independently.
    form.requestSubmit();
    form.requestSubmit();
    await login.updateComplete;
    expect(submissions()).toHaveLength(1);
    expect(login.shadowRoot!.querySelector('zl-field[type="password"]')).toBeNull();

    release();
    await expectPasswordFocus();
    await expect.element(submit()).toBeEnabled();
    expect(login.shadowRoot!.querySelector("form")!.getAttribute("aria-busy")).toBe("false");
    expect(submissions()).toHaveLength(1);
  });
});
