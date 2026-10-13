import { afterEach, describe, expect, it } from "vitest";

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
function failure(run: () => void): string | undefined {
  try {
    run();
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

  it("accepts a tree that agrees with itself", () => {
    expect(
      failure(() =>
        validatePlannedSso({
          actions: [create(FLOW, "flow", consistent[FLOW])],
          scannedContents: contents(consistent),
          stateResources: {},
        }),
      ),
    ).toBeUndefined();
  });

  it("stops on one that does not, naming the file", () => {
    const message = failure(() =>
      validatePlannedSso({
        actions: [create(FLOW, "flow", consistent[FLOW])],
        scannedContents: contents({ ...consistent, [SCHEMA]: schema(["other"]) }),
        stateResources: {},
      }),
    );

    expect(message).toContain(`${FLOW}: step "identifier"`);
    expect(message).toContain('"acme" is not listed in sso.providers');
  });

  it("does not re-judge a project this plan does not touch", () => {
    // A rule added later must not break a project that was already applied.
    expect(
      failure(() =>
        validatePlannedSso({
          actions: [{ kind: "skip", path: FLOW, reason: "no-change" }],
          scannedContents: contents({ ...consistent, [SCHEMA]: schema(["other"]) }),
          stateResources: {},
        }),
      ),
    ).toBeUndefined();
  });

  it("is skipped by the same switch as flow validation", () => {
    process.env.ZITADEL_SKIP_FLOW_VALIDATION = "1";

    expect(
      failure(() =>
        validatePlannedSso({
          actions: [create(FLOW, "flow", consistent[FLOW])],
          scannedContents: contents({ ...consistent, [SCHEMA]: schema(["other"]) }),
          stateResources: {},
        }),
      ),
    ).toBeUndefined();
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

    it("by the id the schema declares", () => {
      expect(run(flow("https://schemas.example.test/staff.json", ["acme"]))).toContain(
        "is not listed in sso.providers",
      );
    });

    it("by the id the platform assigned, once applied", () => {
      expect(
        run(flow("sch_01TEST", ["acme"]), {
          stateResources: { [SCHEMA]: { id: "sch_01TEST", hash: "h" } },
        }),
      ).toContain("is not listed in sso.providers");
    });

    it("by the file name in the URL setup wrote before the first apply", () => {
      expect(run(flow("https://elsewhere.example.test/schemas/staff.json", ["acme"]))).toContain(
        "is not listed in sso.providers",
      );
    });

    it("by the file a re-pin in this plan names", () => {
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
        failure(() =>
          validatePlannedSso({
            actions: [action],
            scannedContents: contents({ ...broken, [FLOW]: body }),
            stateResources: {},
          }),
        ),
      ).toContain("is not listed in sso.providers");
    });

    it("not at all when it cannot be told, which leaves only the rules that need no schema", () => {
      // Paired with its schema this flow would be refused, since the schema has
      // sso switched off. With no way to pair them, only the flow's own rules run.
      const off = {
        ...schema(["acme"]),
        "x-auth-methods": { sso: { enabled: false, providers: ["acme"] } },
      };
      const body = flow("https://unrelated.example.test/other.json", ["acme"]);

      expect(
        failure(() =>
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
