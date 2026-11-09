import { rm } from "node:fs/promises";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { describe, expect, vi } from "vitest";

import { SchemaCheck } from "@/commands/doctor/checks";
import { ZitadelError } from "@/lib/errors";
import { ZitadelConfig } from "@/lib/zitadel";
import { aCheckContext } from "@tests/helpers/check-context";
import { anOidcConnection, aUserSchema } from "@tests/helpers/config";
import { it } from "@tests/helpers/fixtures";
import { write } from "@tests/helpers/git-repo";
import { usePlatformServer } from "@tests/helpers/platform-project";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * The project's user schema.
 */
const SCHEMA_FILE = ".zitadel/schemas/user.json";

/**
 * The connection whose subject is the user's email, a claim they can change.
 */
const EMAIL_CONNECTION = ".zitadel/idps/acme.json";

/**
 * The advice that the subject claim is one the user can change.
 */
const SUBJECT_ADVICE = "subject_claim is";

const { server } = usePlatformServer();

/**
 * Fills `dir` with a project bound to the cloud: the files a check reads to
 * find the project and its server, and a valid user schema.
 *
 * @param dir - The directory to fill.
 */
async function aProject(dir: string): Promise<void> {
  await write(dir, {
    "zitadel.json": JSON.stringify({
      project: "proj-001",
      server: "https://api.zitadel.cloud",
      framework: { id: "next" },
    }),
    ".zitadel/secret": JSON.stringify({
      project_id: "proj-001",
      project_secret: "sk_proj_test",
      preview_secret: "sk_proj_preview",
      primary_origins: [],
      preview_origins: [],
      created_at: "2026-10-01T00:00:00.000Z",
    }),
    [SCHEMA_FILE]: JSON.stringify(aUserSchema()),
  });
}

/**
 * Makes the server list `slugs` as the connections the project has.
 *
 * @param slugs - The connections' slugs.
 */
function deploying(...slugs: readonly string[]): void {
  server.use(
    http.post("*/idps/query", () => {
      return HttpResponse.json({
        idps: slugs.map((slug) => {
          return {
            id: `idp_${slug}`,
            revision_id: `rev_${slug}`,
            slug,
            definition: anOidcConnection({ subject_claim: "email" }),
            created_at: "2026-10-01T00:00:00.000Z",
            updated_at: "2026-10-01T00:00:00.000Z",
          };
        }),
        next_page_token: null,
      });
    }),
  );
}

/**
 * Counts the requests the server gets for the connection listing.
 *
 * @returns A reader of how many listings have been asked for so far.
 */
function countingListings(): () => number {
  let asked = 0;
  server.use(
    http.post("*/idps/query", () => {
      asked += 1;
      return HttpResponse.json({ idps: [], next_page_token: null });
    }),
  );
  return () => {
    return asked;
  };
}

describe("SchemaCheck", () => {
  it("passes for a valid user schema", async ({ dir }) => {
    await aProject(dir);

    const outcome = await new SchemaCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("pass");
  });

  it.for([
    ["a malformed JSON Schema", { type: 123 }],
    [
      "a JSON Schema with no kind discriminator",
      { type: "object", properties: { email: { type: "string" } } },
    ],
  ] as const)("fails for %s", async ([, schema], { dir }) => {
    await aProject(dir);
    await write(dir, { [SCHEMA_FILE]: JSON.stringify(schema) });

    const outcome = await new SchemaCheck().run(aCheckContext(dir));

    expect(outcome.status).toBe("fail");
  });

  it("fails on an x-auth-methods key that is no authentication method", async ({ dir }) => {
    await aProject(dir);
    await write(dir, {
      [SCHEMA_FILE]: JSON.stringify(
        aUserSchema({ "x-auth-methods": { pasword: { enabled: true } } }),
      ),
    });

    const outcome = await new SchemaCheck().run(aCheckContext(dir));

    expect(outcome).toMatchObject({
      status: "fail",
      message: expect.stringContaining("x-auth-methods pasword is not"),
    });
  });

  it("fails for a key the user meta-schema refuses, as deploy does", async ({ dir }) => {
    await aProject(dir);
    await write(dir, {
      [SCHEMA_FILE]: JSON.stringify(
        aUserSchema({ properties: { firstName: { type: "string", minimumLength: 3 } } }),
      ),
    });

    const outcome = await new SchemaCheck().run(aCheckContext(dir));

    expect(outcome).toMatchObject({
      status: "fail",
      message: expect.stringContaining("properties.firstName minimumLength is not an allowed key"),
    });
  });

  it.for([
    ["a flow file that breaks the flow contract", ".zitadel/flows/login.json", { name: "bad" }],
    [
      "a connection file that breaks the connection contract",
      ".zitadel/idps/acme.json",
      { slug: "acme", protocol: "oidc" },
    ],
  ] as const)("fails on %s, naming it", async ([, path, body], { dir }) => {
    await aProject(dir);
    await write(dir, { [path]: JSON.stringify(body) });

    const outcome = await new SchemaCheck().run(aCheckContext(dir));

    expect(outcome).toMatchObject({
      status: "fail",
      message: expect.stringContaining(`${path}: `),
    });
  });

  it("warns, not fails, for a project with no schema files and a broken connection", async ({
    dir,
  }) => {
    await aProject(dir);
    await rm(join(dir, SCHEMA_FILE));
    await write(dir, {
      ".zitadel/idps/acme.json": JSON.stringify({ slug: "acme", protocol: "oidc" }),
    });

    const outcome = await new SchemaCheck().run(aCheckContext(dir));

    expect(outcome).toMatchObject({
      status: "warn",
      message: expect.stringContaining("No schema files found"),
    });
  });

  it.for([
    ["a connection", ".zitadel/idps/acme.json", { slug: "acme", protocol: "oidc" }],
    ["a flow", ".zitadel/flows/login.json", { name: "bad" }],
  ] as const)("reports the file of a failing %s as the path", async ([, path, body], { dir }) => {
    await aProject(dir);
    await write(dir, { [path]: JSON.stringify(body) });

    const outcome = await new SchemaCheck().run(aCheckContext(dir));

    expect(outcome).toMatchObject({ status: "fail", path });
  });

  it("reports the configuration directory when files in several places fail", async ({ dir }) => {
    await aProject(dir);
    await write(dir, {
      ".zitadel/idps/acme.json": JSON.stringify({ slug: "acme", protocol: "oidc" }),
      ".zitadel/flows/login.json": JSON.stringify({ name: "bad" }),
    });

    const outcome = await new SchemaCheck().run(aCheckContext(dir));

    expect(outcome).toMatchObject({ status: "fail", path: ".zitadel" });
  });

  it("warns on a warning the rules raise when nothing fails", async ({ dir }) => {
    await aProject(dir);
    await write(dir, {
      ".zitadel/idps/acme.json": JSON.stringify(anOidcConnection({ subject_claim: "email" })),
    });
    deploying();

    const outcome = await new SchemaCheck().run(aCheckContext(dir));

    expect(outcome).toMatchObject({
      status: "warn",
      message: expect.stringContaining(".zitadel/idps/acme.json: subject_claim"),
    });
  });

  describe("with a connection whose subject claim the user can change", () => {
    /**
     * Writes the connection whose subject is the user's email.
     *
     * @param dir - The project directory.
     */
    async function withEmailSubject(dir: string): Promise<void> {
      await aProject(dir);
      await write(dir, {
        [EMAIL_CONNECTION]: JSON.stringify(anOidcConnection({ subject_claim: "email" })),
      });
    }

    it("does not warn about a connection the project already has", async ({ dir }) => {
      await withEmailSubject(dir);
      deploying("acme");

      const outcome = await new SchemaCheck().run(aCheckContext(dir));

      expect(outcome.status).toBe("pass");
    });

    it("still warns about a connection the project does not have yet", async ({ dir }) => {
      await withEmailSubject(dir);
      deploying("other");

      const outcome = await new SchemaCheck().run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "warn",
        message: expect.stringContaining(SUBJECT_ADVICE),
      });
    });

    it("leaves the warning out when the listing cannot be read", async ({ dir }) => {
      await withEmailSubject(dir);
      server.use(
        http.post("*/idps/query", () => {
          return HttpResponse.json({ code: "forbidden", message: "no" }, { status: 403 });
        }),
      );

      const outcome = await new SchemaCheck().run(aCheckContext(dir));

      expect(outcome.status).toBe("pass");
    });

    it("stops when the person cancels while the listing is read", async ({ dir }) => {
      await withEmailSubject(dir);
      const controller = new AbortController();
      controller.abort(new ZitadelError("E_CANCELLED", "cancelled"));

      const error = await rejectionOf(() => {
        return new SchemaCheck().run(aCheckContext(dir, { signal: controller.signal }));
      });

      expect(error).toMatchObject({ code: "E_CANCELLED" });
    });

    it("asks nothing when no connection could draw the warning", async ({ dir }) => {
      await aProject(dir);
      await write(dir, {
        [EMAIL_CONNECTION]: JSON.stringify(anOidcConnection({ subject_claim: "sub" })),
      });
      const listings = countingListings();

      const outcome = await new SchemaCheck().run(aCheckContext(dir));

      expect(outcome.status).toBe("pass");
      expect(listings()).toBe(0);
    });

    it("reads the files once, though it asks which connections are deployed", async ({ dir }) => {
      await withEmailSubject(dir);
      deploying("acme");
      const loading = vi.spyOn(ZitadelConfig, "loadUnchecked");

      await new SchemaCheck().run(aCheckContext(dir));

      expect(loading).toHaveBeenCalledTimes(1);
      loading.mockRestore();
    });

    it("asks once when a connection could draw the warning", async ({ dir }) => {
      await withEmailSubject(dir);
      const listings = countingListings();

      await new SchemaCheck().run(aCheckContext(dir));

      expect(listings()).toBe(1);
    });
  });
});
