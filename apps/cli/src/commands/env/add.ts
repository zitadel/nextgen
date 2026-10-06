import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Flags } from "@oclif/core";
import { cancel, isCancel, select, text } from "@clack/prompts";
import { consola } from "consola";

import { createZitadelClient } from "../../lib/api-client";
import { ZitadelError } from "../../lib/errors";
import { BaseCommand, CommandGroups, nonBlankArg, type JsonEnvelope } from "../../lib/oclif";
import { publicCliCommand } from "../../lib/public-cli";
import { DEFAULT_SERVER } from "../../lib/server";

/**
 * `zitadel env add` — bind a second environment to a project: create one on
 * the server, or bind an id a teammate sent over, and write the
 * `.env.<name>.local` file the environment is.
 */
export default class EnvAdd extends BaseCommand {
  static override description = "Bind an environment to a project, creating the project if needed.";
  static override group = CommandGroups.project;
  static override examples = [
    "<%= config.bin %> env add production",
    "<%= config.bin %> env add production --server https://api.zitadel.cloud --project proj_01K9AA9M3K7E2QX8VB4T",
  ];
  static override args = {
    name: nonBlankArg({ required: true, description: "The environment name, e.g. production." }),
  };
  static override flags = {
    project: Flags.string({ description: "Bind this existing project instead of creating one." }),
    name: Flags.string({ description: "The name for a project this command creates." }),
    force: Flags.boolean({ description: "Overwrite an existing .env.<name>.local." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(EnvAdd);
    await this.toMeta(flags);
    const { cwd, nonInteractive, dryRun, cliVersion, serverFlag } = this.meta;
    const envName = args.name;
    const file = `.env.${envName}.local`;

    let server = serverFlag ?? this.meta.source;
    if (!serverFlag && !nonInteractive) {
      const answer = await text({ message: "server?", initialValue: DEFAULT_SERVER });
      if (isCancel(answer)) {
        cancel("Cancelled.");
        throw new ZitadelError("E_VALIDATION", "env add cancelled by user");
      }
      server = new URL(String(answer)).origin;
    }

    let projectId = flags.project;
    let projectName = flags.name;
    if (!projectId && !nonInteractive) {
      const choice = await select({
        message: "project?",
        options: [
          { value: "create", label: "create a new one" },
          { value: "bind", label: "bind an existing one" },
        ],
      });
      if (isCancel(choice)) {
        cancel("Cancelled.");
        throw new ZitadelError("E_VALIDATION", "env add cancelled by user");
      }
      if (choice === "bind") {
        const id = await text({ message: "project id?" });
        if (isCancel(id)) {
          cancel("Cancelled.");
          throw new ZitadelError("E_VALIDATION", "env add cancelled by user");
        }
        projectId = String(id);
      } else if (!projectName) {
        const name = await text({ message: "name?", initialValue: envName });
        if (isCancel(name)) {
          cancel("Cancelled.");
          throw new ZitadelError("E_VALIDATION", "env add cancelled by user");
        }
        projectName = String(name);
      }
    }

    if (dryRun) {
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: { environment: envName, server, project_id: projectId, file },
      });
    }

    let values: Record<string, string>;
    if (projectId) {
      // Binding an id: the secret came the same way the id did, so it is
      // not written here and the command names it for the developer to add.
      values = { ZITADEL_URL: server, ZITADEL_PROJECT_ID: projectId };
    } else {
      const created = await createZitadelClient({ baseUrl: server }).createProject({
        name: projectName ?? envName,
        allowed_origins: [],
        seed_defaults: false,
      });
      consola.success(`created ${created.id}   class=${created.class}`);
      projectId = created.id;
      values = {
        ZITADEL_URL: server,
        ZITADEL_PROJECT_ID: created.id,
        ZITADEL_PUBLISHABLE_KEY: created.preview_secret,
        ZITADEL_PROJECT_SECRET: created.project_secret,
        ZITADEL_PREVIEW_TOKEN: created.preview_token,
      };
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
      publicCliCommand(`allowlist add https://app.example.com --kind primary --env ${envName}`, cliVersion),
      publicCliCommand(`deploy --env ${envName}`, cliVersion),
      publicCliCommand(`claim --env ${envName}`, cliVersion),
      publicCliCommand(`projects promote --env ${envName}`, cliVersion),
    ];
    const pretty = [
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
        next_commands: next,
      },
      pretty,
    });
  }
}
