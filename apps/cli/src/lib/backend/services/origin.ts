import type { AddOriginBody } from "@zitadel/api/generated/model";
import escapeStringRegexp from "escape-string-regexp";

import { ApiService } from "@/lib/backend/api-service";
import { isCancelled, type ZitadelClient } from "@/lib/backend/client";

/** The two kinds an origin pattern can be. */
export type OriginKind = AddOriginBody["kind"];

/**
 * What removing a pattern left the project admitting.
 *
 * An empty list admits no origin except a loopback origin, so removing the
 * last pattern closes a project to every other origin, more than removing any
 * other pattern does. The pattern is gone in every case: `unverified` only means the
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
 * A URL in the form two origins are compared in: its origin, so a value written
 * `http://localhost:3000/` names the stored `http://localhost:3000`. A pattern
 * holding a `*` is not a URL, so it is returned as written and matched as a
 * glob instead.
 *
 * @param value - A URL, or a pattern.
 * @returns The comparable form.
 */
function comparableOrigin(value: string): string {
  return URL.canParse(value) ? new URL(value).origin : value;
}

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
   * The pattern in the form a URL is compared in, so a question asked of it
   * cannot forget to ask it of the stored spelling too. `pattern` stays exactly
   * as the project stores it, because a removal names it and the output prints
   * it.
   */
  private readonly comparable: string;

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
    this.comparable = comparableOrigin(record.pattern);
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
   * Whether this pattern is a concrete origin URL. A `primary` pattern is an
   * exact origin by contract — scheme and host, no `*` — so it is compared
   * rather than matched, and both sides are compared in the same form, so a URL
   * written with a trailing slash is still the origin it names.
   *
   * @param origin - The concrete origin URL.
   * @returns True when the pattern is that origin.
   */
  is(origin: string): boolean {
    return this.comparable === comparableOrigin(origin);
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
    return new RegExp(`^${expression}$`).test(comparableOrigin(origin));
  }

  /**
   * The pattern and its kind, which is what the JSON output carries: the form
   * the project stores, never the form this compares in.
   *
   * @returns The record.
   */
  toJSON(): Pick<Origin, "pattern" | "kind"> {
    return {
      pattern: this.pattern,
      kind: this.kind,
    };
  }
}

/**
 * A project's origin patterns, as a collection that answers questions about
 * itself.
 *
 * @remarks
 * A rich Value Object (Fowler, PoEAA): immutable, and it carries the questions
 * a caller asks of it, so a caller that wants to know which kind a URL is, or
 * whether the issuer is held the wrong way round, asks the collection and never
 * loops over it. `all` is there for a caller that renders them as a list.
 */
export class Origins {
  readonly all: readonly Origin[];

  /**
   * Build a collection from the origins it holds.
   *
   * @param all - The origins, in the order the project stores them.
   */
  private constructor(all: readonly Origin[]) {
    this.all = all;
  }

  /**
   * Wrap origin patterns the API reported, or a file recorded.
   *
   * @param records - The patterns and their kinds.
   * @returns The origins.
   */
  static wrap(records: ReadonlyArray<Pick<Origin, "pattern" | "kind">>): Origins {
    return new Origins(
      records.map((record) => {
        return Origin.of(record);
      }),
    );
  }

  /**
   * A URL as its origin, the form a stored pattern takes, so an issuer written
   * `http://localhost:3000/` names the stored `http://localhost:3000`. A value
   * that is not a URL is returned as written.
   *
   * @param value - A URL, or a pattern.
   * @returns The URL's origin, or the value as written.
   */
  static originOf(value: string): string {
    return comparableOrigin(value);
  }

  /**
   * The patterns a deploy lands on.
   *
   * @returns The primary patterns.
   */
  get primary(): readonly string[] {
    return this.all
      .filter((origin) => {
        return origin.isPrimary;
      })
      .map((origin) => {
        return origin.pattern;
      });
  }

  /**
   * The patterns only a pull-request build's preview URLs may match.
   *
   * @returns The preview patterns.
   */
  get preview(): readonly string[] {
    return this.all
      .filter((origin) => {
        return !origin.isPrimary;
      })
      .map((origin) => {
        return origin.pattern;
      });
  }

  /**
   * Whether the project admits no origin except a loopback origin: it holds no
   * pattern at all.
   *
   * @returns True when there are no patterns.
   */
  get isEmpty(): boolean {
    return this.all.length === 0;
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
    const isPrimary = this.all.some((origin) => {
      return origin.isPrimary && origin.is(url);
    });
    if (isPrimary) {
      return "primary";
    }
    const isPreview = this.all.some((origin) => {
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
    return this.all.find((origin) => {
      return !origin.isPrimary && origin.is(issuer);
    })?.pattern;
  }

  /**
   * The patterns the API answered, which is what the JSON output carries: the
   * collection stands for the list, so it serialises as one and not as the
   * field it keeps them in.
   *
   * @returns The origins.
   */
  toJSON(): readonly Origin[] {
    return this.all;
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
 *
 * Its endpoint does not page, and `list` answers an {@link Origins} rather than
 * a plain array: the questions a caller asks of a project's origins belong to
 * the collection, not to whoever happens to hold it.
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
      // A cancellation is not a project that could not be read: the person
      // asked the command to stop, so it stops rather than reporting what the
      // removal left behind.
      if (isCancelled(this.client)) {
        throw cause;
      }
      return {
        pattern,
        outcome: "unverified",
        cause,
      };
    }
  }
}
