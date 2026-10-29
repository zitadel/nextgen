/**
 * App presets: complete starting documents for the common shapes of an app,
 * so nobody picks grant types or authentication methods by hand. A preset only
 * fills the document (ADR 071 §4): the app keeps its name as an annotation in
 * `preset`, and its behavior comes from the configs the preset wrote.
 *
 * The CLI's `app create --preset` and the console offer the same list, and an
 * agent can start from {@link composeAppDocument} directly.
 */

/** Every preset's id, in the order the CLI and the console list them. */
export const APP_PRESETS = Object.freeze([
  "web",
  "spa",
  "native",
  "cli",
  "api",
  "backend",
  "service-account",
  "mcp-server",
] as const);

export type AppPresetId = (typeof APP_PRESETS)[number];

/** What a preset asks for beyond the slug. */
export type AppPresetNeed = "redirect_uris" | "identifier";

export type AppPresetInput = {
  /** The app's slug, which also names the `${{ NAME }}` of each client secret. */
  slug: string;
  /** The app's name; the slug when left out. */
  name?: string;
  /** Redirect URIs, for a preset whose client signs users in. */
  redirectUris?: readonly string[];
  /** The API's identifier, for a preset that serves one. */
  identifier?: string;
  /** Scopes the API defines, for a preset that serves one. */
  scopes?: readonly string[];
};

/** The app document a preset composes; the shape of `.zitadel/apps/<slug>.json`. */
export type AppDocument = {
  $schema?: string;
  slug: string;
  name: string;
  preset: AppPresetId;
  clients?: Record<string, unknown>[];
  apis?: Record<string, unknown>[];
  registration?: { client_id_metadata_documents?: boolean; dynamic?: boolean };
};

type Preset = {
  summary: string;
  needs: readonly AppPresetNeed[];
  compose: (input: Required<Pick<AppPresetInput, "slug" | "name">> & AppPresetInput) => Omit<
    AppDocument,
    "slug" | "name" | "preset"
  >;
};

/** The loopback callbacks a CLI listens on, any port (RFC 8252 §7.3). */
const LOOPBACK_REDIRECTS = [
  "http://127.0.0.1/callback",
  "http://[::1]/callback",
  "http://localhost/callback",
];

/**
 * The variable a declared confidential client's secret is read from:
 * `SHOP_WEB_CLIENT_SECRET` for client `web` of app `shop`.
 */
export function appClientSecretVariable(appSlug: string, clientSlug: string): string {
  return `${appSlug}_${clientSlug}_CLIENT_SECRET`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

const secretRef = (appSlug: string, clientSlug: string): string =>
  `\${{ ${appClientSecretVariable(appSlug, clientSlug)} }}`;

const api = (slug: string, input: AppPresetInput, extra: Record<string, unknown> = {}) => ({
  slug,
  identifier: input.identifier,
  ...(input.scopes?.length ? { scopes: input.scopes.map((name) => ({ name })) } : {}),
  ...extra,
});

const PRESETS: Readonly<Record<AppPresetId, Preset>> = Object.freeze({
  web: {
    summary: "A server-rendered web app that signs users in, with a secret",
    needs: ["redirect_uris"],
    compose: ({ slug, redirectUris }) => ({
      clients: [
        {
          slug: "web",
          type: "confidential",
          secret: secretRef(slug, "web"),
          grants: ["authorization_code", "refresh_token"],
          redirect_uris: [...(redirectUris ?? [])],
        },
      ],
    }),
  },
  spa: {
    summary: "A single-page app that signs users in with PKCE and holds no secret",
    needs: ["redirect_uris"],
    compose: ({ redirectUris }) => ({
      clients: [
        {
          slug: "spa",
          type: "public",
          grants: ["authorization_code", "refresh_token"],
          redirect_uris: [...(redirectUris ?? [])],
        },
      ],
    }),
  },
  native: {
    summary: "A mobile or desktop app that signs users in with PKCE",
    needs: ["redirect_uris"],
    compose: ({ redirectUris }) => ({
      clients: [
        {
          slug: "native",
          type: "public",
          grants: ["authorization_code", "refresh_token"],
          redirect_uris: [...(redirectUris ?? [])],
        },
      ],
    }),
  },
  cli: {
    summary: "A command-line tool that signs users in through a loopback redirect",
    needs: [],
    compose: () => ({
      clients: [
        {
          slug: "cli",
          type: "public",
          grants: ["authorization_code", "refresh_token"],
          redirect_uris: [...LOOPBACK_REDIRECTS],
        },
      ],
    }),
  },
  api: {
    summary: "An API that accepts access tokens for its identifier",
    needs: ["identifier"],
    compose: (input) => ({ apis: [api("api", input)] }),
  },
  backend: {
    summary: "A backend that serves an API and calls others as itself",
    needs: ["identifier"],
    compose: (input) => ({
      clients: [
        {
          slug: "backend",
          type: "confidential",
          secret: secretRef(input.slug, "backend"),
          grants: ["client_credentials"],
          apis: [{ api: "api" }],
        },
      ],
      apis: [api("api", input)],
    }),
  },
  "service-account": {
    summary: "A job or service that calls APIs as itself",
    needs: [],
    compose: ({ slug }) => ({
      clients: [
        {
          slug: "service",
          type: "confidential",
          secret: secretRef(slug, "service"),
          grants: ["client_credentials"],
        },
      ],
    }),
  },
  "mcp-server": {
    summary: "An MCP server any MCP client can connect to with the user's consent",
    needs: ["identifier"],
    compose: (input) => ({
      apis: [api("mcp", input, { third_party: true })],
      registration: { client_id_metadata_documents: true },
    }),
  },
});

/** The one-line summary the CLI and the console show for a preset. */
export function appPresetSummary(id: AppPresetId): string {
  return PRESETS[id].summary;
}

/** What a preset asks for beyond the slug. */
export function appPresetNeeds(id: AppPresetId): readonly AppPresetNeed[] {
  return PRESETS[id].needs;
}

export function isAppPreset(value: string): value is AppPresetId {
  return (APP_PRESETS as readonly string[]).includes(value);
}

/**
 * The document a preset composes for input. A need the input leaves out is
 * reported, so a caller can ask for it or list it, rather than writing a
 * document the server refuses.
 */
export function composeAppDocument(
  id: AppPresetId,
  input: AppPresetInput,
): { document: AppDocument; missing: AppPresetNeed[] } {
  const preset = PRESETS[id];
  const missing = preset.needs.filter((need) =>
    need === "redirect_uris" ? !input.redirectUris?.length : !input.identifier,
  );
  const name = input.name ?? input.slug;
  return {
    document: { slug: input.slug, name, preset: id, ...preset.compose({ ...input, name }) },
    missing,
  };
}
