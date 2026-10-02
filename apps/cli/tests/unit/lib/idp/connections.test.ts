import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../src/lib/errors";
import {
  type ConnectionFile,
  IDPS_DIR,
  credentialVariablesOf,
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
    expect(plan).toEqual({
      action: "create",
      name: "google.json",
      path: `${IDPS_DIR}/google.json`,
      slug: "google",
    });
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
    expect(planConnection({ provider: "google", files: [other] })).toMatchObject({
      action: "create",
    });
  });

  it("stops and names the candidates when two google connections exist", () => {
    const files = [
      file("google.json", googleBody()),
      file("google-work.json", googleBody({ slug: "google_work" })),
    ];
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
      planConnection({
        provider: "google",
        files: [existing],
        clientId: "999.apps.googleusercontent.com",
      });
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
      planConnection({
        provider: "google",
        files: [existing],
        clientId: "111.apps.googleusercontent.com",
      }),
    ).toMatchObject({ action: "reuse" });
  });

  it("refuses to overwrite an unrelated file already called google.json", () => {
    const squatter = file("google.json", {
      slug: "google",
      template: "okta",
      oidc: { issuer: "https://acme.okta.com" },
    });
    try {
      planConnection({ provider: "google", files: [squatter] });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ZitadelError).code).toBe("E_CONFLICT");
      expect((error as ZitadelError).message).toContain("not a Google connection");
    }
  });

  it("rejects a provider the catalog does not know", () => {
    expect(() => planConnection({ provider: "okta", files: [] })).toThrow(
      /unknown identity provider/,
    );
  });

  it("refuses two slugs whose credentials would land in one variable", () => {
    // A slug may hold `-` or `_`, and both become `_` in a variable name, so
    // `google-work` and `google_work` share GOOGLE_WORK_CLIENT_SECRET. The
    // second connection would then sign in with the first's application.
    const existing = file("google-work.json", googleBody({ slug: "google-work" }));
    const reused = file("google_work.json", googleBody({ slug: "google_work" }));

    expect(() => planConnection({ provider: "google", files: [existing, reused] })).toThrow(
      /both use GOOGLE_WORK_CLIENT_SECRET|More than one Google connection/,
    );
  });

  it("reads what a hand-edited connection references, not what its slug implies", () => {
    // An okta connection pointing at GOOGLE_CLIENT_SECRET collides with
    // Google however its slug reads; deriving OKTA_CLIENT_SECRET from the
    // slug would miss it and let the google publish overwrite a variable
    // both connections consume.
    const okta = file(
      "okta.json",
      googleBody({
        slug: "okta",
        template: "oidc-generic",
        oidc: {
          issuer: "https://acme.okta.com",
          client_id: "${{ OKTA_CLIENT_ID }}",
          client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
          scopes: ["openid"],
        },
      }),
    );

    expect(() => planConnection({ provider: "google", files: [okta] })).toThrow(
      /both use GOOGLE_CLIENT_SECRET/,
    );
  });

  it("refuses a connection pointing both credentials at one variable", () => {
    // The second publish would replace the first, leaving the connection
    // holding a client id where it looks for a secret.
    const both = file(
      "google.json",
      googleBody({
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "${{ GOOGLE_CLIENT_SECRET }}",
          client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
          scopes: ["openid"],
        },
      }),
    );

    expect(() => planConnection({ provider: "google", files: [both] })).toThrow(
      /both credentials at GOOGLE_CLIENT_SECRET/,
    );
  });

  it("refuses a matched connection that declares no slug", () => {
    // It matches on template, so it is the Google connection; but the schema
    // and flows reference a provider by slug, and inventing one would point
    // them at an identity the file does not declare.
    const { slug: _dropped, ...body } = googleBody();
    const noSlug = file("google.json", body as Record<string, unknown>);

    expect(() => planConnection({ provider: "google", files: [noSlug] })).toThrow(/no slug/);
  });

  it("does not claim a variable for a literal client id", () => {
    // A literal is the value itself. Publishing to a derived name would store
    // it where the connection never looks and report it as stored, and the
    // collision guard would reserve a name this file does not use.
    const literal = file(
      "google.json",
      googleBody({
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "824.apps.googleusercontent.com",
          client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
          scopes: ["openid"],
        },
      }),
    );

    expect(credentialVariablesOf(literal, "google")).toEqual({
      clientId: undefined,
      clientSecret: "GOOGLE_CLIENT_SECRET",
    });
  });

  it("lets another connection use the name a literal-backed one does not", () => {
    // google holds its id literally, so GOOGLE_CLIENT_ID is unclaimed and a
    // second connection referencing it is not a collision.
    const literal = file(
      "google.json",
      googleBody({
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "824.apps.googleusercontent.com",
          client_secret: "${{ SOMETHING_ELSE }}",
          scopes: ["openid"],
        },
      }),
    );

    expect(planConnection({ provider: "google", files: [literal] })).toMatchObject({
      action: "reuse",
    });
  });

  it("still names the scaffolded variable when the field is absent", () => {
    const { oidc: _oidc, ...rest } = googleBody();
    const bare = file("google.json", { ...rest, oidc: { issuer: "https://accounts.google.com" } });

    expect(credentialVariablesOf(bare, "google")).toEqual({
      clientId: "GOOGLE_CLIENT_ID",
      clientSecret: "GOOGLE_CLIENT_SECRET",
    });
  });

  it("does not mistake a connection for colliding with itself", () => {
    const only = file("google.json", googleBody({ slug: "google" }));

    expect(planConnection({ provider: "google", files: [only] })).toMatchObject({
      action: "reuse",
      slug: "google",
    });
  });
});
