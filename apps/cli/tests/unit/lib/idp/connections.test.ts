import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../src/lib/errors";
import {
  type ConnectionFile,
  IDPS_DIR,
  planConnection,
  readConnectionFiles,
} from "../../../../src/lib/idp";

const googleBody = (over: Record<string, unknown> = {}) => ({
  slug: "google",
  protocol: "oidc",
  template: "google",
  display_name: "Google",
  oidc: {
    issuer: "https://accounts.google.com",
    client_id: "111.apps.googleusercontent.com",
    client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
    scopes: ["openid"],
  },
  ...over,
});

const file = (name: string, body: Record<string, unknown>): ConnectionFile => ({
  name,
  path: `${IDPS_DIR}/${name}`,
  body,
});

async function project(files: Record<string, unknown>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-idp-conn-"));
  await mkdir(join(cwd, IDPS_DIR), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(cwd, IDPS_DIR, name), JSON.stringify(body), "utf8");
  }
  return cwd;
}

describe("readConnectionFiles", () => {
  it("reads nothing when the project has no idps directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-idp-empty-"));
    expect(await readConnectionFiles(cwd)).toEqual([]);
  });

  it("returns each file with the name needed to report it, in a stable order", async () => {
    const cwd = await project({ "zeta.json": googleBody(), "alpha.json": googleBody() });
    const files = await readConnectionFiles(cwd);
    expect(files.map((f) => f.name)).toEqual(["alpha.json", "zeta.json"]);
    expect(files[0]?.path).toBe(`${IDPS_DIR}/alpha.json`);
  });

  it("names the file that fails to parse", async () => {
    const cwd = await project({});
    await writeFile(join(cwd, IDPS_DIR, "broken.json"), "{not json", "utf8");
    await expect(readConnectionFiles(cwd)).rejects.toThrow(/broken\.json is not valid JSON/);
  });
});

describe("planConnection", () => {
  it("creates google.json when the project has no google connection", () => {
    const plan = planConnection({ provider: "google", files: [] });
    expect(plan).toEqual({ action: "create", name: "google.json", path: `${IDPS_DIR}/google.json`, slug: "google" });
  });

  it("reuses an existing google connection rather than adding a second", () => {
    const existing = file("google.json", googleBody());
    const plan = planConnection({ provider: "google", files: [existing] });
    expect(plan).toMatchObject({ action: "reuse", slug: "google" });
  });

  it("recognises the provider by its issuer even when the template was removed", () => {
    const existing = file("corp.json", googleBody({ template: undefined, slug: "corp" }));
    expect(planConnection({ provider: "google", files: [existing] })).toMatchObject({
      action: "reuse",
      slug: "corp",
    });
  });

  it("ignores connections for other providers", () => {
    const other = file("okta.json", {
      slug: "okta",
      template: "okta",
      oidc: { issuer: "https://acme.okta.com" },
    });
    expect(planConnection({ provider: "google", files: [other] })).toMatchObject({ action: "create" });
  });

  it("stops and names the candidates when two google connections exist", () => {
    const files = [file("google.json", googleBody()), file("google-work.json", googleBody({ slug: "google_work" }))];
    try {
      planConnection({ provider: "google", files });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ZitadelError);
      expect((error as ZitadelError).code).toBe("E_CONFLICT");
      expect((error as ZitadelError).message).toContain("google.json");
      expect((error as ZitadelError).message).toContain("google-work.json");
    }
  });

  it("stops when the supplied client id is not the one already configured", () => {
    const existing = file("google.json", googleBody());
    try {
      planConnection({ provider: "google", files: [existing], clientId: "999.apps.googleusercontent.com" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ZitadelError).code).toBe("E_VALIDATION");
      expect((error as ZitadelError).message).toContain("111.apps.googleusercontent.com");
      expect((error as ZitadelError).message).toContain("999.apps.googleusercontent.com");
    }
  });

  it("reuses without complaint when the supplied client id matches", () => {
    const existing = file("google.json", googleBody());
    expect(
      planConnection({ provider: "google", files: [existing], clientId: "111.apps.googleusercontent.com" }),
    ).toMatchObject({ action: "reuse" });
  });

  it("refuses to overwrite an unrelated file already called google.json", () => {
    const squatter = file("google.json", { slug: "google", template: "okta", oidc: { issuer: "https://acme.okta.com" } });
    try {
      planConnection({ provider: "google", files: [squatter] });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ZitadelError).code).toBe("E_CONFLICT");
      expect((error as ZitadelError).message).toContain("not a Google connection");
    }
  });

  it("rejects a provider the catalog does not know", () => {
    expect(() => planConnection({ provider: "okta", files: [] })).toThrow(/unknown identity provider/);
  });
});
