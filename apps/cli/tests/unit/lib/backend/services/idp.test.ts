import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

import { createZitadelClient } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import { IdpService } from "@/lib/backend/services/idp";
import {
  answering,
  answeringPages,
  refusal,
  TEST_SERVER,
  testClient,
} from "@tests/helpers/api-answers";

/** A service on a test client, bound to `proj_1`. */
function service(): IdpService {
  return new IdpService(testClient(), "proj_1");
}

describe("IdpService.list", () => {
  it("lists every connection of the project it is bound to", async ({ server }) => {
    const queried = answeringPages(server, "queryIdps", { idps: [{ slug: "google" }] });

    await service().list();

    expect(queried.map(({ url }) => url.searchParams.get("project_id"))).toEqual(["proj_1"]);
  });

  it("answers every connection the listing drained", async ({ server }) => {
    answeringPages(
      server,
      "queryIdps",
      { idps: [{ slug: "google" }] },
      { idps: [{ slug: "acme" }] },
    );

    const connections = await service().list();

    expect(connections).toEqual([{ slug: "google" }, { slug: "acme" }]);
  });
});

describe("IdpService.deployedSlugs", () => {
  it("answers the slugs of the connections the project has", async ({ server }) => {
    answeringPages(server, "queryIdps", { idps: [{ slug: "google" }, { slug: "acme" }] });

    expect(await service().deployedSlugs()).toEqual(new Set(["google", "acme"]));
  });

  it("answers undefined when the listing cannot be read", async ({ server }) => {
    answering(server, "queryIdps", refusal(403, "idp.permission_denied"));

    expect(await service().deployedSlugs()).toBeUndefined();
  });

  it("passes on the person stopping the command", async () => {
    const idpService = new IdpService(
      createZitadelClient({
        baseUrl: TEST_SERVER,
        signal: AbortSignal.abort(new ZitadelError("E_CANCELLED", "cancelled")),
      }),
      "proj_1",
    );

    expect(await rejectionOf(() => idpService.deployedSlugs())).toMatchObject({
      code: "E_CANCELLED",
    });
  });
});
