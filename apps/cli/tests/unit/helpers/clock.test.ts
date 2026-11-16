import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

const realSetTimeout = globalThis.setTimeout;

describe("clock", () => {
  describe("while the test runs", () => {
    it("starts with no timer waiting", ({ clock }) => {
      expect(clock.pending()).toBe(0);
    });

    it("runs a timer once time reaches it", ({ clock }) => {
      const fired: string[] = [];
      setTimeout(() => fired.push("done"), 100);

      clock.advance(100);

      expect(fired).toEqual(["done"]);
    });

    it("leaves a timer waiting until time reaches it", ({ clock }) => {
      const fired: string[] = [];
      setTimeout(() => fired.push("done"), 100);

      clock.advance(99);

      expect(fired).toEqual([]);
    });

    it("lets the promise a timer resolves settle as time advances", async ({ clock }) => {
      const waited = new Promise<string>((resolve) => {
        setTimeout(() => resolve("done"), 50);
      });

      await clock.advanceAsync(50);

      await expect(waited).resolves.toBe("done");
    });

    it("runs the next timer whatever its delay", async ({ clock }) => {
      const fired: string[] = [];
      setTimeout(() => fired.push("late"), 10_000);

      await clock.next();

      expect(fired).toEqual(["late"]);
    });

    it("runs the timers a timer starts", ({ clock }) => {
      const fired: string[] = [];
      setTimeout(() => {
        fired.push("first");
        setTimeout(() => fired.push("second"), 10);
      }, 10);

      clock.runAll();

      expect(fired).toEqual(["first", "second"]);
    });

    it("runs the timers a timer starts, letting promises settle", async ({ clock }) => {
      const fired: string[] = [];
      setTimeout(() => {
        fired.push("first");
        setTimeout(() => fired.push("second"), 10);
      }, 10);

      await clock.runAllAsync();

      expect(fired).toEqual(["first", "second"]);
    });

    it("runs only the timers waiting now", ({ clock }) => {
      const fired: string[] = [];
      setTimeout(() => {
        fired.push("first");
        setTimeout(() => fired.push("second"), 10);
      }, 10);

      clock.runPending();

      expect(fired).toEqual(["first"]);
    });

    it("counts the timers waiting", ({ clock }) => {
      setTimeout(() => undefined, 10);
      setTimeout(() => undefined, 20);

      expect(clock.pending()).toBe(2);
    });

    it("fakes only the timers it is told to", ({ clock }) => {
      clock.only("setInterval", "clearInterval");

      expect(globalThis.setTimeout).toBe(realSetTimeout);
    });
  });

  describe("once the test is over", () => {
    it("gives the real timers back", () => {
      expect(globalThis.setTimeout).toBe(realSetTimeout);
    });
  });
});
