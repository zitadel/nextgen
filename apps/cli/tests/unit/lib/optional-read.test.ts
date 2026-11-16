import { beforeEach, describe, expect, it } from "vitest";

import { ZitadelError } from "@/lib/errors";
import { readingOptionally } from "@/lib/optional-read";
import { takeReportedWarnings } from "@/lib/warnings";
import { rejectionOf } from "@tests/helpers/thrown-value";

describe("readingOptionally", () => {
  beforeEach(() => {
    takeReportedWarnings();
  });

  it("answers what the read answers", async () => {
    const answer = await readingOptionally("the answer", async () => "found", "none");

    expect(answer).toBe("found");
  });

  it("warns of nothing when the read answers", async () => {
    await readingOptionally("the answer", async () => "found", "none");

    expect(takeReportedWarnings()).toEqual([]);
  });

  it("answers what it was given in place of a read that fails", async () => {
    const answer = await readingOptionally(
      "the answer",
      async () => {
        throw new ZitadelError("E_NETWORK", "down");
      },
      "none",
    );

    expect(answer).toBe("none");
  });

  it("names what could not be read and why", async () => {
    await readingOptionally(
      "the answer",
      async () => {
        throw new ZitadelError("E_NETWORK", "down");
      },
      "none",
    );

    expect(takeReportedWarnings()).toEqual(["Could not read the answer: down"]);
  });

  it("does not hide a cancellation", async () => {
    const thrown = await rejectionOf(() => {
      return readingOptionally(
        "the answer",
        async () => {
          throw new ZitadelError("E_CANCELLED", "Cancelled by user");
        },
        "none",
      );
    });

    expect(thrown).toMatchObject({ code: "E_CANCELLED" });
  });
});
