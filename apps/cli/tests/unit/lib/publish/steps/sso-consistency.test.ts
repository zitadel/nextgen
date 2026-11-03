import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, describe, expect } from "vitest";

import { it } from "../../../../helpers/fixtures";

import { ZitadelError } from "../../../../../src/lib/errors";
import { validateSsoConsistency } from "../../../../../src/lib/publish/steps/sso-consistency";
import { takeReportedWarnings } from "../../../../../src/lib/warnings";

const SCHEMA = ".zitadel/schemas/staff.json";
const FLOW = ".zitadel/flows/login.json";
const CONNECTION = ".zitadel/idps/acme.json";

const schema = (providers: string[]) => ({
  objectType: "staff",
  properties: { email: {} },
  "x-auth-methods": { sso: { enabled: true, providers } },
});

const flow = (userSchema: string, providers: string[]) => ({
  user_schema: userSchema,
  steps: [
    {
      name: "identifier",
      sso_providers: providers,
      transitions: {
        sso_authenticated: { target: "done" },
        sso_user_not_found: { target: "register-sso" },
        user_already_exists: { target: "sso-conflict" },
      },
    },
  ],
});

const connection = (slug: string) => ({ slug, claim_mapping: { email: "email" } });

beforeEach(async () => {
  takeReportedWarnings();
});

async function write(cwd: string, path: string, body: object): Promise<void> {
  await mkdir(join(cwd, path, ".."), { recursive: true });
  await writeFile(join(cwd, path), JSON.stringify(body));
}

async function failure(cwd: string): Promise<ZitadelError | undefined> {
  try {
    await validateSsoConsistency(cwd);
  } catch (error) {
    expect(error).toBeInstanceOf(ZitadelError);
    return error as ZitadelError;
  }
  return undefined;
}

describe("validateSsoConsistency", () => {
  it("accepts a project whose files agree", async ({ dir: cwd }) => {
    await write(cwd, SCHEMA, schema(["acme"]));
    await write(cwd, FLOW, flow("staff", ["acme"]));
    await write(cwd, CONNECTION, connection("acme"));

    expect(await failure(cwd)).toBeUndefined();
  });

  it("accepts a project with no SSO files at all", async ({ dir: cwd }) => {
    expect(await failure(cwd)).toBeUndefined();
  });

  it("stops on a provider the pinned schema does not list, naming the flow file", async ({
    dir: cwd,
  }) => {
    await write(cwd, SCHEMA, schema(["other"]));
    await write(cwd, FLOW, flow("staff", ["acme"]));
    await write(cwd, CONNECTION, connection("acme"));

    const error = await failure(cwd);

    expect(error?.code).toBe("E_VALIDATION");
    expect(error?.message).toContain(`${FLOW}: step "identifier"`);
    expect(error?.message).toContain('"acme" is not listed in sso.providers');
  });

  it("stops on a schema that lists a provider with no connection file", async ({ dir: cwd }) => {
    await write(cwd, SCHEMA, schema(["acme"]));

    const error = await failure(cwd);

    expect(error?.message).toContain(SCHEMA);
  });

  it("stops on two connection files that claim one slug", async ({ dir: cwd }) => {
    await write(cwd, CONNECTION, connection("acme"));
    await write(cwd, ".zitadel/idps/acme-copy.json", connection("acme"));

    const error = await failure(cwd);

    expect(error?.message).toContain("SSO configuration is not consistent");
  });

  it("reports every problem in one error", async ({ dir: cwd }) => {
    await write(cwd, SCHEMA, schema(["acme", "ghost"]));

    const error = await failure(cwd);

    expect(error?.message).toContain("(2 issues)");
  });

  it("lists each issue under details with the file as its path", async ({ dir: cwd }) => {
    await write(cwd, SCHEMA, schema(["acme"]));

    const error = await failure(cwd);

    const details = error?.details as { issues: Array<{ path: string; rule: string }> } | undefined;
    expect(details?.issues.map((issue) => issue.path)).toEqual([SCHEMA]);
  });

  it("says nothing was changed", async ({ dir: cwd }) => {
    await write(cwd, SCHEMA, schema(["acme"]));

    const error = await failure(cwd);

    expect(error?.hint).toContain("no changes were made");
  });

  describe("finding the schema a flow pins", () => {
    it("matches a flow's user_schema to a schema's objectType", async ({ dir: cwd }) => {
      await write(cwd, SCHEMA, schema(["other"]));
      await write(cwd, FLOW, flow("staff", ["acme"]));
      await write(cwd, CONNECTION, connection("acme"));

      expect((await failure(cwd))?.message).toContain('"acme" is not listed in sso.providers');
    });

    it("matches a flow's user_schema to a schema's $id", async ({ dir: cwd }) => {
      await write(cwd, SCHEMA, {
        ...schema(["other"]),
        $id: "https://schemas.example.test/staff.json",
      });
      await write(cwd, FLOW, flow("https://schemas.example.test/staff.json", ["acme"]));
      await write(cwd, CONNECTION, connection("acme"));

      expect((await failure(cwd))?.message).toContain('"acme" is not listed in sso.providers');
    });

    it("warns instead of failing when the pinned schema is not a local file", async ({
      dir: cwd,
    }) => {
      await write(cwd, FLOW, flow("not-kept-here", ["acme"]));
      await write(cwd, CONNECTION, connection("acme"));

      await failure(cwd);

      expect(takeReportedWarnings().join("\n")).toContain(
        `${FLOW}: could not tell which local schema this flow pins`,
      );
    });

    it("does not warn about a flow that offers no provider", async ({ dir: cwd }) => {
      await write(cwd, FLOW, flow("not-kept-here", []));

      await failure(cwd);

      expect(takeReportedWarnings()).toEqual([]);
    });
  });
});
