import { describe, expect, it } from "vitest";

import type { ZitadelClient } from "@zitadel/api/client";

import {
  assertEnvironmentName,
  listEnvironmentNames,
  ownerLabel,
} from "../../../src/lib/environment";

describe("assertEnvironmentName", () => {
  it.each(["dev", "prod", "staging", "staging-eu", "a".repeat(63)])(
    "accepts the platform-legal name %s",
    (name) => {
      expect(() => assertEnvironmentName(name)).not.toThrow();
    },
  );

  it.each(["Prod", "-prod", "prod-", "pro_d", "pr od", "", "a".repeat(64)])(
    "rejects %j, which the platform would refuse",
    (name) => {
      expect(() => assertEnvironmentName(name)).toThrow(/Invalid environment name/);
    },
  );

  it("refuses the prompt's project-level sentinel, so it cannot name an environment", () => {
    // The prompt answers "(project-level)" for the project level; the grammar
    // must guarantee no real environment can collide with it.
    expect(() => assertEnvironmentName("(project-level)")).toThrow(/Invalid environment name/);
  });
});

describe("ownerLabel", () => {
  it("names an environment, or the project level", () => {
    expect(ownerLabel("prod")).toBe("prod");
    expect(ownerLabel(undefined)).toBe("the project");
  });
});

describe("listEnvironmentNames", () => {
  /** A client whose `listEnvironments` answers from the given pages, in order. */
  const clientWith = (pages: ReadonlyArray<{ names: string[]; next?: string }>) => {
    const seen: Array<string | undefined> = [];
    const client = {
      listEnvironments: async (params: { page_token?: string }) => {
        seen.push(params.page_token);
        const page = pages[seen.length - 1] ?? { names: [] };
        return {
          environments: page.names.map((name) => ({ id: `env_${name}`, project_id: "p", name })),
          next_page_token: page.next ?? null,
        };
      },
    } as unknown as ZitadelClient;
    return { client, seen };
  };

  it("returns every name on a single page", async () => {
    const { client } = clientWith([{ names: ["dev", "staging", "prod"] }]);
    expect(await listEnvironmentNames(client, "p")).toEqual(["dev", "staging", "prod"]);
  });

  it("drains every page, following the page token", async () => {
    const { client, seen } = clientWith([
      { names: ["dev"], next: "t1" },
      { names: ["staging"], next: "t2" },
      { names: ["prod"] },
    ]);

    expect(await listEnvironmentNames(client, "p")).toEqual(["dev", "staging", "prod"]);
    expect(seen).toEqual([undefined, "t1", "t2"]);
  });
});
