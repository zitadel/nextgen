import { describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/backend/errors";
import { ZitadelError } from "@/lib/errors";
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

describe("IdpService.deployedSlugs", () => {
  it("answers the slugs of the connections the project has", async () => {
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

    expect(await service.deployedSlugs()).toEqual(new Set(["google", "acme"]));
  });

  it("answers undefined when the listing cannot be read", async () => {
    const service = new IdpService(
      fakeClient({
        queryIdps: {
          all: async () => {
            throw new ForbiddenError("not allowed", { status: 403 });
          },
        },
      }),
      "proj_1",
    );

    expect(await service.deployedSlugs()).toBeUndefined();
  });

  it("passes on the person stopping the command", async () => {
    const service = new IdpService(
      fakeClient({
        queryIdps: {
          all: async () => {
            throw new ZitadelError("E_CANCELLED", "cancelled");
          },
        },
      }),
      "proj_1",
    );

    await expect(service.deployedSlugs()).rejects.toMatchObject({ code: "E_CANCELLED" });
  });
});
