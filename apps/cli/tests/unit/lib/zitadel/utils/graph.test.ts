import { describe, expect, it } from "vitest";

import { walk } from "@/lib/zitadel/utils/graph";

/**
 * A graph of named nodes, as the edges out of each.
 */
const EDGES: Readonly<Record<string, readonly string[]>> = {
  a: ["b", "c"],
  b: ["d"],
  c: ["d", "a"],
  d: [],
  e: ["a"],
};

/**
 * The nodes a node leads to.
 *
 * @param node - The node.
 * @returns Its successors; none for a node the graph does not have.
 */
function next(node: string): readonly string[] {
  return EDGES[node] ?? [];
}

/**
 * A node as its own key.
 *
 * @param node - The node.
 * @returns The node.
 */
function itself(node: string): string {
  return node;
}

describe("walk", () => {
  it("reaches every node breadth first, each once, in the order first reached", () => {
    expect(walk(["a"], next, itself)).toEqual(["a", "b", "c", "d"]);
  });

  it("reaches nothing from nowhere", () => {
    expect(walk([], next, itself)).toEqual([]);
  });

  it("visits a node once per key, so what a walk carries tells visits apart", () => {
    const visits = walk(
      [{ node: "a", via: "" }],
      (visit) => {
        return next(visit.node).map((node) => {
          return { node, via: visit.node };
        });
      },
      (visit) => {
        return `${visit.node}/${visit.via}`;
      },
    );

    expect(
      visits
        .filter((visit) => {
          return visit.node === "d";
        })
        .map((visit) => {
          return visit.via;
        }),
    ).toEqual(["b", "c"]);
  });
});
