import { compare } from "./order";

/** The HTTP methods an OpenAPI path item can hold an operation under. */
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

/**
 * Who an operation answers to, which decides the credentials its requests carry:
 *
 * - `public`: declares no security; requests carry none.
 * - `management`: accepts the project secret as a bearer token.
 * - `session`: accepts only the end user's session cookie.
 * - `logout`: ends the session cookie's session. It runs on a session of its own
 *   so that it cannot sign the `session` family out mid-run.
 */
export type Family = "public" | "management" | "session" | "logout";

/** The order the families run and are reported in. */
export const FAMILIES: readonly Family[] = ["public", "management", "session", "logout"];

/** The one operation that destroys the session its cookie belongs to. */
export const LOGOUT_OPERATION = "DELETE /sessions/me";

interface SecurityScheme {
  type: string;
  in?: string;
}

interface OperationObject {
  operationId?: string;
  security?: Record<string, string[]>[];
}

export interface OpenApiDocument {
  servers?: { url: string }[];
  security?: Record<string, string[]>[];
  components?: { securitySchemes?: Record<string, SecurityScheme> };
  paths: Record<string, Record<string, unknown>>;
}

/** How a scheme's credential is supplied to Schemathesis. */
export type SchemeKind = "bearer" | "cookie";

export interface Operation {
  /** `METHOD /path` with the path as the spec writes it; the name Schemathesis reports it under. */
  name: string;
  /** The `operationId`, which is what Schemathesis filters on. */
  id: string;
  family: Family;
  /** How many security requirements it lists, any one of which is enough to call it. */
  alternatives: number;
}

export class OpenApiSpec {
  private readonly document: OpenApiDocument;

  constructor(document: OpenApiDocument) {
    this.document = document;
  }

  static parse(text: string): OpenApiSpec {
    return new OpenApiSpec(JSON.parse(text) as OpenApiDocument);
  }

  /** The URL prefix every path is served under. */
  get prefix(): string | undefined {
    return this.document.servers?.[0]?.url;
  }

  /** Every operation, sorted by name. */
  operations(): Operation[] {
    const operations: Operation[] = [];
    for (const [path, item] of Object.entries(this.document.paths)) {
      for (const method of METHODS) {
        const operation = item[method] as OperationObject | undefined;
        if (operation === undefined) {
          continue;
        }
        const name = `${method.toUpperCase()} ${path}`;
        operations.push({
          name,
          id: this.operationId(name, operation),
          family: this.familyOf(name, operation),
          alternatives: (operation.security ?? this.document.security ?? []).length,
        });
      }
    }
    return operations.sort((a, b) => {
      return compare(a.name, b.name);
    });
  }

  /** The operations of one family. */
  operationsOf(family: Family): Operation[] {
    return this.operations().filter((operation) => {
      return operation.family === family;
    });
  }

  /** The name of the security scheme of this kind, which is what Schemathesis's auth config is keyed by. */
  schemeNamed(kind: SchemeKind): string {
    const names = Object.keys(this.document.components?.securitySchemes ?? {}).filter((name) => {
      return this.schemeKind(name) === kind;
    });
    if (names.length !== 1) {
      throw new Error(`expected one ${kind} security scheme, found ${String(names.length)}`);
    }
    return names[0] ?? "";
  }

  /**
   * Schemathesis selects operations by `operationId`, exactly. An operation
   * without one would select nothing and pass untested, so it is an error.
   */
  private operationId(name: string, operation: OperationObject): string {
    if (operation.operationId === undefined) {
      throw new Error(`${name} has no operationId, so Schemathesis cannot be limited to it`);
    }
    return operation.operationId;
  }

  /**
   * An operation is `management` when any of its security alternatives is an
   * OAuth 2 bearer, because the lane then authenticates it with the project
   * secret; `session` when the only ones are cookies. An operation that
   * accepts either is tested as `management`, since that is the stronger
   * credential and the operation is the same.
   */
  private familyOf(name: string, operation: OperationObject): Family {
    const requirements = operation.security ?? this.document.security ?? [];
    const types = new Set(
      requirements.flatMap((requirement) => {
        return Object.keys(requirement).map((scheme) => {
          return this.schemeKind(scheme);
        });
      }),
    );
    if (types.has("bearer")) {
      return "management";
    }
    if (types.has("cookie")) {
      return name === LOGOUT_OPERATION ? "logout" : "session";
    }
    return "public";
  }

  private schemeKind(name: string): SchemeKind {
    const scheme = this.document.components?.securitySchemes?.[name];
    if (scheme?.type === "oauth2" || scheme?.type === "http") {
      return "bearer";
    }
    if (scheme?.type === "apiKey" && scheme.in === "cookie") {
      return "cookie";
    }
    throw new Error(`security scheme "${name}" is neither a bearer nor a cookie scheme`);
  }
}
