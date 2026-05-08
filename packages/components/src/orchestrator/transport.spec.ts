import { describe, expect, it, vi } from "vitest";

import {
  FetchTransport,
  FixtureTransport,
  FlowTransportError,
  WalkingFixtureTransport,
  type FlowDefinition,
} from "./transport.js";
import type { FlowResponse } from "./types.js";

const baseStep: FlowResponse = {
  session_id: "sess_1",
  session_token: "tok_1",
  step: {
    name: "identifier",
    type: "identifier",
    fields: { email: { type: "email", text_key: "identifier.field.email", required: true } },
  },
};

const passwordStep: FlowResponse = {
  session_id: "sess_1",
  session_token: "tok_2",
  step: {
    name: "password",
    type: "credential",
    fields: { password: { type: "password", text_key: "password.field.password", required: true } },
  },
};

describe("FixtureTransport", () => {
  it("plays the script in order and replays the last response after exhaustion", async () => {
    const transport = new FixtureTransport({
      start: baseStep,
      submit: [() => passwordStep, () => baseStep],
    });

    const start = await transport.start();
    expect(start.step.name).toBe("identifier");

    const after1 = await transport.submit({
      session_id: "sess_1",
      session_token: "tok_1",
      payload: {},
    });
    expect(after1.step.name).toBe("password");

    const after2 = await transport.submit({
      session_id: "sess_1",
      session_token: "tok_2",
      payload: {},
    });
    expect(after2.step.name).toBe("identifier");

    const after3 = await transport.submit({
      session_id: "sess_1",
      session_token: "tok_2",
      payload: {},
    });
    expect(after3.step.name).toBe("identifier");
  });

  it("resets the cursor on each start call", async () => {
    const handler = vi.fn(() => passwordStep);
    const transport = new FixtureTransport({ start: baseStep, submit: [handler] });
    await transport.start();
    await transport.submit({ session_id: "sess_1", session_token: "tok_1", payload: {} });
    expect(handler).toHaveBeenCalledTimes(1);
    await transport.start();
    await transport.submit({ session_id: "sess_1", session_token: "tok_1", payload: {} });
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("FetchTransport", () => {
  function makeFetch(payload: unknown, status = 200): typeof fetch {
    const fn = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        }),
    );
    return fn as unknown as typeof fetch;
  }

  it("POSTs JSON to /flows on start", async () => {
    const fetchImpl = makeFetch(baseStep);
    const transport = new FetchTransport({
      baseUrl: "https://example.test/api",
      fetchImpl,
    });
    const response = await transport.start({ purpose: "login" });
    expect(response.step.name).toBe("identifier");
    const calls = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls.length).toBe(1);
    const firstCall = calls[0];
    if (!firstCall) throw new Error("expected fetch to have been called");
    const [url, init] = firstCall;
    expect(url).toBe("https://example.test/api/flows");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toMatchObject({ purpose: "login" });
  });

  it("POSTs to /flows/{id}/submit with the session token in the body", async () => {
    const fetchImpl = makeFetch(passwordStep);
    const transport = new FetchTransport({
      baseUrl: "https://example.test/api",
      fetchImpl,
    });
    const response = await transport.submit({
      session_id: "sess_1",
      session_token: "tok_1",
      payload: { values: { email: "alice@acme.com" } },
    });
    expect(response.step.name).toBe("password");
    const calls = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const firstCall = calls[0];
    if (!firstCall) throw new Error("expected fetch to have been called");
    const [url, init] = firstCall;
    expect(url).toBe("https://example.test/api/flows/sess_1/submit");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      session_token: "tok_1",
      payload: { values: { email: "alice@acme.com" } },
    });
  });

  it("throws FlowTransportError on non-2xx", async () => {
    const fetchImpl = makeFetch({ code: "BAD" }, 400);
    const transport = new FetchTransport({
      baseUrl: "https://example.test/api",
      fetchImpl,
    });
    await expect(transport.start({ purpose: "login" })).rejects.toBeInstanceOf(FlowTransportError);
  });
});

describe("WalkingFixtureTransport", () => {
  const loginFlow: FlowDefinition = {
    name: "login",
    purposes: ["login"],
    initial_steps: { login: "identifier" },
    steps: [
      {
        name: "identifier",
        type: "identifier",
        texts: { title_key: "identifier.title" },
        fields: { email: { type: "email", text_key: "identifier.field.email", required: true } },
        actions: { submit: { text_key: "submit.continue", primary: true } },
        transitions: { submit: "resolve_user" },
      },
      {
        name: "resolve_user",
        type: "policy_check",
        transitions: { found: "password", not_found: "identifier" },
      },
      {
        name: "password",
        type: "credential",
        texts: { title_key: "password.title" },
        fields: { password: { type: "password", text_key: "password.field.password", required: true } },
        actions: { submit: { text_key: "submit.signin", primary: true } },
        transitions: { submit: "done" },
      },
      {
        name: "done",
        type: "complete",
        texts: { title_key: "complete.title" },
      },
    ],
  };

  it("starts at the initial step for the requested purpose", async () => {
    const transport = new WalkingFixtureTransport({ flow: loginFlow });
    const start = await transport.start({ purpose: "login" });
    expect(start.step.name).toBe("identifier");
  });

  it("walks through invisible policy_check / action steps", async () => {
    const transport = new WalkingFixtureTransport({ flow: loginFlow });
    await transport.start({ purpose: "login" });
    const next = await transport.submit({
      session_id: "sess_walking",
      session_token: "tok_walking",
      payload: { action: "submit", values: { email: "alice@acme.com" } },
    });
    expect(next.step.name).toBe("password");
  });

  it("follows action-named transitions when present", async () => {
    const branchFlow: FlowDefinition = {
      initial_steps: { login: "identifier" },
      steps: [
        {
          name: "identifier",
          type: "identifier",
          actions: {
            submit: { text_key: "k", primary: true },
            register: { text_key: "k" },
          },
          transitions: { submit: "password", register: "profile" },
        },
        { name: "password", type: "credential" },
        { name: "profile", type: "form" },
      ],
    };
    const transport = new WalkingFixtureTransport({ flow: branchFlow });
    await transport.start({ purpose: "login" });
    const next = await transport.submit({
      session_id: "sess_walking",
      session_token: "tok_walking",
      payload: { action: "register" },
    });
    expect(next.step.name).toBe("profile");
  });

  it("replays the current step when a transition is missing or off-graph", async () => {
    const transport = new WalkingFixtureTransport({ flow: loginFlow });
    await transport.start({ purpose: "login" });
    const next = await transport.submit({
      session_id: "sess_walking",
      session_token: "tok_walking",
      payload: { action: "nope" },
    });
    expect(next.step.name).toBe("identifier");
  });

  it("does not follow object transitions (switch / pivot) into other flows", async () => {
    const flow: FlowDefinition = {
      initial_steps: { login: "identifier" },
      steps: [
        {
          name: "identifier",
          type: "identifier",
          actions: { register: { text_key: "k" } },
          transitions: { register: { switch: "register" } },
        },
      ],
    };
    const transport = new WalkingFixtureTransport({ flow });
    await transport.start({ purpose: "login" });
    const next = await transport.submit({
      session_id: "sess_walking",
      session_token: "tok_walking",
      payload: { action: "register" },
    });
    expect(next.step.name).toBe("identifier");
  });

  it("attaches the configured branding to every response", async () => {
    const transport = new WalkingFixtureTransport({
      flow: loginFlow,
      branding: { layout: "centered" },
    });
    const start = await transport.start({ purpose: "login" });
    expect(start.branding?.layout).toBe("centered");
  });

  it("invokes the decorate hook so callers can inject identity etc.", async () => {
    const transport = new WalkingFixtureTransport({
      flow: loginFlow,
      decorate: (step, ctx) => {
        if (step.name === "password") {
          const email =
            (ctx.payload.values as Record<string, string> | undefined)?.email ?? "";
          return { ...step, identity: { display_name: email || "user" } };
        }
        return step;
      },
    });
    await transport.start({ purpose: "login" });
    const next = await transport.submit({
      session_id: "sess_walking",
      session_token: "tok_walking",
      payload: { action: "submit", values: { email: "alice@acme.com" } },
    });
    expect(next.step.identity).toEqual({ display_name: "alice@acme.com" });
  });
});
