import { QueryUsersBody as QueryUsersBodySchema } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import type {
  QueryUsers200UsersItemMetadataStatus,
  QueryUsersBody,
} from "@zitadel/api/generated/model";
import type { OperationName } from "@zitadel/api/client";
import type { SetupServer } from "msw/node";
import { beforeEach, describe, expect, vi } from "vitest";

import { it } from "@tests/fixtures";

import type { Credential } from "@/lib/backend";
import { lockoutStep } from "@/lib/publish/steps/lockout";
import { warnings } from "@/lib/ui";
import type { JsonObject, JsonValue } from "@/lib/zitadel";
import { aConfig, aLoginFlow, aUserSchema } from "@tests/helpers/config";
import { answering, answeringPages, refusal, type Sent } from "@tests/helpers/api-answers";
import { aDeployment } from "@tests/helpers/records";
import { aStepContext } from "@tests/helpers/step-context";
import type { StepContext } from "@/lib/publish/pipeline";

/**
 * The revision id the project lists for `human-user`.
 */
const HUMAN = "https://schemas.test/human-user.json";

/**
 * The revision id the project lists for `employee`.
 */
const EMPLOYEE = "https://schemas.test/employee.json";

/**
 * The warning a check that could not finish adds.
 */
const UNFINISHED = "Could not finish checking existing users";

/**
 * The warning the credential check gives when it cannot compare with the live release.
 */
const CREDENTIALS_SKIPPED =
  "Skipped the check for users whose only way to sign in this release disables: the live release's schemas could not be read.";

/**
 * A user of the project, as the fake platform holds one.
 */
type AUser = Readonly<{
  id: string;
  objectType: string;
  attributes: JsonObject;
  status: QueryUsers200UsersItemMetadataStatus;
}>;

/**
 * A schema revision as the project lists it, newest first.
 */
type Listed = Readonly<{ id: string; schema: JsonObject; metadata?: { created_at: string } }>;

/**
 * What the fake platform holds and how it answers.
 */
type Platform = Readonly<{
  /**
   * The project's users.
   */
  users?: readonly AUser[];
  /**
   * The users who hold an SSO link.
   */
  linked?: readonly string[];
  /**
   * The credentials each user holds; a user not named holds none.
   */
  held?: Readonly<Record<string, readonly Credential[]>>;
  /**
   * The schema revisions the project lists; `human-user` and `employee` unless given.
   */
  listing?: readonly Listed[];
  /**
   * The schema revisions the live release pins; nothing is deployed when left out.
   */
  pinned?: readonly string[];
  /**
   * Whether the live release pins no flow, and so serves no sign-in.
   */
  pinsNoFlow?: boolean;
  /**
   * Users deleted since the query: reading their links finds no user.
   */
  gone?: readonly string[];
  /**
   * Users whose credentials cannot be read.
   */
  credentialsUnreadableFor?: readonly string[];
  /**
   * Queries the platform refuses, by their filter.
   */
  refuses?: (filter: NonNullable<QueryUsersBody["filter"]>) => boolean;
  /**
   * Where the number of users each page served is recorded.
   */
  served?: number[];
}>;

/**
 * The requests the fake platform received.
 */
type Received = Readonly<{
  /**
   * The user queries, one per page asked for.
   */
  queried: readonly Sent[];
  /**
   * The schema listings.
   */
  listed: readonly Sent[];
  /**
   * The password reads.
   */
  passwords: readonly Sent[];
  /**
   * The passkey reads.
   */
  passkeys: readonly Sent[];
  /**
   * The identity-link reads.
   */
  links: readonly Sent[];
}>;

/**
 * An active user of `objectType`, carrying `attributes`.
 *
 * @param id - The user's id.
 * @param objectType - The object type of the user's schema.
 * @param attributes - The user's content.
 * @returns The user.
 */
function aUser(id: string, objectType: string, attributes: JsonObject = {}): AUser {
  return { id, objectType, attributes, status: "active" };
}

/**
 * `count` active users of `objectType`, numbered from `<prefix>-0`.
 *
 * @param prefix - What each id starts with.
 * @param objectType - The object type of their schema.
 * @param count - How many.
 * @param attributes - The content each carries.
 * @returns The users.
 */
function someUsers(
  prefix: string,
  objectType: string,
  count: number,
  attributes: JsonObject = {},
): AUser[] {
  return Array.from({ length: count }, (_, index) => {
    return aUser(`${prefix}-${index}`, objectType, attributes);
  });
}

/**
 * The step's view of a project on the fake platform: answers every request
 * the step sends.
 *
 * @param server - The test's MSW server.
 * @param platform - What the platform holds.
 * @returns The requests it received.
 */
function aPlatform(server: SetupServer, platform: Platform = {}): Received {
  const {
    users = [],
    linked = [],
    held = {},
    listing = [
      { id: HUMAN, schema: withoutIdentifier("human-user") },
      { id: EMPLOYEE, schema: withoutIdentifier("employee") },
    ],
    gone = [],
    credentialsUnreadableFor = [],
  } = platform;
  const unreachable = (userId: string | readonly string[] | undefined) => {
    if (typeof userId !== "string") {
      return undefined;
    }
    if (gone.includes(userId)) {
      return refusal(404, "user.not_found");
    }
    if (credentialsUnreadableFor.includes(userId)) {
      return refusal(403, "user.permission_denied");
    }
    return undefined;
  };
  answeringPages(server, "listDeployments", { deployments: liveOn(platform) });
  return {
    queried: answering(server, "queryUsers", ({ body }) => {
      return pageOf(platform, users, QueryUsersBodySchema.parse(body));
    }),
    links: answering(server, "listUserIdentityLinks", ({ params }) => {
      return (
        unreachable(params.user_id) ?? {
          identity_links: linked.includes(String(params.user_id)) ? [{}] : [],
        }
      );
    }),
    passwords: answering(server, "getUserPasswordState", ({ params }) => {
      return (
        unreachable(params.user_id) ??
        (held[String(params.user_id)]?.includes("password")
          ? { set_at: "2026-01-01T00:00:00Z" }
          : {})
      );
    }),
    passkeys: answering(server, "listUserPasskeys", ({ params }) => {
      return (
        unreachable(params.user_id) ?? {
          passkeys: held[String(params.user_id)]?.includes("passkey") ? [{}] : [],
        }
      );
    }),
    listed: answeringPages(server, "listSchemas", { schemas: listing }),
  };
}

/**
 * Has the platform refuse every request for `operation`.
 *
 * @param server - The test's MSW server.
 * @param operation - The operation it refuses.
 */
function refusing(server: SetupServer, operation: OperationName): void {
  answering(server, operation, refusal(403, "forbidden"));
}

/**
 * The credentials the step read, by method, as the users it read them of.
 *
 * @param received - What the platform received.
 * @returns The users each method was read for.
 */
function credentialsRead(received: Received) {
  const users = (sent: readonly Sent[]) => {
    return sent.map(({ params }) => {
      return params.user_id;
    });
  };
  return {
    password: users(received.passwords),
    passkey: users(received.passkeys),
    sso: users(received.links),
  };
}

/**
 * One page of the users a query matches, as the platform answers it.
 *
 * @param platform - What the platform holds and refuses.
 * @param users - The project's users.
 * @param query - The query.
 * @returns The page.
 */
function pageOf(platform: Platform, users: readonly AUser[], query: QueryUsersBody) {
  const filter = query.filter ?? [];
  if (platform.refuses?.(filter)) {
    return refusal(403, "user.permission_denied");
  }
  const equals = filter.find((f) => {
    return f.field === "schema_object_type" && f.operation === "equals";
  })?.value;
  const status = filter.find((f) => {
    return f.field === "status";
  })?.value;
  const excluded = filter
    .filter((f) => {
      return f.operation === "not_equals";
    })
    .map((f) => {
      return f.value;
    });
  const matching = users.filter((user) => {
    const ofType =
      equals === undefined ? !excluded.includes(user.objectType) : user.objectType === equals;
    return (status === undefined || user.status === status) && ofType;
  });
  const start = Number(query.page_token ?? 0);
  const page = matching.slice(start, start + (query.limit ?? matching.length));
  platform.served?.push(page.length);
  const end = start + page.length;
  return {
    users: page.map((user) => {
      return {
        id: user.id,
        schema: user.objectType === "employee" ? EMPLOYEE : HUMAN,
        attributes: user.attributes,
        metadata: { status: user.status },
      };
    }),
    next_page_token: end < matching.length ? String(end) : null,
  };
}

/**
 * The deployments live on the primary origins: one serving a release that
 * pins `platform.pinned`, or none when nothing is deployed.
 *
 * @param platform - What the platform holds.
 * @returns The deployments.
 */
function liveOn(platform: Platform) {
  if (platform.pinned === undefined) {
    return [];
  }
  const schemas = platform.pinned.map((revision_id) => {
    return { kind: "schema" as const, handle: "human-user", revision_id };
  });
  const flows = platform.pinsNoFlow
    ? []
    : [{ kind: "flow_definition" as const, handle: "default-login", revision_id: "fl_1" }];
  return [aDeployment({ release: { pointers: [...schemas, ...flows] } })];
}

/**
 * A lookup that fails.
 *
 * @returns Never; it always throws.
 */
function refused(): never {
  throw new Error("forbidden");
}

/**
 * A schema the schema contract takes that signs in with `identifier`.
 *
 * @param objectType - The schema's object type.
 * @param identifier - The property it designates as the identifier.
 * @returns The schema document.
 */
function signingInWith(objectType: string, identifier: string): JsonObject {
  return aUserSchema({ objectType, "x-identifier": identifier });
}

/**
 * A schema the schema contract takes that designates no identifier.
 *
 * @param objectType - The schema's object type.
 * @returns The schema document.
 */
function withoutIdentifier(objectType: string): JsonObject {
  return aUserSchema({ objectType, "x-identifier": undefined });
}

/**
 * A login flow whose sign-in starts on a passkey and reaches the identifier
 * step through `email_fallback`, as the `passkey-first` preset does.
 */
const PASSKEY_FIRST: JsonObject = {
  name: "default-login",
  user_schema: "human-user",
  purposes: { login: "passkey-first" },
  steps: [
    {
      name: "passkey-first",
      fields: [],
      transitions: { email_fallback: { target: "identifier" }, register: { purpose: "register" } },
    },
    { name: "identifier", fields: ["email"], transitions: { submit: { target: "password" } } },
    { name: "password", fields: ["x-auth-methods#password"] },
  ],
};

/**
 * A login flow that collects no identifier itself and only switches to a sign-up that does.
 */
const SIGN_UP_ONLY_COLLECTS: JsonObject = {
  name: "default-login",
  user_schema: "human-user",
  purposes: { login: "start", register: "register" },
  steps: [
    { name: "start", fields: [], transitions: { register: { purpose: "register" } } },
    { name: "register", fields: ["email"] },
  ],
};

/**
 * The methods a schema built by `enabling` lists, each on or off.
 */
const LISTED_METHODS = ["password", "passkey"] as const;

beforeEach(() => {
  warnings.take();
});

/**
 * Run the step and say everything it found: the lockouts it hands back, then
 * the notes it warned with.
 *
 * @param context - The step's context.
 * @returns The lockouts, then the warnings.
 */
async function everythingSaid(context: StepContext): Promise<readonly string[]> {
  const result = await lockoutStep.run(context);
  return [
    ...(result?.lockouts ?? []).map((lockout) => {
      return lockout.message;
    }),
    ...warnings.take(),
  ];
}

describe("lockoutStep", () => {
  it("runs for deploy only", () => {
    expect(lockoutStep.runsFor).toEqual(["deploy"]);
  });

  describe("when it finds users it would lock out", () => {
    const context = (server: SetupServer) => {
      aPlatform(server, { users: [aUser("u1", "human-user", { email: "a@example.com" })] });
      return aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "username") },
          flows: { "1.json": aLoginFlow({ collects: ["username"] }) },
        }),
      });
    };

    it("hands them back as lockouts", async ({ server }) => {
      const result = await lockoutStep.run(context(server));

      expect(result?.lockouts).toEqual([
        expect.objectContaining({
          message: expect.stringContaining(
            '1 of 1 existing user of "human-user" has no "username"',
          ),
        }),
      ]);
    });

    it("does not only warn about them", async ({ server }) => {
      await lockoutStep.run(context(server));

      expect(warnings.take()).toEqual([]);
    });
  });

  describe("when it cannot finish the check", () => {
    const context = (server: SetupServer) => {
      aPlatform(server);
      refusing(server, "queryUsers");
      return aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "username") },
          flows: { "1.json": aLoginFlow({ collects: ["username"] }) },
        }),
      });
    };

    it("hands back no lockouts", async ({ server }) => {
      const result = await lockoutStep.run(context(server));

      expect(result?.lockouts).toBeUndefined();
    });

    it("warns that the check did not finish", async ({ server }) => {
      await lockoutStep.run(context(server));

      expect(warnings.take()).toEqual([expect.stringContaining("Could not finish checking")]);
    });
  });

  describe("with users lacking the identifier their schema signs in with", () => {
    it("warns with the count", async ({ server }) => {
      aPlatform(server, {
        users: [
          aUser("u1", "human-user", { email: "a@example.com" }),
          aUser("u2", "human-user", { username: "b" }),
        ],
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "username") },
          flows: { "1.json": aLoginFlow({ collects: ["username"] }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining('1 of 2 existing users of "human-user" has no "username"'),
      ]);
    });

    it("hands back the update that moves each user to the revision that defines the identifier", async ({
      server,
    }) => {
      aPlatform(server, { users: [aUser("u1", "human-user", { email: "a@example.com" })] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "username") },
          flows: { "1.json": aLoginFlow({ collects: ["username"] }) },
        }),
      });

      const result = await lockoutStep.run(context);

      expect(result?.lockouts).toEqual([
        {
          message: expect.stringMatching(
            /Move each user to the schema revision that defines it.* update$/,
          ),
          fix: {
            id: "user:update",
            args: { id: "<user_id>" },
            flags: { schema: "<revision_id>", set: "attributes.username=<value>" },
          },
        },
      ]);
    });

    it("hands back the dot-path form for a dotted identifier", async ({ server }) => {
      aPlatform(server, { users: [aUser("u1", "human-user")] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "account.handle") },
          flows: { "1.json": aLoginFlow({ collects: ["account.handle"] }) },
        }),
      });

      const result = await lockoutStep.run(context);

      expect(result?.lockouts).toEqual([
        expect.objectContaining({
          fix: expect.objectContaining({
            flags: expect.objectContaining({ set: "attributes.account.handle=<value>" }),
          }),
        }),
      ]);
    });

    it("does not read an inherited property as the identifier", async ({ server }) => {
      aPlatform(server, { users: [aUser("u1", "human-user")] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "constructor") },
          flows: { "1.json": aLoginFlow({ collects: ["constructor"] }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toHaveLength(1);
    });

    it("counts only active users", async ({ server }) => {
      const deactivated = someUsers("d", "human-user", 200).map((user) => {
        return { ...user, status: "deactivated" as const };
      });
      aPlatform(server, { users: [...someUsers("a", "human-user", 3), ...deactivated] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "email") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining('3 of 3 existing users of "human-user"')]);
    });

    it("stays quiet when every user carries the identifier", async ({ server }) => {
      aPlatform(server, { users: [aUser("u1", "human-user", { email: "a@example.com" })] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("human-user") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([]);
    });
  });

  describe("when finding the identifier a flow collects", () => {
    it("does not treat a login field the schema does not designate as a lookup", async ({
      server,
    }) => {
      aPlatform(server, { users: [aUser("u1", "human-user", { email: "a@example.com" })] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "email") },
          flows: { "1.json": aLoginFlow({ collects: ["username"] }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([]);
    });

    it("checks only the designated identifier among the fields a login step collects", async ({
      server,
    }) => {
      aPlatform(server, { users: [aUser("u1", "human-user", { email: "a@example.com" })] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "email") },
          flows: { "1.json": aLoginFlow({ collects: ["email", "nickname"] }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([]);
    });

    it("finds the identifier on a later step of the login path", async ({ server }) => {
      aPlatform(server, { users: [aUser("u1", "human-user")] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "email") },
          flows: { "1.json": PASSKEY_FIRST },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining('has no "email"')]);
    });

    it.for<[string, JsonObject]>([
      [
        "a null purpose and action on a transition as absent",
        {
          ...PASSKEY_FIRST,
          steps: [
            {
              name: "passkey-first",
              fields: [],
              transitions: {
                email_fallback: { target: "identifier", purpose: null, action: null },
              },
            },
            {
              name: "identifier",
              fields: ["email"],
              transitions: { submit: { target: "password" } },
            },
            { name: "password", fields: ["x-auth-methods#password"] },
          ],
        },
      ],
      [
        "a plain transition to a step that is also the sign-up entry as on the path",
        {
          ...SIGN_UP_ONLY_COLLECTS,
          steps: [
            { name: "start", fields: [], transitions: { go: { target: "register" } } },
            { name: "register", fields: ["email"] },
          ],
        },
      ],
    ])("treats %s", async ([_shape, flow], { server }) => {
      aPlatform(server, { users: [aUser("u1", "human-user")] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "email") },
          flows: { "1.json": flow },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining('has no "email"')]);
    });

    it.for<[string, JsonObject]>([
      ["a purpose change", SIGN_UP_ONLY_COLLECTS],
      [
        "a not-found outcome into a sign-up step",
        {
          ...SIGN_UP_ONLY_COLLECTS,
          purposes: { login: "start" },
          steps: [
            {
              name: "start",
              fields: [],
              transitions: { sso_user_not_found: { target: "register-sso" } },
            },
            { name: "register-sso", fields: ["email"] },
          ],
        },
      ],
      [
        "a transition to another flow",
        {
          ...SIGN_UP_ONLY_COLLECTS,
          purposes: { login: "start" },
          steps: [
            {
              name: "start",
              fields: [],
              transitions: { other: { action: "switch", target: "identifier" } },
            },
            { name: "identifier", fields: ["email"] },
          ],
        },
      ],
    ])("does not follow %s off the login path", async ([_transition, flow], { server }) => {
      aPlatform(server, { users: [aUser("u1", "human-user")] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "email") },
          flows: { "1.json": flow },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([]);
    });
  });

  describe("when finding the schema a flow signs in with", () => {
    it("checks a schema that is only in the project's listing", async ({ server }) => {
      aPlatform(server, {
        users: [aUser("u1", "human-user")],
        listing: [{ id: HUMAN, schema: signingInWith("human-user", "email") }],
      });
      const context = aStepContext({
        config: aConfig({ flows: { "1.json": aLoginFlow({ userSchema: HUMAN }) } }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining('has no "email"')]);
    });

    it("checks a flow whose schema exists only on the server, named by object type", async ({
      server,
    }) => {
      aPlatform(server, {
        users: [aUser("e1", "employee")],
        listing: [{ id: EMPLOYEE, schema: signingInWith("employee", "email") }],
      });
      const context = aStepContext({
        config: aConfig({ flows: { "1.json": aLoginFlow({ userSchema: "employee" }) } }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining('has no "email"')]);
    });

    it("uses the newest revision of a server-only schema for its identifier", async ({
      server,
    }) => {
      aPlatform(server, {
        users: [aUser("e1", "employee", { email: "a@example.com" })],
        listing: [
          {
            id: "sch_new",
            schema: signingInWith("employee", "email"),
            metadata: { created_at: "2026-02-01T00:00:00Z" },
          },
          {
            id: "sch_old",
            schema: signingInWith("employee", "username"),
            metadata: { created_at: "2026-01-01T00:00:00Z" },
          },
        ],
      });
      const context = aStepContext({
        config: aConfig({ flows: { "1.json": aLoginFlow({ userSchema: "employee" }) } }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([]);
    });

    it("takes the identifier from the newest revision when a flow names an older one by id", async ({
      server,
    }) => {
      aPlatform(server, {
        users: [aUser("e1", "employee", { email: "a@example.com" })],
        listing: [
          {
            id: "sch_new",
            schema: signingInWith("employee", "username"),
            metadata: { created_at: "2026-02-01T00:00:00Z" },
          },
          {
            id: "sch_old",
            schema: signingInWith("employee", "email"),
            metadata: { created_at: "2026-01-01T00:00:00Z" },
          },
        ],
      });
      const context = aStepContext({
        config: aConfig({
          flows: { "1.json": aLoginFlow({ userSchema: "sch_old", collects: ["username"] }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining('has no "username"')]);
    });

    it("takes the first listed revision as the newest, whatever the timestamps' fractional digits", async ({
      server,
    }) => {
      aPlatform(server, {
        users: [aUser("e1", "employee", { email: "a@example.com" })],
        listing: [
          {
            id: "sch_new",
            schema: signingInWith("employee", "username"),
            metadata: { created_at: "2026-01-01T00:00:00.123Z" },
          },
          {
            id: "sch_old",
            schema: signingInWith("employee", "email"),
            metadata: { created_at: "2026-01-01T00:00:00.12Z" },
          },
        ],
      });
      const context = aStepContext({
        config: aConfig({
          flows: { "1.json": aLoginFlow({ userSchema: "employee", collects: ["username"] }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining('has no "username"')]);
    });

    it("lets the bundle's schema drop the designation even if a listed revision still has one", async ({
      server,
    }) => {
      aPlatform(server, {
        users: [aUser("e1", "employee")],
        listing: [
          {
            id: "sch_old",
            schema: signingInWith("employee", "email"),
            metadata: { created_at: "2026-01-01T00:00:00Z" },
          },
        ],
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "sch_old" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([]);
    });

    it("does not list the schemas when every flow names an object type, nobody is linked and nothing is deployed", async ({
      server,
    }) => {
      const received = aPlatform(server, {
        users: [aUser("u1", "human-user", { email: "a@example.com" })],
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "email") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      await lockoutStep.run(context);

      expect(received.listed).toEqual([]);
    });

    it("lists the schemas once when both resolving a flow and naming a user need them", async ({
      server,
    }) => {
      const received = aPlatform(server, { users: [aUser("u1", "human-user")], linked: ["u1"] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: EMPLOYEE }) },
        }),
      });

      await lockoutStep.run(context);

      expect(received.listed).toHaveLength(1);
    });

    it("names the unserved schema from the one listing it read", async ({ server }) => {
      aPlatform(server, { users: [aUser("u1", "human-user")], linked: ["u1"] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: EMPLOYEE }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining(
          'of "human-user" is on a schema no flow in this release uses (1 of them has an SSO link)',
        ),
      ]);
    });
  });

  describe("with users of a schema no flow serves", () => {
    it("warns about every one of them, counting the SSO ones on top", async ({ server }) => {
      aPlatform(server, {
        users: [aUser("u1", "human-user"), aUser("u2", "human-user")],
        linked: ["u1"],
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining(
          '2 existing users of "human-user" are on a schema no flow in this release uses (1 of them has an SSO link)',
        ),
      ]);
    });

    it("tells the reader to keep or restore a flow on their schema", async ({ server }) => {
      aPlatform(server, { users: [aUser("u1", "human-user")], linked: ["u1"] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining('keep or restore a flow on "human-user"')]);
    });

    it("counts the revisions of one schema together", async ({ server }) => {
      aPlatform(server, {
        users: [aUser("u1", "human-user"), aUser("u2", "human-user")],
        linked: ["u1", "u2"],
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining(
          '2 existing users of "human-user" are on a schema no flow in this release uses (2 of them have an SSO link)',
        ),
      ]);
    });

    it("warns about those with no SSO link, such as password users", async ({ server }) => {
      aPlatform(server, { users: [aUser("u1", "human-user")] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining(
          '1 existing user of "human-user" is on a schema no flow in this release uses, so they cannot sign in',
        ),
      ]);
    });

    it("says nothing of SSO links when none of them has one", async ({ server }) => {
      aPlatform(server, { users: [aUser("u1", "human-user")] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.not.stringContaining("SSO link")]);
    });

    it("resolves a flow's schema given by its $id before checking either case", async ({
      server,
    }) => {
      aPlatform(server, {
        users: [aUser("u1", "employee", { email: "a@example.com" }), aUser("u2", "human-user")],
        linked: ["u2", "u1"],
      });
      const context = aStepContext({
        config: aConfig({
          schemas: {
            "1.json": aUserSchema({
              objectType: "employee",
              $id: EMPLOYEE,
              "x-identifier": "username",
            }),
          },
          flows: { "1.json": aLoginFlow({ userSchema: EMPLOYEE, collects: ["username"] }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining('of "employee"'),
        expect.stringContaining('of "human-user"'),
      ]);
    });

    it("warns about every user when the release carries no flow definitions, as it serves no sign-in", async ({
      server,
    }) => {
      aPlatform(server, { users: [aUser("u1", "human-user")], linked: ["u1"] });
      const context = aStepContext({
        config: aConfig({ schemas: { "1.json": withoutIdentifier("employee") } }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining(
          '1 existing user of "human-user" is on a schema no flow in this release uses (1 of them has an SSO link)',
        ),
      ]);
    });

    it("does not guess which schema is unserved when a flow's schema cannot be resolved", async ({
      server,
    }) => {
      aPlatform(server, { users: [aUser("u1", "human-user")], linked: ["u1"] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: {
            "1.json": aLoginFlow({ userSchema: "employee" }),
            "2.json": aLoginFlow({ userSchema: "https://schemas.test/unknown.json" }),
          },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining("Skipped the check for users of schemas no flow serves"),
      ]);
    });

    it("names a schema that really has an empty object type instead of calling it unnamed", async ({
      server,
    }) => {
      aPlatform(server, {
        users: [aUser("u1", "human-user")],
        linked: ["u1"],
        listing: [{ id: HUMAN, schema: aUserSchema({ objectType: "" }) }],
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining(
          'of "" is on a schema no flow in this release uses (1 of them has an SSO link)',
        ),
      ]);
    });

    it("counts a user deleted since the query, without reporting a failure", async ({ server }) => {
      aPlatform(server, {
        users: [aUser("u1", "human-user"), aUser("u2", "human-user")],
        linked: ["u2"],
        gone: ["u1"],
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining(
          '2 existing users of "human-user" are on a schema no flow in this release uses (1 of them has an SSO link)',
        ),
      ]);
    });

    it("counts every one of them", async ({ server }) => {
      aPlatform(server, { users: someUsers("s", "human-user", 250), linked: ["s-249"] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining('250 existing users of "human-user" are on a schema'),
      ]);
    });

    it("looks up the links of only the first ones", async ({ server }) => {
      aPlatform(server, { users: someUsers("s", "human-user", 250), linked: ["s-249"] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.not.stringContaining("SSO link")]);
    });

    it("counts linked users among the first ones", async ({ server }) => {
      aPlatform(server, { users: someUsers("s", "human-user", 250), linked: ["s-0"] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining("(at least 1 of them has an SSO link)")]);
    });

    it("qualifies the SSO count when the user read was cut short", async ({ server }) => {
      aPlatform(server, { users: someUsers("s", "human-user", 1200), linked: ["s-0"] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining("(at least 1 of them has an SSO link)")]);
    });
  });

  describe("when reading the users", () => {
    it("reads no more than the scan limit in all, across schemas", async ({ server }) => {
      const served: number[] = [];
      aPlatform(server, {
        users: [...someUsers("h", "human-user", 700), ...someUsers("e", "employee", 700)],
        served,
      });
      const context = aStepContext({
        config: aConfig({
          schemas: {
            "1.json": signingInWith("human-user", "email"),
            "2.json": signingInWith("employee", "email"),
          },
          flows: { "1.json": aLoginFlow(), "2.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      await lockoutStep.run(context);

      expect(
        served.reduce((total, count) => {
          return total + count;
        }, 0),
      ).toBeLessThanOrEqual(1000);
    });

    it("gives every schema its own share of the scan limit", async ({ server }) => {
      aPlatform(server, {
        users: [
          ...someUsers("a", "human-user", 1200, { email: "a@example.com" }),
          ...someUsers("e", "employee", 3),
        ],
      });
      const context = aStepContext({
        config: aConfig({
          schemas: {
            "1.json": signingInWith("human-user", "email"),
            "2.json": signingInWith("employee", "email"),
          },
          flows: { "1.json": aLoginFlow(), "2.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining('3 of 3 existing users of "employee" have no "email"'),
        expect.stringContaining('Checked only some of the users of "human-user"'),
      ]);
    });

    it("reports an exact count when the read ends exactly at the limit", async ({ server }) => {
      aPlatform(server, { users: someUsers("u", "human-user", 500) });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "email") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining('500 of 500 existing users of "human-user"')]);
    });

    it("stops asking when a page is empty but still offers another", async ({ server }) => {
      aPlatform(server);
      answering(server, "queryUsers", { users: [], next_page_token: "again" });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "email") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining("Checked only some of the users of")]);
    });
  });

  describe("with what the diff learned", () => {
    it("reads no users when no schema or flow changed", async ({ server }) => {
      const received = aPlatform(server, { users: [aUser("u1", "human-user")] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
        learned: { schemasOrFlowsChanged: false },
      });

      await lockoutStep.run(context);

      expect(received.queried).toEqual([]);
    });

    it("warns about nothing when no schema or flow changed", async ({ server }) => {
      aPlatform(server, { users: [aUser("u1", "human-user")] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
        learned: { schemasOrFlowsChanged: false },
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([]);
    });

    it("checks the users when a schema or flow changed", async ({ server }) => {
      aPlatform(server, { users: [aUser("u1", "human-user")] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
        learned: { schemasOrFlowsChanged: true },
      });

      const said = await everythingSaid(context);

      expect(said).toHaveLength(1);
    });

    it("still checks when a clean diff leaves a flow's schema to the server", async ({
      server,
    }) => {
      aPlatform(server, { users: [aUser("u1", "human-user")] });
      const context = aStepContext({
        config: aConfig({ flows: { "1.json": aLoginFlow({ userSchema: "employee" }) } }),
        learned: { schemasOrFlowsChanged: false },
      });

      const said = await everythingSaid(context);

      expect(said).toHaveLength(1);
    });
  });

  describe("when the platform cannot answer", () => {
    it("never fails the deploy when users cannot be read", async ({ server }) => {
      aPlatform(server);
      refusing(server, "queryUsers");
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "username") },
          flows: { "1.json": aLoginFlow({ collects: ["username"] }) },
        }),
      });

      const result = await lockoutStep.run(context);

      expect(result).toBeUndefined();
    });

    it("says the check could not finish when users cannot be read", async ({ server }) => {
      aPlatform(server);
      refusing(server, "queryUsers");
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "username") },
          flows: { "1.json": aLoginFlow({ collects: ["username"] }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining(UNFINISHED)]);
    });

    it("keeps the identifier warning when a link read fails", async ({ server }) => {
      aPlatform(server, { users: [aUser("u1", "human-user"), aUser("u2", "other")] });
      refusing(server, "listUserIdentityLinks");
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "username") },
          flows: { "1.json": aLoginFlow({ collects: ["username"] }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining('has no "username"'),
        expect.stringContaining('1 existing user of "human-user" is on a schema'),
        expect.stringContaining(UNFINISHED),
      ]);
    });

    it("reports failed identity-link reads instead of counting the users as unlinked", async ({
      server,
    }) => {
      aPlatform(server, { users: [aUser("u1", "human-user")], linked: ["u1"] });
      refusing(server, "listUserIdentityLinks");
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining('1 existing user of "human-user" is on a schema'),
        expect.stringContaining(UNFINISHED),
      ]);
    });

    it("keeps one scan's warning when the other scan fails", async ({ server }) => {
      aPlatform(server, {
        users: [aUser("u1", "human-user")],
        refuses: (filter) => {
          return filter.some((f) => {
            return f.operation === "not_equals";
          });
        },
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "email") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining('has no "email"'),
        expect.stringContaining(UNFINISHED),
      ]);
    });

    it("keeps one schema's warning when another schema's read fails", async ({ server }) => {
      aPlatform(server, {
        users: [aUser("u1", "human-user"), aUser("e1", "employee")],
        refuses: (filter) => {
          return filter.some((f) => {
            return f.value === "employee";
          });
        },
      });
      const context = aStepContext({
        config: aConfig({
          schemas: {
            "1.json": signingInWith("human-user", "email"),
            "2.json": signingInWith("employee", "email"),
          },
          flows: { "1.json": aLoginFlow(), "2.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining('of "human-user"'),
        expect.stringContaining(UNFINISHED),
      ]);
    });

    it("still warns about missing identifiers when the schemas cannot be listed", async ({
      server,
    }) => {
      aPlatform(server, { users: [aUser("u1", "human-user", { email: "a@example.com" })] });
      refusing(server, "listSchemas");
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "username") },
          flows: { "1.json": aLoginFlow({ collects: ["username"] }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining('has no "username"')]);
    });

    it("says the schemas could not be read, not that a flow's schema is undefined", async ({
      server,
    }) => {
      aPlatform(server);
      refusing(server, "listSchemas");
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: EMPLOYEE }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining("the project's schemas could not be read")]);
    });

    it("counts users together when their schemas cannot be named", async ({ server }) => {
      aPlatform(server, {
        users: [aUser("u1", "human-user"), aUser("u2", "human-user")],
        linked: ["u1", "u2"],
      });
      refusing(server, "listSchemas");
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining("2 existing users of schemas whose names could not be read"),
      ]);
    });

    it("does not name a schema id when their schemas cannot be named", async ({ server }) => {
      aPlatform(server, {
        users: [aUser("u1", "human-user"), aUser("u2", "human-user")],
        linked: ["u1", "u2"],
      });
      refusing(server, "listSchemas");
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": withoutIdentifier("employee") },
          flows: { "1.json": aLoginFlow({ userSchema: "employee" }) },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.not.stringContaining(HUMAN)]);
    });

    it("says so when resolving the flows throws before the scans start", async ({ server }) => {
      aPlatform(server);
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": signingInWith("human-user", "email") },
          flows: { "1.json": aLoginFlow() },
        }),
      });
      vi.spyOn(context.config.flows, "findSchemaOf").mockImplementation(refused);

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining(UNFINISHED)]);
    });
  });

  describe("with users whose only way in the release disables", () => {
    /**
     * A `human-user` schema signing in by email, listing password and passkey
     * with only the `enabled` ones on, since the contract takes no schema that
     * lists no method.
     *
     * @param enabled - The methods it enables.
     * @returns The schema document.
     */
    const enabling = (...enabled: string[]): JsonObject => {
      return {
        ...signingInWith("human-user", "email"),
        "x-auth-methods": Object.fromEntries(
          LISTED_METHODS.map((method) => {
            return [method, { enabled: enabled.includes(method) }];
          }),
        ),
      };
    };
    const users = [
      aUser("u1", "human-user", { email: "a@example.com" }),
      aUser("u2", "human-user", { email: "b@example.com" }),
      aUser("u3", "human-user", { email: "c@example.com" }),
    ];
    const liveListing = [{ id: HUMAN, schema: enabling("password", "passkey") }];

    it("warns when passkeys are disabled and some users hold only a passkey", async ({
      server,
    }) => {
      aPlatform(server, {
        users,
        listing: liveListing,
        pinned: [HUMAN],
        held: { u1: ["passkey"], u2: ["passkey", "password"] },
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": enabling("password") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        '1 of 3 existing users of "human-user" can only sign in with passkey, which this release disables, so they cannot sign in after it. Keep passkey enabled until they have another way in.',
      ]);
    });

    it("counts a live revision the schema contract refuses", async ({ server }) => {
      const refusedByContract: JsonObject = {
        ...enabling("password", "passkey"),
        "x-identifier": "",
      };
      aPlatform(server, {
        users,
        listing: [{ id: HUMAN, schema: refusedByContract }],
        pinned: [HUMAN],
        held: { u1: ["passkey"] },
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": enabling("password") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        '1 of 3 existing users of "human-user" can only sign in with passkey, which this release disables, so they cannot sign in after it. Keep passkey enabled until they have another way in.',
      ]);
    });

    /**
     * A live `human-user` revision the schema contract refuses, since its
     * identifier is blank, with the given `x-auth-methods`.
     *
     * @param authMethods - The raw `x-auth-methods` value.
     * @returns The schema document.
     */
    const refusedWith = (authMethods: JsonValue): JsonObject => {
      return {
        ...signingInWith("human-user", "email"),
        "x-identifier": "",
        "x-auth-methods": authMethods,
      };
    };

    /**
     * Runs the step against a release that enables nothing and a live
     * revision the contract refuses.
     *
     * @param live - The live revision.
     * @param linked - The users holding an SSO link.
     * @param held - The credentials each user holds.
     * @returns The warnings reported.
     */
    const runAgainst = async (
      server: SetupServer,
      live: JsonObject,
      linked: readonly string[],
      held: Readonly<Record<string, readonly Credential[]>>,
    ): Promise<readonly string[]> => {
      aPlatform(server, {
        users,
        listing: [{ id: HUMAN, schema: live }],
        pinned: [HUMAN],
        linked,
        held,
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": enabling() },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      return everythingSaid(context);
    };

    it("counts SSO on a refused live revision that lists a provider", async ({ server }) => {
      const warnings = await runAgainst(
        server,
        refusedWith({ sso: { enabled: true, providers: ["google"] } }),
        ["u1"],
        {},
      );

      expect(warnings).toEqual([
        '1 of 3 existing users of "human-user" can only sign in with sso, which this release disables, so they cannot sign in after it. Keep sso enabled until they have another way in.',
      ]);
    });

    it.for<[string, JsonValue]>([
      ["lists no provider", { enabled: true, providers: [] }],
      ["has no providers field", { enabled: true }],
      ["has providers that are not a list", { enabled: true, providers: "google" }],
    ])(
      "does not count SSO on a refused live revision that %s",
      async ([_name, sso], { server }) => {
        const warnings = await runAgainst(server, refusedWith({ sso }), ["u1"], {});

        expect(warnings).toEqual([]);
      },
    );

    it.for<[string, JsonValue]>([
      ["is switched off", { enabled: false }],
      ["is enabled by something other than true", { enabled: "true" }],
      ["has no enabled field", {}],
    ])(
      "does not count a method on a refused live revision that %s",
      async ([_name, password], { server }) => {
        const warnings = await runAgainst(
          server,
          refusedWith({ password, passkey: { enabled: true } }),
          [],
          {
            u1: ["password", "passkey"],
          },
        );

        expect(warnings).toEqual([
          '1 of 3 existing users of "human-user" can only sign in with passkey, which this release disables, so they cannot sign in after it. Keep passkey enabled until they have another way in.',
        ]);
      },
    );

    it("names the methods of a refused live revision in a fixed order", async ({ server }) => {
      const warnings = await runAgainst(
        server,
        refusedWith({ password: { enabled: true }, passkey: { enabled: true } }),
        [],
        { u1: ["password"] },
      );

      expect(warnings).toEqual([
        expect.stringContaining("can only sign in with passkey or password, which this release"),
      ]);
    });

    it("cannot compare with a refused live revision that has no string object type", async ({
      server,
    }) => {
      const live: JsonObject = {
        ...refusedWith({ password: { enabled: true } }),
        objectType: 5,
      };

      const warnings = await runAgainst(server, live, [], { u1: ["password"] });

      expect(warnings).toEqual([expect.stringContaining(CREDENTIALS_SKIPPED)]);
    });

    it("takes the identifier of a refused live revision that designates one", async ({
      server,
    }) => {
      aPlatform(server, {
        users: [aUser("u9", "human-user")],
        listing: [{ id: HUMAN, schema: { ...refusedWith({}), "x-identifier": "email" } }],
      });
      const context = aStepContext({
        config: aConfig({ flows: { "1.json": aLoginFlow({ userSchema: "human-user" }) } }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining('has no "email"')]);
    });

    it.for<[JsonValue]>([["   "], [""], [5]])(
      "takes no identifier from a refused live revision whose identifier is %j",
      async ([identifier], { server }) => {
        aPlatform(server, {
          users: [aUser("u9", "human-user")],
          listing: [{ id: HUMAN, schema: { ...refusedWith({}), "x-identifier": identifier } }],
        });
        const context = aStepContext({
          config: aConfig({
            flows: { "1.json": aLoginFlow({ userSchema: "human-user", collects: ["   "] }) },
          }),
        });

        const said = await everythingSaid(context);

        expect(said).toEqual([]);
      },
    );

    it("reads only the credentials of the methods lost and kept", async ({ server }) => {
      const received = aPlatform(server, {
        users: users.slice(0, 1),
        listing: liveListing,
        pinned: [HUMAN],
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": enabling("password") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      await lockoutStep.run(context);

      expect(credentialsRead(received)).toEqual({ password: ["u1"], passkey: ["u1"], sso: [] });
    });

    it("warns about no user who holds neither method", async ({ server }) => {
      aPlatform(server, { users: users.slice(0, 1), listing: liveListing, pinned: [HUMAN] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": enabling("password") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([]);
    });

    it("reads no credentials when the release keeps every method", async ({ server }) => {
      const received = aPlatform(server, { users, listing: liveListing, pinned: [HUMAN] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": enabling("password", "passkey") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      await lockoutStep.run(context);

      expect(credentialsRead(received)).toEqual({ password: [], passkey: [], sso: [] });
    });

    it("reads no credentials when nothing is deployed", async ({ server }) => {
      const received = aPlatform(server, { users, listing: liveListing });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": enabling("password") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      await lockoutStep.run(context);

      expect(credentialsRead(received)).toEqual({ password: [], passkey: [], sso: [] });
    });

    it("warns about nothing when the release keeps every method", async ({ server }) => {
      aPlatform(server, { users, listing: liveListing, pinned: [HUMAN] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": enabling("password", "passkey") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([]);
    });

    it("warns about nothing when nothing is deployed", async ({ server }) => {
      aPlatform(server, { users, listing: liveListing });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": enabling("password") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([]);
    });

    it("compares with the revision the live release pins, not the newest one", async ({
      server,
    }) => {
      aPlatform(server, {
        users,
        listing: [
          { id: "sch_newest", schema: enabling("password") },
          { id: "sch_live", schema: enabling("password", "passkey") },
        ],
        pinned: ["sch_live"],
        held: { u1: ["passkey"] },
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": enabling("password") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([expect.stringContaining("can only sign in with passkey")]);
    });

    it("compares a schema the release does not carry with the newest revision the server pins for it", async ({
      server,
    }) => {
      aPlatform(server, {
        users,
        listing: [
          { id: "sch_newest", schema: enabling("password") },
          { id: "sch_live", schema: enabling("password", "passkey") },
        ],
        pinned: ["sch_live"],
        held: { u1: ["passkey"] },
      });
      const context = aStepContext({
        config: aConfig({ flows: { "1.json": aLoginFlow() } }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining(
          '1 of 3 existing users of "human-user" can only sign in with passkey',
        ),
      ]);
    });

    it("takes no method as live when the live release pins no flow", async ({ server }) => {
      aPlatform(server, {
        users,
        listing: [
          { id: "sch_newest", schema: enabling("password", "passkey") },
          { id: "sch_pinned", schema: enabling("password") },
        ],
        pinned: ["sch_pinned"],
        pinsNoFlow: true,
        held: { u1: ["passkey"] },
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": enabling("password") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([]);
    });

    it("asks to keep both methods when two are disabled", async ({ server }) => {
      aPlatform(server, {
        users,
        listing: liveListing,
        pinned: [HUMAN],
        held: { u1: ["passkey"], u2: ["password"] },
      });
      const context = aStepContext({
        config: aConfig({ schemas: { "1.json": enabling() }, flows: { "1.json": aLoginFlow() } }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        expect.stringContaining(
          "can only sign in with passkey or password, which this release disables, so they cannot sign in after it. Keep them enabled",
        ),
      ]);
    });

    it("says the check could not finish when a credential read fails", async ({ server }) => {
      aPlatform(server, {
        users,
        listing: liveListing,
        pinned: [HUMAN],
        credentialsUnreadableFor: ["u1", "u2", "u3"],
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": enabling("password") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        "Could not finish checking existing users for sign-in lockouts: a request to the server failed.",
      ]);
    });

    it("keeps the other users' counts when one user's read fails", async ({ server }) => {
      aPlatform(server, {
        users,
        listing: liveListing,
        pinned: [HUMAN],
        held: { u1: ["passkey"], u3: ["passkey"] },
        credentialsUnreadableFor: ["u3"],
      });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": enabling("password") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toEqual([
        'at least 1 of 3 existing users of "human-user" can only sign in with passkey, which this release disables, so they cannot sign in after it. Keep passkey enabled until they have another way in.',
        "Could not finish checking existing users for sign-in lockouts: a request to the server failed.",
      ]);
    });

    it.for<[string, Platform, readonly OperationName[]]>([
      [
        "a live revision is not in the listing",
        { listing: liveListing, pinned: ["sch_unlisted"] },
        [],
      ],
      ["the schemas cannot be read", { pinned: [HUMAN] }, ["listSchemas"]],
      ["the live release cannot be read", { listing: liveListing }, ["listDeployments"]],
    ])("says the check was skipped when %s", async ([_why, platform, failing], { server }) => {
      aPlatform(server, { users, ...platform });
      for (const operation of failing) {
        refusing(server, operation);
      }
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": enabling("password") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      const said = await everythingSaid(context);

      expect(said).toContain(CREDENTIALS_SKIPPED);
    });

    it("reads no credentials when a live revision is not in the listing", async ({ server }) => {
      const received = aPlatform(server, { users, listing: liveListing, pinned: ["sch_unlisted"] });
      const context = aStepContext({
        config: aConfig({
          schemas: { "1.json": enabling("password") },
          flows: { "1.json": aLoginFlow() },
        }),
      });

      await lockoutStep.run(context);

      expect(credentialsRead(received)).toEqual({ password: [], passkey: [], sso: [] });
    });
  });
});
