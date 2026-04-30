import type { CliIO, GlobalOptions } from "../io/output";
import { ok, skipped } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { buildIdpPreset, IDP_PRESETS, idpResourceSchema, type IdpPreset } from "../resources/idp";
import { listResources, readResource, removeResource, writeResource } from "../resources/store";

export type IdpAddOptions = GlobalOptions & {
  slug?: string;
  displayName?: string;
  protocol?: string;
  preset?: string;
  issuer?: string;
  clientId?: string;
  clientSecretEnv?: string;
  metadataUrl?: string;
  scopes?: string;
  fromFile?: string;
};

export type IdpRemoveOptions = GlobalOptions & { slug?: string };
const IDP_PROTOCOLS = ["oidc", "saml"] as const;
type IdpProtocol = (typeof IDP_PROTOCOLS)[number];

export async function runIdpAdd(io: CliIO, opts: IdpAddOptions): Promise<void> {
  const resource = await buildIdpResource(opts);
  const parsed = idpResourceSchema.safeParse(resource);
  if (!parsed.success) {
    throw new ZitadelError("E_VALIDATION", "IDP resource is invalid", {
      details: { issues: parsed.error.issues },
    });
  }
  const slug = parsed.data.slug;
  const { path, created } = await writeResource(opts.cwd, "idp", slug, parsed.data, {
    force: opts.force,
    dryRun: opts.dryRun,
  });
  ok(
    io,
    {
      title: created ? `IdP "${slug}" added.` : `IdP "${slug}" updated.`,
      slug,
      path,
      created,
      protocol: parsed.data.protocol,
      enabled: parsed.data.enabled,
      next_commands: ["zitadel apply"],
    },
    opts,
  );
}

export async function runIdpList(io: CliIO, opts: GlobalOptions): Promise<void> {
  const resources = await listResources(opts.cwd, "idp");
  const items = resources.map((entry) => ({
    slug: entry.slug,
    path: entry.path,
    display_name:
      typeof entry.contents.display_name === "string" ? entry.contents.display_name : entry.slug,
    protocol: typeof entry.contents.protocol === "string" ? entry.contents.protocol : "unknown",
    enabled: entry.contents.enabled !== false,
  }));
  ok(
    io,
    { title: `Found ${items.length} IdP${items.length === 1 ? "" : "s"}.`, idps: items },
    opts,
  );
}

export async function runIdpShow(
  io: CliIO,
  opts: GlobalOptions,
  slug: string | undefined,
): Promise<void> {
  if (!slug) {
    throw new ZitadelError("E_VALIDATION", "zitadel idp show requires a slug", {
      nextCommands: ["zitadel idp list"],
    });
  }
  const entry = await readResource(opts.cwd, "idp", slug);
  if (!entry) {
    throw new ZitadelError("E_VALIDATION", `IdP "${slug}" not found`, {
      hint: "Run `zitadel idp list` to see configured IdPs.",
      nextCommands: ["zitadel idp list"],
    });
  }
  ok(io, { title: `IdP "${slug}"`, path: entry.path, idp: entry.contents }, opts);
}

export async function runIdpRemove(
  io: CliIO,
  opts: IdpRemoveOptions,
  slug: string | undefined,
): Promise<void> {
  if (!slug) {
    throw new ZitadelError("E_VALIDATION", "zitadel idp remove requires a slug", {
      nextCommands: ["zitadel idp list"],
    });
  }
  const { path, removed } = await removeResource(opts.cwd, "idp", slug, { dryRun: opts.dryRun });
  if (!removed) {
    skipped(io, "not-found", opts, { slug, path });
    return;
  }
  ok(io, { title: `IdP "${slug}" removed.`, slug, path, next_commands: ["zitadel apply"] }, opts);
}

async function buildIdpResource(opts: IdpAddOptions): Promise<Record<string, unknown>> {
  if (opts.fromFile) {
    const { readFile } = await import("node:fs/promises");
    const contents = await readFile(opts.fromFile, "utf8");
    return JSON.parse(contents) as Record<string, unknown>;
  }

  if (opts.preset) {
    if (!isIdpPreset(opts.preset)) {
      throw new ZitadelError("E_VALIDATION", `Unknown IdP preset "${opts.preset}"`, {
        hint: `Available presets: ${IDP_PRESETS.join(", ")}`,
      });
    }
    const clientId = requireOpt(opts.clientId, "--client-id");
    const clientSecretEnv = requireOpt(opts.clientSecretEnv, "--env-secret");
    return buildIdpPreset(opts.preset, {
      slug: opts.slug,
      client_id: clientId,
      client_secret_env: clientSecretEnv,
      issuer: opts.issuer,
    });
  }

  const protocol = resolveIdpProtocol(opts.protocol);
  const slug = requireOpt(opts.slug, "--slug");
  const displayName = opts.displayName ?? slug;

  if (protocol === "oidc") {
    return {
      version: 1,
      kind: "idp",
      slug,
      display_name: displayName,
      protocol: "oidc",
      enabled: true,
      oidc: {
        issuer: requireOpt(opts.issuer, "--issuer"),
        client_id: requireOpt(opts.clientId, "--client-id"),
        client_secret_env: requireOpt(opts.clientSecretEnv, "--env-secret"),
        scopes: opts.scopes
          ? opts.scopes
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : ["openid", "email", "profile"],
        claim_mapping: {
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

  return {
    version: 1,
    kind: "idp",
    slug,
    display_name: displayName,
    protocol: "saml",
    enabled: true,
    saml: {
      metadata_url: requireOpt(opts.metadataUrl, "--metadata-url"),
      binding: "post",
    },
    provisioning: {
      mode: "auto_link_by_email",
      link_by: ["claims.email"],
      auto_create_user: true,
      default_schema: "user",
    },
  };
}

function isIdpPreset(value: string): value is IdpPreset {
  return (IDP_PRESETS as string[]).includes(value);
}

function resolveIdpProtocol(value: string | undefined): IdpProtocol {
  const protocol = requireOpt(value, "--protocol");
  if ((IDP_PROTOCOLS as readonly string[]).includes(protocol)) return protocol as IdpProtocol;
  throw new ZitadelError("E_VALIDATION", `Invalid --protocol "${protocol}"`, {
    hint: `Use one of: ${IDP_PROTOCOLS.join(", ")}.`,
  });
}

function requireOpt<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null || value === "") {
    throw new ZitadelError("E_VALIDATION", `Missing required option ${name}`, {
      hint: `Pass ${name} or use --from-file to point at an existing resource JSON.`,
    });
  }
  return value;
}
