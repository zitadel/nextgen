import { describe, expect, it } from "vitest";

import { responseFailure } from "@/lib/backend";
import { ForbiddenError, UnauthorizedError, UnavailableError } from "@/lib/backend/errors";
import {
  EXIT_CODES,
  ZitadelError,
  errorMessage,
  isCancellation,
  isErrno,
  toZitadelError,
} from "@/lib/errors";
import { ConfigError, ConflictError, NotFoundError } from "@/lib/zitadel";
import { unscopedCommand } from "@/lib/suggestion";

describe("EXIT_CODES", () => {
  it("maps every error code to its documented exit number", () => {
    expect(EXIT_CODES).toEqual({
      E_ALREADY_INIT: 0,
      E_FRAMEWORK_NOT_DETECTED: 3,
      E_UNSUPPORTED_PROJECT_SHAPE: 3,
      E_NETWORK: 4,
      E_LOCAL_SERVER_NOT_RUNNING: 4,
      E_NOT_FOUND: 4,
      E_AUTH: 1,
      E_CONFLICT: 5,
      E_PORT_IN_USE: 5,
      E_VALIDATION: 3,
      E_CONFIRMATION_REQUIRED: 3,
      E_CREDENTIAL_MISSING: 3,
      E_NOT_IMPLEMENTED: 2,
      E_CANCELLED: 130,
    });
  });
});

describe("ZitadelError", () => {
  it("carries the code, message, and optional extras", () => {
    const err = new ZitadelError("E_CONFLICT", "boom", {
      hint: "try again",
      nextCommands: [unscopedCommand("doctor"), unscopedCommand("init")],
      details: { field: "x" },
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ZitadelError");
    expect(err.message).toBe("boom");
    expect(err.code).toBe("E_CONFLICT");
    expect(err.hint).toBe("try again");
    expect(err.nextCommands).toEqual(["zitadel doctor", "zitadel init"]);
    expect(err.details).toEqual({ field: "x" });
  });

  it("leaves optional extras undefined when omitted", () => {
    const err = new ZitadelError("E_VALIDATION", "nope");
    expect(err.hint).toBeUndefined();
    expect(err.nextCommands).toBeUndefined();
    expect(err.details).toBeUndefined();
  });

  it("derives exitCode from the code via EXIT_CODES", () => {
    expect(new ZitadelError("E_NETWORK", "x").exitCode).toBe(4);
    expect(new ZitadelError("E_CONFLICT", "x").exitCode).toBe(5);
    expect(new ZitadelError("E_ALREADY_INIT", "x").exitCode).toBe(0);
    expect(new ZitadelError("E_NOT_IMPLEMENTED", "x").exitCode).toBe(2);
  });
});

describe("toZitadelError", () => {
  it("passes an existing ZitadelError through unchanged", () => {
    const original = new ZitadelError("E_AUTH", "already normalised");
    expect(toZitadelError(original)).toBe(original);
  });

  it("maps EACCES errno errors to E_AUTH", () => {
    const errno = Object.assign(new Error("denied"), { code: "EACCES" });
    const result = toZitadelError(errno);
    expect(result.code).toBe("E_AUTH");
    expect(result.message).toBe("Permission denied: denied");
    expect(result.hint).toBe("Check file permissions or run with the right user.");
    expect(result.details).toEqual({
      original: { name: "Error", message: "denied", code: "EACCES" },
    });
  });

  it("maps EPERM errno errors to E_AUTH", () => {
    const errno = Object.assign(new Error("perm"), { code: "EPERM" });
    expect(toZitadelError(errno).code).toBe("E_AUTH");
  });

  it("maps EEXIST errno errors to E_CONFLICT", () => {
    const errno = Object.assign(new Error("file exists"), { code: "EEXIST" });
    const result = toZitadelError(errno);
    expect(result.code).toBe("E_CONFLICT");
    expect(result.message).toBe("file exists");
    expect(result.hint).toBe("A file already exists. Use --force to overwrite or remove it first.");
  });

  it("maps ENOENT errno errors to E_VALIDATION", () => {
    const errno = Object.assign(new Error("missing"), { code: "ENOENT" });
    const result = toZitadelError(errno);
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toBe("missing");
    expect(result.hint).toBe("A required file or directory is missing.");
  });

  it.each([
    ["a ConflictError", new ConflictError("two with one slug"), "E_CONFLICT"],
    ["a NotFoundError", new NotFoundError("no such connection"), "E_NOT_FOUND"],
    ["any other ConfigError", new ConfigError("not valid"), "E_VALIDATION"],
    [
      "a ConfigError for a file the OS refused to read",
      new ConfigError("x.json cannot be read (EACCES)", { details: { code: "EACCES" } }),
      "E_AUTH",
    ],
    [
      "a ConfigError for a file the OS would not let it touch",
      new ConfigError("x.json cannot be read (EPERM)", { details: { code: "EPERM" } }),
      "E_AUTH",
    ],
    [
      "a ConfigError for any other errno",
      new ConfigError("x.json cannot be read (EIO)", { details: { code: "EIO" } }),
      "E_VALIDATION",
    ],
  ])("maps %s to %s", (_name, err, code) => {
    expect(toZitadelError(err).code).toBe(code);
  });

  it("passes a ConfigError's message, hint and details on", () => {
    const err = new ConfigError("boom", { hint: "do this", details: { file: "a.json" } });
    const result = toZitadelError(err);
    expect([result.message, result.hint, result.details]).toEqual([
      "boom",
      "do this",
      { file: "a.json" },
    ]);
  });

  it("leaves out the hint and details a ConfigError has none of", () => {
    const result = toZitadelError(new ConfigError("boom"));
    expect([result.hint, result.details]).toEqual([undefined, undefined]);
  });

  it.each([
    ["UnauthorizedError", new UnauthorizedError("the credential was not accepted")],
    ["ForbiddenError", new ForbiddenError("the credential may not do this")],
  ])("maps a %s the backend raised to E_AUTH", (_name, err) => {
    const result = toZitadelError(err);

    expect(result.code).toBe("E_AUTH");
    expect(result.message).toBe(err.message);
  });

  it("maps a request that got no response to E_NETWORK", () => {
    const err = new UnavailableError(
      "GET http://localhost:8080/idps got no response (ECONNREFUSED)",
      {
        url: "http://localhost:8080/idps",
        reason: "unreachable",
      },
    );
    const result = toZitadelError(err);
    expect(result.code).toBe("E_NETWORK");
    expect(result.exitCode).toBe(4);
    expect(result.message).toBe("GET http://localhost:8080/idps got no response (ECONNREFUSED)");
    expect(result.hint).toBe("Check your connection and the server URL (ZITADEL_URL or --server).");
    expect(result.details).toEqual({ url: "http://localhost:8080/idps", reason: "unreachable" });
  });

  it("maps a request that timed out to E_NETWORK with a hint about the server", () => {
    const err = new UnavailableError("GET … timed out", {
      url: "http://localhost:8080/idps",
      reason: "timeout",
    });
    const result = toZitadelError(err);
    expect(result.code).toBe("E_NETWORK");
    expect(result.hint).toBe(
      "The server accepted the connection but did not answer in time. Check that it is healthy, then retry.",
    );
  });

  it("maps a response whose body could not be read to E_NETWORK with a hint about proxies", () => {
    const err = new UnavailableError(
      "GET http://localhost:8080/idps answered 200, but its body could not be read",
      {
        url: "http://localhost:8080/idps",
        reason: "unreadable",
      },
    );
    const result = toZitadelError(err);
    expect(result.code).toBe("E_NETWORK");
    expect(result.hint).toBe(
      "The server answered, but its response could not be read. Check any proxy between you and the server, then retry.",
    );
    expect(result.details).toEqual({ url: "http://localhost:8080/idps", reason: "unreadable" });
  });

  it("does not guess a network failure from a TypeError's message", () => {
    const result = toZitadelError(new TypeError("fetch failed"));
    expect(result.code).toBe("E_VALIDATION");
  });

  it("wraps a zod-like Error (issues array) as E_VALIDATION", () => {
    // A real ZodError is an Error subclass carrying `.issues`; errorMessage
    // only reads `.message` from genuine Error instances (a plain object
    // would stringify to "[object Object]" — see the next case).
    const issues = [{ path: ["name"], message: "Required" }];
    const zodLike = Object.assign(new Error("validation failed"), { issues });
    const result = toZitadelError(zodLike);
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toBe("validation failed");
    expect(result.details).toEqual({ issues });
  });

  it("falls back to String() for a zod-like error without a message", () => {
    const zodLike = { issues: [] as unknown[] };
    const result = toZitadelError(zodLike);
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toBe(String(zodLike));
  });

  it("wraps a generic Error as E_VALIDATION preserving its shape", () => {
    const err = new Error("plain failure");
    const result = toZitadelError(err);
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toBe("plain failure");
    expect(result.details).toEqual({
      original: { name: "Error", message: "plain failure", code: undefined },
    });
  });

  it("wraps an unknown non-error value as E_VALIDATION with a generic message", () => {
    const value = { weird: true };
    const result = toZitadelError(value);
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toBe("Unknown error");
    expect(result.details).toBe(value);
  });

  it("wraps a thrown string as E_VALIDATION with a generic message", () => {
    const result = toZitadelError("just a string");
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toBe("Unknown error");
    expect(result.details).toBe("just a string");
  });

  it("reports a 409 as a conflict with the state the platform holds", () => {
    const err = responseFailure(
      409,
      "http://mock/releases/rel_1/revoke?project_id=proj_1",
      { code: "rel.in_use", message: "release: still served by an origin" },
      "POST http://mock/releases/rel_1/revoke returned 409",
    );

    expect(toZitadelError(err).code).toBe("E_CONFLICT");
  });

  it("surfaces the server's message + nested details.details on ApiError 400", () => {
    const err = responseFailure(
      400,
      "http://mock/flow_definitions/flow_1?project_id=proj_1",
      {
        code: "flowdef.invalid",
        message: "flow definition: invalid",
        details: {
          details:
            "required fields [company] in user schema are missing in the flow definition steps",
        },
      },
      "PUT http://mock/flow_definitions/flow_1?project_id=proj_1 returned 400",
    );
    const result = toZitadelError(err);
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toBe(
      "flow definition: invalid: required fields [company] in user schema are missing in the flow definition steps",
    );
  });

  it("uses the server's message when details is a plain string", () => {
    const err = responseFailure(
      404,
      "http://mock/schemas/sch_x?project_id=proj_1",
      { code: "schema.notfound", message: "schema not found", details: "sch_x" },
      "GET http://mock/schemas/sch_x?project_id=proj_1 returned 404",
    );
    const result = toZitadelError(err);
    // Enveloped 404 = a real platform API reporting a missing resource:
    // E_NOT_FOUND, but no wrong-server suffix on the message.
    expect(result.code).toBe("E_NOT_FOUND");
    expect(result.message).toBe("schema not found: sch_x");
  });

  it("flags a non-enveloped 404 as a likely wrong server", () => {
    const err = responseFailure(
      404,
      "https://api.zitadel.cloud/projects",
      { message: "not found" },
      "POST https://api.zitadel.cloud/projects returned 404",
    );
    const result = toZitadelError(err);
    expect(result.code).toBe("E_NOT_FOUND");
    expect(result.exitCode).toBe(4);
    expect(result.message).toBe(
      "not found — https://api.zitadel.cloud/projects has no such endpoint; is this a Zitadel platform API?",
    );
  });

  it("tells a server without the operation from a wrong server", () => {
    const err = responseFailure(
      404,
      "http://localhost:8080/widgets",
      { code: "req.not_found", message: "No API operation matches this path." },
      "GET http://localhost:8080/widgets returned 404",
    );
    const result = toZitadelError(err);
    expect(result.code).toBe("E_NOT_FOUND");
    expect(result.message).toBe(
      "http://localhost:8080/widgets has no such endpoint on this Zitadel server",
    );
    expect(result.hint).toContain("different versions");
  });

  it("falls back to the fetch-layer message when the body is not an envelope", () => {
    const err = responseFailure(
      502,
      "http://mock/anything",
      { raw: "<html>Bad Gateway</html>" },
      "GET http://mock/anything returned 502",
    );
    expect(toZitadelError(err).message).toBe("GET http://mock/anything returned 502");
  });

  it("classifies 401/403 as E_AUTH and 5xx as E_NETWORK", () => {
    const auth = responseFailure(
      401,
      "http://mock/x",
      { message: "bad token" },
      "GET returned 401",
    );
    const server = responseFailure(500, "http://mock/x", { message: "boom" }, "GET returned 500");
    expect(toZitadelError(auth).code).toBe("E_AUTH");
    expect(toZitadelError(server).code).toBe("E_NETWORK");
  });

  it.each([
    ["too many requests", 429, "E_NETWORK"],
    ["what the server says is gone", 410, "E_NOT_FOUND"],
  ])("classifies %s as %s, which is not the caller's body to correct", (_what, status, code) => {
    const refused = responseFailure(
      status,
      "http://mock/projects/p/claim/status",
      { message: "come back later" },
      `GET returned ${status}`,
    );

    expect(toZitadelError(refused).code).toBe(code);
  });

  it("classifies a 403 refusing a target origin as E_VALIDATION, not E_AUTH", () => {
    const refused = responseFailure(
      403,
      "http://mock/deployments",
      { code: "proj.origin_not_allowed", message: "project: https://x is not a primary origin" },
      "POST returned 403",
    );
    expect(toZitadelError(refused).code).toBe("E_VALIDATION");
  });
});

/**
 * Found against the real IdP controller: rejecting a changed issuer answers
 * `idp.field_immutable`, whose message names no field. The envelope does, so
 * the failure a person reads should too.
 */
describe("fields the platform blames", () => {
  const immutable = (body: unknown) =>
    toZitadelError(
      responseFailure(400, "http://localhost:8140/idps?project_id=p", body, "Bad Request"),
    );

  it("names them, as the server nests them", () => {
    const error = immutable({
      code: "idp.field_immutable",
      message: "identity provider connection: the field is fixed for the life of the connection",
      details: { details: { fields: ["oidc.issuer"] } },
    });

    expect(error.hint).toContain("oidc.issuer");
    expect(error.hint).toContain("this field");
  });

  it("reads them without the extra wrapper too", () => {
    const error = immutable({ code: "idp.field_immutable", details: { fields: ["protocol"] } });

    expect(error.hint).toContain("protocol");
  });

  it("says fields, plural, when there is more than one", () => {
    const error = immutable({
      code: "idp.field_immutable",
      details: { details: { fields: ["protocol", "subject_claim"] } },
    });

    expect(error.hint).toContain("these fields");
    expect(error.hint).toContain("protocol, subject_claim");
  });

  it("adds no hint when the envelope blames nothing", () => {
    expect(immutable({ code: "req.invalid", message: "nope" }).hint).toBeUndefined();
  });
});

/**
 * `idp.endpoints_partial` names the endpoints a connection left out only in
 * the envelope, so the hint carries them, as it does the blamed fields.
 */
describe("endpoints the platform reports missing", () => {
  const partial = (body: unknown) =>
    toZitadelError(
      responseFailure(400, "http://localhost:8140/idps?project_id=p", body, "Bad Request"),
    );

  it("names them, in the server's order, as the server nests them", () => {
    const error = partial({
      code: "idp.endpoints_partial",
      message: "identity provider connection: the endpoints are partially set",
      details: { details: { missing: ["jwks_uri", "userinfo_endpoint"] } },
    });

    expect(error.code).toBe("E_VALIDATION");
    expect(error.hint).toBe(
      "The server reports these endpoints missing: jwks_uri, userinfo_endpoint.",
    );
  });

  it("says endpoint, singular, when one is missing", () => {
    const error = partial({
      code: "idp.endpoints_partial",
      details: { missing: ["token_endpoint"] },
    });

    expect(error.hint).toBe("The server reports this endpoint missing: token_endpoint.");
  });

  it("keeps the blamed fields when an envelope lists both", () => {
    const error = partial({
      code: "req.invalid",
      details: { details: { fields: ["oidc.issuer"], missing: ["jwks_uri"] } },
    });

    expect(error.hint).toBe(
      "The server rejected this field: oidc.issuer. The server reports this endpoint missing: jwks_uri.",
    );
  });
});

/**
 * A rejected release names the schema or flow at fault, and why, only under
 * `details.resources`; the hint carries them so the reason shows without
 * `--json`.
 */
describe("resources the platform rejected", () => {
  const rejected = (body: unknown) =>
    toZitadelError(responseFailure(400, "http://localhost:8140/releases", body, "Bad Request"));

  it("names each resource's kind, handle and reason", () => {
    const error = rejected({
      code: "rel.invalid",
      message: "release: invalid",
      details: {
        resources: [
          {
            code: "sch.invalid_request",
            kind: "schema",
            handle: "human-user",
            message: 'schema designation invalid: "x-display" names unknown property "nickname"',
          },
          { kind: "flow", handle: "default-login", message: "step is broken" },
        ],
      },
    });

    expect(error.hint).toBe(
      'schema human-user: schema designation invalid: "x-display" names unknown property "nickname"; flow default-login: step is broken.',
    );
  });

  it("appends a flow's reason from the resource's own details", () => {
    const error = rejected({
      code: "rel.invalid",
      message: "release: invalid",
      details: {
        resources: [
          {
            code: "flowdef.invalid",
            kind: "flow",
            handle: "default-login",
            message: "flow definition: invalid",
            details: {
              details:
                'step "register-password": on_success create_user requires "identifier" to be collected upstream',
            },
          },
        ],
      },
    });

    expect(error.hint).toBe(
      'flow default-login: flow definition: invalid: step "register-password": on_success create_user requires "identifier" to be collected upstream.',
    );
  });

  it("appends the fields a connection may not change", () => {
    const error = rejected({
      code: "rel.invalid",
      message: "release: invalid",
      details: {
        resources: [
          {
            code: "idp.field_immutable",
            kind: "idp",
            handle: "zitadel-cloud",
            message:
              "identity provider connection: the field is fixed for the life of the connection",
            details: { details: { fields: ["oidc.issuer"] } },
          },
        ],
      },
    });

    expect(error.hint).toBe(
      "idp zitadel-cloud: identity provider connection: the field is fixed for the life of the connection: oidc.issuer.",
    );
  });

  it("appends the endpoints a connection left out", () => {
    const error = rejected({
      code: "rel.invalid",
      message: "release: invalid",
      details: {
        resources: [
          {
            code: "idp.endpoints_partial",
            kind: "idp",
            handle: "acme-sso",
            message: "identity provider connection: the endpoints are partially set",
            details: { details: { missing: ["jwks_uri", "token_endpoint"] } },
          },
        ],
      },
    });

    expect(error.hint).toBe(
      "idp acme-sso: identity provider connection: the endpoints are partially set: jwks_uri, token_endpoint.",
    );
  });

  it("adds no hint when a resource has no message", () => {
    expect(rejected({ details: { resources: [{ kind: "schema", handle: "a" }] } }).hint).toBe(
      undefined,
    );
  });
});

describe("isErrno", () => {
  it("matches an error carrying the given code", () => {
    expect(isErrno(Object.assign(new Error("gone"), { code: "ENOENT" }), "ENOENT")).toBe(true);
  });

  it("does not match another code, a missing code or a non-object", () => {
    expect(isErrno(Object.assign(new Error("gone"), { code: "EACCES" }), "ENOENT")).toBe(false);
    expect(isErrno(new Error("no code"), "ENOENT")).toBe(false);
    expect(isErrno(undefined, "ENOENT")).toBe(false);
    expect(isErrno("ENOENT", "ENOENT")).toBe(false);
  });
});

describe("errorMessage", () => {
  it("reads an Error's message, a string as it is, and anything else as text", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});

describe("isCancellation", () => {
  it("knows the error Ctrl-C aborts the run with", () => {
    expect(isCancellation(new ZitadelError("E_CANCELLED", "Cancelled."))).toBe(true);
  });

  it("is false for any other failure, so only a cancellation is let through", () => {
    expect(isCancellation(new ZitadelError("E_NETWORK", "Unreachable."))).toBe(false);
    expect(isCancellation(new Error("Cancelled."))).toBe(false);
    expect(isCancellation(undefined)).toBe(false);
  });
});
