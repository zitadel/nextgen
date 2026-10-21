import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderPlanSummary } from "../../../../src/lib/sync/plan-summary";
import type { ResourceSyncer, SyncAction } from "../../../../src/lib/sync/types";

function syncer(kind: string): ResourceSyncer {
  return {
    kind,
    directory: kind,
    mutable: false,
    revisioned: false,
    validate() {
      /* no-op */
    },
    async create() {
      return { id: "id" };
    },
    async update() {
      return {};
    },
    async delete() {
      /* no-op */
    },
  } as ResourceSyncer;
}

const create = (kind: string, path: string): SyncAction => ({
  kind: "create",
  path,
  syncer: syncer(kind),
  content: {},
  hash: "h",
});

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "plan-summary-"));
  await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("the plan summary", () => {
  it("says nothing when the plan changes nothing", async () => {
    const skip = { kind: "skip", path: "a", syncer: syncer("schema") } as unknown as SyncAction;

    expect(await renderPlanSummary(cwd, [skip])).toBeUndefined();
  });

  it("lists each change with what it does and the file it is in", async () => {
    const summary = await renderPlanSummary(cwd, [create("schema", ".zitadel/schemas/a.json")]);

    expect(summary).toContain("Plan summary");
    expect(summary).toMatch(/\+ create\s+schema\s+\.zitadel\/schemas\/a\.json/);
  });

  it("shows what a connection it creates maps, apart from what verifies it", async () => {
    await writeFile(
      join(cwd, ".zitadel/idps/acme.json"),
      JSON.stringify({
        display_name: "Acme",
        claim_mapping: { email: "email" },
        verified_claims: { email: "email_verified" },
        oidc: { scopes: ["openid", "email"], client_secret: "${{ ACME_CLIENT_SECRET }}" },
      }),
    );

    const summary = await renderPlanSummary(cwd, [create("idp", ".zitadel/idps/acme.json")]);

    expect(summary).toContain("SIGN IN WITH ACME");
    expect(summary).toMatch(/email\s+→\s+email\b/);
    expect(summary).toMatch(/Verified when[^\n]*\n[^\n]*email\s+→\s+email_verified/);
    expect(summary).toContain("Scopes: openid email");
  });

  it.each([
    ["update", { kind: "update", id: "idp_1" }],
    ["revision", { kind: "revise", previousId: "idp_1" }],
  ])("shows what a connection it %ss maps", async (_name, action) => {
    await writeFile(
      join(cwd, ".zitadel/idps/acme.json"),
      JSON.stringify({ display_name: "Acme", claim_mapping: { email: "mail" } }),
    );
    const change = {
      path: ".zitadel/idps/acme.json",
      syncer: syncer("idp"),
      content: {},
      hash: "h",
      ...action,
    } as unknown as SyncAction;

    const summary = await renderPlanSummary(cwd, [change]);

    expect(summary).toContain("SIGN IN WITH ACME");
    expect(summary).toMatch(/email\s+→\s+mail/);
  });

  it("shows what a moved connection maps, read from its new file", async () => {
    await writeFile(
      join(cwd, ".zitadel/idps/new.json"),
      JSON.stringify({ display_name: "Renamed", claim_mapping: { email: "mail" } }),
    );
    const move = {
      ...create("idp", ".zitadel/idps/new.json"),
      movedFrom: ".zitadel/idps/old.json",
    } as SyncAction;

    const summary = await renderPlanSummary(cwd, [move]);

    expect(summary).toContain("→ move");
    expect(summary).toContain("SIGN IN WITH RENAMED");
  });

  it("names a connection with no display name after its file", async () => {
    await writeFile(
      join(cwd, ".zitadel/idps/acme-sso.json"),
      JSON.stringify({ claim_mapping: { email: "mail" } }),
    );

    const summary = await renderPlanSummary(cwd, [create("idp", ".zitadel/idps/acme-sso.json")]);

    expect(summary).toContain("SIGN IN WITH ACME-SSO");
    expect(summary).not.toContain(".JSON");
  });

  it("never shows the client secret", async () => {
    await writeFile(
      join(cwd, ".zitadel/idps/acme.json"),
      JSON.stringify({
        display_name: "Acme",
        claim_mapping: { email: "email" },
        oidc: { client_secret: "${{ ACME_CLIENT_SECRET }}" },
      }),
    );

    const summary = await renderPlanSummary(cwd, [create("idp", ".zitadel/idps/acme.json")]);

    expect(summary).not.toContain("ACME_CLIENT_SECRET");
  });

  it("skips a connection file that cannot be read", async () => {
    const summary = await renderPlanSummary(cwd, [create("idp", ".zitadel/idps/missing.json")]);

    expect(summary).not.toContain("SIGN IN WITH");
  });

  it("skips a connection file that is not a JSON object", async () => {
    await writeFile(join(cwd, ".zitadel/idps/list.json"), "[]");

    const summary = await renderPlanSummary(cwd, [create("idp", ".zitadel/idps/list.json")]);

    expect(summary).not.toContain("SIGN IN WITH");
  });

  it("does not describe a connection the plan deletes", async () => {
    await writeFile(
      join(cwd, ".zitadel/idps/acme.json"),
      JSON.stringify({ display_name: "Acme", claim_mapping: { email: "email" } }),
    );
    const remove = {
      kind: "delete",
      path: ".zitadel/idps/acme.json",
      id: "idp_1",
      syncer: syncer("idp"),
    } as unknown as SyncAction;

    const summary = await renderPlanSummary(cwd, [remove]);

    expect(summary).toMatch(/- delete\s+idp/);
    expect(summary).not.toContain("SIGN IN WITH");
  });
});
