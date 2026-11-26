import { beforeEach, describe, expect, it } from "vitest";

import { BackendUnreachableError } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import { PreviewExpiries } from "@/lib/preview";
import { warnings } from "@/lib/ui/warnings";
import { fakeClient, pagesOf } from "@tests/helpers/fake-client";
import { rejectionOf } from "@tests/helpers/thrown-value";

/** A walk whose first read fails with `error`. */
function failingWith(error: Error): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          return Promise.reject(error);
        },
      };
    },
  };
}

describe("PreviewExpiries.live", () => {
  const ORIGIN = "https://pr-7.preview.acme.com";
  const EXPIRES = "2026-02-01T00:00:00Z";

  beforeEach(() => {
    warnings.take();
  });

  it("answers the expiry of each origin it was asked for", async () => {
    const client = fakeClient({
      listProjectPreviews: {
        pages: () =>
          pagesOf({
            previews: [{ origin: ORIGIN, expires_at: EXPIRES }],
            next_page_token: null,
          }),
      },
    });

    const expiries = await PreviewExpiries.of(client, "proj_1").live([ORIGIN]);

    expect(expiries).toEqual(new Map([[ORIGIN, EXPIRES]]));
  });

  it("answers no expiry when the previews cannot be read", async () => {
    const client = fakeClient({
      listProjectPreviews: {
        pages: () => failingWith(new BackendUnreachableError("down")),
      },
    });

    const expiries = await PreviewExpiries.of(client, "proj_1").live([ORIGIN]);

    expect(expiries).toEqual(new Map());
  });

  it("says why when the previews cannot be read", async () => {
    const client = fakeClient({
      listProjectPreviews: {
        pages: () => failingWith(new BackendUnreachableError("down")),
      },
    });

    await PreviewExpiries.of(client, "proj_1").live([ORIGIN]);

    expect(warnings.take()).toEqual(["Could not read when the previews expire: down"]);
  });

  it("does not hide a cancellation", async () => {
    const client = fakeClient({
      listProjectPreviews: {
        pages: () => failingWith(new ZitadelError("E_CANCELLED", "Cancelled by user")),
      },
    });

    const thrown = await rejectionOf(() => PreviewExpiries.of(client, "proj_1").live([ORIGIN]));

    expect(thrown).toMatchObject({ code: "E_CANCELLED" });
  });

  it("warns of nothing when the previews are read", async () => {
    const client = fakeClient({
      listProjectPreviews: {
        pages: () => pagesOf({ previews: [], next_page_token: null }),
      },
    });

    await PreviewExpiries.of(client, "proj_1").live([ORIGIN]);

    expect(warnings.take()).toEqual([]);
  });
});
