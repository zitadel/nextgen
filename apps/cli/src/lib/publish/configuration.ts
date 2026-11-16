import {
  DeploymentService,
  FlowService,
  type ReleasePointerKind,
  type ReleaseRecord,
  ReleaseService,
  SchemaService,
  type ZitadelClient,
} from "@/lib/backend";

/**
 * A pinned revision's body, as the server stores it, for a kind `.zitadel/`
 * has a file for.
 */
export type RevisionBody =
  | Awaited<ReturnType<SchemaService["get"]>>["schema"]
  | Awaited<ReturnType<FlowService["get"]>>["flow_definition"];

/**
 * The configuration a project has published: which release is live, what it
 * pins, and the body of each resource it pins.
 *
 * @remarks
 * A Facade (Gang of Four) and {@link Publisher}'s read-side counterpart, so a
 * command that rebuilds `.zitadel/` from the server holds one object rather
 * than the four services the walk from deployment to resource body needs. It
 * answers with the server's own bodies and words nothing, so the command
 * decides what a miss means.
 */
export class PublishedConfiguration {
  private readonly releases: ReleaseService;
  private readonly deployments: DeploymentService;
  private readonly schemas: SchemaService;
  private readonly flows: FlowService;

  /**
   * Bind the configuration to one project.
   *
   * @param client - The client every call goes through.
   * @param projectId - The project whose published configuration is read.
   */
  constructor(client: ZitadelClient, projectId: string) {
    this.releases = new ReleaseService(client, projectId);
    this.deployments = new DeploymentService(client, projectId);
    this.schemas = new SchemaService(client, projectId);
    this.flows = new FlowService(client, projectId);
  }

  /**
   * Fetch the release the newest deployment to a primary origin serves.
   *
   * @remarks
   * A preview deployment never serves a primary origin, so this is the
   * project's live configuration rather than a pull-request preview.
   *
   * @returns The release's id, or undefined when nothing is deployed to a primary origin.
   */
  async fetchLiveReleaseId(): Promise<string | undefined> {
    const deployment = await this.deployments.newestPrimary();

    return deployment?.release_id;
  }

  /**
   * Fetch the release one deployment made live.
   *
   * @param deploymentId - The deployment to read.
   * @returns The release's id.
   */
  async fetchReleaseIdOfDeployment(deploymentId: string): Promise<string> {
    const deployment = await this.deployments.get(deploymentId);

    return deployment.release_id;
  }

  /**
   * Fetch one release, with the resource revisions it pins.
   *
   * @param releaseId - The release to read.
   * @returns The release.
   */
  async fetchRelease(releaseId: string): Promise<ReleaseRecord> {
    return this.releases.get(releaseId);
  }

  /**
   * Fetch the body of one resource revision a release pins, as the server
   * stores it.
   *
   * @param kind - The kind of resource the release pinned.
   * @param revisionId - The revision the release pinned.
   * @returns The body, or undefined for a kind that cannot be rebuilt on disk yet.
   */
  async fetchRevision(
    kind: ReleasePointerKind,
    revisionId: string,
  ): Promise<RevisionBody | undefined> {
    switch (kind) {
      case "schema": {
        const response = await this.schemas.get(revisionId);

        return response.schema;
      }
      case "flow_definition": {
        const response = await this.flows.get(revisionId);

        return response.flow_definition;
      }
      // A kind the server pins but `.zitadel/` has no file for yet.
      case "branding":
      case "idp":
      case "policy":
      case "oauth": {
        return undefined;
      }
    }
  }
}
