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

    const previews = await service({ listPreviews: { all } }).list();

    expect(all).toHaveBeenCalledWith("proj_1");
    expect(previews).toEqual([{ origin: "https://pr-7.preview.acme.com" }]);
  });
});

describe("PreviewService.page", () => {
  it("reads one page and the cursor to the next", async () => {
    const previewService = service({
      listPreviews: {
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
      listPreviews: {
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

    await service({ listPreviews: { pages } }).page({ limit: 5 }, { all: true });

    expect(pages).toHaveBeenCalledWith("proj_1", { limit: 5 });
  });
});

describe("PreviewService.remove", () => {
  it("stops serving the origin it was given, on the project it is bound to", async () => {
    const removePreview = vi.fn(async () => undefined);

    await service({ removePreview }).remove("https://pr-7.preview.acme.com");

    expect(removePreview).toHaveBeenCalledWith("proj_1", {
      origin: "https://pr-7.preview.acme.com",
    });
  });
});
