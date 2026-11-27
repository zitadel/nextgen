import { setupMockHandlers } from "@zitadel/api-mock";
import { setRequestPolicy } from "@zitadel/api/runtime/fetch";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  exchangeSession,
  getCurrentStep,
  getSession,
  revokeSession,
  startFlow,
  submitStep,
} from "./api-client.js";

const API_BASE = "https://api-client.test.invalid";

const project = Object.freeze({ proxyPath: API_BASE, projectId: "proj-1" });

const userAgents: (string | null)[] = [];

const server = setupServer(...setupMockHandlers().handlers);

server.events.on("request:start", ({ request }) => {
  userAgents.push(request.headers.get("user-agent"));
});

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  userAgents.length = 0;
  setRequestPolicy({});
});

afterAll(() => {
  server.close();
});

describe("api-client exports", () => {
  it("exports the four expected wrapper functions", () => {
    expect(typeof startFlow).toBe("function");
    expect(typeof submitStep).toBe("function");
    expect(typeof getCurrentStep).toBe("function");
    expect(typeof exchangeSession).toBe("function");
  });
});

/**
 * Each of the widget's calls, given a project and the id of a flow the mock
 * has started; the session reads answer 401 in-process, which is fine here.
 */
const CALLS: [string, (flowId: string) => Promise<unknown>][] = [
  ["startFlow", () => startFlow(project, { purpose: "login", project_id: "proj-1" })],
  ["submitStep", (flowId) => submitStep(project, flowId, { action: "submit" })],
  ["getCurrentStep", (flowId) => getCurrentStep(project, flowId)],
  [
    "exchangeSession",
    () => exchangeSession(project, { handoff_token: "handoff" }, { project_id: "proj-1" }),
  ],
  ["getSession", () => getSession(project, "proj-1")],
  ["getSession without a project id", () => getSession(project, "")],
  ["revokeSession", () => revokeSession(project, "proj-1")],
];

describe.each(CALLS)("%s", (_name, call) => {
  it("runs without the request policy another client on the page left behind", async () => {
    const { id } = await startFlow(project, { purpose: "login", project_id: "proj-1" });
    userAgents.length = 0;
    setRequestPolicy({ userAgent: "another-client", signal: AbortSignal.abort() });

    await call(id).catch(() => undefined);

    expect(userAgents.length).toBeGreaterThan(0);
    expect(userAgents).not.toContain("another-client");
  });
});
