import type {
  CreateProject201,
  CreateProjectBody,
  GetProject200,
} from "@zitadel/api/generated/model";

import { ApiService } from "@/lib/backend/api-service";

/** A project, as a read returns it. */
export type Project = GetProject200;

/** What creating a project takes: its name, the origins it admits and whether to seed defaults. */
export type ProjectInput = Readonly<CreateProjectBody>;

/** A project as creation returns it, with the secrets that are never shown again. */
export type CreatedProject = CreateProject201;

/**
 * The projects of a server: reading one and creating one.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. It is the one service bound to a client alone, because it is what
 * brings a project into being.
 */
export class ProjectService extends ApiService {
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
  async create(input: ProjectInput): Promise<CreatedProject> {
    return this.client.createProject(input);
  }
}
