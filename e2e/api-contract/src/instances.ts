import { startLocalZitadel } from "@zitadel/testing";

import { Credentials } from "./credentials";
import type { Instance, Instances } from "./lane";
import type { OpenApiSpec } from "./spec";

/**
 * Where the resource API lives on a deployment's host (ADR 077). The served
 * spec states it as its `servers` URL; the lane asserts the two agree, as the
 * Go side does for its own copy of this constant.
 */
export const API_PREFIX = "/api/v1";

/**
 * Boots a real server of this working tree for each call, each with a port,
 * state folder and database of its own, so no two runs share a byte.
 */
export class LocalInstances implements Instances {
  private readonly serverBinary: string;
  private spec: OpenApiSpec | undefined;

  constructor(serverBinary: string) {
    this.serverBinary = serverBinary;
  }

  /** Tells the instances which spec the credentials are minted against. */
  useSpec(spec: OpenApiSpec): void {
    this.spec = spec;
  }

  async start(): Promise<Instance> {
    const zitadel = await startLocalZitadel({ serverBinary: this.serverBinary });
    const baseUrl = `${zitadel.handle.baseUrl.replace(/\/$/, "")}${API_PREFIX}`;
    const spec = this.spec;
    return {
      baseUrl,
      credentialFor: (family) => {
        if (spec === undefined) {
          throw new Error("useSpec() must be called before credentials are minted");
        }
        return new Credentials(zitadel, spec, baseUrl).forFamily(family);
      },
      stop: () => zitadel.stop(),
    };
  }
}
