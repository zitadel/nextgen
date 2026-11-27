import { setupMockHandlers } from "@zitadel/api-mock";
import { setRequestPolicy } from "@zitadel/api/runtime/fetch";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { exchangeSession, getCurrentStep, startFlow, submitStep } from "./api-client.js";

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

describe("startFlow", () => {
  it("runs without the request policy another client on the page left behind", async () => {
    setRequestPolicy({ userAgent: "another-client" });

    await startFlow(project, { purpose: "login", project_id: "proj-1" });

    expect(userAgents).toHaveLength(1);
    expect(userAgents[0]).not.toBe("another-client");
  });
});
