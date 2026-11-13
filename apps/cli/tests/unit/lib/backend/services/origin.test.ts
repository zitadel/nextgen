import type { AddOriginBody } from "@zitadel/api/generated/model";
import { HttpResponse, http } from "msw";
import { describe, expect, vi } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { Origin, Origins, OriginService } from "@/lib/backend/services/origin";
import { allowDestructive, createZitadelClient } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import { fakeClient } from "@tests/helpers/fake-client";
import { PRIMARY_ORIGIN, PREVIEW_PATTERN } from "@tests/helpers/records";

/** A server a cancelled run is pointed at. */
const CANCEL_SERVER = "http://localhost:8080";

const ISSUER = "http://localhost:3000";

/** An origin as the API stores and answers it. */
function stored(pattern: string, kind: "primary" | "preview") {
  return { pattern, kind };
}

/** A service whose project holds `origins`, plus anything else a test stubs. */
function serviceHolding(
  origins: readonly { pattern: string; kind: "primary" | "preview" }[],
): OriginService {
  return new OriginService(
    fakeClient({
      getProject: async () => ({ origins }),
    }),
    "proj_1",
  );
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
  it("answers the patterns the project stores", async () => {
    const originService = serviceHolding([{ pattern: ISSUER, kind: "primary" }]);

    const origins = await originService.list();

    expect(origins.primary).toEqual([ISSUER]);
  });

  it("answers an empty collection for a project that holds none", async () => {
    const originService = new OriginService(
      fakeClient({
        getProject: async () => ({}),
      }),
      "proj_1",
    );

    await expect(originService.list()).resolves.toMatchObject({ isEmpty: true });
  });
});

describe("OriginService.primaryAmong", () => {
  it("picks out the URLs a deploy would land on, in the order given", async () => {
    const originService = serviceHolding([
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

  it("picks out none when the project holds no primary origin", async () => {
    const originService = serviceHolding([
      { pattern: "https://*.preview.acme.com", kind: "preview" },
    ]);

    await expect(originService.primaryAmong(["https://pr-7.preview.acme.com"])).resolves.toEqual(
      [],
    );
  });
});

describe("OriginService.add", () => {
  it("adds the pattern to the project it is bound to", async () => {
    const addOrigin = vi.fn(async () => stored(ISSUER, "primary"));
    const originService = new OriginService(fakeClient({ addOrigin }), "proj_1");

    const added = await originService.add(ISSUER, "primary");

    expect(addOrigin).toHaveBeenCalledWith("proj_1", { pattern: ISSUER, kind: "primary" });
    expect(added.isPrimary).toBe(true);
  });
});

describe("OriginService.promote", () => {
  it("removes the preview pattern and adds it back as primary", async () => {
    const removeOrigin = vi.fn(async () => undefined);
    const addOrigin = vi.fn(async () => stored(ISSUER, "primary"));
    const originService = new OriginService(fakeClient({ removeOrigin, addOrigin }), "proj_1");

    await originService.promote(ISSUER);

    expect(removeOrigin).toHaveBeenCalledWith("proj_1", { pattern: ISSUER });
    expect(addOrigin).toHaveBeenCalledWith("proj_1", { pattern: ISSUER, kind: "primary" });
  });

  it("puts the pattern back as a preview one when the add fails, and raises the failure", async () => {
    const addOrigin = vi.fn(async (_projectId: string, body: AddOriginBody) => {
      if (body.kind === "primary") {
        throw new Error("refused");
      }
      return stored(ISSUER, "preview");
    });
    const originService = new OriginService(
      fakeClient({ removeOrigin: async () => undefined, addOrigin }),
      "proj_1",
    );

    await expect(originService.promote(ISSUER)).rejects.toThrow("refused");
    expect(addOrigin).toHaveBeenLastCalledWith("proj_1", { pattern: ISSUER, kind: "preview" });
  });

  it("raises the add's failure even when putting the pattern back fails too", async () => {
    const originService = new OriginService(
      fakeClient({
        removeOrigin: async () => undefined,
        addOrigin: async () => {
          throw new Error("refused");
        },
      }),
      "proj_1",
    );

    await expect(originService.promote(ISSUER)).rejects.toThrow("refused");
  });
});

describe("OriginService.remove", () => {
  it("reports a removal that left the project holding others", async () => {
    const originService = new OriginService(
      fakeClient({
        removeOrigin: async () => undefined,
        getProject: async () => ({ origins: [{ pattern: ISSUER, kind: "primary" }] }),
      }),
      "proj_1",
    );

    await expect(originService.remove("https://gone.acme.com")).resolves.toEqual({
      pattern: "https://gone.acme.com",
      outcome: "removed",
    });
  });

  it("reports a removal that left the project admitting every origin", async () => {
    const originService = new OriginService(
      fakeClient({
        removeOrigin: async () => undefined,
        getProject: async () => ({ origins: [] }),
      }),
      "proj_1",
    );

    await expect(originService.remove(ISSUER)).resolves.toEqual({
      pattern: ISSUER,
      outcome: "emptied",
    });
  });

  it("reports the pattern gone but unverified when what is left could not be read", async () => {
    const originService = new OriginService(
      fakeClient({
        removeOrigin: async () => undefined,
        getProject: async () => {
          throw new Error("unreadable");
        },
      }),
      "proj_1",
    );

    await expect(originService.remove(ISSUER)).resolves.toMatchObject({
      pattern: ISSUER,
      outcome: "unverified",
      cause: expect.any(Error),
    });
  });

  it("raises a removal the server refused, which removed nothing", async () => {
    const originService = new OriginService(
      fakeClient({
        removeOrigin: async () => {
          throw new Error("refused");
        },
      }),
      "proj_1",
    );

    await expect(originService.remove(ISSUER)).rejects.toThrow("refused");
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
    // Removing is destructive, so the service is built on a client that may
    // reach it, exactly as the command builds one inside `confirmed`.
    const originService = new OriginService(
      allowDestructive(
        createZitadelClient({
          baseUrl: CANCEL_SERVER,
          signal: controller.signal,
        }),
      ),
      "proj_1",
    );

    await expect(originService.remove(PRIMARY_ORIGIN)).rejects.toBeDefined();
  });
});
