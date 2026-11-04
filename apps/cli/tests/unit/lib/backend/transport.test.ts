import { describe, expect, it } from "vitest";

import { UnavailableError } from "../../../../src/lib/backend/errors";
import { request } from "../../../../src/lib/backend/transport";
import { ZitadelError } from "../../../../src/lib/errors";

/** A port nothing listens on, so a connection is refused at once. */
const CLOSED = "http://127.0.0.1:1/sessions/exchange";

describe("request", () => {
  it("fails with the backend's own error when it gets no response", async () => {
    // The transport's failure type is the backend's to keep: untranslated, the
    // CLI has nothing that tells a refused connection from a rejected body.
    await expect(request(CLOSED, { method: "POST" })).rejects.toBeInstanceOf(UnavailableError);
  });

  it("says why no response came, so the failure can be worded", async () => {
    await expect(request(CLOSED, { method: "POST" })).rejects.toMatchObject({
      reason: "unreachable",
    });
  });

  it("fails with the backend's own error when the body cannot be read", async () => {
    const read = async (): Promise<never> => {
      throw new Error("the body broke off");
    };

    await expect(
      request("http://127.0.0.1:1/", { method: "GET" }, {}, read),
    ).rejects.toBeInstanceOf(UnavailableError);
  });

  it("answers a cancellation as it came, so Ctrl-C still reads as cancelled", async () => {
    const cancelled = new ZitadelError("E_CANCELLED", "Cancelled.");

    await expect(
      request(CLOSED, { method: "POST" }, { signal: AbortSignal.abort(cancelled) }),
    ).rejects.toBe(cancelled);
  });
});
