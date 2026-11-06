import { describe, expect, test } from "vitest";

import { EXIT_MARKER } from "./command";
import { Completion } from "./completion";

describe("Completion", () => {
  test("settles with the status on the marker line", async () => {
    const completion = new Completion();

    completion.push("some output\n");
    completion.push(`${EXIT_MARKER} 1\n`);

    await expect(completion.exitCode).resolves.toBe(1);
  });

  test("settles when the marker arrives split across chunks", async () => {
    const completion = new Completion();

    completion.push(EXIT_MARKER);
    completion.push(" 0\n");

    await expect(completion.exitCode).resolves.toBe(0);
  });

  test("does not settle on a status whose line is not complete", async () => {
    const completion = new Completion();

    completion.push(`${EXIT_MARKER} 1`);
    completion.push("37\n");

    await expect(completion.exitCode).resolves.toBe(137);
  });

  test("does not settle on a marker with no status yet", async () => {
    const completion = new Completion();

    completion.push(`${EXIT_MARKER} \n`);
    completion.push(`${EXIT_MARKER} 2\n`);

    await expect(completion.exitCode).resolves.toBe(2);
  });

  test("keeps everything it was given", () => {
    const completion = new Completion();

    completion.push(Buffer.from("a"));
    completion.push("b");

    expect(completion.log).toBe("ab");
  });
});
