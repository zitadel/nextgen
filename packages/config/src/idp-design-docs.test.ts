import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

// Verification receipt for the IdP design docs (docs/design/idp/): loads the
// shipped connection and sso-auth-method schemas from
// packages/config/meta-schemas/, the example connection files and the
// scaffolded flow from docs/design/idp/schemas/, and runs the accept/reject
// matrix the docs claim was "mechanically verified". The docs lean on these
// results for security-relevant rules (verified_claims value classes,
// protocol arms, scope requirements), so the receipt must be checkable from
// the repo.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const readme = readFileSync(
  join(repoRoot, "docs/design/idp/README.md"),
  "utf8",
);
const resourceModel = readFileSync(
  join(repoRoot, "docs/design/idp/1-resource-model.md"),
  "utf8",
);
const authMethodSelection = readFileSync(
  join(repoRoot, "docs/design/idp/2-auth-method-selection.md"),
  "utf8",
);
const providerSetup = readFileSync(
  join(repoRoot, "docs/design/idp/4-cli-provider-setup.md"),
  "utf8",
);
const socialLoginFlow = readFileSync(
  join(repoRoot, "docs/design/idp/3-social-login-flow.md"),
  "utf8",
);

const schemasDir = join(repoRoot, "docs/design/idp/schemas");
const metaSchemaDir = join(repoRoot, "packages/config/meta-schemas");
const loadJson = (dir: string, name: string) =>
  JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
const connectionSchema = loadJson(metaSchemaDir, "idp-connection.json");
const googleExample = loadJson(schemasDir, "google.json");
const githubExample = loadJson(schemasDir, "github.json");
const ssoAuthMethodSchema = loadJson(metaSchemaDir, "sso-auth-method.json");

const ajv = () => new Ajv2020({ strict: false, validateFormats: false });
const validateConnection = ajv().compile(connectionSchema);
const validateSso = ajv().compile(ssoAuthMethodSchema as object);

const root = { slug: "g", display_name: "G" };
const oidcBlock = {
  issuer: "https://a",
  client_id: "c",
  client_secret_env: "S",
  scopes: ["openid"],
};
const oauth2Block = {
  authorization_endpoint: "https://a",
  token_endpoint: "https://t",
  userinfo_endpoint: "https://u",
  client_id: "c",
  client_secret_env: "S",
};
const oidc = { ...root, protocol: "oidc", oidc: oidcBlock };
const oauth2 = { ...root, protocol: "oauth2", subject_claim: "id", oauth2: oauth2Block };

/** The accept/reject matrix the docs reference. One row per documented rule. */
const connectionCases: ReadonlyArray<[string, object, boolean]> = [
  // baselines
  ["oidc via discovery", oidc, true],
  ["oauth2 with explicit endpoints", oauth2, true],
  ["scaffolded $schema editor pointer", { ...oidc, $schema: "../meta/idp-connection.json" }, true],
  [
    "legacy OIDC with manual endpoint overrides",
    {
      ...root,
      protocol: "oidc",
      oidc: {
        ...oidcBlock,
        authorization_endpoint: "https://a",
        token_endpoint: "https://t",
        userinfo_endpoint: "https://u",
        jwks_uri: "https://j",
      },
    },
    true,
  ],
  // protocol arms
  ["missing protocol entirely", { ...root, oidc: oidcBlock }, false],
  ["oidc without its block", { ...root, protocol: "oidc" }, false],
  ["oidc carrying an oauth2 block", { ...oidc, oauth2: oauth2Block }, false],
  ["oauth2 carrying an oidc block", { ...oauth2, oidc: oidcBlock }, false],
  ["issuer at root (flat shape)", { ...oidc, issuer: "https://a" }, false],
  ["oidc missing issuer", { ...root, protocol: "oidc", oidc: { ...oidcBlock, issuer: undefined } }, false],
  ["oauth2 missing an endpoint", { ...oauth2, oauth2: { ...oauth2Block, token_endpoint: undefined } }, false],
  ["oauth2 without subject_claim", { ...root, protocol: "oauth2", oauth2: oauth2Block }, false],
  // credentials
  ["oidc missing client_id", { ...root, protocol: "oidc", oidc: { ...oidcBlock, client_id: undefined } }, false],
  ["oidc missing client_secret_env", { ...root, protocol: "oidc", oidc: { ...oidcBlock, client_secret_env: undefined } }, false],
  ["literal client_secret in block", { ...root, protocol: "oidc", oidc: { ...oidcBlock, client_secret: "leak" } }, false],
  ["camelCase leftover (clientId)", { ...root, protocol: "oidc", oidc: { ...oidcBlock, client_id: undefined, clientId: "c" } }, false],
  ["secret_strategy not shipped", { ...root, protocol: "oidc", oidc: { ...oidcBlock, secret_strategy: "static" } }, false],
  ["token_endpoint_auth_method post", { ...root, protocol: "oidc", oidc: { ...oidcBlock, token_endpoint_auth_method: "client_secret_post" } }, true],
  ["token_endpoint_auth_method unknown", { ...root, protocol: "oidc", oidc: { ...oidcBlock, token_endpoint_auth_method: "client_secret_jwt" } }, false],
  ["response_mode cut from 851 (returns with Apple)", { ...root, protocol: "oidc", oidc: { ...oidcBlock, response_mode: "form_post" } }, false],
  ["dynamic_authorize_parameters cut from 851", { ...root, protocol: "oidc", oidc: { ...oidcBlock, dynamic_authorize_parameters: { login_hint: "email" } } }, false],
  // reserved authorize parameters (engine-owned; propertyNames guard)
  ["static param prompt allowed", { ...root, protocol: "oidc", oidc: { ...oidcBlock, static_authorize_parameters: { prompt: "select_account" } } }, true],
  ["static param reserved (state)", { ...root, protocol: "oidc", oidc: { ...oidcBlock, static_authorize_parameters: { state: "x" } } }, false],
  ["static param reserved (redirect_uri)", { ...oauth2, oauth2: { ...oauth2Block, static_authorize_parameters: { redirect_uri: "https://evil.example" } } }, false],
  ["static param client_secret", { ...root, protocol: "oidc", oidc: { ...oidcBlock, static_authorize_parameters: { client_secret: "leak" } } }, false],
  ["static param client_assertion", { ...oauth2, oauth2: { ...oauth2Block, static_authorize_parameters: { client_assertion: "eyJhbGc" } } }, false],
  // TLS on endpoint URLs (pattern; localhost carve-out for dev)
  ["http issuer rejected", { ...root, protocol: "oidc", oidc: { ...oidcBlock, issuer: "http://accounts.google.com" } }, false],
  ["http localhost issuer allowed (dev)", { ...root, protocol: "oidc", oidc: { ...oidcBlock, issuer: "http://localhost:8080" } }, true],
  ["http token_endpoint rejected", { ...oauth2, oauth2: { ...oauth2Block, token_endpoint: "http://t.example" } }, false],
  // scopes
  ["oidc scopes absent", { ...root, protocol: "oidc", oidc: { ...oidcBlock, scopes: undefined } }, false],
  ["oidc scopes empty", { ...root, protocol: "oidc", oidc: { ...oidcBlock, scopes: [] } }, false],
  ["oidc scopes without openid", { ...root, protocol: "oidc", oidc: { ...oidcBlock, scopes: ["profile"] } }, false],
  // strategy contract projections
  [
    "github strategy with user:email",
    { ...oauth2, oauth2: { ...oauth2Block, scopes: ["user:email"], supplementary_fetch: "github_primary_email" } },
    true,
  ],
  [
    "github strategy without user:email",
    { ...oauth2, oauth2: { ...oauth2Block, supplementary_fetch: "github_primary_email" } },
    false,
  ],
  [
    "strategy on oidc (field absent from the block)",
    { ...root, protocol: "oidc", oidc: { ...oidcBlock, supplementary_fetch: "github_primary_email" } },
    false,
  ],
  [
    "unknown strategy name (closed enum)",
    { ...oauth2, oauth2: { ...oauth2Block, scopes: ["user:email"], supplementary_fetch: "future_thing" } },
    false,
  ],
  // provisioning (linking policy deferred with the account-linking journey)
  ["creation auto (default)", { ...oidc, provisioning: { creation: "auto" } }, true],
  ["creation disabled", { ...oidc, provisioning: { creation: "disabled" } }, true],
  ["creation auto_only (deferred — no fail-closed branch in 851)", { ...oidc, provisioning: { creation: "auto_only" } }, false],
  ["creation collect (not planned)", { ...oidc, provisioning: { creation: "collect" } }, false],
  ["is_creation_allowed (replaced by creation)", { ...oidc, provisioning: { is_creation_allowed: true } }, false],
  ["is_auto_creation (replaced by creation)", { ...oidc, provisioning: { is_auto_creation: true } }, false],
  ["auto_linking (deferred — no linking in 851)", { ...oidc, provisioning: { auto_linking: "never" } }, false],
  ["is_linking_allowed (deferred)", { ...oidc, provisioning: { is_linking_allowed: true } }, false],
  ["is_auto_update (deferred — awaits per-property verification state)", { ...oidc, provisioning: { is_auto_update: false } }, false],
  ["unknown provisioning flag", { ...oidc, provisioning: { is_magic: true } }, false],
  ["default_schema (dropped field)", { ...oidc, provisioning: { default_schema: "user-human" } }, false],
  [
    "$supplementary_fetch coverage on the GitHub shape",
    {
      ...oauth2,
      verified_claims: { email: "$supplementary_fetch" },
      oauth2: { ...oauth2Block, scopes: ["user:email"], supplementary_fetch: "github_primary_email" },
    },
    true,
  ],
  // verified_claims value classes
  ["verified_claims literal true accepted (Entra trust)", { ...oidc, verified_claims: { email: true } }, true],
  ["verified_claims false rejected", { ...oidc, verified_claims: { email: false } }, false],
  ["verified_claims number rejected", { ...oidc, verified_claims: { email: 42 } }, false],
  ["verified_claims $-typo rejected", { ...oidc, verified_claims: { email: "$strateggy" } }, false],
  ["old $strategy sentinel rejected", { ...oidc, verified_claims: { email: "$strategy" } }, false],
  // claim_mapping value classes: plain string = exact top-level claim key;
  // $-strings and non-strings are reserved for future mapping forms
  ["claim_mapping dotted value accepted (dot is part of the key)", { ...oidc, claim_mapping: { email: "plan.name" } }, true],
  ["claim_mapping $-value rejected (reserved)", { ...oidc, claim_mapping: { email: "$expr" } }, false],
  ["claim_mapping object value rejected (reserved)", { ...oidc, claim_mapping: { email: { expr: "login" } } }, false],
  // slug bounds (pattern + maxLength) and the documented pkce opt-out
  ["slug uppercase rejected", { ...oidc, slug: "Google" }, false],
  ["slug over 64 chars rejected", { ...oidc, slug: "a".repeat(65) }, false],
  ["pkce_enabled false accepted (documented opt-out)", { ...oidc, oidc: { ...oidcBlock, pkce_enabled: false } }, true],
  // dropped root fields
  ["kind (dropped)", { ...oidc, kind: "idp" }, false],
  ["enabled (dropped — availability is the policy gates + runtime disable)", { ...oidc, enabled: true }, false],
  ["audience (not a connection concern)", { ...oidc, audience: { team_ids: ["t"] } }, false],
  ["typo at root", { ...oidc, slugg: "x" }, false],
];

describe("idp connection schema (docs/design/idp/1-resource-model.md)", () => {
  it.each(connectionCases)("%s", (_name, doc, expected) => {
    expect(validateConnection(JSON.parse(JSON.stringify(doc)))).toBe(expected);
  });

  it("accepts both scaffolded example files verbatim", () => {
    expect(validateConnection(googleExample)).toBe(true);
    expect(validateConnection(githubExample)).toBe(true);
  });
});

describe("sso-auth-method schema (docs/design/idp/2-auth-method-selection.md)", () => {
  it.each<[string, object, boolean]>([
    ["enabled with providers", { enabled: true, providers: ["google"] }, true],
    ["disabled alone (migration)", { enabled: false }, true],
    ["disabled with list (rejected)", { enabled: false, providers: ["google"] }, false],
    ["enabled without providers", { enabled: true }, false],
    ["enabled with empty providers", { enabled: true, providers: [] }, false],
    ["providers without enabled", { providers: ["google"] }, false],
    ["uppercase slug", { enabled: true, providers: ["Google"] }, false],
    ["duplicate slugs", { enabled: true, providers: ["google", "google"] }, false],
    ["unknown property", { enabled: true, providers: ["google"], extra: 1 }, false],
  ])("%s", (_name, doc, expected) => {
    expect(validateSso(doc)).toBe(expected);
  });
});

describe("x-auth-methods snippets (2-auth-method-selection.md · Decision)", () => {
  // The two most copy-able snippets in the doc, validated against the
  // shipped auth-methods.json, whose sso slot points at sso-auth-method.json.
  const shippedAuthMethod = loadJson(metaSchemaDir, "auth-method.json") as object;
  const shippedAuthMethods = loadJson(metaSchemaDir, "auth-methods.json") as {
    properties: Record<string, { $ref: string }>;
  };

  const snippets = [...authMethodSelection.matchAll(/"x-auth-methods": (\{[\s\S]*?\n\})/g)].map(
    (m) => JSON.parse(`{"x-auth-methods": ${m[1]!}}`) as Record<string, unknown>,
  );

  it("finds both schema snippets (Customers and Employees)", () => {
    expect(snippets).toHaveLength(2);
  });

  it("the sso slot is the sso-auth-method schema", () => {
    expect(shippedAuthMethods.properties["sso"]).toEqual({ $ref: "sso-auth-method.json" });
  });

  it("both validate against the shipped composite", () => {
    const composite = ajv()
      .addSchema(shippedAuthMethod, "auth-method.json")
      .addSchema(ssoAuthMethodSchema as object, "sso-auth-method.json")
      .compile(shippedAuthMethods);
    for (const snippet of snippets) {
      expect(composite(snippet["x-auth-methods"])).toBe(true);
    }
  });
});

describe("scaffolded flow (schemas/default-login.scaffold.json)", () => {
  type ScaffoldStep = {
    name: string;
    fields?: string[];
    actions?: Array<{ kind: string }>;
    on_success?: string;
    sso_providers?: string[];
    transitions?: Record<string, { target: string; action?: string; purpose?: string }>;
  };
  const flow = loadJson(schemasDir, "default-login.scaffold.json") as unknown as {
    purposes: Record<string, string>;
    steps: ScaffoldStep[];
  };
  const flowMeta = loadJson(metaSchemaDir, "flow-definition.json");

  it("validates against the shipped meta-schema", () => {
    // on_success carries create_user_with_sso and sso_providers is a slug
    // list (area 2, Rendering from the Connection).
    const validate = new Ajv2020({ strict: false, validateFormats: false, allErrors: true }).compile(
      flowMeta,
    );
    expect(validate(flow), JSON.stringify(validate.errors)).toBe(true);
  });

  it("every step carrying sso_providers routes all three outcomes", () => {
    const ssoSteps = flow.steps.filter((s) => s.sso_providers);
    expect(ssoSteps.map((s) => s.name)).toEqual(["identifier", "register", "sso-conflict"]);
    for (const step of ssoSteps) {
      for (const outcome of ["callback", "identity_unknown", "user_already_exists"]) {
        expect(step.transitions?.[outcome], `${step.name} routes ${outcome}`).toBeDefined();
      }
      expect(step.transitions!["identity_unknown"]!.target).toBe("register-sso");
    }
    // user_not_found stays the typed-email outcome with the shipped target.
    expect(ssoSteps[0]!.transitions!["user_not_found"]).toEqual({ target: "register" });
    expect(ssoSteps[1]!.transitions!["user_not_found"]).toBeUndefined();
  });

  it("both firing points reach sso-conflict, whose sign-in re-purposes to login's entry; no pivot anywhere", () => {
    const byName = new Map(flow.steps.map((s) => [s.name, s]));
    for (const name of ["identifier", "register", "register-password", "register-sso"]) {
      expect(byName.get(name)!.transitions!["user_already_exists"]!.target).toBe("sso-conflict");
    }
    expect(byName.get("register-sso")!.on_success).toBe("create_user_with_sso");
    expect(byName.get("sso-conflict")!.transitions!["sign_in"]).toEqual({
      target: flow.purposes["login"],
      purpose: "login",
    });
    // One-step recovery for every account type: password field, passkey
    // action, and the provider buttons all sit on the conflict step itself.
    expect(byName.get("sso-conflict")!.fields).toEqual(["x-auth-methods#password"]);
    expect(byName.get("sso-conflict")!.actions?.map((a) => a.kind)).toEqual(["submit", "passkey", "navigate"]);
    expect(byName.get("sso-conflict")!.transitions!["user_already_exists"]!.target).toBe("sso-conflict");
    for (const step of flow.steps) {
      for (const t of Object.values(step.transitions ?? {})) {
        expect(t.action).not.toBe("pivot");
      }
    }
  });

  it("provider ids reference area 1's connection slug", () => {
    const ids = flow.steps.flatMap((s) => s.sso_providers ?? []);
    expect(ids).toEqual(["google", "google", "google"]);
    expect((googleExample as { slug: string }).slug).toBe("google");
  });

  it("reversing the SSO deltas yields the shipped default exactly", () => {
    // Reversing the deltas area 4 documents must reproduce
    // packages/config/defaults/default-login.json, so any other drift from
    // the shipped default goes red.
    const stripped = JSON.parse(JSON.stringify(flow)) as typeof flow;
    stripped.steps = stripped.steps.filter(
      (s) => s.name !== "register-sso" && s.name !== "sso-conflict",
    );
    for (const step of stripped.steps) delete step.sso_providers;
    const byName = new Map(stripped.steps.map((s) => [s.name, s]));
    for (const name of ["identifier", "register"]) {
      for (const outcome of ["callback", "identity_unknown", "user_already_exists"]) {
        delete byName.get(name)!.transitions![outcome];
      }
    }
    for (const name of ["register", "register-password"]) {
      byName.get(name)!.transitions!["user_already_exists"] = { target: "password" };
    }
    const shipped = JSON.parse(
      readFileSync(join(repoRoot, "packages/config/defaults/default-login.json"), "utf8"),
    ) as unknown;
    expect(stripped).toEqual(shipped);
  });
});

describe("forward compatibility (1-resource-model.md · Forward compatibility)", () => {
  // The documented extension paths: secret_strategy returns as a closed enum
  // with secret_params, client_secret_env relaxes from unconditional to
  // conditional, and is_auto_update returns with per-property verification
  // state. Every file valid today must stay valid.
  it("today's examples survive the post-Apple extension", () => {
    const extended = JSON.parse(JSON.stringify(connectionSchema)) as {
      properties: Record<string, { required: string[]; properties: Record<string, unknown>; allOf?: unknown[] }>;
    };
    for (const block of ["oidc", "oauth2"]) {
      const b = extended.properties[block]!;
      b.required = b.required.filter((r) => r !== "client_secret_env");
      b.properties["secret_strategy"] = { type: "string", enum: ["static", "apple_jwt"], default: "static" };
      b.properties["response_mode"] = { type: "string", enum: ["query", "form_post"], default: "query" };
      b.properties["secret_params"] = {
        type: "object",
        additionalProperties: false,
        properties: {
          team_id: { type: "string" },
          key_id: { type: "string" },
          private_key_env: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
        },
      };
      b.allOf = [
        ...(b.allOf ?? []),
        {
          if: { properties: { secret_strategy: { const: "apple_jwt" } }, required: ["secret_strategy"] },
          then: {
            required: ["secret_params"],
            properties: { secret_params: { required: ["team_id", "key_id", "private_key_env"] } },
          },
          else: { required: ["client_secret_env"] },
        },
      ];
    }
    const provisioning = extended.properties["provisioning"]!;
    provisioning.properties["is_auto_update"] = { type: "boolean", default: false };
    (provisioning.properties["creation"] as { enum: string[] }).enum.push("auto_only");
    const validateExtended = ajv().compile(extended);
    expect(validateExtended(googleExample)).toBe(true);
    expect(validateExtended(githubExample)).toBe(true);
    expect(
      validateExtended({
        ...oidc,
        provisioning: { creation: "auto_only", is_auto_update: true },
      }),
    ).toBe(true);
    expect(
      validateExtended({
        ...root,
        protocol: "oidc",
        oidc: {
          issuer: "https://appleid.apple.com",
          client_id: "c",
          scopes: ["openid"],
          response_mode: "form_post",
          secret_strategy: "apple_jwt",
          secret_params: { team_id: "T", key_id: "K", private_key_env: "APPLE_KEY" },
        },
      }),
    ).toBe(true);
    expect(
      validateExtended({
        ...root,
        protocol: "oidc",
        oidc: { ...oidcBlock, client_secret_env: undefined, secret_strategy: "apple_jwt" },
      }),
    ).toBe(false);
  });
});

describe("dialect dependency (x-verify removed in #901)", () => {
  // Doc 1's dependency note claims the dialect carries exactly x-unique,
  // x-claim, and x-audit today. Assert that against the real file, so any
  // dialect vocabulary change (an x-verify re-add included) breaks this
  // suite and forces the dependency notes in areas 1 and 3 to be revisited.
  const squash = (s: string) => s.replace(/\s+/g, " ");

  it("the dialect's x-* vocabulary matches the note in area 1", () => {
    const dialect = JSON.parse(
      readFileSync(join(repoRoot, "packages/config/meta-schemas/user-property.json"), "utf8"),
    ) as { properties: Record<string, unknown> };
    const annotations = Object.keys(dialect.properties)
      .filter((k) => k.startsWith("x-"))
      .sort();
    expect(annotations).toEqual(["x-audit", "x-claim", "x-unique"]);
    expect(squash(resourceModel)).toContain(
      "today carries only `x-unique`, `x-claim`, and `x-audit`",
    );
  });

  it("both docs name the removal PR", () => {
    expect(resourceModel).toContain("https://github.com/zitadel/nextgen/pull/901");
    expect(socialLoginFlow).toContain("https://github.com/zitadel/nextgen/pull/901");
  });
});

describe("cross-doc anchors resolve (docs/design/idp)", () => {
  // The quote pins guard text; this guards the links. Every
  // [text](N-doc.md#fragment) and in-doc [text](#fragment) must hit a real
  // heading under GitHub's slugging, or the link 404s silently.
  const docs: Record<string, string> = {
    "README.md": readme,
    "1-resource-model.md": resourceModel,
    "2-auth-method-selection.md": authMethodSelection,
    "3-social-login-flow.md": socialLoginFlow,
    "4-cli-provider-setup.md": providerSetup,
  };
  const slugs = (doc: string) =>
    new Set(
      [...doc.matchAll(/^#{1,6} (.+)$/gm)].map((m) =>
        m[1]!.toLowerCase().replace(/[^\w\- ]/g, "").trim().replace(/ /g, "-"),
      ),
    );
  const headings = new Map(Object.entries(docs).map(([name, text]) => [name, slugs(text)]));

  it.each(Object.keys(docs))("%s", (name) => {
    const links = [...docs[name]!.matchAll(/\]\((?:([1-9][a-z-]*\.md|README\.md))?#([\w-]+)\)/g)];
    for (const [, file, fragment] of links) {
      expect(
        headings.get(file ?? name)!.has(fragment!),
        `${name} links ${file ?? "(self)"}#${fragment}`,
      ).toBe(true);
    }
  });

  // Relative links must also point at files that exist (example schemas like
  // schemas/catalog.json included), or the doc 404s just as silently.
  it("relative file links resolve", () => {
    const docsDir = join(repoRoot, "docs/design/idp");
    for (const [name, text] of Object.entries(docs)) {
      const targets = [...text.matchAll(/\]\(([^)]+)\)/g)]
        .map((m) => m[1]!)
        .filter((t) => !/^https?:|^#|^mailto:/.test(t))
        .map((t) => t.split("#")[0]!)
        .filter(Boolean);
      for (const target of targets) {
        expect(existsSync(join(docsDir, target)), `${name} links ${target}`).toBe(true);
      }
    }
  });
});

describe("provider catalog (4-cli-provider-setup.md · The Provider Catalog)", () => {
  // catalog.json restates the vendor facts of the example connections; this
  // pins the two files together so an edit to one fails until the other moves.
  const catalog = loadJson(schemasDir, "catalog.json") as Record<
    string,
    {
      display_name: string;
      template: string;
      protocol_block: {
        protocol: "oidc" | "oauth2";
        subject_claim: string;
        verified_claims: Record<string, unknown>;
      } & Record<string, unknown>;
      claim_table: Record<string, string>;
    }
  >;

  // The derivation the doc states: slug = entry key, client_secret_env =
  // upper-cased key + _CLIENT_SECRET, client_id prompted (taken from the
  // example), provisioning = scaffold default.
  const scaffold = (key: string, clientId: string) => {
    const entry = catalog[key]!;
    const { protocol, subject_claim, verified_claims, ...blocks } =
      entry.protocol_block;
    return {
      slug: key,
      protocol,
      template: entry.template,
      display_name: entry.display_name,
      subject_claim,
      claim_mapping: entry.claim_table,
      verified_claims,
      provisioning: { creation: "auto" },
      [protocol]: {
        ...(blocks[protocol] as Record<string, unknown>),
        client_id: clientId,
        client_secret_env: `${key.toUpperCase()}_CLIENT_SECRET`,
      },
    };
  };

  it.each<[string, Record<string, unknown>]>([
    ["google", googleExample],
    ["github", githubExample],
  ])("entry %s scaffolds the example connection verbatim", (key, example) => {
    const { $schema: _, ...expected } = example;
    const protocol = catalog[key]!.protocol_block.protocol;
    const clientId = (expected[protocol] as Record<string, unknown>)
      .client_id as string;
    expect(scaffold(key, clientId)).toEqual(expected);
  });
});
