import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import type { CreateFlow201, CreateFlowBodyPurpose } from "@zitadel/api/generated/model";
import { clearBranding, PASSWORD_FIELD, setupMockHandlers } from "@zitadel/api-mock";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-login.js";
import type { ZlAlert } from "../atoms/zl-alert.js";
import type { ZlField } from "../atoms/zl-field.js";
import type { ZitadelLogin } from "./zitadel-login.js";

const server = setupServer();
let mock = setupMockHandlers();
let element: ZitadelLogin;
let steps: CreateFlow201["step"][];

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  _resetConfigForTesting();
  clearBranding();
  mock = setupMockHandlers({ accounts: ["known@example.com"] });
  server.resetHandlers(...mock.handlers);
  steps = [];
  element = document.createElement("zitadel-login");
  element.project = configureZitadel({
    proxyPath: "https://flow.test.invalid",
    projectId: "demo-project",
  });
  element.addEventListener("zitadel-flow-step", (event) => {
    steps.push((event as CustomEvent<{ step: CreateFlow201["step"] }>).detail.step);
  });
});

afterEach(() => {
  element.remove();
  vi.restoreAllMocks();
  server.resetHandlers();
});

function root(): ShadowRoot {
  return element.shadowRoot!;
}

async function transition(action: () => void): Promise<void> {
  const nextCount = steps.length + 1;
  action();
  await vi.waitFor(() => expect(steps).toHaveLength(nextCount));
  await element.updateComplete;
  await Promise.all(
    Array.from(
      root().querySelectorAll<ZlField | ZlAlert>("zl-field, zl-alert"),
      (atom) => atom.updateComplete,
    ),
  );
  expect(element.getAttribute("aria-busy")).toBe("false");
}

async function mount(purpose: CreateFlowBodyPurpose = "login"): Promise<void> {
  element.purpose = purpose;
  await transition(() => document.body.appendChild(element));
}

function clickLink(action: "register" | "sign_in"): void {
  const link = root().querySelector<HTMLAnchorElement>(`a[data-action="${action}"]`);
  expect(link).not.toBeNull();
  let click: Event | undefined;
  root().addEventListener(
    "click",
    (event) => {
      click = event;
    },
    { once: true },
  );
  link!.click();
  // Even a click ignored while busy must not follow href="#" and add a
  // browser-history entry outside the flow's own back-navigation sentinel.
  expect(click?.defaultPrevented).toBe(true);
}

function enter(name: string, value: string): void {
  const field = root().querySelector<ZlField>(`zl-field[name="${name}"]`);
  expect(field).not.toBeNull();
  const input = field!.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

function submitForm(): void {
  // jsdom cannot submit form-associated custom elements. Form participation
  // is covered in the browser suite; here we exercise the form's listener.
  root()
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function expectEntry(purpose: "login" | "register"): void {
  const login = purpose === "login";
  expect(steps.at(-1)).toMatchObject({ name: login ? "identifier" : "register", purpose });
  expect(root().querySelector(".zl-card-title")?.textContent).toBe(
    login ? "Sign in" : "Create your account",
  );
  expect(root().querySelector(".zl-card-subtitle")?.textContent).toBe(
    login ? "Enter your email to continue" : "Enter your details to get started",
  );
  const links = root().querySelectorAll(".zl-card-nav__link");
  expect(links).toHaveLength(1);
  expect(links[0]?.textContent).toBe(login ? "Sign up" : "Sign in");
  expect(links[0]?.getAttribute("data-action")).toBe(login ? "register" : "sign_in");
}

function expectNoBanner(): void {
  expect(
    root().querySelector("zl-alert[data-zl-step-message], zl-alert[data-zl-step-error]"),
  ).toBeNull();
  expect(steps.at(-1)?.notice).toBeUndefined();
}

describe("<zitadel-login> purpose navigation", () => {
  it.each(["login", "register"] as const)(
    "switches repeatedly through the actual links, starting at %s",
    async (initial) => {
      await mount(initial);
      expectEntry(initial);
      expectNoBanner();
      const actions: string[] = [];
      let purpose = initial;

      for (let i = 0; i < 6; i++) {
        const action = purpose === "login" ? "register" : "sign_in";
        actions.push(action);
        // Empty required fields must not prevent explicit navigation.
        await transition(() => clickLink(action));
        purpose = purpose === "login" ? "register" : "login";
        expectEntry(purpose);
        expectNoBanner();
        expect(root().querySelector("zl-field[invalid]")).toBeNull();
      }

      expect(mock.getCaptured().filter((request) => request.kind === "createFlow")).toHaveLength(1);
      expect(
        mock
          .getCaptured()
          .flatMap((request) => (request.kind === "submitFlowStep" ? [request.body.action] : [])),
      ).toEqual(actions);
    },
  );

  it("ignores repeated link clicks while a switch is pending without following the anchor", async () => {
    await mount();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (...args) => {
      await pending;
      return fetch(...args);
    });

    try {
      clickLink("register");
      await element.updateComplete;
      expect(element.getAttribute("aria-busy")).toBe("true");
      clickLink("register");
      clickLink("register");
      expect(steps).toHaveLength(1);
    } finally {
      release();
      await vi.waitFor(() => expect(steps).toHaveLength(2));
      await element.updateComplete;
    }

    expectEntry("register");
    expectNoBanner();
    expect(mock.getCaptured().filter((request) => request.kind === "submitFlowStep")).toHaveLength(
      1,
    );
  });

  it("clears validation errors when the visitor chooses another purpose", async () => {
    await mount();
    submitForm();
    await element.updateComplete;
    expect(root().querySelector("zl-field[invalid]")).not.toBeNull();

    await transition(() => clickLink("register"));
    expectEntry("register");
    expectNoBanner();
    expect(root().querySelector("zl-field[invalid]")).toBeNull();
    await transition(() => clickLink("sign_in"));
    expectEntry("login");
    expectNoBanner();
    expect(root().querySelector("zl-field[invalid]")).toBeNull();
  });

  it("does not carry a failed sign-in banner across explicit purpose switches", async () => {
    element.resumeFlowId = mock.returnFromProvider({
      provider: "google",
      email: "known@example.com",
      error: "access_denied",
    });
    await mount();
    expectEntry("login");
    expect(root().querySelector("zl-alert[data-zl-step-error]")).not.toBeNull();

    await transition(() => clickLink("register"));
    expectEntry("register");
    expectNoBanner();
    await transition(() => clickLink("sign_in"));
    expectEntry("login");
    expectNoBanner();
  });

  it("explains an unknown email switching to sign-up, then retires the notice on manual navigation", async () => {
    await mount();
    enter("email", "new@example.com");
    await transition(submitForm);
    expectEntry("register");
    expect(steps.at(-1)?.notice).toBe("notice.user_not_found");
    const notice = root().querySelector<ZlAlert>("zl-alert[data-zl-step-message]");
    expect(notice?.severity).toBe("info");
    expect(notice?.textContent).toContain("We couldn't find an account for that email");
    expect(root().querySelector("zl-alert[data-zl-step-error]")).toBeNull();

    enter("email", "corrected@example.com");
    await element.updateComplete;
    expect(root().querySelector("zl-alert[data-zl-step-message]")).toBe(notice);
    await transition(() => clickLink("sign_in"));
    expectEntry("login");
    expectNoBanner();
    expect(root().querySelector<ZlField>('zl-field[name="email"]')?.value).toBe(
      "corrected@example.com",
    );
    await transition(() => clickLink("register"));
    expectEntry("register");
    expectNoBanner();
  });

  it("shows no notice when the host sets its text to an empty string", async () => {
    element.locales = { en: { "notice.user_not_found": "" } };
    element.lang = "en";
    await mount();
    enter("email", "new@example.com");
    await transition(submitForm);
    expectEntry("register");
    expect(steps.at(-1)?.notice).toBe("notice.user_not_found");
    expect(root().querySelector("zl-alert[data-zl-step-message]")).toBeNull();
  });

  it("explains an existing email switching to sign-in, then clears the notice on the next step", async () => {
    await mount("register");
    enter("email", "known@example.com");
    enter("given_name", "Known");
    enter("family_name", "User");
    await transition(submitForm);

    expect(steps.at(-1)).toMatchObject({
      name: "password",
      purpose: "login",
      notice: "notice.user_already_exists",
    });
    expect(root().querySelector(".zl-card-title")?.textContent).toBe("Sign in");
    expect(root().querySelector(".zl-card-subtitle")?.textContent).toBe("Enter your password");
    const notice = root().querySelector<ZlAlert>("zl-alert[data-zl-step-message]");
    expect(notice?.severity).toBe("info");
    expect(notice?.textContent).toContain(
      "That email already has an account. Sign in to continue.",
    );
    expect(root().querySelector("zl-alert[data-zl-step-error]")).toBeNull();
    expect(root().querySelector("zl-field")?.getAttribute("autocomplete")).toBe("current-password");

    enter(PASSWORD_FIELD, "correct-horse-battery-staple");
    await element.updateComplete;
    expect(root().querySelector("zl-alert[data-zl-step-message]")).toBe(notice);
    await transition(submitForm);
    expect(steps.at(-1)).toMatchObject({ name: "done", purpose: "login" });
    expectNoBanner();
  });
});
