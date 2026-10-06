import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { Flags } from "@oclif/core";
import { cancel, confirm, isCancel, select, text } from "@clack/prompts";
import { consola } from "consola";

import { createZitadelClient, type ZitadelClient } from "../../lib/api-client";
import { ZitadelError } from "../../lib/errors";
import { BaseCommand, CommandGroups, nonBlankArg, type JsonEnvelope } from "../../lib/oclif";
import { detectPreviewHost } from "../../lib/platform-detect";
import { publicCliCommand } from "../../lib/public-cli";
import { DEFAULT_SERVER } from "../../lib/server";

type OriginKind = "primary" | "preview";
type AllowedEntry = {
  pattern: string;
  kind: OriginKind;
  check: { status: "ok" | "warning"; code?: string; message: string };
};

/**
 * `zitadel env add` — bind a second environment to a project: create one on
 * the server, or bind an id a teammate sent over, write the
 * `.env.<name>.local` file the environment is, and allow the origins it will
 * serve. The allowlist is project state; collecting it here is the one moment
 * a person holds the project secret and is setting the project up anyway.
 */
export default class EnvAdd extends BaseCommand {
  static override description = "Bind an environment to a project, creating the project if needed.";
  static override group = CommandGroups.project;
  static override examples = [
    "<%= config.bin %> env add production",
    "<%= config.bin %> env add production --origin https://app.acme.com --preview 'https://*-acmeinc.vercel.app'",
    "<%= config.bin %> env add production --server https://api.zitadel.cloud --project proj_01K9AA9M3K7E2QX8VB4T",
  ];
  static override args = {
    name: nonBlankArg({ required: true, description: "The environment name, e.g. production." }),
  };
  static override flags = {
    project: Flags.string({ description: "Bind this existing project instead of creating one." }),
    name: Flags.string({ description: "The name for a project this command creates." }),
    origin: Flags.string({
      multiple: true,
      description: "A production origin to allow (primary). Repeatable.",
    }),
    preview: Flags.string({
      multiple: true,
      description: "A pattern the preview credential may register URLs under. Repeatable.",
    }),
    force: Flags.boolean({ description: "Overwrite an existing .env.<name>.local." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(EnvAdd);
    await this.toMeta(flags);
    const { cwd, env, nonInteractive, dryRun, cliVersion, serverFlag } = this.meta;
    const envName = args.name;
    const file = `.env.${envName}.local`;

    let server = serverFlag ?? this.meta.source;
    if (!serverFlag && !nonInteractive) {
      server = new URL(await ask(text({ message: "server?", initialValue: DEFAULT_SERVER }))).origin;
    }

    let projectId = flags.project;
    let projectName = flags.name;
    if (!projectId && !nonInteractive) {
      const choice = await ask(
        select({
          message: "project?",
          options: [
            { value: "create", label: "create a new one" },
            { value: "bind", label: "bind an existing one" },
          ],
        }),
      );
      if (choice === "bind") {
        projectId = await ask(text({ message: "project id?" }));
      } else if (!projectName) {
        projectName = await ask(text({ message: "name?", initialValue: envName }));
      }
    }

    const wanted: Array<{ pattern: string; kind: OriginKind }> = [
      ...(flags.origin ?? []).map((pattern) => ({ pattern, kind: "primary" as const })),
      ...(flags.preview ?? []).map((pattern) => ({ pattern, kind: "preview" as const })),
    ];
    if (wanted.length === 0 && !nonInteractive) {
      wanted.push(...(await askOrigins(cwd)));
    }

    if (dryRun) {
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: { environment: envName, server, project_id: projectId, file, allowed_origins: wanted },
      });
    }

    let values: Record<string, string>;
    let secret: string | undefined;
    if (projectId) {
      // Binding an id: the secret came the same way the id did, so it is
      // not written here and the command names it for the developer to add.
      values = { ZITADEL_URL: server, ZITADEL_PROJECT_ID: projectId };
      secret = env.ZITADEL_PROJECT_SECRET;
    } else {
      const created = await createZitadelClient({ baseUrl: server }).createProject({
        name: projectName ?? envName,
        allowed_origins: [],
        seed_defaults: false,
      });
      consola.success(`created ${created.id}   class=${created.class}`);
      projectId = created.id;
      secret = created.project_secret;
      values = {
        ZITADEL_URL: server,
        ZITADEL_PROJECT_ID: created.id,
        ZITADEL_PUBLISHABLE_KEY: created.preview_secret,
        ZITADEL_PROJECT_SECRET: created.project_secret,
        ZITADEL_PREVIEW_TOKEN: created.preview_token,
      };
    }

    for (const key of await publicProjectIdKeys(cwd)) {
      values[key] = projectId;
    }

    const allowed: AllowedEntry[] = [];
    const deferred: Array<{ pattern: string; kind: OriginKind }> = [];
    if (wanted.length > 0) {
      if (secret) {
        const client = createZitadelClient({ baseUrl: server, token: secret });
        for (const entry of wanted) {
          allowed.push(await allowOrigin(client, projectId, entry));
        }
      } else {
        deferred.push(...wanted);
      }
    }

    const path = join(cwd, file);
    await writeFile(path, `${Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n")}\n`, {
      flag: flags.force ? "w" : "wx",
      mode: 0o600,
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") {
        throw new ZitadelError("E_CONFLICT", `${file} already exists`, {
          hint: "Pass --force to overwrite it.",
        });
      }
      throw error;
    });

    const next = [
      ...(wanted.some((entry) => entry.kind === "primary")
        ? []
        : [
            publicCliCommand(
              `allowlist add https://app.example.com --kind primary --env ${envName}`,
              cliVersion,
            ),
          ]),
      ...deferred.map((entry) =>
        publicCliCommand(`allowlist add '${entry.pattern}' --kind ${entry.kind} --env ${envName}`, cliVersion),
      ),
      publicCliCommand(`deploy --env ${envName}`, cliVersion),
      publicCliCommand(`claim --env ${envName}`, cliVersion),
      publicCliCommand(`projects promote --env ${envName}`, cliVersion),
    ];
    const pretty = [
      ...allowed.map(
        (entry) =>
          `allowed           ${entry.pattern.padEnd(36)} ${entry.kind.padEnd(8)} ${checkLine(entry)}`,
      ),
      ...(deferred.length > 0
        ? ["                  (no project secret in the environment; allow the origins below once it is set)"]
        : []),
      `wrote             ${file}   ${Object.keys(values).map((k) => k.replace("ZITADEL_", "")).join(", ")}`,
      "",
      "next",
      ...next.map((cmd) => `  ${cmd}`),
      "",
      "platform          the build needs these; nothing on this machine puts them there",
      "  production scope   ZITADEL_URL, ZITADEL_PROJECT_ID, ZITADEL_PUBLISHABLE_KEY, ZITADEL_ENV=production",
      "  preview scope      ZITADEL_URL, ZITADEL_PROJECT_ID, ZITADEL_PUBLISHABLE_KEY, ZITADEL_PREVIEW_TOKEN",
      "",
      "ci                the job that runs `zitadel deploy` after merge needs the project secret;",
      "                  put it in the pipeline's secret store, not in the platform",
    ].join("\n");
    return this.emit({
      status: "ok",
      data: {
        environment: envName,
        server,
        project_id: projectId,
        file,
        keys: Object.keys(values),
        allowed_origins: allowed,
        next_commands: next,
      },
      pretty,
    });
  }
}

async function allowOrigin(
  client: ZitadelClient,
  projectId: string,
  entry: { pattern: string; kind: OriginKind },
): Promise<AllowedEntry> {
  const added = await client.addAllowedOrigin(projectId, entry);
  return { pattern: added.pattern, kind: added.kind, check: added.check };
}

function checkLine(entry: AllowedEntry): string {
  return entry.check.status === "ok"
    ? `${entry.check.message}  ✓`
    : `warning ${entry.check.code ?? ""}  ${entry.check.message}`;
}

/**
 * The origins an interactive run collects: the production URL, which nothing
 * on disk knows, and the preview pattern, proposed from the deploy platform
 * the repository is wired to and confirmed rather than assumed. Either may be
 * skipped; `allowlist add` is the same operation later.
 */
async function askOrigins(cwd: string): Promise<Array<{ pattern: string; kind: OriginKind }>> {
  const entries: Array<{ pattern: string; kind: OriginKind }> = [];
  const production = await ask(
    text({ message: "production URL? (leave empty to skip)", placeholder: "https://app.acme.com" }),
  );
  if (production.trim() !== "") {
    entries.push({ pattern: production.trim(), kind: "primary" });
  }

  const host = await detectPreviewHost(cwd);
  if (host?.pattern) {
    const ok = await ask(
      confirm({ message: `allow preview URLs matching ${host.pattern}? (detected ${host.platform})` }),
    );
    if (ok) {
      entries.push({ pattern: host.pattern, kind: "preview" });
    }
    return entries;
  }
  if (host?.label) {
    const label = await ask(
      text({ message: `${host.label.prompt} (detected ${host.platform}; empty to skip)`, placeholder: host.label.example }),
    );
    if (label.trim() !== "") {
      entries.push({ pattern: host.label.pattern(label.trim()), kind: "preview" });
    }
    return entries;
  }
  const pattern = await ask(
    text({
      message: "preview URL pattern? (leave empty to skip)",
      placeholder: "https://*-acmeinc.vercel.app",
    }),
  );
  if (pattern.trim() !== "") {
    entries.push({ pattern: pattern.trim(), kind: "preview" });
  }
  return entries;
}

async function ask<T>(answer: Promise<T | symbol>): Promise<T> {
  const value = await answer;
  if (isCancel(value)) {
    cancel("Cancelled.");
    throw new ZitadelError("E_VALIDATION", "env add cancelled by user");
  }
  return value as T;
}

/**
 * The names the app's client code reads the project id under, such as
 * `NEXT_PUBLIC_ZITADEL_PROJECT_ID` or `VITE_ZITADEL_PROJECT_ID`. Setup wrote
 * the framework's alias into `.env.local` and `.env.example`; whichever of
 * them exists says what this environment's file has to carry as well.
 */
async function publicProjectIdKeys(cwd: string): Promise<string[]> {
  for (const file of [".env.local", ".env.example"]) {
    let contents: string;
    try {
      contents = await readFile(join(cwd, file), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const keys = Object.keys(parseEnv(contents)).filter(
      (key) => key.endsWith("_ZITADEL_PROJECT_ID") && key !== "ZITADEL_PROJECT_ID",
    );
    if (keys.length > 0) return keys;
  }
  return [];
}
