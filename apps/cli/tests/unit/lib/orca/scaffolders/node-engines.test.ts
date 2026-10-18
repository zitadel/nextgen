import { spawnSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  CREATE_VITE_NODE_ENGINES,
  describeAcceptedNode,
  nodeEnginesRange,
  nodeSupport,
} from "../../../../../src/lib/orca/scaffolders/node-engines";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
const mockSpawn = vi.mocked(spawnSync);

const ANGULAR_22 = "^22.22.3 || ^24.15.0 || >=26.0.0";

describe("nodeSupport", () => {
  describe("when the CLI refuses (the Angular CLI's own rule)", () => {
    it.each([
      ["22.22.3", "supported"],
      ["22.21.0", "refused"],
      ["23.11.0", "warned"],
      ["24.12.0", "refused"],
      ["24.15.0", "supported"],
      ["25.2.0", "warned"],
      ["26.0.0", "supported"],
      ["27.0.0", "refused"],
      ["21.7.0", "refused"],
    ])("decides Node %s is %s", (node, support) => {
      expect(nodeSupport(node, ANGULAR_22, "refuse")).toBe(support);
    });
  });

  describe("when the CLI only warns (a plain semver range)", () => {
    it.each([
      ["24.11.0", "supported"],
      ["27.0.0", "supported"],
      ["24.10.0", "warned"],
      ["25.2.0", "warned"],
      ["12.0.0", "warned"],
    ])("decides Node %s is %s", (node, support) => {
      expect(nodeSupport(node, "^22.21.0 || ^24.11.0 || >=26.0.0", "warn")).toBe(support);
    });
  });
});

describe("describeAcceptedNode", () => {
  it("names each accepted major with its minimum, and a bare major when any of it is accepted", () => {
    expect(describeAcceptedNode(ANGULAR_22)).toBe(
      "22.22.3 or newer 22, 24.15.0 or newer 24, or 26",
    );
  });

  it("reads a single part", () => {
    expect(describeAcceptedNode("^20.19.0")).toBe("20.19.0 or newer 20");
  });

  it("does not offer a range that Node 27 satisfies", () => {
    expect(describeAcceptedNode(ANGULAR_22)).not.toContain(">=");
  });
});

describe("nodeEnginesRange", () => {
  it("asks npm for the range of the declared package spec", () => {
    mockSpawn.mockReturnValue({ status: 0, stdout: ">=1.0.0\n" } as ReturnType<typeof spawnSync>);

    expect(nodeEnginesRange(CREATE_VITE_NODE_ENGINES, "/tmp/proj", "linux")).toBe(">=1.0.0");
    expect(mockSpawn.mock.calls[0]?.slice(0, 2)).toEqual([
      "npm",
      ["view", "create-vite@latest", "engines.node"],
    ]);
  });
});
