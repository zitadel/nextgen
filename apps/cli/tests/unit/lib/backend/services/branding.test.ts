import { describe, expect, it, vi } from "vitest";

import { BrandingService } from "@/lib/backend/services/branding";
import { fakeClient } from "@tests/helpers/fake-client";

describe("BrandingService.list", () => {
  it("lists the revisions of the project it is bound to", async () => {
    const listBranding = vi.fn(async () => []);
    const brandingService = new BrandingService(fakeClient({ listBranding }), "proj_1");

    await brandingService.list();

    expect(listBranding).toHaveBeenCalledWith({ project_id: "proj_1" });
  });

  it("answers them in the order the server did", async () => {
    const brandingService = new BrandingService(
      fakeClient({
        listBranding: async () => [{ id: "brand_2" }, { id: "brand_1" }],
      }),
      "proj_1",
    );

    await expect(brandingService.list()).resolves.toEqual([{ id: "brand_2" }, { id: "brand_1" }]);
  });
});

describe("BrandingService.get", () => {
  it("reads one revision by its own id, which names the project already", async () => {
    const getBrandingById = vi.fn(async () => ({ id: "brand_1" }));
    const brandingService = new BrandingService(fakeClient({ getBrandingById }), "proj_1");

    await brandingService.get("brand_1");

    expect(getBrandingById).toHaveBeenCalledWith("brand_1");
  });
});
