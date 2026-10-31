import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../../src/lib/errors";
import { validateSsoConsistency } from "../../../../../src/lib/release/steps/sso-consistency";
import type { SuggestedCommand } from "../../../../../src/lib/suggestion";
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

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "sso-consistency-"));
  takeReportedWarnings();
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function write(path: string, body: object): Promise<void> {
  await mkdir(join(cwd, path, ".."), { recursive: true });
  await writeFile(join(cwd, path), JSON.stringify(body));
}

/** Stands in for the command's own `suggest`, which adds the run's scope flags. */
const suggest = (args: string) => `zitadel ${args}` as SuggestedCommand;

async function failure(): Promise<ZitadelError | undefined> {
  try {
    await validateSsoConsistency(cwd, suggest);
  } catch (error) {
    expect(error).toBeInstanceOf(ZitadelError);
    return error as ZitadelError;
  }
  return undefined;
}

describe("validateSsoConsistency", () => {
  it("accepts a project whose files agree", async () => {
    await write(SCHEMA, schema(["acme"]));
    await write(FLOW, flow("staff", ["acme"]));
    await write(CONNECTION, connection("acme"));

    expect(await failure()).toBeUndefined();
  });

  it("accepts a project with no SSO files at all", async () => {
    expect(await failure()).toBeUndefined();
  });

  it("stops on a provider the pinned schema does not list, naming the flow file", async () => {
    await write(SCHEMA, schema(["other"]));
    await write(FLOW, flow("staff", ["acme"]));
    await write(CONNECTION, connection("acme"));

    const error = await failure();

    expect(error?.code).toBe("E_VALIDATION");
    expect(error?.message).toContain(`${FLOW}: step "identifier"`);
    expect(error?.message).toContain('"acme" is not listed in sso.providers');
  });

  it("stops on a schema that lists a provider with no connection file", async () => {
    await write(SCHEMA, schema(["acme"]));

    const error = await failure();

    expect(error?.message).toContain(SCHEMA);
  });

  it("stops on two connection files that claim one slug", async () => {
    await write(CONNECTION, connection("acme"));
    await write(".zitadel/idps/acme-copy.json", connection("acme"));

    const error = await failure();

    expect(error?.message).toContain("SSO configuration is not consistent");
  });

  it("reports every problem in one error", async () => {
    await write(SCHEMA, schema(["acme", "ghost"]));

    const error = await failure();

    expect(error?.message).toContain("(2 issues)");
  });

  it("lists each issue under details with the file as its path", async () => {
    await write(SCHEMA, schema(["acme"]));

    const error = await failure();

    const details = error?.details as { issues: Array<{ path: string; rule: string }> } | undefined;
    expect(details?.issues.map((issue) => issue.path)).toEqual([SCHEMA]);
  });

  it("says nothing was changed", async () => {
    await write(SCHEMA, schema(["acme"]));

    const error = await failure();

    expect(error?.hint).toContain("no changes were made");
  });

  it("suggests the dry run that checks the files again once they are fixed", async () => {
    await write(SCHEMA, schema(["acme"]));

    const error = await failure();

    expect(error?.nextCommands).toEqual(["zitadel deploy --dry-run"]);
  });

  describe("finding the schema a flow pins", () => {
    it("matches a flow's user_schema to a schema's objectType", async () => {
      await write(SCHEMA, schema(["other"]));
      await write(FLOW, flow("staff", ["acme"]));
      await write(CONNECTION, connection("acme"));

      expect((await failure())?.message).toContain('"acme" is not listed in sso.providers');
    });

    it("matches a flow's user_schema to a schema's $id", async () => {
      await write(SCHEMA, { ...schema(["other"]), $id: "https://schemas.example.test/staff.json" });
      await write(FLOW, flow("https://schemas.example.test/staff.json", ["acme"]));
      await write(CONNECTION, connection("acme"));

      expect((await failure())?.message).toContain('"acme" is not listed in sso.providers');
    });

    it("warns instead of failing when the pinned schema is not a local file", async () => {
      await write(FLOW, flow("not-kept-here", ["acme"]));
      await write(CONNECTION, connection("acme"));

      await failure();

      expect(takeReportedWarnings().join("\n")).toContain(
        `${FLOW}: could not tell which local schema this flow pins`,
      );
    });

    it("does not warn about a flow that offers no provider", async () => {
      await write(FLOW, flow("not-kept-here", []));

      await failure();

      expect(takeReportedWarnings()).toEqual([]);
    });
  });
});
