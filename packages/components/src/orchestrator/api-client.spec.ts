import type { ZitadelApi } from "@zitadel/api/config";
import { describe, it, expect, vi } from "vitest";

import {
  exchangeSession,
  startFlow,
  submitStep,
  getCurrentStep,
  revokeSession,
} from "./api-client.js";

describe("api-client exports", () => {
  it("exports the four expected wrapper functions", () => {
    expect(typeof startFlow).toBe("function");
    expect(typeof submitStep).toBe("function");
    expect(typeof getCurrentStep).toBe("function");
    expect(typeof exchangeSession).toBe("function");
  });
});

describe("revokeSession", () => {
  function revoke(): RequestInit {
    const revokeMySession = vi.fn(async (_init?: RequestInit) => undefined);
    void revokeSession({ revokeMySession } as unknown as ZitadelApi);
    return revokeMySession.mock.calls[0]?.[0] ?? {};
  }

  it("sends the session cookie", () => {
    expect(revoke().credentials).toBe("include");
  });

  it("declares a JSON content type so body-less CSRF guards let the DELETE through", () => {
    expect(new Headers(revoke().headers).get("content-type")).toBe("application/json");
  });
});
