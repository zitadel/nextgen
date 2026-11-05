import { describe, expect, it } from "vitest";

import { serverCanonicalFlow } from "./server-canonical-flow.js";

describe("serverCanonicalFlow", () => {
  const flow = (step: Record<string, unknown>) => ({ name: "login", steps: [step] });

  it("leaves out an action's primary: false, which the server never states", () => {
    const stored = serverCanonicalFlow(
      flow({ name: "s", actions: [{ name: "skip", primary: false }] }),
    );

    expect(stored.steps).toEqual([{ name: "s", actions: [{ name: "skip" }] }]);
  });

  it("keeps primary: true", () => {
    const step = { name: "s", actions: [{ name: "submit", primary: true }] };

    expect(serverCanonicalFlow(flow(step)).steps).toEqual([step]);
  });

  it.each(["fields", "gates", "sso_providers"])("leaves out an empty %s", (key) => {
    const empty = key === "gates" ? {} : [];

    expect(serverCanonicalFlow(flow({ name: "s", [key]: empty })).steps).toEqual([{ name: "s" }]);
  });

  it.each([
    ["fields", ["email"]],
    ["gates", { captcha: { kind: "captcha" } }],
    ["sso_providers", ["google"]],
  ])("keeps a %s that holds something", (key, value) => {
    const step = { name: "s", [key]: value };

    expect(serverCanonicalFlow(flow(step)).steps).toEqual([step]);
  });

  it("does not change the flow it was given", () => {
    const given = flow({ name: "s", fields: [], actions: [{ name: "a", primary: false }] });

    serverCanonicalFlow(given);

    expect(given.steps[0]).toEqual({
      name: "s",
      fields: [],
      actions: [{ name: "a", primary: false }],
    });
  });

  it("passes a flow without steps through as it is", () => {
    expect(serverCanonicalFlow({ name: "x" })).toEqual({ name: "x" });
  });
});
