import type { AddOriginBody } from "@zitadel/api/generated/model";
import escapeStringRegexp from "escape-string-regexp";

import type { ZitadelClient } from "../api-client";
import type { Consent } from "../consent";

/** The two kinds an origin pattern can be. */
export type OriginKind = AddOriginBody["kind"];

/**
 * One of a project's origin patterns: a URL, or a URL with a wildcard, that the
 * project admits.
 *
 * @remarks
 * A rich Value Object (Fowler, PoEAA): immutable, and it carries the questions
 * a caller asks of it, so a command writes `origin.matches(url)` and never
 * builds the glob itself.
 */
export class Origin {
  readonly pattern: string;
  readonly kind: string;

  private constructor(wire: { pattern: string; kind: string }) {
    this.pattern = wire.pattern;
    this.kind = wire.kind;
    Object.freeze(this);
  }

  /**
   * Wrap an origin pattern the API reported.
   *
   * @param wire - The pattern and its kind.
   * @returns The origin.
   */
  static of(wire: { pattern: string; kind: string }): Origin {
    return new Origin(wire);
  }

  /**
   * Whether this is a primary origin, which a deploy lands on, as opposed to a
   * preview pattern.
   *
   * @returns True for a primary origin.
   */
  get isPrimary(): boolean {
    return this.kind === "primary";
  }

  /**
   * Whether this pattern covers a concrete origin URL, matching the server's
   * glob rule: a `*` stands for one or more characters, none of them a dot, so
   * `https://*.preview.acme.com` covers `https://pr-7.preview.acme.com` but not a
   * deeper label. A pattern with no `*` matches only its exact self.
   *
   * @param origin - The concrete origin URL.
   * @returns True when the pattern covers the origin.
   */
  matches(origin: string): boolean {
    const expression = this.pattern.split("*").map(escapeStringRegexp).join("[^.]+");
    return new RegExp(`^${expression}$`).test(origin);
  }
}

/**
 * What removing a pattern left the project admitting.
 *
 * An empty list admits every origin, so removing the last pattern opens a
 * project up instead of closing it, the opposite of what removing any other
 * pattern does. The pattern is gone in every case: `unverified` only means the
 * read that checks what is left failed.
 */
export type OriginRemoval = Readonly<
  {
    pattern: string;
  } & (
    | {
        outcome: "removed";
      }
    | {
        outcome: "emptied";
      }
    | {
        outcome: "unverified";
        cause: unknown;
      }
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
   * List the project's origin patterns.
   *
   * @returns The patterns, as the server stores them.
   */
  async list(): Promise<readonly Origin[]> {
    const project = await this.client.getProject(this.projectId);
    return (project.origins ?? []).map((wire) => {
      return Origin.of(wire);
    });
  }

  /**
   * List the patterns a deploy lands on.
   *
   * @returns The project's primary patterns.
   */
  async primary(): Promise<readonly string[]> {
    const origins = await this.list();
    return origins
      .filter((origin) => {
        return origin.isPrimary;
      })
      .map((origin) => {
        return origin.pattern;
      });
  }

  /**
   * Add one pattern.
   *
   * @param pattern - The pattern to add.
   * @param kind - Whether it is a primary origin or a preview pattern.
   * @returns What the server stored.
   */
  async add(pattern: string, kind: OriginKind): Promise<Origin> {
    const wire = await this.client.addOrigin(this.projectId, {
      pattern,
      kind,
    });
    return Origin.of(wire);
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
    await consent.unlock(this.client).removeOrigin(this.projectId, {
      pattern,
    });
    try {
      await this.add(pattern, "primary");
    } catch (error) {
      await this.add(pattern, "preview").catch(() => {
        return undefined;
      });
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
    await consent.unlock(this.client).removeOrigin(this.projectId, {
      pattern,
    });
    try {
      const remaining = await this.list();
      return Object.freeze({
        pattern,
        outcome: remaining.length === 0 ? "emptied" : "removed",
      });
    } catch (cause) {
      return Object.freeze({
        pattern,
        outcome: "unverified",
        cause,
      });
    }
  }
}
