import { describe, expect, it, vi } from "vitest";

import { BrandingService } from "@/lib/backend/services/branding";
import { fakeClient, pagesOf } from "@tests/helpers/fake-client";

describe("BrandingService.list", () => {
  it("lists every revision of the project it is bound to", async () => {
    const all = vi.fn(async () => []);
    const brandingService = new BrandingService(fakeClient({ listBranding: { all } }), "proj_1");

    await brandingService.list();

    expect(all).toHaveBeenCalledWith({ project_id: "proj_1" });
  });

  it("drains past the first page, in the order the server answered", async () => {
    const brandingService = new BrandingService(
      fakeClient({
        listBranding: { all: async () => [{ id: "brand_2" }, { id: "brand_1" }] },
      }),
      "proj_1",
    );

    await expect(brandingService.list()).resolves.toEqual([{ id: "brand_2" }, { id: "brand_1" }]);
  });
});

describe("BrandingService.page", () => {
  it("reads one page and the cursor to the next", async () => {
    const pages = vi.fn(() =>
      pagesOf(
        { branding: [{ id: "brand_2" }], next_page_token: "t2" },
        { branding: [{ id: "brand_1" }], next_page_token: null },
      ),
    );
    const brandingService = new BrandingService(fakeClient({ listBranding: { pages } }), "proj_1");

    const first = await brandingService.page({ limit: 1 });

    expect(pages).toHaveBeenCalledWith({ project_id: "proj_1", limit: 1 });
    expect(first.items).toEqual([{ id: "brand_2" }]);
    expect(first.next).toBe("t2");
  });

  it("answers no cursor when the server sent none", async () => {
    const brandingService = new BrandingService(
      fakeClient({
        listBranding: { pages: () => pagesOf({ branding: [], next_page_token: null }) },
      }),
      "proj_1",
    );

    const first = await brandingService.page();

    expect(first.next).toBeNull();
  });

  it("drains every page when asked for all of them", async () => {
    const brandingService = new BrandingService(
      fakeClient({
        listBranding: {
          pages: () =>
            pagesOf(
              { branding: [{ id: "brand_2" }], next_page_token: "t2" },
              { branding: [{ id: "brand_1" }], next_page_token: null },
            ),
        },
      }),
      "proj_1",
    );

    const every = await brandingService.page({}, { all: true });

    expect(every.items).toEqual([{ id: "brand_2" }, { id: "brand_1" }]);
    expect(every.next).toBeNull();
  });
});

describe("BrandingService.get", () => {
  it("reads one revision by its own id, which names the project already", async () => {
    const getBranding = vi.fn(async () => ({ id: "brand_1" }));
    const brandingService = new BrandingService(fakeClient({ getBranding }), "proj_1");

    await brandingService.get("brand_1");

    expect(getBranding).toHaveBeenCalledWith("brand_1");
  });
});
