import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

// Verification receipt for the IdP design docs (docs/design/idp/): extracts
// the draft connection schema and its example files straight from the
// markdown and runs the accept/reject matrix the docs claim was "mechanically
// verified". Nothing here ships — the schema is a design draft — but the
// docs lean on these results for security-relevant rules (verified_claims
// value classes, protocol arms, scope requirements),
// so the receipt must be checkable from the repo, not a session scratchpad.
// Covers 1-resource-model.md, 2-auth-method-selection.md, 4-cli-provider-setup.md,
// 6-test-sign-in.md, and 7-console-views.md;
// 3-social-login-flow.md and 5-post-claim-menu.md embed no validatable JSON
// blocks, but their cross-doc rows are pinned as quotes (areas 3<->4, 4<->5,
// {3,4,5}<->6, and {1,2,4}<->7) so sibling rewrites fail loudly.
// When the schema lands as a real meta-schema file, point this test at it
// and delete the extraction.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
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
const postClaimMenu = readFileSync(
  join(repoRoot, "docs/design/idp/5-post-claim-menu.md"),
  "utf8",
);
const testSignIn = readFileSync(
  join(repoRoot, "docs/design/idp/6-test-sign-in.md"),
  "utf8",
);
const consoleViews = readFileSync(
  join(repoRoot, "docs/design/idp/7-console-views.md"),
  "utf8",
);

function extractJson(markdown: string, pattern: RegExp): unknown {
  const match = markdown.match(pattern);
  if (!match?.[1]) {
    throw new Error(`design-doc block not found: ${pattern}`);
  }
  return JSON.parse(match[1]) as unknown;
}

const connectionSchema = extractJson(
  resourceModel,
  /```jsonc\n(\{\n {2}"\$schema": "https:\/\/json-schema\.org[\s\S]*?\n\})\n```/,
) as Record<string, unknown>;
const googleExample = extractJson(
  resourceModel,
  /```jsonc\n\/\/ \.zitadel\/idps\/google\.json[^\n]*\n(\{[\s\S]*?\n\})\n```/,
);
const githubExample = extractJson(
  resourceModel,
  /```jsonc\n\/\/ \.zitadel\/idps\/github\.json[^\n]*\n(\{[\s\S]*?\n\})\n```/,
);
const ssoAuthMethodSchema = extractJson(
  authMethodSelection,
  /```jsonc\n\/\/ packages\/config\/meta-schemas\/sso-auth-method\.json\n(\{[\s\S]*?\n\})\n```/,
);

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
  ["851 provisioning flags", { ...oidc, provisioning: { is_creation_allowed: true, is_auto_creation: false, is_auto_update: false } }, true],
  ["auto_linking (deferred — no linking in 851)", { ...oidc, provisioning: { auto_linking: "never" } }, false],
  ["is_linking_allowed (deferred)", { ...oidc, provisioning: { is_linking_allowed: true } }, false],
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
  ["verified_claims false rejected", { ...oidc, verified_claims: { email: false } }, false],
  ["verified_claims number rejected", { ...oidc, verified_claims: { email: 42 } }, false],
  ["verified_claims $-typo rejected", { ...oidc, verified_claims: { email: "$strateggy" } }, false],
  ["old $strategy sentinel rejected", { ...oidc, verified_claims: { email: "$strategy" } }, false],
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
    ["disabled with list retained (off-switch)", { enabled: false, providers: ["google"] }, true],
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
  // The two most copy-able snippets in the doc, validated against the exact
  // proposed meta-schema change: shipped auth-methods.json with only the sso
  // slot repointed at the doc's sso-auth-method schema.
  const metaSchemaDir = join(repoRoot, "packages/config/meta-schemas");
  const shippedAuthMethod = JSON.parse(
    readFileSync(join(metaSchemaDir, "auth-method.json"), "utf8"),
  ) as object;
  const shippedAuthMethods = JSON.parse(
    readFileSync(join(metaSchemaDir, "auth-methods.json"), "utf8"),
  ) as { properties: Record<string, { $ref: string }> };

  const snippets = [...authMethodSelection.matchAll(/"x-auth-methods": (\{[\s\S]*?\n\})/g)].map(
    (m) => JSON.parse(`{"x-auth-methods": ${m[1]!}}`) as Record<string, unknown>,
  );

  it("finds both schema snippets (Customers and Employees)", () => {
    expect(snippets).toHaveLength(2);
  });

  it("both validate against the proposed composite (sso slot repointed)", () => {
    const proposed = JSON.parse(JSON.stringify(shippedAuthMethods)) as typeof shippedAuthMethods;
    proposed.properties["sso"] = { $ref: "sso-auth-method.json" };
    const composite = ajv()
      .addSchema(shippedAuthMethod, "auth-method.json")
      .addSchema(ssoAuthMethodSchema as object, "sso-auth-method.json")
      .compile(proposed);
    for (const snippet of snippets) {
      expect(composite(snippet["x-auth-methods"])).toBe(true);
    }
  });

  it("today's shipped auth-methods.json rejects sso.providers — the change is required", () => {
    const shipped = ajv()
      .addSchema(shippedAuthMethod, "auth-method.json")
      .compile(shippedAuthMethods);
    expect(shipped(snippets[0]!["x-auth-methods"])).toBe(false);
  });
});

describe("end-to-end flow step (2-auth-method-selection.md · End to end)", () => {
  it("validates against the shipped flow meta-schema's Step definition", () => {
    const raw = authMethodSelection.match(
      /```jsonc\n\/\/ \.zitadel\/flows\/customers-login\.json[^\n]*\n(\{[\s\S]*?\n\})\n```/,
    )?.[1];
    expect(raw).toBeTruthy();
    const step = JSON.parse(raw!.replace(/\/\*[\s\S]*?\*\//g, "")) as object;
    const flowMeta = JSON.parse(
      readFileSync(join(repoRoot, "packages/config/meta-schemas/flow-definition.json"), "utf8"),
    ) as object;
    const validateStep = ajv()
      .addSchema(flowMeta, "flow-def")
      .compile({ $ref: "flow-def#/$defs/Step" });
    expect(validateStep(step)).toBe(true);
  });
});

describe("scaffolded flow (4-cli-provider-setup.md · The scaffolded flow)", () => {
  const raw = providerSetup.match(
    /```jsonc\n\/\/ \.zitadel\/flows\/default-login\.json[^\n]*\n(\{[\s\S]*?\n\})\n```/,
  )?.[1];
  if (!raw) throw new Error("scaffolded default-login.json block not found");
  type ScaffoldStep = {
    name: string;
    on_success?: string;
    sso_providers?: Array<{ id: string }>;
    transitions?: Record<string, { target: string; action?: string; purpose?: string }>;
  };
  const flow = JSON.parse(raw.replace(/\/\*[\s\S]*?\*\//g, "")) as {
    purposes: Record<string, string>;
    steps: ScaffoldStep[];
  };
  const flowMeta = () =>
    JSON.parse(
      readFileSync(join(repoRoot, "packages/config/meta-schemas/flow-definition.json"), "utf8"),
    ) as { $defs: { Step: { properties: { on_success: { enum: string[] } } } } };

  it("fails against the shipped meta-schema only on the on_success enum", () => {
    const validate = new Ajv2020({ strict: false, validateFormats: false, allErrors: true }).compile(
      flowMeta(),
    );
    expect(validate(flow)).toBe(false);
    for (const err of validate.errors!) {
      expect(err.keyword).toBe("enum");
      expect(err.instancePath.endsWith("/on_success")).toBe(true);
    }
  });

  it("validates once create_user_with_sso joins the enum (the single delta)", () => {
    const patched = flowMeta();
    patched.$defs.Step.properties.on_success.enum.push("create_user_with_sso");
    expect(ajv().compile(patched)(flow)).toBe(true);
  });

  it("every step carrying sso_providers routes all three outcomes", () => {
    const ssoSteps = flow.steps.filter((s) => s.sso_providers);
    expect(ssoSteps.map((s) => s.name)).toEqual(["identifier", "register"]);
    for (const step of ssoSteps) {
      for (const outcome of ["callback", "user_not_found", "user_already_exists"]) {
        expect(step.transitions?.[outcome], `${step.name} routes ${outcome}`).toBeDefined();
      }
    }
  });

  it("both firing points reach sso-conflict, whose sign-in re-purposes to login's entry; no pivot anywhere", () => {
    const byName = new Map(flow.steps.map((s) => [s.name, s]));
    for (const name of ["identifier", "register", "register-sso"]) {
      expect(byName.get(name)!.transitions!["user_already_exists"]!.target).toBe("sso-conflict");
    }
    expect(byName.get("register-sso")!.on_success).toBe("create_user_with_sso");
    expect(byName.get("sso-conflict")!.transitions!["sign_in"]).toEqual({
      target: flow.purposes["login"],
      purpose: "login",
    });
    for (const step of flow.steps) {
      for (const t of Object.values(step.transitions ?? {})) {
        expect(t.action).not.toBe("pivot");
      }
    }
  });

  it("provider ids reference area 1's connection slug", () => {
    const ids = flow.steps.flatMap((s) => (s.sso_providers ?? []).map((p) => p.id));
    expect(ids).toEqual(["google", "google"]);
    expect((googleExample as { slug: string }).slug).toBe("google");
  });
});

describe("sibling quotes pinned verbatim (4-cli-provider-setup.md)", () => {
  // Sibling rewrites broke area 4's quotes three times while this suite
  // stayed green; containment (whitespace-collapsed) makes the next drift a
  // red test naming both files.
  const squash = (s: string) => s.replace(/\s+/g, " ");
  it.each([
    [
      "callback URI surface row (area 3)",
      socialLoginFlow,
      "**Callback URI Surface:** Expose `{origin}/__nextgen/idp/callback` in the setup journey and per environment.",
    ],
    [
      "flow scaffolding row (area 3)",
      socialLoginFlow,
      "**Flow Scaffolding:** Scaffold `sso_providers` on register-purpose steps and the conflict step with its login route.",
    ],
    [
      "register-step topology open point (area 2)",
      authMethodSelection,
      "both single-step and multi-step topologies are functionally valid. The final choice was a CLI scaffolding decision",
    ],
    [
      "resolved-identity lifetime (area 3)",
      socialLoginFlow,
      "an ephemeral object attached directly to the attempt that dies when the attempt completes or expires",
    ],
  ])("%s appears in the source doc and area 4", (_name, source, quote) => {
    expect(squash(source)).toContain(quote);
    expect(squash(providerSetup)).toContain(quote);
  });

  it("the #flow-architecture-decisions heading exists (siblings deep-link it)", () => {
    // Quotes above pin cross-doc text; this pins the one in-doc anchor the
    // siblings link to, so a heading rename goes red instead of silently 404ing.
    expect(providerSetup).toContain("\n### Flow Architecture Decisions\n");
  });
});

describe("sibling quotes pinned verbatim (5-post-claim-menu.md)", () => {
  // Same discipline as area 4's pins: area 5 imports two area-4 rows by
  // quote, so a reword on either side must name both files.
  const squash = (s: string) => s.replace(/\s+/g, " ");
  it.each([
    [
      "re-enterable sub-journey row (area 4)",
      'Callable behind the "Sign-in methods" interface with the reuse branch as default mode.',
    ],
    [
      "multi-schema reuse open point (area 4)",
      "Multi-schema reuse logic is specified but unreachable in Epic 851's single-schema flow; activates with the Area 5 post-claim menu.",
    ],
  ])("%s appears in the source doc and area 5", (_name, quote) => {
    expect(squash(providerSetup)).toContain(quote);
    expect(squash(postClaimMenu)).toContain(quote);
  });

  it("the provider-setup anchors area 5 deep-links exist", () => {
    expect(providerSetup).toContain("\n## The Sub-journey\n");
    expect(providerSetup).toContain("\n## Create or Reuse\n");
  });
});

describe("forward compatibility (1-resource-model.md · Forward compatibility)", () => {
  // The documented extension path: secret_strategy returns as a closed enum
  // with secret_params, and client_secret_env relaxes from unconditional to
  // conditional. Every file valid today must stay valid.
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
    const validateExtended = ajv().compile(extended);
    expect(validateExtended(googleExample)).toBe(true);
    expect(validateExtended(githubExample)).toBe(true);
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

describe("verdict catalog (6-test-sign-in.md)", () => {
  // Area 6's classification table and JSON examples must agree with the
  // closed catalog they draw from; a code renamed in one place and not the
  // other goes red here.
  const catalog = extractJson(
    testSignIn,
    /```jsonc\n\/\/ test-sign-in verdict and reason-code catalog\n(\{[\s\S]*?\n\})\n```/,
  ) as {
    verdicts: string[];
    milestones: string[];
    reason_codes: string[];
    cli_reasons: string[];
  };
  const event = extractJson(
    testSignIn,
    /```jsonc\n\/\/ idp-attempt diagnostic event\n(\{[\s\S]*?\n\})\n```/,
  ) as { reason_code: string };
  const envelope = extractJson(
    testSignIn,
    /```jsonc\n\/\/ test sign-in failure envelope\n(\{[\s\S]*?\n\})\n```/,
  ) as {
    code: string;
    details: { verdict: string; reason_code: string; last_milestone: string; milestones: string[] };
  };

  it("every verdict, milestone, and reason code is used in prose", () => {
    for (const name of [
      ...catalog.verdicts,
      ...catalog.milestones,
      ...catalog.reason_codes,
      ...catalog.cli_reasons,
    ]) {
      expect(testSignIn, name).toContain(`\`${name}\``);
    }
  });

  it("the classification table covers every failure reason code", () => {
    const start = testSignIn.indexOf("| Signal | Verdict |");
    const end = testSignIn.indexOf("\n## ", start);
    const table = testSignIn.slice(start, end);
    for (const code of [...catalog.reason_codes, ...catalog.cli_reasons]) {
      expect(table, code).toContain(`\`${code}\``);
    }
  });

  it("the JSON examples use catalog values only", () => {
    expect(catalog.reason_codes).toContain(event.reason_code);
    expect(catalog.verdicts).toContain(envelope.details.verdict);
    expect([...catalog.reason_codes, ...catalog.cli_reasons]).toContain(
      envelope.details.reason_code,
    );
    expect(catalog.milestones).toContain(envelope.details.last_milestone);
    for (const milestone of envelope.details.milestones) {
      expect(catalog.milestones).toContain(milestone);
    }
    expect(envelope.code).toBe("E_TEST_FAILED");
  });
});

describe("sibling quotes pinned verbatim (6-test-sign-in.md)", () => {
  // Area 6 imports one row from each of areas 3, 4, and 5; a reword on
  // either side must name both files.
  const squash = (s: string) => s.replace(/\s+/g, " ");
  it.each([
    [
      "failure-details row (area 3)",
      socialLoginFlow,
      "Details are written to server logs and the test journey (area 6); tenant-side misconfigurations are hidden from the end user.",
    ],
    [
      "test journey handoff row (area 4)",
      providerSetup,
      "Provides execution target for exit copy; applying changes is never presented as working sign-in.",
    ],
    [
      "test journey surface row (area 5)",
      postClaimMenu,
      'Exit copy (or a menu row) hands off to the test journey; CLI avoids asserting that auth "works".',
    ],
  ])("%s appears in the source doc and area 6", (_name, source, quote) => {
    expect(squash(source)).toContain(quote);
    expect(squash(testSignIn)).toContain(quote);
  });
});

describe("console views (7-console-views.md)", () => {
  // Area 7 imports its premises by quote from areas 1, 2, and 4, and embeds
  // two machine-checkable sketches: the x-auth-methods example must satisfy
  // area 2's proposed composite, and the connections-list sketch must agree
  // field by field with area 1's example connection files.
  const squash = (s: string) => s.replace(/\s+/g, " ");

  it.each([
    [
      "secret invariant (area 1)",
      resourceModel,
      "Secret resolution must never happen upstream of anything that is diffed, hashed, committed, or printed.",
    ],
    [
      "get-by-slug API row (area 1)",
      resourceModel,
      "The API surface must support `get-by-slug` and strictly enforce uniqueness on creation.",
    ],
    [
      "UI-visibility rationale (area 2)",
      authMethodSelection,
      "Both the post-claim journey and the Console need to display exactly which authentication methods a schema supports.",
    ],
    [
      "dead-capability consequence (area 2)",
      authMethodSelection,
      "The Console would advertise a sign-in method that has no actual login path.",
    ],
    [
      "read-only scope note (area 4)",
      providerSetup,
      'the developer explicitly cannot "configure or manage identity provider connections through the Console in this iteration"',
    ],
  ])("%s appears in the source doc and area 7", (_name, source, quote) => {
    expect(squash(source)).toContain(quote);
    expect(squash(consoleViews)).toContain(quote);
  });

  it("the x-auth-methods example validates against area 2's composite", () => {
    const raw = consoleViews.match(
      /```jsonc\n\/\/ Customers schema as the console reads it\n"x-auth-methods": (\{[\s\S]*?\n\})\n```/,
    )?.[1];
    expect(raw).toBeTruthy();
    const snippet = JSON.parse(raw!) as object;
    const metaSchemaDir = join(repoRoot, "packages/config/meta-schemas");
    const shippedAuthMethod = JSON.parse(
      readFileSync(join(metaSchemaDir, "auth-method.json"), "utf8"),
    ) as object;
    const proposed = JSON.parse(
      readFileSync(join(metaSchemaDir, "auth-methods.json"), "utf8"),
    ) as { properties: Record<string, { $ref: string }> };
    proposed.properties["sso"] = { $ref: "sso-auth-method.json" };
    const composite = ajv()
      .addSchema(shippedAuthMethod, "auth-method.json")
      .addSchema(ssoAuthMethodSchema as object, "sso-auth-method.json")
      .compile(proposed);
    expect(composite(snippet)).toBe(true);
  });

  it("the connections-list sketch agrees with area 1's example connections", () => {
    const sketch = extractJson(
      consoleViews,
      /```jsonc\n\/\/ GET \/idps[^\n]*\n(\{[\s\S]*?\n\})\n```/,
    ) as {
      idps: Array<{ slug: string; display_name: string; protocol: string; template: string }>;
    };
    const examples: Record<string, { display_name: string; protocol: string; template: string }> = {
      google: googleExample as never,
      github: githubExample as never,
    };
    expect(sketch.idps.map((row) => row.slug).sort()).toEqual(["github", "google"]);
    for (const row of sketch.idps) {
      const example = examples[row.slug]!;
      expect(row.display_name).toBe(example.display_name);
      expect(row.protocol).toBe(example.protocol);
      expect(row.template).toBe(example.template);
    }
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
