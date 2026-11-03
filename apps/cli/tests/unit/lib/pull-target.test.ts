import { describe, expect, it } from "vitest";

import { classifyTarget } from "../../../src/lib/pull-target";

describe("classifyTarget", () => {
  it("reads 'latest' as the live release", () => {
    expect(classifyTarget("latest")).toEqual({ kind: "latest" });
  });

  it("reads a rel_ id as a release", () => {
    expect(classifyTarget("rel_01ABC")).toEqual({ kind: "release", id: "rel_01ABC" });
  });

  it("reads a dep_ id as a deployment", () => {
    expect(classifyTarget("dep_01ABC")).toEqual({ kind: "deployment", id: "dep_01ABC" });
  });

  it("rejects anything else", () => {
    expect(classifyTarget("sch_01ABC").kind).toBe("invalid");
    expect(classifyTarget("human-user").kind).toBe("invalid");
  });
});
