import type { RequestListener } from "node:http";

import { describe, expect } from "vitest";

import { UnavailableError } from "@/lib/backend/errors";
import { request } from "@/lib/backend/transport";
import { ZitadelError } from "@/lib/errors";
import { it } from "@tests/helpers/fixtures";

/** A port nothing listens on, so a connection is refused at once. */
const CLOSED = "http://127.0.0.1:1/sessions/exchange";

/**
 * Answers every request `200`, so a test of the body reader reaches the reader
 * at all: pointed at a closed port the request is refused first, and the
 * failure a reader would have raised is never the one seen.
 */
const answering: RequestListener = (_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end("{}");
};

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

  it("fails with the backend's own error when the body cannot be read", async ({ serve }) => {
    const answeringUrl = await serve(answering, "127.0.0.1");
    const read = async (): Promise<never> => {
      throw new Error("the body broke off");
    };

    await expect(request(answeringUrl, { method: "GET" }, {}, read)).rejects.toBeInstanceOf(
      UnavailableError,
    );
  });

  it("says the body was the part that failed, so it is not reported as an unreachable server", async ({
    serve,
  }) => {
    const answeringUrl = await serve(answering, "127.0.0.1");
    const read = async (): Promise<never> => {
      throw new Error("the body broke off");
    };

    await expect(request(answeringUrl, { method: "GET" }, {}, read)).rejects.toMatchObject({
      reason: "unreadable",
    });
  });

  it("answers a cancellation as it came, so Ctrl-C still reads as cancelled", async () => {
    const cancelled = new ZitadelError("E_CANCELLED", "Cancelled.");

    await expect(
      request(CLOSED, { method: "POST" }, { signal: AbortSignal.abort(cancelled) }),
    ).rejects.toBe(cancelled);
  });
});
