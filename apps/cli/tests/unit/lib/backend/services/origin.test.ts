import { HttpResponse, http } from "msw";
import type { SetupServer } from "msw/node";
import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { ConflictError, ForbiddenError, UnavailableError } from "@/lib/backend/errors";
import { rejectionOf } from "@tests/helpers/thrown-value";

import { Origin, Origins, OriginService } from "@/lib/backend/services/origin";
import { createZitadelClient, type ZitadelClient } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import { answering, refusal } from "@tests/helpers/api-answers";
import { PRIMARY_ORIGIN, PREVIEW_PATTERN } from "@tests/helpers/records";

/** A server a cancelled run is pointed at. */
const CANCEL_SERVER = "http://localhost:8080";

const ISSUER = "http://localhost:3000";

/** An origin as the API stores and answers it. */
function stored(pattern: string, kind: "primary" | "preview") {
  return { pattern, kind };
}

/** The project every test's service is bound to. */
const PROJECT = "proj_1";

/** A service on `client` whose project answers `origins`. */
function serviceHolding(
  server: SetupServer,
  client: ZitadelClient,
  origins: readonly { pattern: string; kind: "primary" | "preview" }[],
): OriginService {
  answering(server, "getProject", { origins });
  return new OriginService(client, PROJECT);
}

describe("Origin.isPrimary", () => {
  it("is true for a primary origin", () => {
    expect(Origin.of({ pattern: ISSUER, kind: "primary" }).isPrimary).toBe(true);
  });

  it("is false for a preview pattern", () => {
    expect(Origin.of({ pattern: ISSUER, kind: "preview" }).isPrimary).toBe(false);
  });
});

describe("Origin.matches", () => {
  it("lets a wildcard stand for one label", () => {
    expect(
      Origin.of({ pattern: "https://*.preview.acme.com", kind: "preview" }).matches(
        "https://pr-7.preview.acme.com",
      ),
    ).toBe(true);
  });

  it("never lets a wildcard cross a dot", () => {
    expect(
      Origin.of({ pattern: "https://*.preview.acme.com", kind: "preview" }).matches(
        "https://a.b.preview.acme.com",
      ),
    ).toBe(false);
  });

  it("never lets a wildcard stand for nothing at all", () => {
    expect(
      Origin.of({ pattern: "https://*.preview.acme.com", kind: "preview" }).matches(
        "https://.preview.acme.com",
      ),
    ).toBe(false);
  });

  it("matches a pattern with no wildcard only exactly", () => {
    expect(
      Origin.of({ pattern: PRIMARY_ORIGIN, kind: "primary" }).matches(`${PRIMARY_ORIGIN}:8443`),
    ).toBe(false);
  });
});

describe("Origin.toJSON", () => {
  it("carries the pattern and the kind, and not the form it compares in", () => {
    const origin = Origin.of({ pattern: PRIMARY_ORIGIN, kind: "primary" });

    expect(JSON.parse(JSON.stringify(origin))).toEqual({
      pattern: PRIMARY_ORIGIN,
      kind: "primary",
    });
  });
});

describe("Origins.primary", () => {
  it("names the patterns a deploy lands on", () => {
    expect(
      Origins.wrap([
        { pattern: PRIMARY_ORIGIN, kind: "primary" },
        { pattern: "https://*.preview.acme.com", kind: "preview" },
      ]).primary,
    ).toEqual([PRIMARY_ORIGIN]);
  });
});

describe("Origins.preview", () => {
  it("names the patterns only a pull-request build may match", () => {
    expect(
      Origins.wrap([
        { pattern: PRIMARY_ORIGIN, kind: "primary" },
        { pattern: "https://*.preview.acme.com", kind: "preview" },
      ]).preview,
    ).toEqual(["https://*.preview.acme.com"]);
  });
});

describe("Origins.isEmpty", () => {
  it("is true for a project that holds no pattern, and so admits every origin", () => {
    expect(Origins.wrap([]).isEmpty).toBe(true);
  });

  it("is false for a project that holds one", () => {
    expect(Origins.wrap([{ pattern: ISSUER, kind: "primary" }]).isEmpty).toBe(false);
  });
});

describe("Origins.kindOf", () => {
  const origins = Origins.wrap([
    { pattern: PRIMARY_ORIGIN, kind: "primary" },
    { pattern: "https://*.preview.acme.com", kind: "preview" },
  ]);

  it("calls an exact primary pattern primary", () => {
    expect(origins.kindOf(PRIMARY_ORIGIN)).toBe("primary");
  });

  it("calls a URL a preview pattern covers preview", () => {
    expect(origins.kindOf("https://pr-7.preview.acme.com")).toBe("preview");
  });

  it("calls any other URL unknown", () => {
    expect(origins.kindOf("https://other.acme.com")).toBe("unknown");
  });

  it("names the same origin however the URL was written, so a trailing slash is not a miss", () => {
    expect(origins.kindOf(`${PRIMARY_ORIGIN}/`)).toBe("primary");
    expect(origins.kindOf("https://pr-7.preview.acme.com/")).toBe("preview");
  });
});

describe("Origins.all", () => {
  it("answers the origins in the order the project stores them, for a caller that lists them", () => {
    const origins = Origins.wrap([
      { pattern: PRIMARY_ORIGIN, kind: "primary" },
      { pattern: "https://*.preview.acme.com", kind: "preview" },
    ]);

    expect(
      origins.all.map((origin) => {
        return origin.pattern;
      }),
    ).toEqual([PRIMARY_ORIGIN, "https://*.preview.acme.com"]);
  });
});

describe("Origins.heldAsPreview", () => {
  it("returns the stored pattern when the issuer is a preview origin and nothing is primary", () => {
    expect(Origins.wrap([{ pattern: ISSUER, kind: "preview" }]).heldAsPreview(ISSUER)).toBe(ISSUER);
  });

  it("returns nothing when any origin is primary", () => {
    expect(
      Origins.wrap([
        { pattern: ISSUER, kind: "preview" },
        { pattern: PRIMARY_ORIGIN, kind: "primary" },
      ]).heldAsPreview(ISSUER),
    ).toBeUndefined();
  });

  it("returns nothing when the project does not hold the issuer", () => {
    expect(
      Origins.wrap([{ pattern: PREVIEW_PATTERN, kind: "preview" }]).heldAsPreview(ISSUER),
    ).toBeUndefined();
  });

  it("matches an issuer written with a trailing slash or upper-case host", () => {
    expect(
      Origins.wrap([{ pattern: ISSUER, kind: "preview" }]).heldAsPreview("http://LOCALHOST:3000/"),
    ).toBe(ISSUER);
  });
});

describe("Origins.originOf", () => {
  it("drops a trailing slash", () => {
    expect(Origins.originOf(`${ISSUER}/`)).toBe(ISSUER);
  });

  it("returns a value that is not a URL as written", () => {
    expect(Origins.originOf("not a url")).toBe("not a url");
  });
});

describe("OriginService.list", () => {
  it("answers the patterns the project stores", async ({ server, client }) => {
    const originService = serviceHolding(server, client, [{ pattern: ISSUER, kind: "primary" }]);

    const origins = await originService.list();

    expect(origins.primary).toEqual([ISSUER]);
  });

  it("answers an empty collection for a project that holds none", async ({ server, client }) => {
    answering(server, "getProject", {});

    await expect(new OriginService(client, PROJECT).list()).resolves.toEqual(Origins.wrap([]));
  });
});

describe("OriginService.primaryAmong", () => {
  it("picks out the URLs a deploy would land on, in the order given", async ({
    server,
    client,
  }) => {
    const originService = serviceHolding(server, client, [
      { pattern: "https://b.acme.com", kind: "primary" },
      { pattern: "https://a.acme.com", kind: "primary" },
      { pattern: "https://*.preview.acme.com", kind: "preview" },
    ]);

    await expect(
      originService.primaryAmong([
        "https://a.acme.com",
        "https://pr-7.preview.acme.com",
        "https://b.acme.com",
      ]),
    ).resolves.toEqual(["https://a.acme.com", "https://b.acme.com"]);
  });

  it("picks out none when the project holds no primary origin", async ({ server, client }) => {
    const originService = serviceHolding(server, client, [
      { pattern: "https://*.preview.acme.com", kind: "preview" },
    ]);

    await expect(originService.primaryAmong(["https://pr-7.preview.acme.com"])).resolves.toEqual(
      [],
    );
  });
});

describe("OriginService.add", () => {
  it("adds the pattern to the project it is bound to", async ({ server, client }) => {
    const added = answering(server, "addProjectOrigin", stored(ISSUER, "primary"));

    const origin = await new OriginService(client, PROJECT).add(ISSUER, "primary");

    expect(added.map(({ params, body }) => [params.project_id, body])).toEqual([
      ["proj_1", { pattern: ISSUER, kind: "primary" }],
    ]);
    expect(origin.isPrimary).toBe(true);
  });
});

describe("OriginService.promote", () => {
  it("removes the preview pattern and adds it back as primary", async ({ server, client }) => {
    const removed = answering(server, "removeProjectOrigin", undefined);
    const added = answering(server, "addProjectOrigin", stored(ISSUER, "primary"));

    await new OriginService(client, PROJECT).promote(ISSUER);

    expect(removed.map(({ params, body }) => [params.project_id, body])).toEqual([
      ["proj_1", { pattern: ISSUER }],
    ]);
    expect(added.map(({ body }) => body)).toEqual([{ pattern: ISSUER, kind: "primary" }]);
  });

  it("puts the pattern back as a preview one when the add fails, and raises the failure", async ({
    server,
    client,
  }) => {
    answering(server, "removeProjectOrigin", undefined);
    const added = answering(server, "addProjectOrigin", ({ body }) => {
      return body.kind === "primary"
        ? refusal(409, "proj.origin_conflict")
        : stored(ISSUER, "preview");
    });

    const error = await rejectionOf(() => new OriginService(client, PROJECT).promote(ISSUER));

    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ status: 409 });
    expect(added.map(({ body }) => body)).toEqual([
      { pattern: ISSUER, kind: "primary" },
      { pattern: ISSUER, kind: "preview" },
    ]);
  });

  it("raises the add's failure even when putting the pattern back fails too", async ({
    server,
    client,
  }) => {
    answering(server, "removeProjectOrigin", undefined);
    answering(server, "addProjectOrigin", refusal(409, "proj.origin_conflict"));

    const error = await rejectionOf(() => new OriginService(client, PROJECT).promote(ISSUER));

    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ status: 409 });
  });
});

describe("OriginService.remove", () => {
  it("reports a removal that left the project holding others", async ({ server, client }) => {
    answering(server, "removeProjectOrigin", undefined);
    answering(server, "getProject", { origins: [{ pattern: ISSUER, kind: "primary" }] });

    await expect(
      new OriginService(client, PROJECT).remove("https://gone.acme.com"),
    ).resolves.toEqual({
      pattern: "https://gone.acme.com",
      outcome: "removed",
    });
  });

  it("reports a removal that left the project admitting every origin", async ({
    server,
    client,
  }) => {
    answering(server, "removeProjectOrigin", undefined);
    answering(server, "getProject", { origins: [] });

    await expect(new OriginService(client, PROJECT).remove(ISSUER)).resolves.toEqual({
      pattern: ISSUER,
      outcome: "emptied",
    });
  });

  it("reports the pattern gone but unverified when what is left could not be read", async ({
    server,
    client,
  }) => {
    answering(server, "removeProjectOrigin", undefined);
    answering(server, "getProject", refusal(503, "unavailable"));

    await expect(new OriginService(client, PROJECT).remove(ISSUER)).resolves.toEqual({
      pattern: ISSUER,
      outcome: "unverified",
      cause: expect.any(UnavailableError),
    });
  });

  it("raises a removal the server refused, which removed nothing", async ({ server, client }) => {
    answering(server, "removeProjectOrigin", refusal(403, "proj.permission_denied"));

    const error = await rejectionOf(() => new OriginService(client, PROJECT).remove(ISSUER));

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ status: 403 });
  });
});

describe("Origins.toJSON", () => {
  it("serialises as the list of patterns, not as the field they are kept in", () => {
    const origins = Origins.wrap([
      {
        pattern: PRIMARY_ORIGIN,
        kind: "primary",
      },
      {
        pattern: "https://*.preview.acme.com",
        kind: "preview",
      },
    ]);

    // What a reader of `--json` receives is what the serialiser writes, and an
    // origin list has always been a list.
    expect(JSON.parse(JSON.stringify({ origins }))).toEqual({
      origins: [
        {
          pattern: PRIMARY_ORIGIN,
          kind: "primary",
        },
        {
          pattern: "https://*.preview.acme.com",
          kind: "preview",
        },
      ],
    });
  });
});

describe("OriginService.remove when the run is cancelled", () => {
  it("throws the cancellation instead of answering the removal unverified", async ({ server }) => {
    // The pattern is gone and the read that checks what is left is cut off by
    // Ctrl-C. Reporting it as unverified would have the command print a result
    // and exit as though it had finished.
    const controller = new AbortController();
    const cancelled = new ZitadelError("E_CANCELLED", "Cancelled.");
    server.use(
      http.post(`${CANCEL_SERVER}/api/v1/projects/proj_1/origins/remove`, () => {
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(`${CANCEL_SERVER}/api/v1/projects/proj_1`, () => {
        controller.abort(cancelled);
        return HttpResponse.error();
      }),
    );
    const originService = new OriginService(
      createZitadelClient({ baseUrl: CANCEL_SERVER, signal: controller.signal }),
      PROJECT,
    );

    expect(await rejectionOf(() => originService.remove(PRIMARY_ORIGIN))).toBe(cancelled);
  });
});
