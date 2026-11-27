import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { BrandingService } from "@/lib/backend/services/branding";
import { answering, answeringPages } from "@tests/helpers/api-answers";

describe("BrandingService.list", () => {
  it("lists every revision of the project it is bound to", async ({ server, client }) => {
    const listed = answeringPages(server, "listBranding", { branding: [] });

    await new BrandingService(client, "proj_1").list();

    expect(listed.map(({ url }) => url.searchParams.get("project_id"))).toEqual(["proj_1"]);
  });

  it("drains past the first page, in the order the server answered", async ({ server, client }) => {
    answeringPages(
      server,
      "listBranding",
      { branding: [{ id: "brand_2" }] },
      { branding: [{ id: "brand_1" }] },
    );

    await expect(new BrandingService(client, "proj_1").list()).resolves.toEqual([
      { id: "brand_2" },
      { id: "brand_1" },
    ]);
  });
});

describe("BrandingService.page", () => {
  it("reads one page and the cursor to the next", async ({ server, client }) => {
    const listed = answering(server, "listBranding", {
      branding: [{ id: "brand_2" }],
      next_page_token: "t2",
    });

    const first = await new BrandingService(client, "proj_1").page({ limit: 1 });

    expect(
      listed.map(({ url }) => [url.searchParams.get("project_id"), url.searchParams.get("limit")]),
    ).toEqual([["proj_1", "1"]]);
    expect(first.items).toEqual([{ id: "brand_2" }]);
    expect(first.next).toBe("t2");
  });

  it("answers no cursor when the server sent none", async ({ server, client }) => {
    answeringPages(server, "listBranding", { branding: [] });

    const first = await new BrandingService(client, "proj_1").page();

    expect(first.next).toBeNull();
  });

  it("drains every page when asked for all of them", async ({ server, client }) => {
    answeringPages(
      server,
      "listBranding",
      { branding: [{ id: "brand_2" }] },
      { branding: [{ id: "brand_1" }] },
    );

    const every = await new BrandingService(client, "proj_1").page({}, { all: true });

    expect(every.items).toEqual([{ id: "brand_2" }, { id: "brand_1" }]);
    expect(every.next).toBeNull();
  });
});

describe("BrandingService.get", () => {
  it("reads one revision by its own id, which names the project already", async ({
    server,
    client,
  }) => {
    const read = answering(server, "getBranding", { id: "brand_1" });

    await new BrandingService(client, "proj_1").get("brand_1");

    expect(read.map(({ params, url }) => [params.branding_id, url.search])).toEqual([
      ["brand_1", ""],
    ]);
  });
});
