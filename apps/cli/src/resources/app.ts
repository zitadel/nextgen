import { z } from "zod";

const oidcBlock = z.object({
  client_type: z.enum(["web", "spa", "native", "machine"]),
  auth_methods: z
    .array(z.enum(["client_secret_basic", "client_secret_post", "none", "private_key_jwt"]))
    .default(["client_secret_basic"]),
  grant_types: z
    .array(
      z.enum([
        "authorization_code",
        "refresh_token",
        "client_credentials",
        "urn:ietf:params:oauth:grant-type:token-exchange",
      ]),
    )
    .default(["authorization_code", "refresh_token"]),
  response_types: z.array(z.enum(["code", "id_token", "token"])).default(["code"]),
  redirect_uris: z.array(z.string().url()).default([]),
  post_logout_redirect_uris: z.array(z.string().url()).default([]),
  access_token_type: z.enum(["jwt", "opaque"]).default("jwt"),
  id_token_claims: z.array(z.string()).default(["email", "given_name", "family_name"]),
  skip_consent: z.boolean().default(true),
});

const samlBlock = z
  .object({
    entity_id: z.string().min(1),
    metadata_url: z.string().url().optional(),
    metadata_xml: z.string().optional(),
    acs_url: z.string().url().optional(),
    binding: z.enum(["post", "redirect"]).default("post"),
  })
  .refine((value) => Boolean(value.metadata_url || value.metadata_xml || value.acs_url), {
    message: "SAML app requires metadata_url, metadata_xml, or acs_url",
  });

export const appResourceSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("app"),
    slug: z.string(),
    display_name: z.string().min(1),
    protocol: z.enum(["oidc", "saml"]),
    role: z.enum(["client", "server"]).default("client"),
    enabled: z.boolean().default(true),
    audience: z
      .object({
        scope: z.enum(["project", "team"]).default("project"),
        project_id: z.string().optional(),
        team_id: z.string().optional(),
      })
      .optional(),
    oidc: oidcBlock.optional(),
    saml: samlBlock.optional(),
  })
  .refine((value) => (value.protocol === "oidc" ? Boolean(value.oidc) : Boolean(value.saml)), {
    message: "OIDC app needs an `oidc` block; SAML app needs a `saml` block.",
  });

export type AppResource = z.infer<typeof appResourceSchema>;

export type AppPreset = "spa" | "web" | "native" | "machine";

export function buildAppPreset(
  preset: AppPreset,
  input: { slug: string; display_name?: string; redirect_uri?: string; redirect_uris?: string[] },
): Record<string, unknown> {
  const redirectUris = input.redirect_uris ?? (input.redirect_uri ? [input.redirect_uri] : []);
  const base = {
    version: 1,
    kind: "app",
    slug: input.slug,
    display_name: input.display_name ?? input.slug,
    protocol: "oidc",
    role: "client",
    enabled: true,
  } as const;

  switch (preset) {
    case "spa":
      return {
        ...base,
        oidc: {
          client_type: "spa",
          auth_methods: ["none"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          redirect_uris: redirectUris,
          post_logout_redirect_uris: [],
          access_token_type: "jwt",
          id_token_claims: ["email", "given_name", "family_name"],
          skip_consent: true,
        },
      };
    case "web":
      return {
        ...base,
        oidc: {
          client_type: "web",
          auth_methods: ["client_secret_basic"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          redirect_uris: redirectUris,
          post_logout_redirect_uris: [],
          access_token_type: "jwt",
          id_token_claims: ["email", "given_name", "family_name"],
          skip_consent: true,
        },
      };
    case "native":
      return {
        ...base,
        oidc: {
          client_type: "native",
          auth_methods: ["none"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          redirect_uris: redirectUris,
          post_logout_redirect_uris: [],
          access_token_type: "jwt",
          id_token_claims: ["email", "given_name", "family_name"],
          skip_consent: false,
        },
      };
    case "machine":
      return {
        ...base,
        oidc: {
          client_type: "machine",
          auth_methods: ["private_key_jwt"],
          grant_types: ["client_credentials", "urn:ietf:params:oauth:grant-type:token-exchange"],
          response_types: ["code"],
          redirect_uris: [],
          post_logout_redirect_uris: [],
          access_token_type: "jwt",
          id_token_claims: [],
          skip_consent: true,
        },
      };
  }
}

export const APP_PRESETS: AppPreset[] = ["spa", "web", "native", "machine"];
