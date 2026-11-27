import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { BrandingService } from "@/lib/backend/services/branding";
import { answering, answeringPages, testClient } from "@tests/helpers/api-answers";

/** A service on a test client, bound to `proj_1`. */
function service(): BrandingService {
  return new BrandingService(testClient(), "proj_1");
}

describe("BrandingService.list", () => {
  it("lists every revision of the project it is bound to", async ({ server }) => {
    const listed = answeringPages(server, "listBranding", { branding: [] });

    await service().list();

    expect(listed.map(({ url }) => url.searchParams.get("project_id"))).toEqual(["proj_1"]);
  });

  it("drains past the first page, in the order the server answered", async ({ server }) => {
    answeringPages(
      server,
      "listBranding",
      { branding: [{ id: "brand_2" }] },
      { branding: [{ id: "brand_1" }] },
    );

    await expect(service().list()).resolves.toEqual([{ id: "brand_2" }, { id: "brand_1" }]);
  });
});

describe("BrandingService.page", () => {
  it("reads one page and the cursor to the next", async ({ server }) => {
    const listed = answering(server, "listBranding", {
      branding: [{ id: "brand_2" }],
      next_page_token: "t2",
    });

    const first = await service().page({ limit: 1 });

    expect(
      listed.map(({ url }) => [url.searchParams.get("project_id"), url.searchParams.get("limit")]),
    ).toEqual([["proj_1", "1"]]);
    expect(first.items).toEqual([{ id: "brand_2" }]);
    expect(first.next).toBe("t2");
  });

  it("answers no cursor when the server sent none", async ({ server }) => {
    answeringPages(server, "listBranding", { branding: [] });

    const first = await service().page();

    expect(first.next).toBeNull();
  });

  it("drains every page when asked for all of them", async ({ server }) => {
    answeringPages(
      server,
      "listBranding",
      { branding: [{ id: "brand_2" }] },
      { branding: [{ id: "brand_1" }] },
    );

    const every = await service().page({}, { all: true });

    expect(every.items).toEqual([{ id: "brand_2" }, { id: "brand_1" }]);
    expect(every.next).toBeNull();
  });
});

describe("BrandingService.get", () => {
  it("reads one revision by its own id, which names the project already", async ({ server }) => {
    const read = answering(server, "getBranding", { id: "brand_1" });

    await service().get("brand_1");

    expect(read.map(({ params, url }) => [params.branding_id, url.search])).toEqual([
      ["brand_1", ""],
    ]);
  });
});
