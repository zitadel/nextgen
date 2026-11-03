import escapeStringRegexp from "escape-string-regexp";

import type { ZitadelClient } from "../api-client";
import type { Consent } from "../consent";

/** One of a project's origin patterns, as `GET /projects/{id}` returns it. */
export type ProjectOriginEntry = Readonly<{ pattern: string; kind: string }>;

/** The two kinds an origin pattern can be. */
export type OriginKind = "primary" | "preview";

/** The origin patterns of one project. */
export class OriginService {
  private readonly client: ZitadelClient;
  private readonly projectId: string;

  constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }

  /**
   * Whether an origin pattern covers a concrete origin URL, matching the server's
   * glob rule: a `*` stands for one or more characters, none of them a dot, so
   * `https://*.preview.acme.com` covers `https://pr-7.preview.acme.com` but not a
   * deeper label. A pattern with no `*` matches only its exact self.
   */
  static matches(pattern: string, origin: string): boolean {
    // Every literal part is escaped whole, so only the `*` between them is a
    // wildcard in the expression.
    const expression = pattern.split("*").map(escapeStringRegexp).join("[^.]+");
    return new RegExp(`^${expression}$`).test(origin);
  }

  /** The project's origin patterns, as the server stores them. */
  async list(): Promise<readonly ProjectOriginEntry[]> {
    const project = await this.client.getProject(this.projectId);
    return project.origins ?? [];
  }

  /** Add one pattern and return what the server stored. */
  async add(pattern: string, kind: OriginKind): Promise<ProjectOriginEntry> {
    return this.client.addOrigin(this.projectId, { pattern, kind });
  }

  /** Remove one pattern. An empty list admits every origin, so this can open a project up. */
  async remove(consent: Consent, pattern: string): Promise<void> {
    await consent.unlock(this.client).removeOrigin(this.projectId, { pattern });
  }
}
