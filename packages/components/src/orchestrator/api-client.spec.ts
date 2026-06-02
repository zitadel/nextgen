/**
 * api-client.ts no longer exports `resolveSessionExchangeUrl` or
 * `DEFAULT_SESSION_EXCHANGE_PATH`. The exchange call now uses the
 * generated `exchangeHandoff` client via the thin `exchangeSession`
 * wrapper. URL resolution tests are no longer needed.
 *
 * This file is kept as a placeholder for future api-client unit tests.
 */
import { describe, it, expect } from "vitest";

import { exchangeSession, startFlow, submitStep, getCurrentStep } from "./api-client.js";

describe("api-client exports", () => {
  it("exports the four expected wrapper functions", () => {
    expect(typeof startFlow).toBe("function");
    expect(typeof submitStep).toBe("function");
    expect(typeof getCurrentStep).toBe("function");
    expect(typeof exchangeSession).toBe("function");
  });
});
