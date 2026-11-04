import { z } from "zod";
import { basename } from "node:path";

import { Args, Flags } from "@oclif/core";
import type { Parsed } from "@zitadel/config/idp";
import { consola } from "consola";

import { createZitadelClient } from "../../../lib/gateway/client";
import {
  deployInitialRelease,
  EnvironmentDirectory,
  type InitialDeployment,
  isEnvironmentName,
} from "../../../lib/environment";
import { toZitadelError } from "../../../lib/errors";
import { isObject } from "../../../lib/json";
import { EnvironmentService, ProjectService } from "../../../lib/backend";
import { describeBinding } from "./result";
import { reportWarning } from "../../../lib/warnings";
import {
  type Admitted,
  BaseCommand,
  CommandGroups,
  type JsonEnvelope,
  nonBlankString,
} from "../../../lib/oclif";
import { PUBLIC_PROJECT_ID_VARIABLE } from "../../../lib/orca/patchers/rule/public-project-id";
import { readZitadelConfig } from "../../../lib/project";
import { DEFAULT_SERVER, parseServer, resolveServer } from "../../../lib/server";
import { Cmd } from "../../../lib/cmd";
import { environmentSelectorSuffix, projectEnvFile } from "../../../lib/oclif/environment-flags";
import { DEPLOY_ARGS, type EnvironmentSelector, projectCommand } from "../../../lib/suggestion";
import { Promptable } from "../../../lib/oclif/promptable";
import { reads, type Refused, taken } from "../../../lib/oclif/flags";
import { interpolate, type Refusal, refusalError } from "../../../lib/oclif/refusal";

/** What a `.env.<name>.local` that already exists is refused for. */
const FILE_EXISTS_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "{file} already exists",
  hint: "Pass --force to overwrite it.",
};

/** The message the release this command publishes carries. */
const INITIAL_DEPLOY_MESSAGE = "Initial deployment from zitadel env add";

/** What an app URL is refused for: it must be an http(s) URL. */
const APP_URL_REFUSAL: Refusal = {
  message: 'Invalid app URL "{value}"',
  hint: "Use a URL like https://app.acme.com.",
};

/** The environment name the argument holds: one that can name a `.env.<name>.local` file. */
const ENVIRONMENT_NAME: Refused<string> = {
  schema: z.string().trim().refine(isEnvironmentName),
  refusal: {
    message: '"{value}" is not a usable environment name',
    hint: 'Use letters, digits, dot, dash and underscore, and no "..", e.g. production.',
  },
};

/** The URL the app is served from, which must be an http(s) one. */
const APP_URL: Refused<string> = {
  schema: z
    .string()
    .trim()
    .pipe(z.url({ protocol: /^https?$/ })),
  refusal: APP_URL_REFUSAL,
};

/**
 * What a person typed as the URL their app is served from, for a prompt's
 * `parse`: an empty answer is none, and anything else is an http(s) URL.
 */
export function readAppUrl(answer: string): Parsed<string | undefined> {
  const typed = answer.trim();
  if (typed === "") {
    return {
      ok: true,
      value: undefined,
    };
  }
  if (!APP_URL.schema.safeParse(typed).success) {
    return {
      ok: false,
      problem: interpolate(APP_URL_REFUSAL.message, {
        value: typed,
      }),
    };
  }
  return {
    ok: true,
    value: typed,
  };
}

/**
 * `zitadel env add` — bind an environment to a project: create one on the
 * server, or bind an id a teammate sent over, and write the
 * `.env.<name>.local` file that is the environment. The file is the only thing
 * it writes. The deployed app never reads it (it is gitignored and the hosting
 * platform builds from git), so the command ends by printing exactly which
 * values the platform and the pipeline need.
 */
export default class EnvAdd extends Promptable(BaseCommand) {
  static override description = "Bind an environment to a project, creating the project if needed.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> env add production --server https://api.zitadel.cloud --app-url https://app.acme.com",
    "<%= config.bin %> env add staging --server https://api.zitadel.cloud --project proj_01K9AA9M3K7E2QX8VB4T",
  ];
  static override args = {
    name: Args.custom<string>({
      parse: taken(ENVIRONMENT_NAME),
    })({
      required: true,
      description: "The environment name, e.g. production.",
    }),
  };
  static override flags = {
    project: nonBlankString({
      description:
        "Bind this existing project instead of creating one. Its secrets come from ZITADEL_PROJECT_SECRET and ZITADEL_PREVIEW_TOKEN in the process environment.",
    }),
    "app-url": Flags.custom<string>({
      parse: reads(APP_URL),
    })({
      description:
        "The URL this environment's app is served from. It becomes ZITADEL_ISSUER and is registered with a new project.",
    }),
    force: Flags.boolean({ description: "Overwrite an existing .env.<name>.local." }),
  };

  static override meta = {
    resolveServer: false,
  };

  protected async execute({ args, flags }: Admitted<typeof EnvAdd>): Promise<JsonEnvelope> {
    const { cwd, env, nonInteractive, dryRun } = this.meta;
    const environmentService = new EnvironmentService(
      (url) => new ProjectService(createZitadelClient({ baseUrl: url, signal: this.signal })),
      new EnvironmentDirectory(cwd),
    );
    const location = await environmentService.locate(args.name);
    if (location.exists && !flags.force) {
      throw refusalError(FILE_EXISTS_REFUSAL, { file: location.file });
    }
    // `--server` resolves to an origin as it does everywhere; one that was not
    // given is left to the prompt below.
    const givenServer = this.meta.serverFlag
      ? (await resolveServer({ cwd, serverFlag: this.meta.serverFlag })).value
      : undefined;

    const config = await readZitadelConfig(cwd);
    const frameworkId = isObject(config.framework) ? config.framework.id : undefined;
    const publicVariable =
      typeof frameworkId === "string"
        ? PUBLIC_PROJECT_ID_VARIABLE[frameworkId as keyof typeof PUBLIC_PROJECT_ID_VARIABLE]
        : undefined;

    const server =
      givenServer ??
      (await this.input({
        kind: "text",
        name: "server",
        message: "What is the URL of your Zitadel server?",
        flag: "--server",
        initialValue: DEFAULT_SERVER,
        parse: parseServer,
        // The rerun keeps every choice this run made, so binding a project
        // (`--project`) stays a bind rather than creating a new project.
        retry: this.suggestUnscoped(
          [
            `env add ${Cmd.quote(args.name)}`,
            "--server https://api.zitadel.cloud",
            ...(flags.project === undefined ? [] : [Cmd.option("--project", flags.project)]),
            ...(flags.appUrl === undefined ? [] : [Cmd.option("--app-url", flags.appUrl)]),
            ...(flags.force ? ["--force"] : []),
          ].join(" "),
        ),
      }));

    const appUrl =
      flags.appUrl ??
      (nonInteractive
        ? undefined
        : await this.input({
            kind: "text",
            name: "app URL",
            message: "What URL is your app served from? You can leave this empty to skip it.",
            flag: "--app-url",
            placeholder: "https://app.acme.com",
            parse: readAppUrl,
          }));
    const issuer = appUrl === undefined ? undefined : new URL(appUrl).origin;

    if (dryRun) {
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: {
          environment: args.name,
          file: location.file,
          server,
          project_id: flags.project,
          issuer,
        },
      });
    }

    const binding = await environmentService.bind({
      name: args.name,
      directory: basename(cwd),
      server,
      issuer,
      existing:
        flags.project === undefined
          ? undefined
          : {
              projectId: flags.project,
              projectSecret: env.ZITADEL_PROJECT_SECRET,
              previewToken: env.ZITADEL_PREVIEW_TOKEN,
            },
      framework: typeof frameworkId === "string" ? frameworkId : undefined,
      publicVariable,
    });
    if (binding.created) {
      consola.success(`Created project ${binding.projectId}`);
    }
    consola.success(`Wrote ${binding.file}`);

    // The new environment, by the file just written rather than by its name:
    // `--env-file` outranks the process environment, which `--env` does not, so
    // a follow-up run in a shell exporting another project's ZITADEL_* values
    // still acts on the project this run bound.
    const selector = environmentSelectorSuffix({
      envFile: projectEnvFile(flags.cwd, binding.file),
      ...(flags.cwd === undefined ? {} : { cwd: flags.cwd }),
    });
    // A project this run created has never had a release, so the environment
    // serves the server's own defaults until something is deployed to it
    // (#1651). Offer that deploy here, the one moment the project, its secret
    // and its origin are all at hand. A bound project is someone else's and is
    // never offered one, and a run with nobody to ask gets the suggestion in the
    // envelope instead. `--force`, which permits overwriting the env file, never
    // answers a `yes-no`.
    const offerDeployment =
      binding.canDeploy && !nonInteractive && binding.projectSecret !== undefined;
    if (offerDeployment) {
      consola.info(
        "Nothing is deployed to this environment yet, so it serves the server's default schema and login flow rather than your .zitadel/ files.",
      );
    }
    const deployment: InitialDeployment | undefined =
      offerDeployment &&
      binding.projectSecret !== undefined &&
      (await this.input({
        kind: "yes-no",
        name: "deploy .zitadel/ to the new environment",
        message: "Would you like to deploy .zitadel/ to it now?",
        initialValue: true,
      }))
        ? await this.deployInitialRelease({
            cwd,
            server,
            projectId: binding.projectId,
            projectSecret: binding.projectSecret,
            selector,
          })
        : undefined;

    return this.emit({
      status: "ok",
      ...describeBinding({ binding, deployment, selector, cliVersion: this.meta.cliVersion }),
    });
  }

  /**
   * Publish `.zitadel/` to the project this run just created (see
   * {@link deployInitialRelease}).
   *
   * It authenticates with the new project's own secret rather than the one
   * this directory resolves to, since `env add` binds a different project from
   * the one in context. A failure is warned about rather than thrown: the
   * project exists, the file is written, and the deploy is one command away.
   */
  private async deployInitialRelease(opts: {
    cwd: string;
    server: string;
    projectId: string;
    projectSecret: string;
    selector: EnvironmentSelector;
  }): Promise<InitialDeployment | undefined> {
    consola.start("Deploying .zitadel/ to the new environment");
    try {
      const deployment = await deployInitialRelease({
        client: createZitadelClient({
          baseUrl: opts.server,
          token: opts.projectSecret,
          signal: this.signal,
        }),
        projectId: opts.projectId,
        cwd: opts.cwd,
        env: this.env,
        json: this.isJson,
        color: this.isColored,
        message: INITIAL_DEPLOY_MESSAGE,
        suggest: (args) => projectCommand(args, opts.selector, this.cliVersion),
      });
      consola.success(
        `Deployed ${deployment.contentHash} to ${deployment.origins.length} origin${deployment.origins.length === 1 ? "" : "s"}`,
      );
      return deployment;
    } catch (error) {
      reportWarning(
        `The environment was bound but the first deploy failed: ${toZitadelError(error).message}. Run \`zitadel ${DEPLOY_ARGS}${opts.selector}\` to publish it.`,
      );
      return undefined;
    }
  }
}
