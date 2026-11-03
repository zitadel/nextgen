import { ApiError } from "@zitadel/api/runtime/fetch";
import escapeStringRegexp from "escape-string-regexp";

import type { ZitadelClient } from "../api-client";
import type { Consent } from "../consent";

/** The two kinds an origin pattern can be. */
export type OriginKind = "primary" | "preview";

/** One of a project's origin patterns, as `GET /projects/{id}` returns it. */
export type ProjectOriginEntry = Readonly<{ pattern: string; kind: string }>;

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
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to one project at construction, so a call carries only what
 * is specific to it.
 *
 * A removal reports what the project admits afterwards, because the project
 * admitting every origin is a fact of the domain and the warning about it is
 * the command's to word.
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
   *
   * @param pattern - The origin pattern.
   * @param origin - The concrete origin URL.
   * @returns True when the pattern covers the origin.
   */
  static matches(pattern: string, origin: string): boolean {
    const expression = pattern.split("*").map(escapeStringRegexp).join("[^.]+");
    return new RegExp(`^${expression}$`).test(origin);
  }

  /**
   * The patterns of the primary origins among a project's origins.
   *
   * @param origins - The project's origins.
   * @returns The primary patterns, which a deploy lands on.
   */
  static primaryPatterns(origins: readonly ProjectOriginEntry[]): readonly string[] {
    return origins.filter((entry) => entry.kind === "primary").map((entry) => entry.pattern);
  }

  /**
   * List the project's origin patterns.
   *
   * @returns The patterns, as the server stores them.
   */
  async list(): Promise<readonly ProjectOriginEntry[]> {
    const project = await this.client.getProject(this.projectId);
    return project.origins ?? [];
  }

  /**
   * List the patterns a deploy lands on.
   *
   * @returns The project's primary patterns.
   */
  async primary(): Promise<readonly string[]> {
    return OriginService.primaryPatterns(await this.list());
  }

  /**
   * List the patterns a deploy lands on, or none when the token may not read
   * the project (403): the server then decides alone what the token can deploy
   * to. A 401 is a token the server does not accept at all, which fails here.
   *
   * @returns The project's primary patterns, or none when reading is forbidden.
   */
  async primaryIfReadable(): Promise<readonly string[]> {
    try {
      return await this.primary();
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Add one pattern.
   *
   * @param pattern - The pattern to add.
   * @param kind - Whether it is a primary origin or a preview pattern.
   * @returns What the server stored.
   */
  async add(pattern: string, kind: OriginKind): Promise<ProjectOriginEntry> {
    return this.client.addOrigin(this.projectId, { pattern, kind });
  }

  /**
   * Turn a preview pattern into a primary origin: it is removed and added back
   * as primary, and if the add fails it is put back as a preview pattern so the
   * project never loses it.
   *
   * @param consent - The proof the caller was allowed to do something irreversible.
   * @param pattern - The pattern to promote.
   * @throws ApiError the add's failure, after the pattern was restored.
   */
  async promote(consent: Consent, pattern: string): Promise<void> {
    await consent.unlock(this.client).removeOrigin(this.projectId, { pattern });
    try {
      await this.add(pattern, "primary");
    } catch (error) {
      await this.add(pattern, "preview").catch(() => undefined);
      throw error;
    }
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
