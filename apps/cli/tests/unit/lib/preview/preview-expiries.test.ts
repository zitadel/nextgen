import { beforeEach, describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { createZitadelClient } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import { PreviewExpiries } from "@/lib/preview";
import { warnings } from "@/lib/ui/warnings";
import { answering, answeringPages, refusal, TEST_SERVER } from "@tests/helpers/api-answers";
import { rejectionOf } from "@tests/helpers/thrown-value";

describe("PreviewExpiries.live", () => {
  const ORIGIN = "https://pr-7.preview.acme.com";
  const EXPIRES = "2026-02-01T00:00:00Z";

  beforeEach(() => {
    warnings.take();
  });

  it("answers the expiry of each origin it was asked for", async ({ server, client }) => {
    answeringPages(server, "listProjectPreviews", {
      previews: [{ origin: ORIGIN, expires_at: EXPIRES }],
    });

    const expiries = await PreviewExpiries.of(client, "proj_1").live([ORIGIN]);

    expect(expiries).toEqual(new Map([[ORIGIN, EXPIRES]]));
  });

  it("answers no expiry when the previews cannot be read", async ({ server, client }) => {
    answering(server, "listProjectPreviews", refusal(503, "unavailable", "down"));

    const expiries = await PreviewExpiries.of(client, "proj_1").live([ORIGIN]);

    expect(expiries).toEqual(new Map());
  });

  it("says why when the previews cannot be read", async ({ server, client }) => {
    answering(server, "listProjectPreviews", refusal(503, "unavailable", "down"));

    await PreviewExpiries.of(client, "proj_1").live([ORIGIN]);

    expect(warnings.take()).toEqual(["Could not read when the previews expire: down"]);
  });

  it("does not hide a cancellation", async () => {
    const client = createZitadelClient({
      baseUrl: TEST_SERVER,
      signal: AbortSignal.abort(new ZitadelError("E_CANCELLED", "Cancelled by user")),
    });

    const thrown = await rejectionOf(() => PreviewExpiries.of(client, "proj_1").live([ORIGIN]));

    expect(thrown).toMatchObject({ code: "E_CANCELLED" });
  });

  it("warns of nothing when the previews are read", async ({ server, client }) => {
    answeringPages(server, "listProjectPreviews", { previews: [] });

    await PreviewExpiries.of(client, "proj_1").live([ORIGIN]);

    expect(warnings.take()).toEqual([]);
  });
});
