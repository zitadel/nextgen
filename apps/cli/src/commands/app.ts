import type { CliIO, GlobalOptions } from "../io/output";
import { ok, skipped } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { appResourceSchema, APP_PRESETS, buildAppPreset, type AppPreset } from "../resources/app";
import { listResources, readResource, removeResource, writeResource } from "../resources/store";

export type AppAddOptions = GlobalOptions & {
  slug?: string;
  displayName?: string;
  protocol?: string;
  preset?: string;
  clientType?: string;
  role?: string;
  redirectUri?: string | string[];
  postLogoutRedirectUri?: string | string[];
  metadataUrl?: string;
  entityId?: string;
  fromFile?: string;
};

const OIDC_CLIENT_TYPES = ["web", "spa", "native", "machine"] as const;
type OidcClientType = (typeof OIDC_CLIENT_TYPES)[number];

export type AppRemoveOptions = GlobalOptions & { slug?: string };

export async function runAppAdd(io: CliIO, opts: AppAddOptions): Promise<void> {
  const resource = await buildAppResource(opts);
  const parsed = appResourceSchema.safeParse(resource);
  if (!parsed.success) {
    throw new ZitadelError("E_VALIDATION", "App resource is invalid", {
      details: { issues: parsed.error.issues },
    });
  }
  const slug = parsed.data.slug;
  const { path, created } = await writeResource(opts.cwd, "app", slug, parsed.data, {
    force: opts.force,
    dryRun: opts.dryRun,
  });
  ok(
    io,
    {
      title: created ? `App "${slug}" added.` : `App "${slug}" updated.`,
      slug,
      path,
      created,
      protocol: parsed.data.protocol,
      role: parsed.data.role,
      enabled: parsed.data.enabled,
      next_commands: ["zitadel apply"],
    },
    opts,
  );
}

export async function runAppList(io: CliIO, opts: GlobalOptions): Promise<void> {
  const resources = await listResources(opts.cwd, "app");
  const items = resources.map((entry) => ({
    slug: entry.slug,
    path: entry.path,
    display_name: typeof entry.contents.display_name === "string" ? entry.contents.display_name : entry.slug,
    protocol: typeof entry.contents.protocol === "string" ? entry.contents.protocol : "unknown",
    role: typeof entry.contents.role === "string" ? entry.contents.role : "client",
    enabled: entry.contents.enabled !== false,
  }));
  ok(io, { title: `Found ${items.length} app${items.length === 1 ? "" : "s"}.`, apps: items }, opts);
}

export async function runAppShow(io: CliIO, opts: GlobalOptions, slug: string | undefined): Promise<void> {
  if (!slug) {
    throw new ZitadelError("E_VALIDATION", "zitadel app show requires a slug", {
      nextCommands: ["zitadel app list"],
    });
  }
  const entry = await readResource(opts.cwd, "app", slug);
  if (!entry) {
    throw new ZitadelError("E_VALIDATION", `App "${slug}" not found`, {
      hint: "Run `zitadel app list` to see configured apps.",
      nextCommands: ["zitadel app list"],
    });
  }
  ok(io, { title: `App "${slug}"`, path: entry.path, app: entry.contents }, opts);
}

export async function runAppRemove(io: CliIO, opts: AppRemoveOptions, slug: string | undefined): Promise<void> {
  if (!slug) {
    throw new ZitadelError("E_VALIDATION", "zitadel app remove requires a slug", {
      nextCommands: ["zitadel app list"],
    });
  }
  const { path, removed } = await removeResource(opts.cwd, "app", slug, { dryRun: opts.dryRun });
  if (!removed) {
    skipped(io, "not-found", opts, { slug, path });
    return;
  }
  ok(io, { title: `App "${slug}" removed.`, slug, path, next_commands: ["zitadel apply"] }, opts);
}

async function buildAppResource(opts: AppAddOptions): Promise<Record<string, unknown>> {
  if (opts.fromFile) {
    const { readFile } = await import("node:fs/promises");
    const contents = await readFile(opts.fromFile, "utf8");
    return JSON.parse(contents) as Record<string, unknown>;
  }

  const redirectUris = normalizeList(opts.redirectUri);
  const postLogoutRedirectUris = normalizeList(opts.postLogoutRedirectUri);
  const slug = opts.slug ?? opts.preset ?? "app";

  if (opts.preset) {
    if (!isAppPreset(opts.preset)) {
      throw new ZitadelError("E_VALIDATION", `Unknown app preset "${opts.preset}"`, {
        hint: `Available presets: ${APP_PRESETS.join(", ")}`,
      });
    }
    return buildAppPreset(opts.preset, {
      slug,
      display_name: opts.displayName,
      redirect_uris: redirectUris,
    });
  }

  const protocol = requireOpt(opts.protocol, "--protocol") as "oidc" | "saml";
  const displayName = opts.displayName ?? slug;

  if (protocol === "oidc") {
    if (opts.role !== undefined) {
      throw new ZitadelError("E_VALIDATION", "--role is not valid for --protocol oidc", {
        hint: "Use --client-type <web|spa|native|machine> instead. --role is SAML-only.",
      });
    }
    const clientType = resolveOidcClientType(opts.clientType);
    const authMethods =
      clientType === "spa" || clientType === "native"
        ? ["none"]
        : clientType === "machine"
          ? ["private_key_jwt"]
          : ["client_secret_basic"];
    const grantTypes =
      clientType === "machine"
        ? ["client_credentials", "urn:ietf:params:oauth:grant-type:token-exchange"]
        : ["authorization_code", "refresh_token"];
    return {
      version: 1,
      kind: "app",
      slug,
      display_name: displayName,
      protocol: "oidc",
      role: "client",
      enabled: true,
      oidc: {
        client_type: clientType,
        auth_methods: authMethods,
        grant_types: grantTypes,
        response_types: ["code"],
        redirect_uris: clientType === "machine" ? [] : redirectUris,
        post_logout_redirect_uris: clientType === "machine" ? [] : postLogoutRedirectUris,
        access_token_type: "jwt",
        id_token_claims: clientType === "machine" ? [] : ["email", "given_name", "family_name"],
        skip_consent: clientType !== "native",
      },
    };
  }

  return {
    version: 1,
    kind: "app",
    slug,
    display_name: displayName,
    protocol: "saml",
    role: opts.role === "server" ? "server" : "client",
    enabled: true,
    saml: {
      entity_id: requireOpt(opts.entityId, "--entity-id"),
      metadata_url: opts.metadataUrl,
      binding: "post",
    },
  };
}

function isAppPreset(value: string): value is AppPreset {
  return (APP_PRESETS as string[]).includes(value);
}

function resolveOidcClientType(value: string | undefined): OidcClientType {
  if (value === undefined) return "spa";
  if ((OIDC_CLIENT_TYPES as readonly string[]).includes(value)) return value as OidcClientType;
  throw new ZitadelError("E_VALIDATION", `Invalid --client-type "${value}"`, {
    hint: `Use one of: ${OIDC_CLIENT_TYPES.join(", ")}.`,
  });
}

function normalizeList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function requireOpt<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null || value === "") {
    throw new ZitadelError("E_VALIDATION", `Missing required option ${name}`, {
      hint: `Pass ${name} or use --from-file to point at an existing resource JSON.`,
    });
  }
  return value;
}
