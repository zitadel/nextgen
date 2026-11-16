import { describe, expect, it, vi } from "vitest";

import { PreviewService } from "@/lib/backend/services/preview";
import { type ClientStubs, fakeClient, pagesOf } from "@tests/helpers/fake-client";

/** A service answering `stubs`, bound to one project. */
function service(stubs: ClientStubs): PreviewService {
  return new PreviewService(fakeClient(stubs), "proj_1");
}

describe("PreviewService.list", () => {
  it("lists every live preview of the project it is bound to", async () => {
    const all = vi.fn(async () => [{ origin: "https://pr-7.preview.acme.com" }]);

    const previews = await service({ listProjectPreviews: { all } }).list();

    expect(all).toHaveBeenCalledWith("proj_1");
    expect(previews).toEqual([{ origin: "https://pr-7.preview.acme.com" }]);
  });
});

describe("PreviewService.page", () => {
  it("reads one page and the cursor to the next", async () => {
    const previewService = service({
      listProjectPreviews: {
        pages: () =>
          pagesOf(
            { previews: [{ origin: "https://pr-7.preview.acme.com" }], next_page_token: "t2" },
            { previews: [{ origin: "https://pr-6.preview.acme.com" }], next_page_token: null },
          ),
      },
    });

    const page = await previewService.page();

    expect(page.items).toEqual([{ origin: "https://pr-7.preview.acme.com" }]);
    expect(page.next).toBe("t2");
  });

  it("drains every page when asked for all of them", async () => {
    const previewService = service({
      listProjectPreviews: {
        pages: () =>
          pagesOf(
            { previews: [{ origin: "https://pr-7.preview.acme.com" }], next_page_token: "t2" },
            { previews: [{ origin: "https://pr-6.preview.acme.com" }], next_page_token: null },
          ),
      },
    });

    const page = await previewService.page({}, { all: true });

    expect(page.items).toHaveLength(2);
    expect(page.next).toBeNull();
  });

  it("sends the query without the paging option the server does not take", async () => {
    const pages = vi.fn(() => pagesOf({ previews: [], next_page_token: null }));

    await service({ listProjectPreviews: { pages } }).page({ limit: 5 }, { all: true });

    expect(pages).toHaveBeenCalledWith("proj_1", { limit: 5 });
  });
});

/** A walk that answers `page` and fails if anything reads past it. */
async function* pageThenFailing<T>(page: T): AsyncGenerator<T> {
  yield page;
  throw new Error("read a page the answer did not need");
}

describe("PreviewService.expiries", () => {
  const FIRST = "https://pr-7.preview.acme.com";
  const SECOND = "https://pr-6.preview.acme.com";
  const OTHER = "https://pr-5.preview.acme.com";
  const SOON = "2026-02-01T00:00:00Z";
  const LATER = "2026-02-08T00:00:00Z";

  it("answers the expiry of each origin it was asked for, and no other", async () => {
    const previewService = service({
      listProjectPreviews: {
        pages: () =>
          pagesOf({
            previews: [
              { origin: FIRST, expires_at: SOON },
              { origin: OTHER, expires_at: LATER },
              { origin: SECOND, expires_at: LATER },
            ],
            next_page_token: null,
          }),
      },
    });

    const expiries = await previewService.expiries(new Set([FIRST, SECOND]));

    expect(expiries).toEqual(
      new Map([
        [FIRST, SOON],
        [SECOND, LATER],
      ]),
    );
  });

  it("leaves out an origin whose preview is gone, reading every page to know", async () => {
    const previewService = service({
      listProjectPreviews: {
        pages: () =>
          pagesOf(
            { previews: [{ origin: FIRST, expires_at: SOON }], next_page_token: "t2" },
            { previews: [{ origin: OTHER, expires_at: LATER }], next_page_token: null },
          ),
      },
    });

    const expiries = await previewService.expiries(new Set([FIRST, SECOND]));

    expect(expiries).toEqual(new Map([[FIRST, SOON]]));
  });

  it("finds an origin on a later page", async () => {
    const previewService = service({
      listProjectPreviews: {
        pages: () =>
          pagesOf(
            { previews: [{ origin: OTHER, expires_at: LATER }], next_page_token: "t2" },
            { previews: [{ origin: FIRST, expires_at: SOON }], next_page_token: null },
          ),
      },
    });

    const expiries = await previewService.expiries(new Set([FIRST]));

    expect(expiries).toEqual(new Map([[FIRST, SOON]]));
  });

  it("stops reading once every origin it was asked for is found", async () => {
    const previewService = service({
      listProjectPreviews: {
        pages: () =>
          pageThenFailing({
            previews: [{ origin: FIRST, expires_at: SOON }],
            next_page_token: "t2",
          }),
      },
    });

    const expiries = await previewService.expiries(new Set([FIRST]));

    expect(expiries).toEqual(new Map([[FIRST, SOON]]));
  });

  it("asks for the largest page the API gives", async () => {
    const queries: unknown[] = [];
    const previewService = service({
      listProjectPreviews: {
        pages: (_projectId: string, query: unknown) => {
          queries.push(query);
          return pagesOf({ previews: [], next_page_token: null });
        },
      },
    });

    await previewService.expiries(new Set([FIRST]));

    expect(queries).toEqual([{ limit: 100 }]);
  });

  it("makes no request when it was asked for no origin", async () => {
    const previewService = service({});

    const expiries = await previewService.expiries(new Set());

    expect(expiries).toEqual(new Map());
  });
});

describe("PreviewService.remove", () => {
  it("stops serving the origin it was given, on the project it is bound to", async () => {
    const removeProjectPreview = vi.fn(async () => undefined);

    await service({ removeProjectPreview }).remove("https://pr-7.preview.acme.com");

    expect(removeProjectPreview).toHaveBeenCalledWith("proj_1", {
      origin: "https://pr-7.preview.acme.com",
    });
  });
});
