import { beforeEach, describe, expect, it } from "vitest";

import { ZitadelError } from "@/lib/errors";
import { detectPreviewUrls, liveExpiries } from "@/lib/preview";
import { takeReportedWarnings } from "@/lib/warnings";
import { fakeClient, pagesOf } from "@tests/helpers/fake-client";
import { rejectionOf } from "@tests/helpers/thrown-value";

describe("detectPreviewUrls", () => {
  it("reads Vercel's branch and deployment hosts, prepending the scheme", () => {
    const detected = detectPreviewUrls({
      VERCEL_BRANCH_URL: "acme-git-sso-acmeinc.vercel.app",
      VERCEL_URL: "acme-k3x9v2-acmeinc.vercel.app",
    });
    expect(detected.urls).toEqual([
      "https://acme-git-sso-acmeinc.vercel.app",
      "https://acme-k3x9v2-acmeinc.vercel.app",
    ]);
  });

  it("reads Netlify's prime and deploy URLs as they are", () => {
    const detected = detectPreviewUrls({
      DEPLOY_PRIME_URL: "https://deploy-preview-7--acme.netlify.app",
      DEPLOY_URL: "https://62f--acme.netlify.app",
    });
    expect(detected.urls).toEqual([
      "https://deploy-preview-7--acme.netlify.app",
      "https://62f--acme.netlify.app",
    ]);
  });

  it("leaves a Cloudflare Pages URL to --origin, since production sets it too", () => {
    const detected = detectPreviewUrls({
      CF_PAGES_URL: "https://acme.pages.dev",
    });
    expect(detected.urls).toEqual([]);
  });

  it("finds nothing when no platform variable is set, but names them all", () => {
    const detected = detectPreviewUrls({});
    expect(detected.urls).toEqual([]);
    expect(detected.variablesLookedFor).toEqual([
      "VERCEL_BRANCH_URL",
      "VERCEL_URL",
      "DEPLOY_PRIME_URL",
      "DEPLOY_URL",
    ]);
  });

  it("de-duplicates and strips a trailing slash", () => {
    const detected = detectPreviewUrls({
      DEPLOY_PRIME_URL: "https://acme.netlify.app/",
      DEPLOY_URL: "https://acme.netlify.app",
    });
    expect(detected.urls).toEqual(["https://acme.netlify.app"]);
  });
});

/** A walk whose first read fails with `error`. */
async function* failingWith(error: Error): AsyncGenerator<never> {
  yield* [];
  throw error;
}

describe("liveExpiries", () => {
  const ORIGIN = "https://pr-7.preview.acme.com";
  const EXPIRES = "2026-02-01T00:00:00Z";

  beforeEach(() => {
    takeReportedWarnings();
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

    const expiries = await liveExpiries(client, "proj_1", [ORIGIN]);

    expect(expiries).toEqual(new Map([[ORIGIN, EXPIRES]]));
  });

  it("answers no expiry when the previews cannot be read", async () => {
    const client = fakeClient({
      listProjectPreviews: {
        pages: () => failingWith(new ZitadelError("E_NETWORK", "down")),
      },
    });

    const expiries = await liveExpiries(client, "proj_1", [ORIGIN]);

    expect(expiries).toEqual(new Map());
  });

  it("says why when the previews cannot be read", async () => {
    const client = fakeClient({
      listProjectPreviews: {
        pages: () => failingWith(new ZitadelError("E_NETWORK", "down")),
      },
    });

    await liveExpiries(client, "proj_1", [ORIGIN]);

    expect(takeReportedWarnings()).toEqual(["Could not read when the previews expire: down"]);
  });

  it("does not hide a cancellation", async () => {
    const client = fakeClient({
      listProjectPreviews: {
        pages: () => failingWith(new ZitadelError("E_CANCELLED", "Cancelled by user")),
      },
    });

    const thrown = await rejectionOf(() => liveExpiries(client, "proj_1", [ORIGIN]));

    expect(thrown).toMatchObject({ code: "E_CANCELLED" });
  });

  it("warns of nothing when the previews are read", async () => {
    const client = fakeClient({
      listProjectPreviews: {
        pages: () => pagesOf({ previews: [], next_page_token: null }),
      },
    });

    await liveExpiries(client, "proj_1", [ORIGIN]);

    expect(takeReportedWarnings()).toEqual([]);
  });
});
