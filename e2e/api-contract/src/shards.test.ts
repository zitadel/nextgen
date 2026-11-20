import { describe, expect, test } from "vitest";

import { Shards } from "./shards";

const operations = Array.from({ length: 40 }, (_, index) => {
  return { name: `GET /things/${String(index)}` };
});

describe("Shards", () => {
  test("deals every operation into exactly one shard", () => {
    const shards = Shards.of(operations, 4);

    expect(
      shards
        .flat()
        .map((operation) => operation.name)
        .sort(),
    ).toEqual(operations.map((operation) => operation.name).sort());
  });

  test("keeps an operation in its shard when others are added or removed", () => {
    const before = Shards.of(operations, 4);
    const after = Shards.of([...operations.slice(5), { name: "GET /new" }], 4);
    const shardOf = (shards: { name: string }[][], name: string) => {
      return shards.findIndex((shard) => {
        return shard.some((operation) => {
          return operation.name === name;
        });
      });
    };

    expect(shardOf(after, "GET /things/20")).toBe(shardOf(before, "GET /things/20"));
  });

  test("gives the same shards whatever the order of the operations", () => {
    const forward = Shards.of(operations, 4);
    const backward = Shards.of([...operations].reverse(), 4);

    expect(
      backward.map((shard) => {
        return shard.map((operation) => operation.name).sort();
      }),
    ).toEqual(
      forward.map((shard) => {
        return shard.map((operation) => operation.name).sort();
      }),
    );
  });

  test("makes one shard for a count below one, and drops empty shards", () => {
    expect(Shards.of(operations, 0)).toHaveLength(1);
    expect(Shards.of([{ name: "GET /only" }], 8)).toHaveLength(1);
  });
});
