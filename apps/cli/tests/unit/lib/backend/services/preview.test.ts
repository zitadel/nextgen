import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { PreviewService } from "@/lib/backend/services/preview";
import { answering, answeringPages } from "@tests/helpers/api-answers";

describe("PreviewService.list", () => {
  it("lists every live preview of the project it is bound to", async ({ server, client }) => {
    const listed = answeringPages(server, "listProjectPreviews", {
      previews: [{ origin: "https://pr-7.preview.acme.com" }],
    });

    const previews = await new PreviewService(client, "proj_1").list();

    expect(
      listed.map(({ params }) => {
        return params.project_id;
      }),
    ).toEqual(["proj_1"]);
    expect(previews).toEqual([{ origin: "https://pr-7.preview.acme.com" }]);
  });
});

describe("PreviewService.page", () => {
  it("reads one page and the cursor to the next", async ({ server, client }) => {
    answering(server, "listProjectPreviews", {
      previews: [{ origin: "https://pr-7.preview.acme.com" }],
      next_page_token: "t2",
    });

    const page = await new PreviewService(client, "proj_1").page();

    expect(page.items).toEqual([{ origin: "https://pr-7.preview.acme.com" }]);
    expect(page.next).toBe("t2");
  });

  it("drains every page when asked for all of them", async ({ server, client }) => {
    answeringPages(
      server,
      "listProjectPreviews",
      { previews: [{ origin: "https://pr-7.preview.acme.com" }] },
      { previews: [{ origin: "https://pr-6.preview.acme.com" }] },
    );

    const page = await new PreviewService(client, "proj_1").page({}, { all: true });

    expect(page.items).toHaveLength(2);
    expect(page.next).toBeNull();
  });

  it("sends the query without the paging option the server does not take", async ({
    server,
    client,
  }) => {
    const listed = answeringPages(server, "listProjectPreviews", { previews: [] });

    await new PreviewService(client, "proj_1").page({ limit: 5 }, { all: true });

    expect(
      listed.map(({ params, url }) => {
        return [params.project_id, Object.fromEntries(url.searchParams)];
      }),
    ).toEqual([["proj_1", { limit: "5" }]]);
  });
});

describe("PreviewService.expiries", () => {
  const FIRST = "https://pr-7.preview.acme.com";
  const SECOND = "https://pr-6.preview.acme.com";
  const OTHER = "https://pr-5.preview.acme.com";
  const SOON = "2026-02-01T00:00:00Z";
  const LATER = "2026-02-08T00:00:00Z";

  it("answers the expiry of each origin it was asked for, and no other", async ({
    server,
    client,
  }) => {
    answeringPages(server, "listProjectPreviews", {
      previews: [
        { origin: FIRST, expires_at: SOON },
        { origin: OTHER, expires_at: LATER },
        { origin: SECOND, expires_at: LATER },
      ],
    });

    const expiries = await new PreviewService(client, "proj_1").expiries(new Set([FIRST, SECOND]));

    expect(expiries).toEqual(
      new Map([
        [FIRST, SOON],
        [SECOND, LATER],
      ]),
    );
  });

  it("leaves out an origin whose preview is gone, reading every page to know", async ({
    server,
    client,
  }) => {
    answeringPages(
      server,
      "listProjectPreviews",
      { previews: [{ origin: FIRST, expires_at: SOON }] },
      { previews: [{ origin: OTHER, expires_at: LATER }] },
    );

    const expiries = await new PreviewService(client, "proj_1").expiries(new Set([FIRST, SECOND]));

    expect(expiries).toEqual(new Map([[FIRST, SOON]]));
  });

  it("finds an origin on a later page", async ({ server, client }) => {
    answeringPages(
      server,
      "listProjectPreviews",
      { previews: [{ origin: OTHER, expires_at: LATER }] },
      { previews: [{ origin: FIRST, expires_at: SOON }] },
    );

    const expiries = await new PreviewService(client, "proj_1").expiries(new Set([FIRST]));

    expect(expiries).toEqual(new Map([[FIRST, SOON]]));
  });

  it("stops reading once every origin it was asked for is found", async ({ server, client }) => {
    const listed = answeringPages(
      server,
      "listProjectPreviews",
      { previews: [{ origin: FIRST, expires_at: SOON }] },
      { previews: [{ origin: OTHER, expires_at: LATER }] },
    );

    await new PreviewService(client, "proj_1").expiries(new Set([FIRST]));

    expect(listed).toHaveLength(1);
  });

  it("asks for the largest page the API gives", async ({ server, client }) => {
    const listed = answeringPages(server, "listProjectPreviews", { previews: [] });

    await new PreviewService(client, "proj_1").expiries(new Set([FIRST]));

    expect(
      listed.map(({ url }) => {
        return Object.fromEntries(url.searchParams);
      }),
    ).toEqual([{ limit: "100" }]);
  });

  it("makes no request when it was asked for no origin", async ({ client }) => {
    const expiries = await new PreviewService(client, "proj_1").expiries(new Set());

    expect(expiries).toEqual(new Map());
  });
});

describe("PreviewService.remove", () => {
  it("stops serving the origin it was given, on the project it is bound to", async ({
    server,
    client,
  }) => {
    const removed = answering(server, "removeProjectPreview", undefined);

    await new PreviewService(client, "proj_1").remove("https://pr-7.preview.acme.com");

    expect(
      removed.map(({ params, body }) => {
        return [params.project_id, body];
      }),
    ).toEqual([["proj_1", { origin: "https://pr-7.preview.acme.com" }]]);
  });
});
