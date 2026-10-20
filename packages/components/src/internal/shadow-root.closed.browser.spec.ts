import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import type { CreateFlow201 } from "@zitadel/api/generated/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { LIGHT_DOM_TAGS, registeredElements } from "../__tests__/registered-elements.js";

import { SHADOW_ROOT_MODE } from "./shadow-root.js";

/**
 * Runs in the `closed-roots` project, which loads the source with the shipped
 * build's shadow root mode: what a page script can and cannot reach through a
 * closed root. The same checks against the open roots every other project
 * runs would fail, which is what makes them the proof.
 */

const elements = await registeredElements(() => import("../index.js"));

const signInStep: CreateFlow201 = {
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

async function waitFor<T>(probe: () => T | null | undefined, timeout = 3000): Promise<T> {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error("waitFor timed out");
}

describe("closed shadow roots", () => {
  let host: HTMLDivElement;
  let bodies: string[];

  beforeEach(() => {
    _resetConfigForTesting();
    host = document.createElement("div");
    document.body.appendChild(host);
    bodies = [];
    vi.stubGlobal(
      "fetch",
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        bodies.push(String(init?.body ?? ""));
        return new Response(JSON.stringify(signInStep), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
    );
  });

  afterEach(() => {
    host.remove();
    vi.unstubAllGlobals();
  });

  async function mountLogin() {
    const login = document.createElement("zitadel-login");
    login.purpose = "login";
    login.project = configureZitadel({
      proxyPath: "/__nextgen",
      projectId: "test-project",
      url: "http://localhost:4000",
    });
    host.appendChild(login);
    await waitFor(() => (login.getAttribute("aria-busy") === "false" ? login : null));
    return login;
  }

  it("is the mode this project runs", () => {
    expect(SHADOW_ROOT_MODE).toBe("closed");
  });

  describe.each(elements)("<$tag>", ({ tag }) => {
    async function mountTag() {
      configureZitadel({
        proxyPath: "/__nextgen",
        projectId: "test-project",
        url: "http://localhost:4000",
      });
      const element = document.createElement(tag);
      host.appendChild(element);
      if ("updateComplete" in element) await element.updateComplete;
      return element;
    }

    it("has no shadow root a page script can reach", async () => {
      const element = await mountTag();
      expect(element.shadowRoot).toBeNull();
    });

    it.skipIf(LIGHT_DOM_TAGS.includes(tag))("renders into a closed root", async () => {
      const element = await mountTag();
      const root = "renderRoot" in element ? element.renderRoot : null;
      expect(root instanceof ShadowRoot && root.mode).toBe("closed");
    });
  });

  it("keeps the typed password out of a page-level capture listener", async () => {
    const login = await mountLogin();
    const seen: { type: string; target: EventTarget | null; path: EventTarget[] }[] = [];
    const record = (event: Event): void => {
      seen.push({ type: event.type, target: event.target, path: event.composedPath() });
    };
    const types = ["focusin", "keydown", "beforeinput", "input", "change"];
    for (const type of types) document.addEventListener(type, record, true);

    login.focus();
    await userEvent.keyboard("alice@acme.com{Tab}hunter2");

    for (const type of types) document.removeEventListener(type, record, true);

    expect(seen.some((entry) => entry.type === "input")).toBe(true);
    for (const entry of seen) {
      expect(entry.target, entry.type).toBe(login);
      expect(entry.path[0], entry.type).toBe(login);
      expect(
        entry.path.some((node) => node instanceof HTMLInputElement || node instanceof ShadowRoot),
        entry.type,
      ).toBe(false);
      expect(Reflect.get(entry.path[0] ?? {}, "value"), entry.type).toBeUndefined();
    }
    expect(login.shadowRoot).toBeNull();
    expect(login.querySelector("input")).toBeNull();
  });

  it("does not hide keystrokes, which the browser composes", async () => {
    const login = await mountLogin();
    const keys: string[] = [];
    const record = (event: KeyboardEvent): void => {
      keys.push(event.key);
    };
    document.addEventListener("keydown", record, true);

    login.focus();
    await userEvent.keyboard("ab");
    document.removeEventListener("keydown", record, true);

    expect(keys).toEqual(["a", "b"]);
  });

  // A limitation, pinned so a Lit upgrade that changes it forces the README's
  // "Shadow roots" section to be revisited. Lit keeps the part it renders
  // into on the element, and that part's parent is the root.
  it("still lets a script that walks the element's own properties reach the root", async () => {
    const login = await mountLogin();
    const holder = Reflect.ownKeys(login)
      .map((key) => Reflect.get(login, key))
      .find(
        (value) =>
          typeof value === "object" && Reflect.get(value ?? {}, "parentNode") instanceof ShadowRoot,
      );

    expect(Reflect.get(holder ?? {}, "parentNode")).toBeInstanceOf(ShadowRoot);
  });

  it("still signs in: typing, Tab and Enter reach the flow through the closed roots", async () => {
    const login = await mountLogin();

    login.focus();
    await userEvent.keyboard("alice@acme.com{Tab}hunter2{Enter}");

    await waitFor(() => (bodies.length >= 2 ? bodies : null));
    const submitted: { fields?: Record<string, string> } = JSON.parse(bodies[1] ?? "{}");
    expect(submitted.fields).toEqual({ email: "alice@acme.com", password: "hunter2" });
  });
});
