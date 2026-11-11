import { stat } from "node:fs/promises";
import { z } from "zod";
import { basename, join } from "node:path";
import { Args, Flags } from "@oclif/core";
import type { Parsed } from "@zitadel/config/idp";

import { createZitadelClient, ProjectService } from "@/lib/backend";
import { Cmd } from "@/lib/cmd";
import { deployInitialRelease, type InitialDeployment, isEnvironmentName } from "@/lib/environment";
import { toZitadelError } from "@/lib/errors";
import { writeManagedEnvFile } from "@/lib/fs-safe";
import { isObject } from "@/lib/json";
import { log } from "@/lib/log";
import {
  type Admitted,
  BaseCommand,
  CommandGroups,
  type JsonEnvelope,
  nonBlankString,
} from "@/lib/oclif";
import { environmentSelectorSuffix, projectEnvFile } from "@/lib/oclif/environment-flags";
import { reads, type Refused, taken } from "@/lib/oclif/flags";
import { Promptable } from "@/lib/oclif/promptable";
import { interpolate, type Refusal, refusalError } from "@/lib/oclif/refusal";
import { Suggestible } from "@/lib/oclif/suggestible";
import { PUBLIC_PROJECT_ID_VARIABLE } from "@/lib/orca/patchers/rule/public-project-id";
import { readZitadelConfig } from "@/lib/project";
import { DEFAULT_SERVER, parseServer, resolveServer } from "@/lib/server";
import { DEPLOY_ARGS, type EnvironmentSelector, projectCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { userAgent } from "@/lib/user-agent";
import { reportWarning } from "@/lib/warnings";

/** What a `.env.<name>.local` that already exists is refused for. */
const FILE_EXISTS_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "{file} already exists",
  hint: "Pass --force to overwrite it.",
};

/**
 * The `.env.<name>.local` file this run writes. One that already exists is a
 * conflict unless `--force` says it may be overwritten.
 */
async function environmentFile(
  cwd: string,
  name: string,
  force: boolean,
): Promise<{ file: string; path: string }> {
  const file = `.env.${name}.local`;
  const path = join(cwd, file);
  const exists = await stat(path).then(
    () => {
      return true;
    },
    () => {
      return false;
    },
  );
  if (exists && !force) {
    throw refusalError(FILE_EXISTS_REFUSAL, {
      file,
    });
  }
  return {
    file,
    path,
  };
}

/** A variable to set on a hosting platform or in a pipeline. A secret is named, never printed. */
type PlatformVariable = { name: string; value?: string; secret?: boolean };

/** The frameworks whose server needs the project secret at runtime (the session exchange). */
const SERVER_RENDERED = ["next", "nuxt"];

/** The message the release this command publishes carries. */
const INITIAL_DEPLOY_MESSAGE = "Initial deployment from env add";

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
export default class EnvAdd extends Suggestible(Promptable(BaseCommand)) {
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
    const environment = await environmentFile(cwd, args.name, flags.force);
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
      (await this.ask.text({
        name: "server",
        message: "What is the URL of your Zitadel server?",
        flag: "--server",
        initialValue: DEFAULT_SERVER,
        parse: parseServer,
        // The rerun keeps every choice this run made, so binding a project
        // (`--project`) stays a bind rather than creating a new project.
        retry: this.suggest(
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
        : await this.ask.text({
            name: "app URL",
            message: "What URL is your app served from? You can leave this empty to skip it.",
            flag: "--app-url",
            placeholder: "https://app.acme.com",
            parse: readAppUrl,
          }));
    const issuer = appUrl === undefined ? undefined : new URL(appUrl).origin;

    if (dryRun) {
      return this.emit({
        status: "ok",
        data: {
          dry_run: true,
          environment: args.name,
          file: environment.file,
          server,
          project_id: flags.project,
          issuer,
        },
        summary: {
          title: escapeControlCharacters(
            `Would add the ${args.name} environment, bound to ${flags.project ?? "a new project"} (dry run)`,
          ),
          sections: [],
          lines: [
            escapeControlCharacters(
              flags.project === undefined
                ? `Would create a project on ${server}`
                : `Would bind the existing project ${flags.project}`,
            ),
            escapeControlCharacters(`Would write ${environment.file}`),
          ],
        },
      });
    }

    const project =
      flags.project === undefined
        ? await new ProjectService(
            createZitadelClient({ userAgent: userAgent(), baseUrl: server, signal: this.signal }),
          ).create({
            name: `${basename(cwd)}-${args.name}`,
            ...(issuer === undefined
              ? {}
              : { origins: [{ pattern: issuer, kind: "primary" as const }] }),
            seed_defaults: false,
          })
        : {
            id: flags.project,
            project_secret: env.ZITADEL_PROJECT_SECRET,
            preview_secret: env.ZITADEL_PREVIEW_TOKEN,
          };
    if (flags.project === undefined) {
      log.done(`Created project ${escapeControlCharacters(project.id)}`);
    }
    const { id: projectId, project_secret: projectSecret, preview_secret: previewToken } = project;
    this.ui.ranAgainst(projectId, server);

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
    await writeManagedEnvFile(environment.path, values);
    log.done(`Wrote ${environment.file}`);

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
    // The new environment, by the file just written rather than by its name:
    // `--env-file` outranks the process environment, which `--env` does not, so
    // a follow-up run in a shell exporting another project's ZITADEL_* values
    // still acts on the project this run bound. This run's own selection is
    // not it either way.
    const newEnvironment = environmentSelectorSuffix({
      envFile: projectEnvFile(flags.cwd, environment.file),
      ...(flags.cwd === undefined ? {} : { cwd: flags.cwd }),
    });
    // A created project already holds its app URL as a primary origin, which
    // closes it; only a bound one (`--project`) still needs the pattern added.
    const needsOrigin = flags.project !== undefined;
    const createdProject = !needsOrigin;
    // A deploy lands on the project's primary origins, and a created project
    // holds one only when an app URL was given. Without it there is nowhere
    // to land, so the deploy is refused by the server however it is reached:
    // offering it would ask for something that cannot work, and naming it
    // would send the reader to a command that fails the same way.
    const hasSomewhereToLand = createdProject && issuer !== undefined;
    const { cliVersion } = this.meta;
    // A project this run created has never had a release, so the environment
    // serves the server's own defaults until something is deployed to it.
    // Offer that deploy here, the one moment the project, its secret and its
    // origin are all at hand. A bound project (`--project`) is
    // someone else's and may already serve a release of its own, so it is
    // never offered one, and a run with nobody to ask gets the suggestion in
    // the envelope instead — there is no flag to deploy without being asked,
    // because an agent that wants one runs `deploy` itself. `--force`, which
    // permits overwriting the env file, never answers a `yes-no`.
    const offerDeployment = hasSomewhereToLand && !nonInteractive && projectSecret !== undefined;
    if (offerDeployment) {
      log.info(
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
            selector: newEnvironment,
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

    // The runnable `origin add` is in the next steps; the line here is
    // for the one they cannot hold: a placeholder origin, or a file
    // without the project secret it would authenticate with.
    let originGuidance: string[] = [];
    if (needsOrigin) {
      if (writtenKeys.has("ZITADEL_PROJECT_SECRET")) {
        if (issuer === undefined) {
          originGuidance = [
            `Allow this project's origin: ${projectCommand("origin add '<your-app-url>' --kind primary", newEnvironment, this.cliVersion)}`,
          ];
        }
      } else {
        originGuidance = [
          `Allow this project's origin once ZITADEL_PROJECT_SECRET is in ${environment.file}: ${projectCommand(`origin add ${issuer === undefined ? "'<your-app-url>'" : Cmd.quote(issuer)} --kind primary`, newEnvironment, this.cliVersion)}`,
        ];
      }
    }
    // Said even when nobody could be asked, because it is the one thing
    // standing between this environment and a working app: until a
    // release is deployed the project refuses sign-in, and the `.zitadel/`
    // files in this directory are not served.
    let deployGuidance: string[] = [];
    if (createdProject && deployment === undefined) {
      deployGuidance = [
        `Nothing is deployed to ${args.name} yet, so sign-in is refused until .zitadel/ is deployed.`,
      ];
      // With an origin, the deploy is in the next steps.
      if (!hasSomewhereToLand) {
        deployGuidance = [
          ...deployGuidance,
          `Give it an origin first: ${projectCommand("origin add '<your-app-url>' --kind primary", newEnvironment, this.cliVersion)}`,
          `Then deploy to it: ${projectCommand(DEPLOY_ARGS, newEnvironment, this.cliVersion)}`,
        ];
      }
    }

    return this.emit({
      status: "ok",
      data: {
        title: `Bound ${args.name} to ${projectId}`,
        environment: args.name,
        file: environment.file,
        server,
        project_id: projectId,
        keys: Object.keys(values),
        platform,
        // The deployment this run made, so the environment serves the
        // developer's `.zitadel/` rather than whatever the server serves a
        // project with nothing deployed to it. `null` whenever none was made:
        // a `--project` bind, a run with nobody to ask, a declined prompt, or
        // a deploy that failed.
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
        title: escapeControlCharacters(`Added the ${args.name} environment, bound to ${projectId}`),
        sections: [],
        lines: [
          `${environment.file} holds ${Object.keys(values).join(", ")}.`,
          ...guidanceBlock([...originGuidance, ...deployGuidance]),
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
      // A bound project admits no origin except a loopback origin until the
      // first pattern is added, so the first step is `origin add` before
      // anything ships. `next_commands` is machine-readable, so the entry is
      // included only when it is actually runnable: a concrete origin (without
      // `--app-url` it would be a `<your-app-url>` placeholder the shell
      // reads as redirection) and a project secret in the file for it to
      // authenticate with (a `--project` bind with no secret cannot). When it
      // is not runnable, the human-facing line below spells it out instead.
      next: {
        commands: [
          ...(needsOrigin && issuer !== undefined && writtenKeys.has("ZITADEL_PROJECT_SECRET")
            ? // Cmd.quote quotes the origin: an IPv6 issuer like http://[::1]:3000
              // carries brackets a shell such as zsh would treat as a glob.
              [
                projectCommand(
                  `origin add ${Cmd.quote(issuer)} --kind primary`,
                  newEnvironment,
                  cliVersion,
                ),
              ]
            : []),
          // Only a created project is offered a deploy: it is this run's own,
          // it has never had a release, and the file just written holds the
          // secret the deploy authenticates with. A `--project` bind is a
          // project someone else owns and may already serve a release of
          // their own, so this run does not propose replacing it.
          ...(hasSomewhereToLand && deployment === undefined
            ? [projectCommand(DEPLOY_ARGS, newEnvironment, cliVersion)]
            : []),
          projectCommand("env", newEnvironment, cliVersion),
        ],
      },
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
    log.start("Deploying .zitadel/ to the new environment");
    try {
      const deployment = await deployInitialRelease({
        client: createZitadelClient({
          userAgent: userAgent(),
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
        narrate: (notices) => {
          this.narrate(notices);
        },
        suggest: (args) => {
          return projectCommand(args, opts.selector, this.cliVersion);
        },
      });
      log.done(
        `Deployed ${deployment.contentHash} to ${deployment.origins.length} ${new Intl.PluralRules("en").select(deployment.origins.length) === "one" ? "origin" : "origins"}`,
      );
      return deployment;
    } catch (error) {
      reportWarning(
        `The environment was bound but the first deploy failed: ${toZitadelError(error).message}. Run ${projectCommand(DEPLOY_ARGS, opts.selector, this.cliVersion)} to publish it.`,
      );
      return undefined;
    }
  }
}

/** Lines under a blank line that sets them apart, or nothing when there are none. */
function guidanceBlock(lines: string[]): string[] {
  return lines.length === 0 ? [] : ["", ...lines];
}
