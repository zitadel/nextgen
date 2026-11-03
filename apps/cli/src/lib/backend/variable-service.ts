import type { GetVariables200 } from "@zitadel/api/generated/model";

import type { ZitadelClient } from "../api-client";
import type { VariableKind, VariableValue } from "../variables";

/** A value to write: a secret is stored but never read back. */
export type VariableWrite = Readonly<{ value: string | number | boolean; secret: boolean }>;

/** The values a name holds after a write, one per kind. */
export type VariableKinds = Readonly<Partial<Record<VariableKind, VariableValue>>>;

/** The variables of one project. */
export class VariableService {
  private readonly client: ZitadelClient;
  private readonly projectId: string;

  constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }

  /** Every name with the values of both kinds, in one read. */
  async inventory(): Promise<GetVariables200> {
    return this.client.getVariables({ project_id: this.projectId });
  }

  /** The values of one kind, keyed by name. */
  async ofKind(kind: VariableKind): Promise<GetVariables200> {
    return this.client.getVariables({ project_id: this.projectId, kind });
  }

  /** What one name holds in the given kind, or undefined when it holds none. */
  async get(name: string, kind: VariableKind): Promise<VariableValue | undefined> {
    const held = await this.client.getVariable(name, { project_id: this.projectId, kind });
    return held[kind];
  }

  /**
   * Set one name. Without a kind a plain value is stored for both kinds and a
   * secret for the primary kind only; `preview` writes the preview kind alone.
   */
  async set(name: string, write: VariableWrite, kind?: "preview"): Promise<VariableKinds> {
    const scope =
      kind === undefined ? { project_id: this.projectId } : { project_id: this.projectId, kind };
    const written = await this.client.updateVariables({ [name]: write }, scope);
    return written[name] ?? {};
  }

  /** The variables a live deployment froze at the time it was made. */
  async ofDeployment(
    deploymentId: string,
  ): Promise<Awaited<ReturnType<ZitadelClient["getDeploymentVariables"]>>> {
    return this.client.getDeploymentVariables(deploymentId, { project_id: this.projectId });
  }
}
