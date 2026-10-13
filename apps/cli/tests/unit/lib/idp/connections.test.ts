import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ProviderSelection, Scopes } from "@zitadel/config/idp";

import { ZitadelError } from "../../../../src/lib/errors";
import { clientId, displayName, googleSelection, issuer, slug } from "../../../helpers/idp-values";
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

describe("readConnectionFiles with a file that is not JSON", () => {
  it("does not repeat the text of the file in the error", async () => {
    const cwd = await project({});
    await writeFile(join(cwd, IDPS_DIR, "broken.json"), '{"client_secret": GOCSPX-leaked}', "utf8");

    const error = await readConnectionFiles(cwd).catch((err: unknown) => err);

    expect(JSON.stringify((error as { details?: unknown }).details)).not.toContain("GOCSPX-leaked");
  });
});

describe("credentialVariablesOf", () => {
  it("reads what the file references, and derives nothing without a slug", () => {
    const bare = file("x.json", { oidc: { issuer: "https://x.example" } });

    expect(credentialVariablesOf(bare, undefined)).toEqual({
      clientId: undefined,
      clientSecret: undefined,
    });
  });

  it("falls back to the derived names for a field the file leaves out", () => {
    const bare = file("x.json", { oidc: { issuer: "https://x.example" } });

    expect(credentialVariablesOf(bare, slug("acme"))).toEqual({
      clientId: "ACME_CLIENT_ID",
      clientSecret: "ACME_CLIENT_SECRET",
    });
  });
});

describe("planConnection", () => {
  it("still checks the variables a file with an unusable slug references", () => {
    const okta = file("okta.json", {
      slug: "Okta",
      oidc: {
        issuer: "https://acme.okta.com",
        client_id: "${{ OKTA_CLIENT_ID }}",
        client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
      },
    });

    expect(() => planConnection({ selection: googleSelection, files: [okta] })).toThrow(
      expect.objectContaining({ code: "E_CONFLICT" }),
    );
  });

  it("says when a hand-written connection already uses the provider's issuer under another slug", () => {
    const other = file(
      "google-work.json",
      googleBody({ slug: "google-work", template: undefined }),
    );

    expect(
      planConnection({
        selection: googleSelection,
        files: [
          {
            ...other,
            body: {
              ...other.body,
              oidc: {
                issuer: "https://accounts.google.com",
                client_id: "${{ WORK_CLIENT_ID }}",
                client_secret: "${{ WORK_CLIENT_SECRET }}",
              },
            },
          },
        ],
      }),
    ).toMatchObject({ action: "create", alsoUsesIssuer: [`${IDPS_DIR}/google-work.json`] });
  });

  it("creates google.json when the project has no google connection", () => {
    const plan = planConnection({ selection: googleSelection, files: [] });
    expect(plan).toEqual({
      action: "create",
      name: "google.json",
      path: `${IDPS_DIR}/google.json`,
      slug: "google",
    });
  });

  it("reuses an existing google connection rather than adding a second", () => {
    const existing = file("google.json", googleBody());
    const plan = planConnection({ selection: googleSelection, files: [existing] });
    expect(plan).toMatchObject({ action: "reuse", slug: "google" });
  });

  it("recognises the provider by its slug and issuer even when the template was removed", () => {
    const existing = file("google.json", googleBody({ template: undefined }));
    expect(planConnection({ selection: googleSelection, files: [existing] })).toMatchObject({
      action: "reuse",
      slug: "google",
    });
  });

  it("does not claim a custom connection that points at the provider's issuer", () => {
    const custom = file("corp.json", {
      slug: "corp",
      oidc: {
        issuer: "https://accounts.google.com",
        client_id: "${{ CORP_CLIENT_ID }}",
        client_secret: "${{ CORP_CLIENT_SECRET }}",
      },
    });
    expect(planConnection({ selection: googleSelection, files: [custom] })).toMatchObject({
      action: "create",
      slug: "google",
    });
  });

  it("ignores connections for other providers", () => {
    const other = file("okta.json", {
      slug: "okta",
      template: "okta",
      oidc: { issuer: "https://acme.okta.com" },
    });
    expect(planConnection({ selection: googleSelection, files: [other] })).toMatchObject({
      action: "create",
    });
  });

  it("stops and names the candidates when two google connections exist", () => {
    const files = [
      file("google.json", googleBody()),
      file("google-work.json", googleBody({ slug: "google_work" })),
    ];
    try {
      planConnection({ selection: googleSelection, files });
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
        selection: googleSelection,
        files: [existing],
        clientId: clientId("999.apps.googleusercontent.com"),
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
        selection: googleSelection,
        files: [existing],
        clientId: clientId("111.apps.googleusercontent.com"),
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
      planConnection({ selection: googleSelection, files: [squatter] });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ZitadelError).code).toBe("E_CONFLICT");
      expect((error as ZitadelError).message).toContain("already exists");
    }
  });

  it("refuses two slugs whose credentials would land in one variable", () => {
    // A slug may hold `-` or `_`, and both become `_` in a variable name, so
    // `google-work` and `google_work` share GOOGLE_WORK_CLIENT_SECRET. The
    // second connection would then sign in with the first's application.
    const existing = file("google-work.json", googleBody({ slug: "google-work" }));
    const reused = file("google_work.json", googleBody({ slug: "google_work" }));

    expect(() => planConnection({ selection: googleSelection, files: [existing, reused] })).toThrow(
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

    expect(() => planConnection({ selection: googleSelection, files: [okta] })).toThrow(
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

    expect(() => planConnection({ selection: googleSelection, files: [both] })).toThrow(
      /both credentials at GOOGLE_CLIENT_SECRET/,
    );
  });

  it("refuses a matched connection that declares no slug", () => {
    // It matches on template, so it is the Google connection; but the schema
    // and flows reference a provider by slug, and inventing one would point
    // them at an identity the file does not declare.
    const { slug: _dropped, ...body } = googleBody();
    const noSlug = file("google.json", body as Record<string, unknown>);

    expect(() => planConnection({ selection: googleSelection, files: [noSlug] })).toThrow(
      /no usable slug/,
    );
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

    expect(credentialVariablesOf(literal, slug("google"))).toEqual({
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

    expect(planConnection({ selection: googleSelection, files: [literal] })).toMatchObject({
      action: "reuse",
    });
  });

  it("still names the scaffolded variable when the field is absent", () => {
    const { oidc: _oidc, ...rest } = googleBody();
    const bare = file("google.json", { ...rest, oidc: { issuer: "https://accounts.google.com" } });

    expect(credentialVariablesOf(bare, slug("google"))).toEqual({
      clientId: "GOOGLE_CLIENT_ID",
      clientSecret: "GOOGLE_CLIENT_SECRET",
    });
  });

  it("does not mistake a connection for colliding with itself", () => {
    const only = file("google.json", googleBody({ slug: "google" }));

    expect(planConnection({ selection: googleSelection, files: [only] })).toMatchObject({
      action: "reuse",
      slug: "google",
    });
  });
});

describe("planConnection for a custom connection", () => {
  const acme = {
    slug: slug("acme-sso"),
    displayName: displayName("Acme SSO"),
    issuer: issuer("https://sso.acme.example"),
    scopes: ["openid", "profile", "email"] as Scopes,
  };
  const custom = (connection: typeof acme): ProviderSelection => ({ kind: "custom", connection });
  const acmeBody = (over: Record<string, unknown> = {}) => ({
    slug: "acme-sso",
    protocol: "oidc",
    display_name: "Acme SSO",
    oidc: {
      issuer: "https://sso.acme.example",
      client_id: "${{ ACME_SSO_CLIENT_ID }}",
      client_secret: "${{ ACME_SSO_CLIENT_SECRET }}",
      scopes: ["openid", "profile", "email"],
    },
    ...over,
  });

  it("creates a file named after the slug when nothing holds it", () => {
    expect(planConnection({ selection: custom(acme), files: [] })).toEqual({
      action: "create",
      name: "acme-sso.json",
      path: `${IDPS_DIR}/acme-sso.json`,
      slug: "acme-sso",
    });
  });

  it("creates a second connection to an issuer another connection already uses", () => {
    const existing = file(
      "acme-staff.json",
      acmeBody({
        slug: "acme-staff",
        oidc: {
          ...acmeBody().oidc,
          client_id: "${{ ACME_STAFF_CLIENT_ID }}",
          client_secret: "${{ ACME_STAFF_CLIENT_SECRET }}",
        },
      }),
    );

    expect(planConnection({ selection: custom(acme), files: [existing] })).toMatchObject({
      action: "create",
      slug: "acme-sso",
    });
  });

  it("is not confused by a catalog connection to the same issuer", () => {
    const google = file("google.json", googleBody());
    const input = { ...acme, issuer: issuer("https://accounts.google.com") };

    expect(planConnection({ selection: custom(input), files: [google] })).toMatchObject({
      action: "create",
      slug: "acme-sso",
    });
  });

  it("reuses the connection that already has this slug and issuer", () => {
    const existing = file("acme-sso.json", acmeBody());

    expect(planConnection({ selection: custom(acme), files: [existing] })).toEqual({
      action: "reuse",
      file: existing,
      slug: "acme-sso",
    });
  });

  it("finds the connection by its slug even when the file was renamed", () => {
    const existing = file("sso.json", acmeBody());

    expect(planConnection({ selection: custom(acme), files: [existing] })).toMatchObject({
      action: "reuse",
      slug: "acme-sso",
    });
  });

  it("reuses the file but says the scopes that were given and not applied", () => {
    const existing = file("acme-sso.json", acmeBody());
    const input = { ...acme, scopes: ["openid", "groups"] as Scopes };

    expect(
      planConnection({ selection: custom(input), files: [existing], scopesGiven: true }),
    ).toMatchObject({ action: "reuse", notApplied: ["scopes"] });
  });

  it("says nothing about scopes that were left to their default", () => {
    const existing = file("acme-sso.json", acmeBody());
    const input = { ...acme, scopes: ["openid", "groups"] as Scopes };

    expect(planConnection({ selection: custom(input), files: [existing] })).not.toHaveProperty(
      "notApplied",
    );
  });

  it("always says a display name that differs, because it is always given", () => {
    const existing = file("acme-sso.json", acmeBody({ display_name: "Old name" }));

    expect(planConnection({ selection: custom(acme), files: [existing] })).toMatchObject({
      action: "reuse",
      notApplied: ["display name"],
    });
  });

  it("finds the file that holds the slug even when the file spells it with spaces", () => {
    const existing = file("acme-sso.json", acmeBody({ slug: " acme-sso " }));

    expect(planConnection({ selection: custom(acme), files: [existing] })).toMatchObject({
      action: "reuse",
    });
  });

  it("takes a trailing slash for a different issuer, as the server does", () => {
    const existing = file("acme-sso.json", acmeBody());
    const input = { ...acme, issuer: issuer("https://sso.acme.example/") };

    expect(() => planConnection({ selection: custom(input), files: [existing] })).toThrow(
      expect.objectContaining({ code: "E_CONFLICT" }),
    );
  });

  it("points a refused issuer at a new slug, because an applied connection keeps its issuer", () => {
    const existing = file("acme-sso.json", acmeBody());
    const input = { ...acme, issuer: issuer("https://sso.other.example") };

    expect(() => planConnection({ selection: custom(input), files: [existing] })).toThrow(
      expect.objectContaining({ hint: expect.stringContaining("another --slug") }),
    );
  });

  it("stops when the slug belongs to a connection to another issuer", () => {
    const existing = file("acme-sso.json", acmeBody());
    const input = { ...acme, issuer: issuer("https://sso.other.example") };

    expect(() => planConnection({ selection: custom(input), files: [existing] })).toThrow(
      /already named acme-sso and connects to https:\/\/sso\.acme\.example/,
    );
  });

  it("stops when the slug belongs to a connection that is not OIDC", () => {
    const existing = file("acme-sso.json", { slug: "acme-sso", protocol: "oauth2" });

    expect(() => planConnection({ selection: custom(acme), files: [existing] })).toThrow(
      /not an OIDC connection/,
    );
  });

  it("refuses an unrelated file already sitting where the connection would go", () => {
    const occupied = file("acme-sso.json", acmeBody({ slug: "something-else" }));

    expect(() => planConnection({ selection: custom(acme), files: [occupied] })).toThrow(
      /acme-sso\.json already exists and is not the acme-sso connection/,
    );
  });

  it("stops when two files claim the slug", () => {
    const files = [file("a.json", acmeBody()), file("b.json", acmeBody())];

    expect(() => planConnection({ selection: custom(acme), files })).toThrow(
      /More than one connection is named acme-sso/,
    );
  });

  it("stops when the supplied client id is not the literal one already configured", () => {
    const existing = file(
      "acme-sso.json",
      acmeBody({ oidc: { ...acmeBody().oidc, client_id: "literal-id" } }),
    );

    expect(() =>
      planConnection({
        selection: custom(acme),
        files: [existing],
        clientId: clientId("another-id"),
      }),
    ).toThrow(/already uses client id literal-id/);
  });

  it("refuses a new slug whose credentials would land in a variable another connection uses", () => {
    // `acme_sso` and `acme-sso` both derive ACME_SSO_CLIENT_ID.
    const existing = file("acme_sso.json", acmeBody({ slug: "acme_sso" }));

    expect(() => planConnection({ selection: custom(acme), files: [existing] })).toThrow(
      /both use ACME_SSO_CLIENT_ID/,
    );
  });

  it("refuses to take over a variable a hand-edited connection points at", () => {
    const existing = file(
      "okta.json",
      acmeBody({
        slug: "okta",
        oidc: {
          ...acmeBody().oidc,
          client_id: "${{ OKTA_CLIENT_ID }}",
          client_secret: "${{ ACME_SSO_CLIENT_SECRET }}",
        },
      }),
    );

    expect(() => planConnection({ selection: custom(acme), files: [existing] })).toThrow(
      /okta\.json and acme-sso both use ACME_SSO_CLIENT_SECRET/,
    );
  });

  it("reads the credentials a reused connection actually references", () => {
    const existing = file(
      "acme-sso.json",
      acmeBody({ oidc: { ...acmeBody().oidc, client_secret: "${{ ACME_SECRET }}" } }),
    );
    const plan = planConnection({ selection: custom(acme), files: [existing] });

    expect(plan.action).toBe("reuse");
    if (plan.action === "reuse") {
      expect(credentialVariablesOf(plan.file, plan.slug).clientSecret).toBe("ACME_SECRET");
    }
  });
});
