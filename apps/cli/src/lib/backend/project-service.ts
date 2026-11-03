import type { ZitadelClient } from "../api-client";

/** What {@link ProjectService.create} takes: the name, its origins and whether to seed defaults. */
export type CreateProjectInput = Parameters<ZitadelClient["createProject"]>[0];

/** A project as the server returns it on a read. */
export type Project = Awaited<ReturnType<ZitadelClient["getProject"]>>;

/** A project as the server returns it on creation, with the secrets shown only once. */
export type CreatedProject = Awaited<ReturnType<ZitadelClient["createProject"]>>;

/**
 * The projects of a server: reading one and creating one.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. It is the one service bound to a client alone, because it is what
 * brings a project into being.
 */
export class ProjectService {
  private readonly client: ZitadelClient;

  constructor(client: ZitadelClient) {
    this.client = client;
  }

  /**
   * Read one project.
   *
   * @param projectId - The project to read.
   * @returns The project, with its origins.
   */
  async get(projectId: string): Promise<Project> {
    return this.client.getProject(projectId);
  }

  /**
   * Create a project.
   *
   * @param input - The name, the origins it admits and whether to seed defaults.
   * @returns The project with its id and the secrets, which are never shown again.
   */
  async create(input: CreateProjectInput): Promise<CreatedProject> {
    return this.client.createProject(input);
  }
}
