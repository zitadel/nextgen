import type {
  PublishApplication200,
  PublishApplication201,
  PublishApplicationBodyApplication,
} from "@zitadel/api/generated/model";

import { ApiService } from "@/lib/backend/api-service";
import type { ZitadelClient } from "@/lib/backend/client";

/** An application as `publishApplication` returned it, including one-shot secrets. */
export type PublishedApplication = Readonly<PublishApplication200 | PublishApplication201>;

/** What {@link ApplicationService.publish} registers. */
export type ApplicationInput = Readonly<{
  /** The application document to register. */
  application: PublishApplicationBodyApplication;
}>;

/**
 * Registered applications of one project: create or revise through
 * `publishApplication` (`POST /applications`). Declared applications under
 * `.zitadel/applications/` stay on the release path.
 */
export class ApplicationService extends ApiService {
  private readonly projectId: string;

  /**
   * Bind the service to a client and a project.
   *
   * @param client - The client every call goes through.
   * @param projectId - The project the applications belong to.
   */
  constructor(client: ZitadelClient, projectId: string) {
    super(client);
    this.projectId = projectId;
  }

  /**
   * Register an application, or revise one that already holds the slug. Every
   * new client gets a secret shown once in the response.
   *
   * @param input - The application document.
   * @returns The application and any secrets just minted.
   */
  async publish(input: ApplicationInput): Promise<PublishedApplication> {
    return this.client.publishApplication(
      { application: input.application },
      { project_id: this.projectId },
    );
  }
}
