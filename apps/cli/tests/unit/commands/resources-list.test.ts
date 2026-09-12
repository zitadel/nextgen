import { describe, expect, it } from "vitest";

import { RESOURCES } from "../../../src/commands/resources";
import { parseJson, runCliForTest } from "../../helpers/run-cli";

describe("zitadel resources", () => {
  it("describes every registry entry without touching a server", async () => {
    const res = await runCliForTest(["resources", "--json", "--non-interactive", "--no-telemetry"]);
    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: {
        count: number;
        resources: Array<{ topic: string; verbs: string[]; filter_fields?: string[] }>;
      };
    };
    expect(json.status).toBe("ok");
    expect(json.data.count).toBe(Object.keys(RESOURCES).length);
    expect(json.data.resources.map((resource) => resource.topic)).toEqual(Object.keys(RESOURCES));
  });

  it("reports the verbs each resource actually exposes", async () => {
    const res = await runCliForTest(["resources", "--json", "--non-interactive", "--no-telemetry"]);
    const resources = (
      parseJson(res.stdout) as { data: { resources: Array<Record<string, unknown>> } }
    ).data.resources;
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
          resources: Array<{
            topic: string;
            create_fields?: Array<{ flag: string; required: boolean }>;
            update_fields?: Array<{ flag: string; required: boolean }>;
          }>;
        };
      }
    ).data.resources;

    const grants = resources.find((resource) => resource.topic === "grants");
    expect(grants?.create_fields).toEqual([
      {
        name: "principal_type",
        flag: "--principal-type",
        kind: "enum",
        required: true,
        options: ["user", "team"],
      },
      { name: "principal_id", flag: "--principal-id", kind: "string", required: true },
      {
        name: "relation",
        flag: "--relation",
        kind: "enum",
        required: true,
        options: ["viewer", "editor", "admin"],
      },
      { name: "expires_at", flag: "--expires-at", kind: "string", required: false },
    ]);
    // Grants have no update endpoint, so nothing claims otherwise.
    expect(grants?.update_fields).toBeUndefined();

    const teams = resources.find((resource) => resource.topic === "teams");
    expect(teams?.create_fields?.find((field) => field.flag === "--name")?.required).toBe(true);
    expect(teams?.update_fields?.find((field) => field.flag === "--name")?.required).toBe(false);
  });

  it("lists filter fields for query lists and flags for parameter lists", async () => {
    const res = await runCliForTest(["resources", "--json", "--non-interactive", "--no-telemetry"]);
    const resources = (
      parseJson(res.stdout) as {
        data: { resources: Array<{ topic: string; filter_fields?: string[]; params?: string[] }> };
      }
    ).data.resources;
    expect(resources.find((r) => r.topic === "teams")?.filter_fields).toContain("name");
    expect(resources.find((r) => r.topic === "events")?.params).toContain("category");
    expect(resources.find((r) => r.topic === "events")?.filter_fields).toBeUndefined();
  });

  it("names the property a delete's envelope carries, which is not always `deleted`", async () => {
    const res = await runCliForTest(["resources", "--json", "--non-interactive", "--no-telemetry"]);
    const byTopic = Object.fromEntries(
      (
        parseJson(res.stdout) as {
          data: { resources: Array<{ topic: string; delete_outcome?: string }> };
        }
      ).data.resources.map((resource) => [resource.topic, resource.delete_outcome]),
    );
    expect(byTopic.users).toBe("deleted");
    expect(byTopic.teams).toBe("deactivated");
    expect(byTopic.sessions).toBe("revoked");
    expect(byTopic.events).toBeUndefined();
  });

  it("renders a table for humans", async () => {
    const res = await runCliForTest(["resources", "--non-interactive", "--no-telemetry"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("resource");
    expect(res.stdout).toContain("users");
    expect(res.stdout).toContain("list, get, create, update, delete");
    expect(res.stdout).toContain("6 resources");
  });
});
