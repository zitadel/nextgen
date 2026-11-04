import type { AddOriginBody } from "@zitadel/api/generated/model";
import escapeStringRegexp from "escape-string-regexp";
import type { ZitadelClient } from "./client";
import { ApiService } from "./api-service";

/** The two kinds an origin pattern can be. */
export type OriginKind = AddOriginBody["kind"];

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

  /**
   * Build an origin from a pattern the API reported.
   *
   * @param record - The pattern and its kind.
   */
  private constructor(record: {
    pattern: string;
    kind: string;
  }) {
    this.pattern = record.pattern;
    this.kind = record.kind;
  }

  /**
   * Wrap an origin pattern the API reported.
   *
   * @param record - The pattern and its kind.
   * @returns The origin.
   */
  static of(record: Pick<Origin, "pattern" | "kind">): Origin {
    return new Origin(record);
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
 * A project's origin patterns, as a list that can answer questions about itself.
 *
 * @remarks
 * A rich Value Object (Fowler, PoEAA): an immutable array of {@link Origin}, so
 * a caller that maps or counts reads it as a list, and a caller that asks which
 * kind a URL is, or whether the issuer is held the wrong way round, asks the
 * list and never loops over it.
 */
export class Origins extends Array<Origin> {
  /**
   * Make every derived array, such as the result of `map`, a plain one.
   *
   * @returns The plain array constructor.
   */
  static override get [Symbol.species](): ArrayConstructor {
    return Array;
  }

  /**
   * Build an empty collection, which {@link Origins.wrap} fills.
   */
  private constructor() {
    super();
  }

  /**
   * Wrap origin patterns the API reported, or a file recorded.
   *
   * @param records - The patterns and their kinds.
   * @returns The origins.
   */
  static wrap(records: ReadonlyArray<Pick<Origin, "pattern" | "kind">>): Origins {
    const origins = new Origins();
    for (const record of records) {
      origins.push(Origin.of(record));
    }
    return origins;
  }

  /**
   * A URL as its origin, the form a stored pattern takes, so an issuer written
   * `http://localhost:3000/` matches the stored `http://localhost:3000`. A value
   * that is not a URL is returned as written.
   *
   * @param value - A URL, or a pattern.
   * @returns The URL's origin, or the value as written.
   */
  static originOf(value: string): string {
    return URL.canParse(value) ? new URL(value).origin : value;
  }

  /**
   * The patterns a deploy lands on.
   *
   * @returns The primary patterns.
   */
  get primary(): readonly string[] {
    return this.filter((origin) => {
      return origin.isPrimary;
    }).map((origin) => {
      return origin.pattern;
    });
  }

  /**
   * The patterns only a pull-request build's preview URLs may match.
   *
   * @returns The preview patterns.
   */
  get preview(): readonly string[] {
    return this.filter((origin) => {
      return !origin.isPrimary;
    }).map((origin) => {
      return origin.pattern;
    });
  }

  /**
   * Whether the project admits every origin: it holds no pattern at all.
   *
   * @returns True when there are no patterns.
   */
  get isEmpty(): boolean {
    return this.length === 0;
  }

  /**
   * Which kind of origin a URL is to this project: a primary origin a deploy
   * lands on, a preview URL a pull-request build registers, or not one of its
   * origins.
   *
   * @param url - The concrete origin URL.
   * @returns The kind, or `unknown`.
   */
  kindOf(url: string): "primary" | "preview" | "unknown" {
    const isPrimary = this.some((origin) => {
      return origin.isPrimary && origin.pattern === url;
    });
    if (isPrimary) {
      return "primary";
    }
    const isPreview = this.some((origin) => {
      return !origin.isPrimary && origin.matches(url);
    });
    return isPreview ? "preview" : "unknown";
  }

  /**
   * The stored pattern of `issuer` when the project holds it as a preview
   * origin and has no primary one.
   *
   * @remarks
   * That is how `zitadel setup` 0.1.0 registered the app's own URL; setup now
   * registers it as primary. A deploy lands only on primary origins, so such a
   * project has nowhere to deploy, and adding the issuer as primary is refused
   * because the pattern is already stored with another kind: it has to be
   * removed and added back as primary.
   *
   * @param issuer - The origin the app is served from.
   * @returns The stored pattern, or undefined.
   */
  heldAsPreview(issuer: string): string | undefined {
    if (this.primary.length > 0) {
      return undefined;
    }
    const wanted = Origins.originOf(issuer);
    return this.find((origin) => {
      return !origin.isPrimary && Origins.originOf(origin.pattern) === wanted;
    })?.pattern;
  }
}

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
export class OriginService extends ApiService {
  private readonly projectId: string;

  /**
   * Bind the service to a client and the project every call concerns.
   *
   * @param client - The client every call goes through.
   * @param projectId - The project every call concerns.
   */
  constructor(client: ZitadelClient, projectId: string) {
    super(client);
    this.projectId = projectId;
  }

  /**
   * List the project's origin patterns.
   *
   * @returns The patterns, as the server stores them.
   */
  async list(): Promise<Origins> {
    const project = await this.client.getProject(this.projectId);
    return Origins.wrap(project.origins ?? []);
  }

  /**
   * Pick out the URLs that are primary origins of the project.
   *
   * @param urls - The URLs to check.
   * @returns The ones a deploy would land on, in the order given.
   */
  async primaryAmong(urls: readonly string[]): Promise<readonly string[]> {
    const origins = await this.list();
    return urls.filter((url) => {
      return origins.kindOf(url) === "primary";
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
    const record = await this.client.addOrigin(this.projectId, {
      pattern,
      kind,
    });
    return Origin.of(record);
  }

  /**
   * Turn a preview pattern into a primary origin: it is removed and added back
   * as primary, and if the add fails it is put back as a preview pattern so the
   * project never loses it.
   *
   * @param pattern - The pattern to promote.
   * @throws BackendError the add's failure, after the pattern was restored.
   */
  async promote(pattern: string): Promise<void> {
    await this.client.removeOrigin(this.projectId, {
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
   * @param pattern - The pattern to remove, exactly as the project stores it.
   * @returns Whether the project still holds origins, now holds none, or could not be checked.
   */
  async remove(pattern: string): Promise<OriginRemoval> {
    await this.client.removeOrigin(this.projectId, {
      pattern,
    });
    try {
      const remaining = await this.list();
      return {
        pattern,
        outcome: remaining.isEmpty ? "emptied" : "removed",
      };
    } catch (cause) {
      return {
        pattern,
        outcome: "unverified",
        cause,
      };
    }
  }
}
