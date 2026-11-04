import type { ProjectService } from "./backend";

/** Where an environment's values are kept: the port the service writes through. */
export interface EnvironmentFiles {
  /** Whether the file already exists. */
  exists(file: string): Promise<boolean>;
  /** Write the values, replacing the managed part of the file. */
  write(file: string, values: Readonly<Record<string, string>>): Promise<void>;
}

/** A variable to set on a hosting platform or in a pipeline. A secret is named, never carried. */
export type PlatformVariable = Readonly<{
  name: string;
  value?: string;
  secret?: boolean;
}>;

/** What each place that runs the app needs set, by scope. */
export type PlatformVariables = Readonly<{
  production: readonly PlatformVariable[];
  preview: readonly PlatformVariable[];
  pipeline: readonly PlatformVariable[];
}>;

/** Where an environment's file is, and whether something is already there. */
export type EnvironmentLocation = Readonly<{
  file: string;
  exists: boolean;
}>;

/** What binding an environment needs to know. */
export type BindRequest = Readonly<{
  name: string;
  /** Names the project this run creates, as `<directory>-<name>`. */
  directory: string;
  server: string;
  /** The origin the app is served from, when one was given. */
  issuer?: string;
  /** An existing project to bind instead of creating one, with the secrets it came with. */
  existing?: Readonly<{
    projectId: string;
    projectSecret?: string;
    previewToken?: string;
  }>;
  /** The framework the app uses, which decides what its server needs at runtime. */
  framework?: string;
  /** The framework's public name for the project id, when it has one. */
  publicVariable?: string;
}>;

/** An environment bound to a project, with what follows from how it was bound. */
export type EnvironmentBinding = Readonly<{
  name: string;
  file: string;
  server: string;
  projectId: string;
  issuer?: string;
  /** Whether this run created the project, as opposed to binding one that existed. */
  created: boolean;
  projectSecret?: string;
  /** The names written to the file. Only a secret in this list can be copied from it. */
  keys: readonly string[];
  platform: PlatformVariables;
  /**
   * A bound project admits every origin until its first pattern closes it, so
   * it still needs the app's origin added. A created project already holds it.
   */
  needsOrigin: boolean;
  /**
   * A deploy lands on the project's primary origins, and a created project
   * holds one only when an app URL was given. Without it the server refuses
   * the deploy however it is reached.
   */
  canDeploy: boolean;
}>;

/** The frameworks whose server needs the project secret at runtime (the session exchange). */
const SERVER_RENDERED: readonly string[] = ["next", "nuxt"];

/** What the hosting platform and the pipeline need set for an environment to work. */
function platformVariables(input: {
  server: string;
  projectId: string;
  issuer?: string;
  publicVariable?: string;
  serverRendered: boolean;
}): PlatformVariables {
  const { server, projectId, issuer, publicVariable, serverRendered } = input;
  const app: PlatformVariable[] = [
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
  return Object.freeze({
    production: [
      ...app,
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
      ...app,
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
  });
}

/**
 * The environments of a directory: a project on a server, and the file that
 * names it.
 *
 * @remarks
 * A Service Layer that owns the decisions of binding an environment: whether the
 * project is created or taken, what the file holds, what the hosting platform
 * and the pipeline need set, and whether a deploy could land. It reaches the
 * server and the disk only through ports, a project factory and an
 * {@link EnvironmentFiles}, so it runs the same against a fake of each.
 *
 * Results are Value Objects: immutable, compared by content, and free of presentation, so a command words the warnings and a test asserts on data.
 */
export class EnvironmentService {
  private readonly projects: (server: string) => ProjectService;
  private readonly files: EnvironmentFiles;

  constructor(projects: (server: string) => ProjectService, files: EnvironmentFiles) {
    this.projects = projects;
    this.files = files;
  }

  /**
   * The file that holds an environment's values.
   *
   * @param name - The environment's name.
   * @returns The file name, relative to the project directory.
   */
  static fileName(name: string): string {
    return `.env.${name}.local`;
  }

  /**
   * Find where an environment's file is, and whether something is already there.
   *
   * @param name - The environment's name.
   * @returns The file, and whether it exists.
   */
  async locate(name: string): Promise<EnvironmentLocation> {
    const file = EnvironmentService.fileName(name);
    return {
      file,
      exists: await this.files.exists(file),
    };
  }

  /**
   * Bind an environment to a project: create the project, or take the one it
   * was given, and write the file that is the environment.
   *
   * @param request - The name, the server, and the project to bind if one exists.
   * @returns The binding, immutable, with what follows from how it was made.
   */
  async bind(request: BindRequest): Promise<EnvironmentBinding> {
    const file = EnvironmentService.fileName(request.name);
    const { issuer, existing } = request;
    const project =
      existing === undefined
        ? await this.projects(request.server).create({
            name: `${request.directory}-${request.name}`,
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
            id: existing.projectId,
            project_secret: existing.projectSecret,
            preview_secret: existing.previewToken,
          };
    const { id: projectId, project_secret: projectSecret, preview_secret: previewToken } = project;
    const values: Record<string, string> = {
      ZITADEL_URL: request.server,
      ZITADEL_PROJECT_ID: projectId,
      ...(projectSecret === undefined
        ? {}
        : {
            ZITADEL_PROJECT_SECRET: projectSecret,
          }),
      ...(previewToken === undefined
        ? {}
        : {
            ZITADEL_PREVIEW_TOKEN: previewToken,
          }),
      // The origin the app serves from, so a CLI run against this environment
      // resolves the same ZITADEL_ISSUER the deployed app registers.
      ...(issuer === undefined
        ? {}
        : {
            ZITADEL_ISSUER: issuer,
          }),
      ...(request.publicVariable === undefined
        ? {}
        : {
            [request.publicVariable]: projectId,
          }),
    };
    await this.files.write(file, values);
    const created = existing === undefined;
    return Object.freeze({
      name: request.name,
      file,
      server: request.server,
      projectId,
      ...(issuer === undefined
        ? {}
        : {
            issuer,
          }),
      created,
      ...(projectSecret === undefined
        ? {}
        : {
            projectSecret,
          }),
      keys: Object.freeze(Object.keys(values)),
      platform: platformVariables({
        server: request.server,
        projectId,
        issuer,
        publicVariable: request.publicVariable,
        serverRendered:
          request.framework !== undefined && SERVER_RENDERED.includes(request.framework),
      }),
      needsOrigin: !created,
      canDeploy: created && issuer !== undefined,
    });
  }
}
