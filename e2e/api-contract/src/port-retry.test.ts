import { describe, expect, test } from "vitest";

import { untilPortFree } from "./port-retry";

/** A boot that fails with the given errors in turn, then succeeds. */
function bootFailing(errors: Error[]): { boot: () => Promise<string>; tries: () => number } {
  let tries = 0;
  return {
    tries: () => tries,
    boot: () => {
      tries += 1;
      const error = errors[tries - 1];
      return error ? Promise.reject(error) : Promise.resolve("booted");
    },
  };
}

const taken = new Error(
  "zitadel start exited with code 5.\nE_PORT_IN_USE: Port 43209 is already in use",
);

describe("untilPortFree", () => {
  test("boots once when the port is free", async () => {
    const run = bootFailing([]);

    await expect(untilPortFree(run.boot)).resolves.toBe("booted");
    expect(run.tries()).toBe(1);
  });

  test("tries again when the port was taken", async () => {
    const run = bootFailing([taken, taken]);

    await expect(untilPortFree(run.boot)).resolves.toBe("booted");
    expect(run.tries()).toBe(3);
  });

  test("gives up after the attempts it was allowed", async () => {
    const run = bootFailing([taken, taken, taken]);

    await expect(untilPortFree(run.boot, 3)).rejects.toThrow("E_PORT_IN_USE");
    expect(run.tries()).toBe(3);
  });

  test("does not hide any other failure", async () => {
    const run = bootFailing([new Error("zitadel start exited with code 1.")]);

    await expect(untilPortFree(run.boot)).rejects.toThrow("exited with code 1");
    expect(run.tries()).toBe(1);
  });
});
