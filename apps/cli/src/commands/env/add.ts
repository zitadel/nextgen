import { stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { Flags } from "@oclif/core";
import { consola } from "consola";

import { createZitadelClient } from "../../lib/api-client";
import { toZitadelError, ZitadelError } from "../../lib/errors";
import { isEnvironmentName } from "../../lib/environment";
import { writeManagedEnvFile } from "../../lib/fs-safe";
import { input } from "../../lib/input";
import { isObject } from "../../lib/json";
import {
  buildBundle,
  createDeployment,
  createReleaseFromBundle,
  DEPLOY_ARGS,
  headSha,
  runSteps,
  type StepContext,
  validateStep,
  worktreeIsDirty,
} from "../../lib/release";
import { reportWarning } from "../../lib/warnings";
import {
  BaseCommand,
  CommandGroups,
  type JsonEnvelope,
  nonBlankArg,
  nonBlankString,
} from "../../lib/oclif";
import { PUBLIC_PROJECT_ID_VARIABLE } from "../../lib/orca/patchers/rule/public-project-id";
import { readZitadelConfig } from "../../lib/project";
import { DEFAULT_SERVER, parseServer, resolveServer } from "../../lib/server";
import { shellArg, shellOption } from "../../lib/shell";
import { environmentSelectorSuffix } from "../../lib/oclif/environment-flags";
import { nextCommandsData } from "../../lib/oclif/envelope";
import { type EnvironmentSelector, projectCommand } from "../../lib/suggestion";
import { Promptable } from "../../lib/oclif/promptable";

/** A variable to set on a hosting platform or in a pipeline. A secret is named, never printed. */
type PlatformVariable = { name: string; value?: string; secret?: boolean };

/** The frameworks whose server needs the project secret at runtime (the session exchange). */
const SERVER_RENDERED = ["next", "nuxt"];

/** The message the release this command publishes carries. */
const INITIAL_DEPLOY_MESSAGE = "Initial deployment from zitadel env add";

/** What the initial deploy published, for the envelope to report. */
type DeployedRelease = {
  readonly releaseId: string;
  readonly contentHash: string;
  readonly deploymentId: string;
  readonly origins: readonly string[];
};

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

    const server = serverFlag
      ? (await resolveServer({ cwd, serverFlag })).value
      : await this.input({
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
              `env add ${shellArg(name)}`,
              "--server https://api.zitadel.cloud",
              ...(flags.project === undefined ? [] : [shellOption("--project", flags.project)]),
              ...(flags["app-url"] === undefined
                ? []
                : [shellOption("--app-url", flags["app-url"])]),
              ...(flags.force ? ["--force"] : []),
            ].join(" "),
          ),
        });

    const appUrl =
      flags["app-url"] ??
      (nonInteractive
        ? undefined
        : await this.input({
            kind: "text",
            name: "app URL",
            message: "What URL is your app served from? You can leave this empty to skip it.",
            flag: "--app-url",
            placeholder: "https://app.acme.com",
            parse: (answer: string) => ({ ok: true, value: answer.trim() || undefined }) as const,
          }));
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
        ...(issuer === undefined
          ? {}
          : { origins: [{ pattern: issuer, kind: "primary" as const }] }),
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
    // The new environment, by the file just written rather than by its name:
    // `--env-file` outranks the process environment, which `--env` does not, so
    // a follow-up run in a shell exporting another project's ZITADEL_* values
    // still acts on the project this run bound. This run's own selection is
    // not it either way.
    const newEnvironment = environmentSelectorSuffix({
      envFile: file,
      ...(typeof flags.cwd === "string" ? { cwd: flags.cwd } : {}),
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
    // serves the server's own defaults until something is deployed to it
    // (#1651). Offer that deploy here, the one moment the project, its secret
    // and its origin are all at hand. A bound project (`--project`) is
    // someone else's and may already serve a release of its own, so it is
    // never offered one, and a run with nobody to ask gets the suggestion in
    // the envelope instead — there is no flag to deploy without being asked,
    // because an agent that wants one runs `deploy` itself. The question does
    // not go through `this.input`: that one answers a confirm when `--force`
    // is given, and here `--force` permits overwriting the env file, so it
    // must never answer it.
    let deployment: DeployedRelease | undefined;
    if (hasSomewhereToLand && !nonInteractive && projectSecret !== undefined) {
      consola.info(
        "Nothing is deployed to this environment yet, so it serves the server's default schema and login flow rather than your .zitadel/ files.",
      );
      const confirmed = await input(
        {
          kind: "confirm",
          name: "deploy .zitadel/ to the new environment",
          message: "Would you like to deploy .zitadel/ to it now?",
          initialValue: true,
        },
        {
          interactive: !nonInteractive,
          force: false,
          before: () => this.ui.open(),
          after: () => this.ui.answered(),
        },
      );
      if (confirmed) {
        deployment = await this.deployInitialRelease({
          cwd,
          server,
          projectId,
          projectSecret,
          selector: newEnvironment,
        });
      }
    }
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
      boxed: true,
      data: {
        title: `Bound ${name} to ${projectId}.`,
        environment: name,
        file,
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
        // A bound project admits every origin until the first pattern closes
        // it, so the first step is to add one — `origin add` — before anything
        // ships. `next_commands` is machine-readable, so the entry is included
        // only when it is actually runnable: a concrete origin (without
        // `--app-url` it would be a `<your-app-url>` placeholder the shell
        // reads as redirection) and a project secret in the file for it to
        // authenticate with (a `--project` bind with no secret cannot). The
        // human-facing line below still spells it out.
        ...nextCommandsData([
          ...(needsOrigin && issuer !== undefined && writtenKeys.has("ZITADEL_PROJECT_SECRET")
            ? // shellArg quotes the origin: an IPv6 issuer like http://[::1]:3000
              // carries brackets a shell such as zsh would treat as a glob.
              [
                projectCommand(
                  `origin add ${shellArg(issuer)} --kind primary`,
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
        ]),
      },
      pretty: [
        `Wrote ${file} with ${Object.keys(values).join(", ")}`,
        "",
        // Quoted like the machine command, and only offered when it can run:
        // without the project secret in the file it would fail to authenticate.
        ...(needsOrigin
          ? [
              writtenKeys.has("ZITADEL_PROJECT_SECRET")
                ? `Allow this project's origin: zitadel origin add ${issuer === undefined ? "'<your-app-url>'" : shellArg(issuer)} --kind primary${newEnvironment}`
                : `Allow this project's origin once ZITADEL_PROJECT_SECRET is in ${file}: zitadel origin add ${issuer === undefined ? "'<your-app-url>'" : shellArg(issuer)} --kind primary${newEnvironment}`,
            ]
          : []),
        // Said even when nobody could be asked, because it is the one thing
        // standing between this environment and a working app: until a
        // release is deployed the project serves the server's own defaults,
        // not the `.zitadel/` files in this directory.
        ...(createdProject && deployment === undefined
          ? [
              `Nothing is deployed to ${name} yet, so it serves the server's defaults rather than .zitadel/.`,
              ...(hasSomewhereToLand
                ? [`Deploy to it: zitadel ${DEPLOY_ARGS}${newEnvironment}`]
                : [
                    `Give it an origin first: zitadel origin add '<your-app-url>' --kind primary${newEnvironment}`,
                    `Then deploy to it: zitadel ${DEPLOY_ARGS}${newEnvironment}`,
                  ]),
            ]
          : []),
        `Check what resolves: zitadel env${newEnvironment}`,
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

  /**
   * Publish `.zitadel/` to the project this run just created, the way `deploy`
   * does: build the bundle, validate it, create the release and deploy it to
   * every primary origin. `deploy`'s diff step is left out, because nothing
   * has ever been deployed here and there is no baseline to diff against.
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
  }): Promise<DeployedRelease | undefined> {
    const json = this.jsonEnabled();
    const client = createZitadelClient({ baseUrl: opts.server, token: opts.projectSecret });
    consola.start("Deploying .zitadel/ to the new environment");
    try {
      const { bundle, brandingSources, idpFiles, policyFiles } = await buildBundle(opts.cwd);
      const ctx: StepContext = {
        cwd: opts.cwd,
        client,
        projectId: opts.projectId,
        env: this.meta.env,
        mode: "deploy",
        dryRun: false,
        json,
        color: !json && Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
        bundle,
        brandingSources,
        idpFiles,
        policyFiles,
        suggest: (args) => projectCommand(args, opts.selector, this.meta.cliVersion),
      };
      await runSteps([validateStep], ctx);
      const release = await createReleaseFromBundle(client, opts.projectId, bundle, {
        message: INITIAL_DEPLOY_MESSAGE,
        gitSha: await headSha(opts.cwd),
        gitDirty: await worktreeIsDirty(opts.cwd),
      });
      // No optimistic guard: the project was created moments ago and nothing
      // has ever been deployed to it, so there is no deployment to race with.
      const deployment = await createDeployment(client, opts.projectId, {
        releaseId: release.id,
        targets: ["primary"],
        message: INITIAL_DEPLOY_MESSAGE,
      });
      const origins = deployment.targets.map((target) => target.origin);
      consola.success(
        `Deployed ${release.content_hash} to ${origins.length} origin${origins.length === 1 ? "" : "s"}`,
      );
      return {
        releaseId: release.id,
        contentHash: release.content_hash,
        deploymentId: deployment.id,
        origins,
      };
    } catch (error) {
      reportWarning(
        `The environment was bound but the first deploy failed: ${toZitadelError(error).message}. Run \`zitadel ${DEPLOY_ARGS}${opts.selector}\` to publish it.`,
      );
      return undefined;
    }
  }
}
