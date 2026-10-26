import { describe, expect, it } from "vitest";

import { RESOURCES } from "../../../src/commands/resources";
import { onATerminal } from "../../helpers/project";
import { parseJson, runCliForTest } from "../../helpers/run-cli";

type Json = Record<string, unknown>;

describe("zitadel resources", () => {
  it("describes every registry entry without touching a server", async () => {
    const res = await runCliForTest(["resources", "--json", "--non-interactive", "--no-telemetry"]);
    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: {
        count: number;
        items: Array<{ topic: string; verbs: string[]; filter_fields?: string[] }>;
      };
    };
    expect(json.status).toBe("ok");
    expect(json.data.count).toBe(Object.keys(RESOURCES).length);
    expect(json.data.items.map((resource) => resource.topic)).toEqual(Object.keys(RESOURCES));
  });

  it("reports the verbs each resource actually exposes", async () => {
    const res = await runCliForTest(["resources", "--json", "--non-interactive", "--no-telemetry"]);
    const resources = (parseJson(res.stdout) as { data: { items: Array<Record<string, unknown>> } })
      .data.items;
    const byTopic = Object.fromEntries(resources.map((resource) => [resource.topic, resource]));
    expect(byTopic.users?.verbs).toEqual(["list", "get", "create", "update", "delete"]);
    expect(byTopic.sessions?.verbs).toEqual(["list", "get", "revoke"]);
    expect(byTopic.events?.verbs).toEqual(["list", "get"]);
    expect(byTopic.projects?.verbs).toEqual(["list", "get", "update"]);
  });

  it("describes each write verb's own fields, since required differs between them", async () => {
    const res = await runCliForTest(["resources", "--json", "--non-interactive", "--no-telemetry"]);
    const resources = (
      parseJson(res.stdout) as {
        data: {
          items: Array<{
            topic: string;
            create_fields?: Array<{ name: string; flag: string | null; required: boolean }>;
            update_fields?: Array<{ name: string; flag: string | null; required: boolean }>;
          }>;
        };
      }
    ).data.items;

    const grants = resources.find((resource) => resource.topic === "grants");
    expect(grants?.create_fields?.[0]).toMatchObject({
      name: "relation",
      flag: "--relation",
      kind: "enum",
      required: true,
      options: ["viewer", "editor", "admin"],
    });
    // The principal is a nested object, and each of its leaves is a field.
    expect(grants?.create_fields?.map((field) => [field.name, field.flag, field.required])).toEqual(
      [
        ["relation", "--relation", true],
        ["expires_at", "--expires-at", false],
        ["user.user_id", "--user-user-id", false],
        ["user.identifier", "--user-identifier", false],
        ["team.team_id", "--team-team-id", false],
        ["team.name", "--team-name", false],
      ],
    );
    // Grants have no update endpoint, so nothing claims otherwise.
    expect(grants?.update_fields).toBeUndefined();

    const teams = resources.find((resource) => resource.topic === "teams");
    expect(teams?.create_fields?.find((field) => field.flag === "--name")?.required).toBe(true);
    expect(teams?.update_fields?.find((field) => field.flag === "--name")?.required).toBe(false);
  });

  it("describes a rooted document's nested fields, and what makes each required", async () => {
    const res = await runCliForTest(["resources", "--json", "--non-interactive", "--no-telemetry"]);
    const idps = (
      parseJson(res.stdout) as {
        data: {
          items: Array<{ topic: string; document_root?: string; create_fields?: Json[] }>;
        };
      }
    ).data.items.find((resource) => resource.topic === "idps");
    const field = (name: string) => idps?.create_fields?.find((entry) => entry.name === name);

    // The fields are the connection's own, as `.zitadel/idps/<slug>.json` spells them.
    expect(idps?.document_root).toBe("idp");
    expect(idps?.create_fields).toHaveLength(20);
    expect(field("oidc.issuer")).toMatchObject({
      flag: "--oidc-issuer",
      kind: "string",
      required: false,
      required_with: "oidc",
      description: expect.any(String),
    });
    expect(field("oidc.scopes")).toMatchObject({ kind: "list", item: "string" });
    expect(field("oidc.pkce_enabled")).toMatchObject({ kind: "boolean", default: true });
  });

  it("reports one filter vocabulary for every list, with each field's operations", async () => {
    const res = await runCliForTest(["resources", "--json", "--non-interactive", "--no-telemetry"]);
    const resources = (
      parseJson(res.stdout) as {
        data: {
          items: Array<{
            topic: string;
            paged?: boolean;
            drains?: boolean;
            filters?: Array<{
              field: string;
              operations: string[];
              values?: string[];
              combine?: string;
              default?: string;
            }>;
          }>;
        };
      }
    ).data.items;
    const find = (topic: string, field: string) =>
      resources.find((r) => r.topic === topic)?.filters?.find((f) => f.field === field);

    // A structured query endpoint offers the full operation set...
    expect(find("teams", "name")?.operations).toContain("contains");
    // ...and a GET list is described in the same vocabulary, narrowed to what
    // it actually accepts, so an agent never has to guess per transport.
    expect(find("events", "category")?.operations).toEqual(["equals"]);
    expect(find("events", "category")?.combine).toBe("or");
    expect(find("schemas", "revisions")?.values).toEqual(["all", "latest"]);

    // Paging is part of the same contract.
    expect(resources.find((r) => r.topic === "branding")?.paged).toBe(false);
    // A field whose default changes what a bare list returns is reported, so an
    // agent knows `schemas list` is the current schemas rather than every
    // revision.
    expect(
      resources.find((r) => r.topic === "schemas")?.filters?.find((f) => f.field === "revisions")
        ?.default,
    ).toBe("latest");
  });

  it("names the property a delete's envelope carries, which is not always `deleted`", async () => {
    const res = await runCliForTest(["resources", "--json", "--non-interactive", "--no-telemetry"]);
    const byTopic = Object.fromEntries(
      (
        parseJson(res.stdout) as {
          data: { items: Array<{ topic: string; delete_outcome?: string }> };
        }
      ).data.items.map((resource) => [resource.topic, resource.delete_outcome]),
    );
    expect(byTopic.users).toBe("deleted");
    expect(byTopic.teams).toBe("deactivated");
    expect(byTopic.sessions).toBe("revoked");
    expect(byTopic.events).toBeUndefined();
  });

  it("renders a table for humans", async () => {
    const res = await onATerminal(() =>
      runCliForTest(["resources", "--non-interactive", "--no-telemetry"]),
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("topic");
    expect(res.stdout).toContain("users");
    expect(res.stdout).toContain("list, get, create, update, delete");
    expect(res.stdout).toContain(`${Object.keys(RESOURCES).length} resources`);
  });
});
