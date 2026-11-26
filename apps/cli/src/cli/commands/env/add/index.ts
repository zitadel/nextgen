import { FsError, stat } from "@/lib/fs";
import { basename, join } from "node:path";
import { Args, Flags } from "@oclif/core";
import type { Parsed } from "@zitadel/config/idp";
import { z } from "zod";

import { SERVER } from "@/constants";
import { createZitadelClient, ProjectService } from "@/lib/backend";
import { Environment, type InitialDeployment } from "@/lib/environment";
import { toZitadelError, ZitadelError, ZitadelLibError } from "@/lib/errors";
import { warnings } from "@/lib/ui";
import { CommandGroups } from "@/cli/commands/groups";
import { type Admitted, BaseCommand, type CommandResult, nonBlankString } from "@/cli/core";
import { projectEnvFile } from "@/cli/core/environment-flags";
import { type Refused, reads, taken } from "@/cli/core/flags";
import { interpolate, type Refusal, refusalError } from "@/cli/core/refusal";
import { Previewable } from "@/cli/core/previewable";
import { Promptable } from "@/cli/core/promptable";
import { PUBLIC_PROJECT_ID_VARIABLE } from "@/lib/orca/patchers/rule/public-project-id";
import { type Scope, type Suggest, WHAT_CHANGED } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { Runtime } from "@/lib/runtime";
import {
  Project,
  ProjectEnvValueMultilineError,
  ProjectEnvValueUnquotableError,
} from "@/lib/project";
import { ChoosingServerCommand } from "@/cli/commands/server-command";
import { dryRunResult } from "@/cli/core/crud/shared";
import { Telemetered } from "@/cli/telemetry/telemetered";

/** What a `.env.<name>.local` that already exists is refused for. */
const FILE_EXISTS_REFUSAL = {
  code: "E_CONFLICT",
  message: "{file} already exists",
  hint: "Pass --force to overwrite it.",
} as const satisfies Refusal;

/** A variable to set on a hosting platform or in a pipeline. A secret is named, never printed. */
type PlatformVariable = { name: string; value?: string; secret?: boolean };

/** The frameworks whose server needs the project secret at runtime (the session exchange). */
const SERVER_RENDERED = ["next", "nuxt"];

/** The message the release this command publishes carries. */
const INITIAL_DEPLOY_MESSAGE = "Initial deployment from env add";

/** How a value with a line break, which a `.env` file cannot hold, is refused. */
const VALUE_MULTILINE_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "A .env value is a single line; remove the newline or store the value another way.",
} as const satisfies Refusal;

/** How a value no `.env` quoting reads back unchanged is refused. */
const VALUE_UNQUOTABLE_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Set it in the process environment instead of a .env file.",
} as const satisfies Refusal;

/** What an app URL is refused for: it must be an http(s) URL. */
const APP_URL_REFUSAL = {
  message: 'Invalid app URL "{value}"',
  hint: "Use a URL like https://app.acme.com.",
} as const satisfies Refusal;

/** The environment name the argument holds: one that can name a `.env.<name>.local` file. */
const ENVIRONMENT_NAME = {
  schema: z.string().trim().refine(Environment.isName),
  refusal: {
    message: '"{value}" is not a usable environment name',
    hint: 'Use letters, digits, dot, dash and underscore, and no "..", e.g. production.',
  },
} as const satisfies Refused<string>;

/** The URL the app is served from, which must be an http(s) one. */
const APP_URL = {
  schema: z
    .string()
    .trim()
    .pipe(z.url({ protocol: /^https?$/ })),
  refusal: APP_URL_REFUSAL,
} as const satisfies Refused<string>;

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
export default class EnvAdd extends Telemetered(
  Promptable(Previewable(ChoosingServerCommand(BaseCommand))),
) {
  static override description = "Bind an environment to a project, creating the project if needed.";
  static override group = CommandGroups.projectSettings;
  static override groupOrder = 2;

  static override examples = [
    `<%= config.bin %> env add production --server ${SERVER} --app-url https://app.acme.com`,
    `<%= config.bin %> env add staging --server ${SERVER} --project proj_01K9AA9M3K7E2QX8VB4T`,
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

  /**
   * Says what would be written and bound, without creating a project.
   *
   * @param input - The arguments and flags the command accepts.
   * @returns The envelope of the dry run.
   */
  protected async preview({ args, flags }: Admitted<typeof EnvAdd>): Promise<CommandResult> {
    const { environment, server, issuer } = await this.gathered({ args, flags });
    const dryRun = dryRunResult({
      verb: "add",
      topic: "environment",
      noun: `the ${args.name} environment`,
      clause: `bound to ${flags.project ?? "a new project"}`,
      next: await this.again("env:add", {
        without: ["dryRun"],
        with: { server },
      }),
    });

    return {
      ...dryRun,
      pretty: undefined,
      data: {
        ...(dryRun.data as object),
        environment: args.name,
        file: environment.file,
        server,
        project_id: flags.project,
        issuer,
      },
      summary: {
        ...dryRun.summary,
        lines: [
          escapeControlCharacters(
            flags.project === undefined
              ? `Would create a project on ${server}`
              : `Would bind the existing project ${flags.project}`,
          ),
          escapeControlCharacters(`Would write ${environment.file}`),
        ],
      },
    };
  }

  /**
   * Creates or binds the project and writes the environment's file.
   *
   * The file holds the origin the app serves from as ZITADEL_ISSUER, so a CLI
   * run against this environment resolves the same issuer the deployed app
   * registers. Only a secret actually written to the file can be copied from
   * it: when `--project` binds an id with no ZITADEL_PROJECT_SECRET or
   * ZITADEL_PREVIEW_TOKEN in the process environment, the file holds neither,
   * so the platform listing points at the project's own secret instead.
   *
   * Follow-up commands act on the new environment by the file just written
   * rather than by its name: `--env-file` outranks the process environment,
   * which `--env` does not, so a follow-up run in a shell exporting another
   * project's ZITADEL_* values still acts on the project this run bound. This
   * run's own selection is not it either way.
   *
   * A created project already holds its app URL as a primary origin, which
   * closes it; only a bound one (`--project`) still needs the pattern added,
   * and a bound project admits no origin except a loopback origin until the
   * first pattern is added. A deploy lands on the project's primary origins,
   * and a created project holds one only when an app URL was given. Without it
   * there is nowhere to land, so the server refuses the deploy however it is
   * reached: offering it would ask for something that cannot work, and naming
   * it would send the reader to a command that fails the same way.
   *
   * A project this run created has never had a release, so the environment
   * serves the server's own defaults until something is deployed to it. The
   * deploy is offered here, the one moment the project, its secret and its
   * origin are all at hand. A bound project is someone else's and may already
   * serve a release of its own, so it is never offered one, and a run with
   * nobody to ask gets the suggestion in the envelope instead: there is no
   * flag to deploy without being asked, because an agent that wants one runs
   * `deploy` itself. `--force`, which permits overwriting the env file, never
   * answers a `yes-no`. The warning that nothing is deployed is said even when
   * nobody could be asked, because it is the one thing standing between this
   * environment and a working app: until a release is deployed the project
   * refuses sign-in, and the `.zitadel/` files in this directory are not
   * served. With an origin the deploy is in the next steps.
   *
   * The runnable `origin add` is in the next steps, and `next_commands` is
   * machine-readable, so the entry is included only when it is actually
   * runnable: a concrete origin (without `--app-url` it would be a
   * `<your-app-url>` placeholder the shell reads as redirection) and a project
   * secret in the file for it to authenticate with. The renderer quotes the
   * origin, since an IPv6 issuer like http://[::1]:3000 carries brackets a
   * shell such as zsh would treat as a glob. When the entry is not runnable,
   * the human-facing guidance spells it out instead: for a placeholder origin,
   * or a file without the project secret it would authenticate with. The
   * `deployment` in the data is the one this run made, and `null` whenever
   * none was made: a `--project` bind, a run with nobody to ask, a declined
   * prompt, or a deploy that failed.
   *
   * @param input - The arguments and flags the command accepts.
   * @returns The envelope of the run.
   */
  protected async apply({ args, flags }: Admitted<typeof EnvAdd>): Promise<CommandResult> {
    const { env, cwd, nonInteractive } = this.meta;
    const { environment, server, issuer, frameworkId, publicVariable } = await this.gathered({
      args,
      flags,
    });

    this.info(`Adding the ${args.name} environment`);
    const project =
      flags.project === undefined
        ? await new ProjectService(
            createZitadelClient({
              userAgent: Runtime.current().userAgent(),
              baseUrl: server,
              signal: this.signal,
            }),
          ).create({
            name: `${basename(cwd)}-${args.name}`,
            ...(issuer === undefined
              ? {}
              : {
                  origins: [
                    {
                      pattern: issuer,
                      kind: "primary" as const,
                    },
                  ],
                }),
            seed_defaults: false,
          })
        : {
            id: flags.project,
            project_secret: env.ZITADEL_PROJECT_SECRET,
            preview_secret: env.ZITADEL_PREVIEW_TOKEN,
          };
    if (flags.project === undefined) {
      this.debug(`Created project ${escapeControlCharacters(project.id)}`);
    }
    const { id: projectId, project_secret: projectSecret, preview_secret: previewToken } = project;
    this.ui.ranAgainst(projectId, server);

    const values: Record<string, string> = {
      ZITADEL_URL: server,
      ZITADEL_PROJECT_ID: projectId,
      ...(projectSecret === undefined ? {} : { ZITADEL_PROJECT_SECRET: projectSecret }),
      ...(previewToken === undefined ? {} : { ZITADEL_PREVIEW_TOKEN: previewToken }),
      ...(issuer === undefined ? {} : { ZITADEL_ISSUER: issuer }),
      ...(publicVariable === undefined ? {} : { [publicVariable]: projectId }),
    };
    await Project.envFile(environment.path)
      .write(values)
      .catch((error: unknown) => {
        if (error instanceof ProjectEnvValueMultilineError) {
          throw refusalError(VALUE_MULTILINE_REFUSAL, {
            ...error,
            message: error.message,
          });
        }
        if (error instanceof ProjectEnvValueUnquotableError) {
          throw refusalError(VALUE_UNQUOTABLE_REFUSAL, {
            ...error,
            message: error.message,
          });
        }
        throw error;
      });
    this.debug(`Wrote ${escapeControlCharacters(environment.file)}`);

    const appVariables: PlatformVariable[] = [
      {
        name: "ZITADEL_URL",
        value: server,
      },
      {
        name: "ZITADEL_PROJECT_ID",
        value: projectId,
      },
      ...(publicVariable === undefined
        ? []
        : [
            {
              name: publicVariable,
              value: projectId,
            },
          ]),
    ];
    const serverRendered = typeof frameworkId === "string" && SERVER_RENDERED.includes(frameworkId);
    const platform = {
      production: [
        ...appVariables,
        ...(serverRendered
          ? [
              {
                name: "ZITADEL_PROJECT_SECRET",
                secret: true,
              },
            ]
          : []),
        {
          name: "ZITADEL_ENV",
          value: "production",
        },
        ...(serverRendered
          ? [
              {
                name: "ZITADEL_ENVIRONMENT",
                value: "production",
              },
              {
                name: "ZITADEL_ISSUER",
                value: issuer ?? "<the URL your production app is served from>",
              },
            ]
          : []),
      ],
      preview: [
        ...appVariables,
        {
          name: "ZITADEL_ENV",
          value: "preview",
        },
        ...(serverRendered
          ? [
              {
                name: "ZITADEL_ENVIRONMENT",
                value: "preview",
              },
            ]
          : []),
        {
          name: "ZITADEL_PREVIEW_TOKEN",
          secret: true,
        },
      ],
      pipeline: [
        {
          name: "ZITADEL_URL",
          value: server,
        },
        {
          name: "ZITADEL_PROJECT_ID",
          value: projectId,
        },
        {
          name: "ZITADEL_PROJECT_SECRET",
          secret: true,
        },
      ],
    };
    const writtenKeys = new Set(Object.keys(values));
    const newEnvironment: Scope = {
      envFile: projectEnvFile(flags.cwd, environment.file),
      ...(flags.cwd === undefined ? {} : { cwd: flags.cwd }),
    };
    const suggestOnNew = this.suggestWith(newEnvironment);
    const needsOrigin = flags.project !== undefined;
    const createdProject = !needsOrigin;
    const hasSomewhereToLand = createdProject && issuer !== undefined;
    const offerDeployment = hasSomewhereToLand && !nonInteractive && projectSecret !== undefined;
    if (offerDeployment) {
      this.info(
        "Nothing is deployed to this environment yet, so sign-in is refused until your .zitadel/ files are deployed.",
      );
    }
    const deployment: InitialDeployment | undefined =
      offerDeployment &&
      (await this.ask.yesNo({
        name: "deploy .zitadel/ to the new environment",
        message: "Would you like to deploy .zitadel/ to it now?",
        initialValue: true,
      }))
        ? await this.deployInitialRelease({
            cwd,
            server,
            projectId,
            projectSecret,
            suggest: suggestOnNew,
          })
        : undefined;
    const render = (variables: PlatformVariable[]): string[] => {
      return variables.map((variable) => {
        return variable.secret
          ? writtenKeys.has(variable.name)
            ? `  ${variable.name}  (secret, copy it from ${environment.file})`
            : `  ${variable.name}  (secret, copy it from wherever you got this project)`
          : `  ${variable.name}=${variable.value ?? ""}`;
      });
    };

    const awaitingProjectSecret = needsOrigin && !writtenKeys.has("ZITADEL_PROJECT_SECRET");
    const secretGuidance = awaitingProjectSecret
      ? [
          `Allow this project's origin once ZITADEL_PROJECT_SECRET is in ${environment.file}: ${suggestOnNew(
            {
              id: "origin:add",
              args: { pattern: issuer ?? "<your-app-url>" },
              flags: { kind: "primary" },
            },
          )}`,
        ]
      : [];
    const placeholderGuidance =
      needsOrigin && !awaitingProjectSecret && issuer === undefined
        ? [
            `Allow this project's origin: ${suggestOnNew({
              id: "origin:add",
              args: { pattern: "<your-app-url>" },
              flags: { kind: "primary" },
            })}`,
          ]
        : [];
    const originGuidance = [...placeholderGuidance, ...secretGuidance];
    const undeployed = createdProject && deployment === undefined;
    const undeployedGuidance = undeployed
      ? [
          `Nothing is deployed to ${args.name} yet, so sign-in is refused until .zitadel/ is deployed.`,
        ]
      : [];
    const originFirstGuidance =
      undeployed && !hasSomewhereToLand
        ? [
            `Give it an origin first: ${suggestOnNew({
              id: "origin:add",
              args: { pattern: "<your-app-url>" },
              flags: { kind: "primary" },
            })}`,
            `Then deploy to it: ${suggestOnNew({
              id: "deploy",
              flags: { message: WHAT_CHANGED },
            })}`,
          ]
        : [];
    const deployGuidance = [...undeployedGuidance, ...originFirstGuidance];
    const guidance = [...originGuidance, ...deployGuidance];

    const title = `Added the ${args.name} environment, bound to ${projectId}`;

    return {
      status: "ok",
      data: {
        title,
        environment: args.name,
        file: environment.file,
        server,
        project_id: projectId,
        keys: Object.keys(values),
        platform,
        deployment:
          deployment === undefined
            ? null
            : {
                release_id: deployment.releaseId,
                content_hash: deployment.contentHash,
                deployment_id: deployment.deploymentId,
                origins: [...deployment.origins],
              },
      },
      summary: {
        title: escapeControlCharacters(title),
        sections: [],
        lines: [
          ...(createdProject ? [`Created project ${projectId}`] : []),
          `Wrote ${environment.file}`,
          ...(deployment === undefined
            ? []
            : [
                `Deployed ${deployment.contentHash} to ${deployment.origins.length} ${new Intl.PluralRules("en").select(deployment.origins.length) === "one" ? "origin" : "origins"}`,
              ]),
          `${environment.file} holds ${Object.keys(values).join(", ")}.`,
          ...(guidance.length === 0 ? [] : ["", ...guidance]),
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
        ].map((line) => {
          return escapeControlCharacters(line);
        }),
      },
      next: {
        commands: [
          ...(needsOrigin && issuer !== undefined && writtenKeys.has("ZITADEL_PROJECT_SECRET")
            ? // The renderer quotes the origin: an IPv6 issuer like http://[::1]:3000
              [
                suggestOnNew({
                  id: "origin:add",
                  args: { pattern: issuer },
                  flags: { kind: "primary" },
                }),
              ]
            : []),
          ...(hasSomewhereToLand && deployment === undefined
            ? [
                suggestOnNew({
                  id: "deploy",
                  flags: { message: WHAT_CHANGED },
                }),
              ]
            : []),
          suggestOnNew({ id: "env" }),
        ],
      },
    };
  }

  /**
   * What both a dry run and the real run settle before anything is written:
   * the `.env.<name>.local` file this run writes, which is a conflict when it
   * already exists unless `--force` says it may be overwritten, the server, the app URL and the names the project
   * is bound with. `--server` resolves to an origin as it does everywhere,
   * before anything else is read; one that was not given is asked for. The
   * rerun suggested for the question keeps every choice this run made, so
   * binding a project (`--project`) stays a bind rather than creating a new
   * project.
   *
   * @param input - The arguments and flags the command accepts.
   * @returns What the run settled.
   */
  private async gathered({ args, flags }: Pick<Admitted<typeof EnvAdd>, "args" | "flags">) {
    const { cwd, nonInteractive } = this.meta;
    const file = Project.envFileName(args.name);
    const path = join(cwd, file);
    const exists = await stat(path)
      .then(() => {
        return true;
      })
      .catch((error: unknown) => {
        if (error instanceof FsError) {
          return false;
        }
        throw error;
      });
    if (exists && !flags.force) {
      throw refusalError(FILE_EXISTS_REFUSAL, {
        file,
      });
    }
    const environment = {
      file,
      path,
    };
    const givenServer = await this.givenServer();
    const config = await Project.at(cwd).config();
    const frameworkId = config.frameworkId;
    const publicVariable =
      typeof frameworkId === "string"
        ? PUBLIC_PROJECT_ID_VARIABLE[frameworkId as keyof typeof PUBLIC_PROJECT_ID_VARIABLE]
        : undefined;

    const server =
      givenServer ??
      (await this.askServer(await this.again("env:add", { with: { server: SERVER } })));

    const appUrl =
      flags.appUrl ??
      (nonInteractive
        ? undefined
        : await this.ask.text({
            name: "app URL",
            message: "What URL is your app served from? You can leave this empty to skip it.",
            flag: "--app-url",
            placeholder: "https://app.acme.com",
            parse: readAppUrl,
          }));
    const issuer = appUrl === undefined ? undefined : new URL(appUrl).origin;

    return {
      environment,
      server,
      issuer,
      frameworkId,
      publicVariable,
    };
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
    suggest: Suggest;
  }): Promise<InitialDeployment | undefined> {
    this.info("Deploying .zitadel/ to the new environment");
    try {
      const deployment = await Environment.deployInitialRelease({
        client: createZitadelClient({
          userAgent: Runtime.current().userAgent(),
          baseUrl: opts.server,
          token: opts.projectSecret,
          signal: this.signal,
        }),
        projectId: opts.projectId,
        cwd: opts.cwd,
        env: this.env,
        message: INITIAL_DEPLOY_MESSAGE,
        narrate: (notices) => {
          this.narrate(notices);
        },
      });
      this.debug(
        `Deployed ${escapeControlCharacters(deployment.contentHash)} to ${deployment.origins.length} ${new Intl.PluralRules("en").select(deployment.origins.length) === "one" ? "origin" : "origins"}`,
      );
      return deployment;
    } catch (error) {
      if (error instanceof ZitadelLibError) {
        warnings.report(
          `The environment was bound but the first deploy failed: ${toZitadelError(error).message}. Run ${opts.suggest(
            {
              id: "deploy",
              flags: { message: WHAT_CHANGED },
            },
          )} to publish it.`,
        );
        return undefined;
      }
      if (error instanceof ZitadelError) {
        warnings.report(
          `The environment was bound but the first deploy failed: ${error.message}. Run ${opts.suggest(
            {
              id: "deploy",
              flags: { message: WHAT_CHANGED },
            },
          )} to publish it.`,
        );
        return undefined;
      }
      throw error;
    }
  }
}
