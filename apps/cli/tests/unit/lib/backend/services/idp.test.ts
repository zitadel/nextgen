import { describe, expect, it, vi } from "vitest";

import { IdpService } from "@/lib/backend/services/idp";
import { fakeClient } from "@tests/helpers/fake-client";

describe("IdpService.list", () => {
  it("lists every connection of the project it is bound to", async () => {
    const all = vi.fn(async () => {
      return [{ slug: "google" }];
    });

    await new IdpService(fakeClient({ queryIdps: { all } }), "proj_1").list();

    expect(all).toHaveBeenCalledWith({}, { project_id: "proj_1" });
  });

  it("answers every connection the listing drained", async () => {
    const service = new IdpService(
      fakeClient({
        queryIdps: {
          all: async () => {
            return [{ slug: "google" }, { slug: "acme" }];
          },
        },
      }),
      "proj_1",
    );

    const connections = await service.list();

    expect(connections).toEqual([{ slug: "google" }, { slug: "acme" }]);
  });
});
