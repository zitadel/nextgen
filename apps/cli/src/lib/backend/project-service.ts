import type {
  CreateProject201,
  CreateProjectBody,
  GetProject200,
} from "@zitadel/api/generated/model";

import type { ZitadelClient } from "../api-client";

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
  async get(projectId: string): Promise<GetProject200> {
    return this.client.getProject(projectId);
  }

  /**
   * Create a project.
   *
   * @param input - The name, the origins it admits and whether to seed defaults.
   * @returns The project with its id and the secrets, which are never shown again.
   */
  async create(input: Readonly<CreateProjectBody>): Promise<CreateProject201> {
    return this.client.createProject(input);
  }
}
