import escapeStringRegexp from "escape-string-regexp";

import type { ZitadelClient } from "../api-client";
import type { Consent } from "../consent";

/** One of a project's origin patterns, as `GET /projects/{id}` returns it. */
export type ProjectOriginEntry = Readonly<{ pattern: string; kind: string }>;

/** The two kinds an origin pattern can be. */
export type OriginKind = "primary" | "preview";

/**
 * What removing a pattern left the project admitting.
 *
 * An empty list admits every origin, so removing the last pattern opens a
 * project up instead of closing it, the opposite of what removing any other
 * pattern does. The pattern is gone in every case: `unverified` only means the
 * read that checks what is left failed.
 */
export type OriginRemoval = Readonly<
  { pattern: string } & (
    | { outcome: "removed" }
    | { outcome: "emptied" }
    | { outcome: "unverified"; cause: unknown }
  )
>;

/**
 * The origin patterns of one project: which URLs the project admits.
 *
 * @remarks
 * A Service Layer (Fowler, Patterns of Enterprise Application Architecture) over the generated API client, which plays the Gateway: a command says what should happen and never which endpoint serves it. Bound to one project at construction, so a call carries only what is specific to it.
 *
 * Results are Value Objects: immutable, compared by content, and free of presentation, so a command words the warnings and a test asserts on data. A removal reports what the project admits afterwards, because the
 * project admitting every origin is a fact of the domain and the warning about
 * it is the command's to word.
 */
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

  /** The patterns a deploy lands on: the project's primary origins. */
  async primary(): Promise<string[]> {
    return OriginService.primaryPatterns(await this.list());
  }

  /** The patterns of the primary origins among `origins`. */
  static primaryPatterns(origins: readonly ProjectOriginEntry[]): string[] {
    return origins.filter((entry) => entry.kind === "primary").map((entry) => entry.pattern);
  }

  /** Add one pattern and return what the server stored. */
  async add(pattern: string, kind: OriginKind): Promise<ProjectOriginEntry> {
    return this.client.addOrigin(this.projectId, { pattern, kind });
  }

  /**
   * Remove one pattern and report what the project holds afterwards. The pattern
   * is gone once the removal returns, so a failed read of what is left is
   * reported on the outcome rather than thrown as a failed removal.
   *
   * @param consent - The proof the caller was allowed to do something irreversible.
   * @param pattern - The pattern to remove, exactly as the project stores it.
   * @returns Whether the project still holds origins, now holds none, or could not be checked.
   */
  async remove(consent: Consent, pattern: string): Promise<OriginRemoval> {
    await consent.unlock(this.client).removeOrigin(this.projectId, { pattern });
    try {
      const remaining = await this.list();
      return Object.freeze({ pattern, outcome: remaining.length === 0 ? "emptied" : "removed" });
    } catch (cause) {
      return Object.freeze({ pattern, outcome: "unverified", cause });
    }
  }
}
