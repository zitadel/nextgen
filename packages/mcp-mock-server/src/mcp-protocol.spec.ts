import { describe, expect, it } from "vitest";

import { createSessionId, dispatchMcpBody, isKnownSession } from "./mcp-protocol.js";

describe("mcp protocol", () => {
  it("handles initialize with session id", () => {
    const outcome = dispatchMcpBody({
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
        protocolVersion: "2025-06-18",
      },
    });

    expect(outcome.httpStatus).toBe(200);
    expect(outcome.sessionId).toBeTruthy();
    expect(outcome.body).toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "zitadel-mcp-mock-server" },
      },
    });
    expect(isKnownSession(outcome.sessionId)).toBe(true);
  });

  it("accepts notifications/initialized with 202", () => {
    const outcome = dispatchMcpBody({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    expect(outcome.httpStatus).toBe(202);
    expect(outcome.body).toBeUndefined();
  });

  it("lists probe_echo tool", () => {
    const outcome = dispatchMcpBody({
      id: 2,
      jsonrpc: "2.0",
      method: "tools/list",
    });

    expect(outcome.body).toMatchObject({
      id: 2,
      result: {
        tools: [{ name: "probe_echo" }],
      },
    });
  });

  it("creates unique session ids", () => {
    const first = createSessionId();
    const second = createSessionId();
    expect(first).not.toBe(second);
  });
});
