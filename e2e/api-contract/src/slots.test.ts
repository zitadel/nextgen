import { describe, expect, test } from "vitest";

import { Slots } from "./slots";

function pause(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 5);
  });
}

describe("Slots", () => {
  test("never runs more than its limit at once", async () => {
    const slots = new Slots(3);
    let active = 0;
    let most = 0;

    await Promise.all(
      Array.from({ length: 10 }, () => {
        return slots.run(async () => {
          active += 1;
          most = Math.max(most, active);
          await pause();
          active -= 1;
        });
      }),
    );

    expect(most).toBe(3);
  });

  test("runs the work in the order it was asked for", async () => {
    const slots = new Slots(1);
    const order: number[] = [];

    await Promise.all(
      [0, 1, 2, 3].map((index) => {
        return slots.run(async () => {
          await pause();
          order.push(index);
        });
      }),
    );

    expect(order).toEqual([0, 1, 2, 3]);
  });

  test("hands its place on when the work fails", async () => {
    const slots = new Slots(1);

    const failed = slots.run(() => {
      return Promise.reject(new Error("boom"));
    });
    const next = slots.run(() => {
      return Promise.resolve("done");
    });

    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("done");
  });

  test("runs at least one at a time whatever the limit", async () => {
    await expect(
      new Slots(0).run(() => {
        return Promise.resolve("ran");
      }),
    ).resolves.toBe("ran");
  });
});
