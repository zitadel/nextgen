import { z } from "zod";

const envRef = z.string().regex(/^[A-Z][A-Z0-9_]*$/, "must be an env var name like ZITADEL_IDP_X_SECRET");

const claimMapping = z.record(z.string()).default({
  email: "email",
  given_name: "given_name",
  family_name: "family_name",
});

const oidcBlock = z.object({
  issuer: z.string().url(),
  client_id: z.string().min(1),
  client_secret_env: envRef,
  scopes: z.array(z.string()).default(["openid", "email", "profile"]),
  claim_mapping: claimMapping,
});

const samlBlock = z.object({
  metadata_url: z.string().url().optional(),
  metadata_xml: z.string().optional(),
  binding: z.enum(["post", "redirect"]).default("post"),
  signing_cert_env: envRef.optional(),
  claim_mapping: claimMapping.optional(),
}).refine(
  (value) => Boolean(value.metadata_url || value.metadata_xml),
  { message: "SAML IdP requires metadata_url or metadata_xml" },
);

const provisioning = z.object({
  mode: z.enum(["auto_link_by_email", "manual", "jit"]).default("auto_link_by_email"),
  link_by: z.array(z.string()).default(["claims.email"]),
  auto_create_user: z.boolean().default(true),
  default_schema: z.string().default("user"),
});

export const idpResourceSchema = z.object({
  version: z.literal(1),
  kind: z.literal("idp"),
  slug: z.string(),
  display_name: z.string().min(1),
  protocol: z.enum(["oidc", "saml"]),
  enabled: z.boolean().default(true),
  audience: z
    .object({
      scope: z.enum(["project", "team"]).default("project"),
      team_id: z.string().optional(),
      project_id: z.string().optional(),
    })
    .optional(),
  oidc: oidcBlock.optional(),
  saml: samlBlock.optional(),
  provisioning: provisioning.default(provisioning.parse({})),
}).refine(
  (value) => (value.protocol === "oidc" ? Boolean(value.oidc) : Boolean(value.saml)),
  { message: "OIDC IdP needs an `oidc` block; SAML IdP needs a `saml` block." },
);

export type IdpResource = z.infer<typeof idpResourceSchema>;

export type IdpPreset = "google" | "microsoft" | "okta-oidc";

export function buildIdpPreset(
  preset: IdpPreset,
  input: { slug?: string; client_id: string; client_secret_env: string; issuer?: string },
): Record<string, unknown> {
  switch (preset) {
    case "google":
      return idpFromTemplate({
        slug: input.slug ?? "google",
        display_name: "Google",
        issuer: input.issuer ?? "https://accounts.google.com",
        client_id: input.client_id,
        client_secret_env: input.client_secret_env,
      });
    case "microsoft":
      return idpFromTemplate({
        slug: input.slug ?? "microsoft",
        display_name: "Microsoft",
        issuer: input.issuer ?? "https://login.microsoftonline.com/common/v2.0",
        client_id: input.client_id,
        client_secret_env: input.client_secret_env,
      });
    case "okta-oidc":
      if (!input.issuer) {
        throw new Error("okta-oidc preset requires --issuer (your Okta org URL)");
      }
      return idpFromTemplate({
        slug: input.slug ?? "okta",
        display_name: "Okta",
        issuer: input.issuer,
        client_id: input.client_id,
        client_secret_env: input.client_secret_env,
      });
  }
}

function idpFromTemplate(input: {
  slug: string;
  display_name: string;
  issuer: string;
  client_id: string;
  client_secret_env: string;
  scopes?: string[];
  claim_mapping?: Record<string, string>;
}): Record<string, unknown> {
  return {
    version: 1,
    kind: "idp",
    slug: input.slug,
    display_name: input.display_name,
    protocol: "oidc",
    enabled: true,
    oidc: {
      issuer: input.issuer,
      client_id: input.client_id,
      client_secret_env: input.client_secret_env,
      scopes: input.scopes ?? ["openid", "email", "profile"],
      claim_mapping: input.claim_mapping ?? {
        email: "email",
        given_name: "given_name",
        family_name: "family_name",
      },
    },
    provisioning: {
      mode: "auto_link_by_email",
      link_by: ["claims.email"],
      auto_create_user: true,
      default_schema: "user",
    },
  };
}

export const IDP_PRESETS: IdpPreset[] = ["google", "microsoft", "okta-oidc"];
