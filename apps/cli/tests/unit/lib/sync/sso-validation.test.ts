import { afterEach, describe, expect, it } from "vitest";

import { takeReportedWarnings } from "../../../../src/lib/warnings";

import { ZitadelError } from "../../../../src/lib/errors";
import { validatePlannedSso } from "../../../../src/lib/sync/sso-validation";
import type { ResourceSyncer, SyncAction } from "../../../../src/lib/sync/types";

const SCHEMA = ".zitadel/schemas/staff.json";
const FLOW = ".zitadel/flows/login.json";
const CONNECTION = ".zitadel/idps/acme.json";

const syncer = (kind: string) => ({ kind }) as unknown as ResourceSyncer;

const schema = (providers: string[]) => ({
  $id: "https://schemas.example.test/staff.json",
  properties: { email: {} },
  "x-auth-methods": { sso: { enabled: true, providers } },
});

const flow = (userSchema: string, providers: string[]) => ({
  user_schema: userSchema,
  steps: [
    {
      name: "identifier",
      sso_providers: providers,
      transitions: {
        sso_authenticated: { target: "done" },
        sso_user_not_found: { target: "register-sso" },
        user_already_exists: { target: "sso-conflict" },
      },
    },
  ],
});

const connection = { slug: "acme", claim_mapping: { email: "email" } };

const create = (path: string, kind: string, content: object): SyncAction => ({
  kind: "create",
  path,
  syncer: syncer(kind),
  content,
  hash: "h",
});

const contents = (entries: Record<string, object>) => new Map(Object.entries(entries));

/** The message `validatePlannedSso` fails with, or `undefined` when it is satisfied. */
async function failure(run: () => Promise<void>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ZitadelError);
    return (error as ZitadelError).message;
  }
  return undefined;
}

afterEach(() => {
  delete process.env.ZITADEL_SKIP_FLOW_VALIDATION;
});

describe("validatePlannedSso", () => {
  const consistent = {
    [SCHEMA]: schema(["acme"]),
    [FLOW]: flow("https://schemas.example.test/staff.json", ["acme"]),
    [CONNECTION]: connection,
  };

  it("accepts a tree that agrees with itself", async () => {
    expect(
      await failure(() =>
        validatePlannedSso({
          actions: [create(FLOW, "flow", consistent[FLOW])],
          scannedContents: contents(consistent),
          stateResources: {},
        }),
      ),
    ).toBeUndefined();
  });

  it("stops on one that does not, naming the file", async () => {
    const message = await failure(() =>
      validatePlannedSso({
        actions: [create(FLOW, "flow", consistent[FLOW])],
        scannedContents: contents({ ...consistent, [SCHEMA]: schema(["other"]) }),
        stateResources: {},
      }),
    );

    expect(message).toContain(`${FLOW}: step "identifier"`);
    expect(message).toContain('"acme" is not listed in sso.providers');
  });

  it("does not re-judge a project this plan does not touch", async () => {
    // A rule added later must not break a project that was already applied.
    expect(
      await failure(() =>
        validatePlannedSso({
          actions: [{ kind: "skip", path: FLOW, reason: "no-change" }],
          scannedContents: contents({ ...consistent, [SCHEMA]: schema(["other"]) }),
          stateResources: {},
        }),
      ),
    ).toBeUndefined();
  });

  it("is skipped by the same switch as flow validation", async () => {
    process.env.ZITADEL_SKIP_FLOW_VALIDATION = "1";

    expect(
      await failure(() =>
        validatePlannedSso({
          actions: [create(FLOW, "flow", consistent[FLOW])],
          scannedContents: contents({ ...consistent, [SCHEMA]: schema(["other"]) }),
          stateResources: {},
        }),
      ),
    ).toBeUndefined();
  });

  it("judges a plan that only removes a connection a schema still lists", async () => {
    // Deleting the file is the change that makes the tree inconsistent.
    const remaining = { [SCHEMA]: schema(["acme"]) };
    const message = await failure(() =>
      validatePlannedSso({
        actions: [
          {
            kind: "skip",
            path: CONNECTION,
            reason: "unsupported-deletion",
            id: "idp_1",
            syncer: syncer("idp"),
          },
        ],
        scannedContents: contents(remaining),
        stateResources: {},
        slugOfKept: async () => "acme",
      }),
    );

    expect(message).toContain(
      `${SCHEMA}: sso.providers lists "acme" but there is no connection file`,
    );
  });

  it("names every problem under the path key flow validation uses, with the steps it is about", async () => {
    let details: { issues?: Array<Record<string, unknown>> } | undefined;
    try {
      await validatePlannedSso({
        actions: [create(FLOW, "flow", consistent[FLOW])],
        scannedContents: contents({ ...consistent, [SCHEMA]: schema(["other"]) }),
        stateResources: {},
      });
    } catch (error) {
      details = (error as ZitadelError).details as typeof details;
    }

    expect(details?.issues?.find((issue) => issue.rule === "sso/provider-id")).toMatchObject({
      rule: "sso/provider-id",
      path: FLOW,
      steps: ["identifier"],
    });
  });

  it("says how to get past the check, and that nothing was changed", async () => {
    let hint: string | undefined;
    try {
      await validatePlannedSso({
        actions: [create(FLOW, "flow", consistent[FLOW])],
        scannedContents: contents({ ...consistent, [SCHEMA]: schema(["other"]) }),
        stateResources: {},
      });
    } catch (error) {
      hint = (error as ZitadelError).hint;
    }

    expect(hint).toContain("no changes were made");
    expect(hint).toContain("ZITADEL_SKIP_FLOW_VALIDATION");
  });

  describe("finding the schema a flow pins", () => {
    const broken = { ...consistent, [SCHEMA]: schema(["other"]) };
    const run = (flowBody: object, extra: Partial<Parameters<typeof validatePlannedSso>[0]> = {}) =>
      failure(() =>
        validatePlannedSso({
          actions: [create(FLOW, "flow", flowBody)],
          scannedContents: contents({ ...broken, [FLOW]: flowBody }),
          stateResources: {},
          ...extra,
        }),
      );

    it("by the id the schema declares", async () => {
      expect(await run(flow("https://schemas.example.test/staff.json", ["acme"]))).toContain(
        "is not listed in sso.providers",
      );
    });

    it("by the id the platform assigned, once applied", async () => {
      expect(
        await run(flow("sch_01TEST", ["acme"]), {
          stateResources: { [SCHEMA]: { id: "sch_01TEST", hash: "h" } },
        }),
      ).toContain("is not listed in sso.providers");
    });

    it("by the file name in the URL setup wrote before the first apply", async () => {
      expect(
        await run(flow("https://elsewhere.example.test/schemas/staff.json", ["acme"])),
      ).toContain("is not listed in sso.providers");
    });

    it("by the file a re-pin in this plan names", async () => {
      const body = flow("sch_OLD", ["acme"]);
      const action: SyncAction = {
        kind: "create",
        path: FLOW,
        syncer: syncer("flow"),
        content: body,
        hash: "h",
        repin: { previousId: "sch_OLD", schemaPath: SCHEMA },
      };

      expect(
        await failure(() =>
          validatePlannedSso({
            actions: [action],
            scannedContents: contents({ ...broken, [FLOW]: body }),
            stateResources: {},
          }),
        ),
      ).toContain("is not listed in sso.providers");
    });

    it("not by a URL that only ends like a schema this project has already applied", async () => {
      // The platform gave staff.json an id, so a flow that names a URL is
      // naming some other schema, one this project does not keep locally. Paired
      // with staff.json it would be refused, since staff.json has sso off.
      takeReportedWarnings();
      const off = {
        ...schema(["acme"]),
        "x-auth-methods": { sso: { enabled: false, providers: ["acme"] } },
      };
      const body = flow("https://other-tenant.example.test/staff.json", ["acme"]);

      expect(
        await failure(() =>
          validatePlannedSso({
            actions: [create(FLOW, "flow", body)],
            scannedContents: contents({ [SCHEMA]: off, [FLOW]: body, [CONNECTION]: connection }),
            stateResources: { [SCHEMA]: { id: "sch_01TEST", hash: "h" } },
          }),
        ),
      ).toBeUndefined();
    });

    it("and says so when a flow that offers providers could not be paired", async () => {
      takeReportedWarnings();
      run(flow("https://unrelated.example.test/other.json", ["acme"]));

      expect(takeReportedWarnings().join("\n")).toContain(
        `${FLOW}: could not tell which local schema this flow pins`,
      );
    });

    it("not at all when it cannot be told, which leaves only the rules that need no schema", async () => {
      // Paired with its schema this flow would be refused, since the schema has
      // sso switched off. With no way to pair them, only the flow's own rules run.
      const off = {
        ...schema(["acme"]),
        "x-auth-methods": { sso: { enabled: false, providers: ["acme"] } },
      };
      const body = flow("https://unrelated.example.test/other.json", ["acme"]);

      expect(
        await failure(() =>
          validatePlannedSso({
            actions: [create(FLOW, "flow", body)],
            scannedContents: contents({ [SCHEMA]: off, [FLOW]: body, [CONNECTION]: connection }),
            stateResources: {},
          }),
        ),
      ).toBeUndefined();
    });
  });
});

describe("validatePlannedSso reports only what the plan touches", () => {
  const OTHER_CONNECTION = ".zitadel/idps/github.json";
  const OTHER_FLOW = ".zitadel/flows/staff-login.json";
  const OTHER_SCHEMA = ".zitadel/schemas/partners.json";

  /** A flow that offers acme and routes only the sign-in outcome, which the server accepts. */
  const lenientFlow = {
    user_schema: "https://schemas.example.test/partners.json",
    steps: [
      {
        name: "identifier",
        sso_providers: ["github"],
        transitions: { sso_authenticated: { target: "done" } },
      },
    ],
  };
  const tree = {
    [SCHEMA]: schema(["acme"]),
    [FLOW]: flow("https://schemas.example.test/staff.json", ["acme"]),
    [CONNECTION]: connection,
    [OTHER_SCHEMA]: {
      $id: "https://schemas.example.test/partners.json",
      properties: { email: {} },
      "x-auth-methods": { sso: { enabled: true, providers: ["github"] } },
    },
    [OTHER_FLOW]: lenientFlow,
    [OTHER_CONNECTION]: { slug: "github", claim_mapping: { email: "email" } },
  };

  const run = (actions: SyncAction[]) =>
    failure(() =>
      validatePlannedSso({ actions, scannedContents: contents(tree), stateResources: {} }),
    );

  it("does not stop an edit to one connection on another flow's older mistake", async () => {
    expect(await run([create(CONNECTION, "idp", connection)])).toBeUndefined();
  });

  it("stops an edit to the flow that has the mistake", async () => {
    expect(await run([create(OTHER_FLOW, "flow", lenientFlow)])).toContain("sso_user_not_found");
  });

  it("stops an edit to a connection the flow with the mistake offers", async () => {
    expect(
      await run([
        create(OTHER_CONNECTION, "idp", { slug: "github", claim_mapping: { email: "email" } }),
      ]),
    ).toContain(OTHER_FLOW);
  });

  it("stops an edit to the schema a flow with the mistake is pinned to", async () => {
    expect(await run([create(OTHER_SCHEMA, "schema", tree[OTHER_SCHEMA])])).toContain(OTHER_FLOW);
  });

  it("does not stop a plan that only keeps a removed connection no schema lists", async () => {
    const removed: SyncAction = {
      kind: "skip",
      path: ".zitadel/idps/gone.json",
      reason: "unsupported-deletion",
      syncer: syncer("idp"),
      id: "idp_9",
    };

    expect(await run([removed])).toBeUndefined();
  });

  it("does stop a plan that keeps a removed connection a schema still lists", async () => {
    const removed: SyncAction = {
      kind: "skip",
      path: ".zitadel/idps/github.json",
      reason: "unsupported-deletion",
      syncer: syncer("idp"),
      id: "idp_9",
    };
    const without = { ...tree } as Record<string, object>;
    delete without[OTHER_CONNECTION];

    expect(
      await failure(() =>
        validatePlannedSso({
          actions: [removed],
          scannedContents: contents(without),
          stateResources: {},
          slugOfKept: async () => "github",
        }),
      ),
    ).toContain("no connection file");
  });
});

describe("validatePlannedSso and a kept removal", () => {
  const kept = (path: string): SyncAction => ({
    kind: "skip",
    path,
    reason: "unsupported-deletion",
    syncer: syncer("idp"),
    id: "idp_9",
  });
  const withMissingProvider = {
    [SCHEMA]: schema(["acme", "never-existed"]),
    [FLOW]: flow("https://schemas.example.test/staff.json", ["acme"]),
    [CONNECTION]: connection,
  };

  it("does not fail a plan without edits on a provider that never had a file", async () => {
    const message = await failure(() =>
      validatePlannedSso({
        actions: [kept(".zitadel/idps/gone.json")],
        scannedContents: contents(withMissingProvider),
        stateResources: {},
        slugOfKept: async () => "gone",
      }),
    );

    expect(message).toBeUndefined();
  });

  it("fails it on the provider the removed file was for", async () => {
    const message = await failure(() =>
      validatePlannedSso({
        actions: [kept(".zitadel/idps/gone.json")],
        scannedContents: contents(withMissingProvider),
        stateResources: {},
        slugOfKept: async () => "never-existed",
      }),
    );

    expect(message).toContain('"never-existed"');
  });

  it("does not read what the removed file was for when nothing is missing", async () => {
    let asked = false;

    await failure(() =>
      validatePlannedSso({
        actions: [kept(".zitadel/idps/gone.json")],
        scannedContents: contents({
          [SCHEMA]: schema(["acme"]),
          [FLOW]: flow("https://schemas.example.test/staff.json", ["acme"]),
          [CONNECTION]: connection,
        }),
        stateResources: {},
        slugOfKept: async () => {
          asked = true;
          return "gone";
        },
      }),
    );

    expect(asked).toBe(false);
  });

  it("does not fail a rename, whose new file carries the slug", async () => {
    const renamed = {
      [SCHEMA]: schema(["acme"]),
      [FLOW]: flow("https://schemas.example.test/staff.json", ["acme"]),
      ".zitadel/idps/acme-main.json": connection,
    };

    const message = await failure(() =>
      validatePlannedSso({
        actions: [kept(CONNECTION), create(".zitadel/idps/acme-main.json", "idp", connection)],
        scannedContents: contents(renamed),
        stateResources: {},
        slugOfKept: async () => "acme",
      }),
    );

    expect(message).toBeUndefined();
  });
});

describe("validatePlannedSso and other connection files", () => {
  const GITHUB = ".zitadel/idps/github.json";
  const tree = {
    [SCHEMA]: schema(["acme", "github"]),
    [FLOW]: flow("https://schemas.example.test/staff.json", ["acme", "github"]),
    [CONNECTION]: { slug: "acme", claim_mapping: { email: "email", typo: "x" } },
    [GITHUB]: { slug: "github", claim_mapping: { email: "email" } },
  };
  const run = (actions: SyncAction[], over: Record<string, object> = {}) =>
    failure(() =>
      validatePlannedSso({
        actions,
        scannedContents: contents({ ...tree, ...over }),
        stateResources: {},
      }),
    );

  it("does not stop an edit to one on an older mistake in another", async () => {
    expect(await run([create(GITHUB, "idp", tree[GITHUB])])).toBeUndefined();
  });

  it("still stops an edit to a connection with a mistake of its own", async () => {
    expect(await run([create(CONNECTION, "idp", tree[CONNECTION])])).toContain(CONNECTION);
  });

  it("still stops two connections that claim one slug, whichever was edited", async () => {
    const message = await run([create(GITHUB, "idp", tree[GITHUB])], {
      [CONNECTION]: { slug: "github", claim_mapping: { email: "email" } },
    });

    expect(message).toContain("is also used by");
  });
});
