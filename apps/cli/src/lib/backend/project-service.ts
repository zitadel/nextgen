import type { ZitadelClient } from "../api-client";

/** What {@link ProjectService.create} takes: the name, its origins and whether to seed defaults. */
export type CreateProjectInput = Parameters<ZitadelClient["createProject"]>[0];

/** A project as the server returns it on creation, secrets included. */
export type CreatedProject = Awaited<ReturnType<ZitadelClient["createProject"]>>;

/** A project as the server returns it on a read. */
export type Project = Awaited<ReturnType<ZitadelClient["getProject"]>>;

/** The projects of a server. The one service not bound to a project, since it makes them. */
export class ProjectService {
  private readonly client: ZitadelClient;

  constructor(client: ZitadelClient) {
    this.client = client;
  }

  /** Create a project and return its id and the secrets shown only once. */
  async create(input: CreateProjectInput): Promise<CreatedProject> {
    return this.client.createProject(input);
  }

  /** Read one project. */
  async get(projectId: string): Promise<Project> {
    return this.client.getProject(projectId);
  }
}
