import { stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { Flags } from "@oclif/core";
import { text } from "@clack/prompts";
import { consola } from "consola";

import { createZitadelClient } from "../../lib/api-client";
import { ZitadelError } from "../../lib/errors";
import { isEnvironmentName } from "../../lib/environment";
import { writeManagedEnvFile } from "../../lib/fs-safe";
import { isObject } from "../../lib/json";
import {
  BaseCommand,
  CommandGroups,
  type JsonEnvelope,
  nonBlankArg,
  nonBlankString,
} from "../../lib/oclif";
import { PUBLIC_PROJECT_ID_VARIABLE } from "../../lib/orca/patchers/rule/public-project-id";
import { readZitadelConfig } from "../../lib/project";
import { bailOnCancel } from "../../lib/prompt-cancel";
import { DEFAULT_SERVER, resolveServer, serverOrigin } from "../../lib/server";

/** A variable to set on a hosting platform or in a pipeline. A secret is named, never printed. */
type PlatformVariable = { name: string; value?: string; secret?: boolean };

/** The frameworks whose server needs the project secret at runtime (the session exchange). */
const SERVER_RENDERED = ["next", "nuxt"];

/**
 * `zitadel env add` — bind an environment to a project: create one on the
 * server, or bind an id a teammate sent over, and write the
 * `.env.<name>.local` file that is the environment. The file is the only thing
 * it writes. The deployed app never reads it (it is gitignored and the hosting
 * platform builds from git), so the command ends by printing exactly which
 * values the platform and the pipeline need.
 */
export default class EnvAdd extends BaseCommand {
  static override description = "Bind an environment to a project, creating the project if needed.";
  static override group = CommandGroups.project;
  static override groupOrder = 7;
  static override examples = [
    "<%= config.bin %> env add production --server https://api.zitadel.cloud --app-url https://app.acme.com",
    "<%= config.bin %> env add staging --server https://api.zitadel.cloud --project proj_01K9AA9M3K7E2QX8VB4T",
  ];
  static override args = {
    name: nonBlankArg({ required: true, description: "The environment name, e.g. production." }),
  };
  static override flags = {
    project: nonBlankString({
      description:
        "Bind this existing project instead of creating one. Its secrets come from ZITADEL_PROJECT_SECRET and ZITADEL_PREVIEW_TOKEN in the process environment.",
    }),
    "app-url": nonBlankString({
      description:
        "The URL this environment's app is served from. It becomes ZITADEL_ISSUER and is registered with a new project.",
    }),
    force: Flags.boolean({ description: "Overwrite an existing .env.<name>.local." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(EnvAdd);
    // The server is chosen here, not resolved: the environment being added has
    // no file yet to say where its project lives.
    await this.toMeta(flags, { resolveServer: false });
    const { cwd, env, nonInteractive, dryRun, serverFlag } = this.meta;
    const name = args.name;
    if (!isEnvironmentName(name)) {
      throw new ZitadelError("E_VALIDATION", `"${name}" is not a usable environment name`, {
        hint: 'Use letters, digits, dot, dash and underscore, and no "..", e.g. production.',
      });
    }
    const file = `.env.${name}.local`;
    const path = join(cwd, file);

    const config = await readZitadelConfig(cwd);
    const frameworkId = isObject(config.framework) ? config.framework.id : undefined;
    const publicVariable =
      typeof frameworkId === "string"
        ? PUBLIC_PROJECT_ID_VARIABLE[frameworkId as keyof typeof PUBLIC_PROJECT_ID_VARIABLE]
        : undefined;

    if (
      !flags.force &&
      (await stat(path).then(
        () => true,
        () => false,
      ))
    ) {
      throw new ZitadelError("E_CONFLICT", `${file} already exists`, {
        hint: "Pass --force to overwrite it.",
      });
    }

    let server: string;
    if (serverFlag) {
      server = (await resolveServer({ cwd, serverFlag })).value;
    } else if (nonInteractive) {
      throw new ZitadelError("E_VALIDATION", "No server given", {
        hint: "Pass --server, e.g. --server https://api.zitadel.cloud.",
      });
    } else {
      const answer = await text({ message: "Server URL", initialValue: DEFAULT_SERVER });
      bailOnCancel(answer, "Env add");
      server = serverOrigin(String(answer).trim());
    }

    let appUrl = flags["app-url"];
    if (appUrl === undefined && !nonInteractive) {
      const answer = await text({
        message: "URL the app is served from (leave empty to skip)",
        placeholder: "https://app.acme.com",
      });
      bailOnCancel(answer, "Env add");
      appUrl = String(answer).trim() || undefined;
    }
    if (
      appUrl !== undefined &&
      !(URL.canParse(appUrl) && /^https?:$/.test(new URL(appUrl).protocol))
    ) {
      throw new ZitadelError("E_VALIDATION", `Invalid app URL "${appUrl}"`, {
        hint: "Use a URL like https://app.acme.com.",
      });
    }
    const issuer = appUrl === undefined ? undefined : new URL(appUrl).origin;

    if (dryRun) {
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: { environment: name, file, server, project_id: flags.project, issuer },
      });
    }

    let projectId = flags.project;
    let projectSecret = env.ZITADEL_PROJECT_SECRET;
    let previewToken = env.ZITADEL_PREVIEW_TOKEN;
    if (projectId === undefined) {
      const created = await createZitadelClient({ baseUrl: server }).createProject({
        name: `${basename(cwd)}-${name}`,
        ...(issuer === undefined ? {} : { preview_origins: [issuer] }),
        seed_defaults: false,
      });
      consola.success(`Created project ${created.id}`);
      projectId = created.id;
      projectSecret = created.project_secret;
      previewToken = created.preview_secret;
    }

    const values: Record<string, string> = {
      ZITADEL_URL: server,
      ZITADEL_PROJECT_ID: projectId,
      ...(projectSecret === undefined ? {} : { ZITADEL_PROJECT_SECRET: projectSecret }),
      ...(previewToken === undefined ? {} : { ZITADEL_PREVIEW_TOKEN: previewToken }),
      // The origin the app serves from, so a CLI run against this environment
      // resolves the same ZITADEL_ISSUER the deployed app registers.
      ...(issuer === undefined ? {} : { ZITADEL_ISSUER: issuer }),
      ...(publicVariable === undefined ? {} : { [publicVariable]: projectId }),
    };
    await writeManagedEnvFile(path, values);
    consola.success(`Wrote ${file}`);

    const appVariables: PlatformVariable[] = [
      { name: "ZITADEL_URL", value: server },
      { name: "ZITADEL_PROJECT_ID", value: projectId },
      ...(publicVariable === undefined ? [] : [{ name: publicVariable, value: projectId }]),
    ];
    const serverRendered = typeof frameworkId === "string" && SERVER_RENDERED.includes(frameworkId);
    const platform = {
      production: [
        ...appVariables,
        ...(serverRendered ? [{ name: "ZITADEL_PROJECT_SECRET", secret: true }] : []),
        { name: "ZITADEL_ENV", value: "production" },
        ...(serverRendered
          ? [
              { name: "ZITADEL_ENVIRONMENT", value: "production" },
              {
                name: "ZITADEL_ISSUER",
                value: issuer ?? "<the URL your production app is served from>",
              },
            ]
          : []),
      ],
      preview: [
        ...appVariables,
        { name: "ZITADEL_ENV", value: "preview" },
        ...(serverRendered ? [{ name: "ZITADEL_ENVIRONMENT", value: "preview" }] : []),
        { name: "ZITADEL_PREVIEW_TOKEN", secret: true },
      ],
      pipeline: [
        { name: "ZITADEL_URL", value: server },
        { name: "ZITADEL_PROJECT_ID", value: projectId },
        { name: "ZITADEL_PROJECT_SECRET", secret: true },
      ],
    };
    // Only a secret actually written to the file can be copied from it. When
    // `--project` binds an id with no ZITADEL_PROJECT_SECRET / PREVIEW_TOKEN in
    // the process environment, the file holds neither, so "copy it from <file>"
    // would send the user to a value that is not there — point them at the
    // project's own secret instead.
    const writtenKeys = new Set(Object.keys(values));
    const render = (variables: PlatformVariable[]): string[] =>
      variables.map((variable) =>
        variable.secret
          ? writtenKeys.has(variable.name)
            ? `  ${variable.name}  (secret, copy it from ${file})`
            : `  ${variable.name}  (secret, copy it from wherever you got this project)`
          : `  ${variable.name}=${variable.value}`,
      );

    return this.emit({
      status: "ok",
      data: {
        title: `Bound ${name} to ${projectId}.`,
        environment: name,
        file,
        server,
        project_id: projectId,
        keys: Object.keys(values),
        platform,
        next_commands: [`zitadel env --env ${name}`],
      },
      pretty: [
        `Wrote ${file} with ${Object.keys(values).join(", ")}`,
        "",
        `Check what resolves: zitadel env --env ${name}`,
        "",
        "The deployed app never reads that file. Set these where it is built and run.",
        "",
        "Hosting platform, production scope:",
        ...render(platform.production),
        "",
        "Hosting platform, preview scope:",
        ...render(platform.preview),
        "",
        "Pipeline secret store, for the job that runs zitadel:",
        ...render(platform.pipeline),
      ].join("\n"),
    });
  }
}
