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
