import { describe, expect, it } from "vitest";

import { renderPlan, summarizePlan } from "../../../../src/lib/sync/plan-renderer";
import type { ResourceSyncer, SyncAction } from "../../../../src/lib/sync/types";

function makeSyncer(
  kind: string,
  directory: string,
  { mutable = false, revisioned = false }: { mutable?: boolean; revisioned?: boolean } = {},
): ResourceSyncer {
  return {
    kind,
    directory,
    mutable,
    revisioned,
    validate() { /* no-op: renderer tests do not exercise validation */ },
    async create(_d: object) { return "id"; },
    async update() { /* no-op: renderer tests do not exercise update */ },
    async delete() { /* no-op: renderer tests do not exercise delete */ },
  };
}

const schema = makeSyncer("schema", ".zitadel/schemas", { revisioned: true });
const flow = makeSyncer("flow", ".zitadel/flows", { mutable: true });

describe("summarizePlan", () => {
  it("counts each action kind and ignores skips", () => {
    const actions: SyncAction[] = [
      { kind: "create", path: "a", syncer: schema, content: {}, hash: "h" },
      { kind: "create", path: "b", syncer: schema, content: {}, hash: "h" },
      { kind: "update", path: "c", syncer: flow, id: "1", content: {}, hash: "h", oldContent: null },
      { kind: "delete", path: "d", syncer: schema, id: "2", oldContent: null },
      { kind: "skip", path: "e", reason: "no-change" },
    ];

    expect(summarizePlan(actions)).toEqual({
      creates: 2,
      updates: 1,
      revisions: 0,
      deletes: 1,
      total: 4,
    });
  });

  it("returns all-zero for an empty or skip-only plan", () => {
    expect(summarizePlan([])).toEqual({
      creates: 0,
      updates: 0,
      revisions: 0,
      deletes: 0,
      total: 0,
    });
    expect(summarizePlan([{ kind: "skip", path: "a", reason: "immutable" }])).toEqual({
      creates: 0,
      updates: 0,
      revisions: 0,
      deletes: 0,
      total: 0,
    });
  });
});

describe("renderPlan — no changes", () => {
  it("prints no-changes message when all actions are skips", () => {
    const actions: SyncAction[] = [
      { kind: "skip", path: ".zitadel/schemas/user.json", reason: "no-change" },
      { kind: "skip", path: ".zitadel/flows/default.json", reason: "immutable" },
    ];
    const out = renderPlan(actions, false);
    expect(out).toContain("No changes.");
    expect(out).not.toContain("Plan:");
  });

  it("prints no-changes message for empty action list", () => {
    expect(renderPlan([], false)).toContain("No changes.");
  });
});

describe("renderPlan — create block", () => {
  const actions: SyncAction[] = [
    {
      kind: "create",
      path: ".zitadel/schemas/user.json",
      syncer: schema,
      content: { kind: "user-schema", version: 1 },
      hash: "abc",
    },
  ];

  it("prints the correct header comment", () => {
    expect(renderPlan(actions, false)).toContain(
      "# .zitadel/schemas/user.json will be created",
    );
  });

  it("prints the resource opening line with kind and filename", () => {
    expect(renderPlan(actions, false)).toContain(
      '+ resource "schema" "user.json" {',
    );
  });

  it("shows id = (known after apply)", () => {
    expect(renderPlan(actions, false)).toContain("id      = (known after apply)");
  });

  it("shows content fields sorted alphabetically", () => {
    const out = renderPlan(actions, false);
    const kindPos = out.indexOf("kind");
    const versionPos = out.indexOf("version");
    expect(kindPos).toBeLessThan(versionPos);
  });

  it("aligns = signs within the block", () => {
    const out = renderPlan(actions, false);
    // All three keys (id, kind, version) have max length 7 — padded to align
    expect(out).toContain("+ id      =");
    expect(out).toContain("+ kind    =");
    expect(out).toContain("+ version =");
  });

  it("includes summary with 1 to add", () => {
    expect(renderPlan(actions, false)).toContain("Plan: 1 to add.");
  });

  it("skips are not shown", () => {
    const mixed: SyncAction[] = [
      ...actions,
      { kind: "skip", path: ".zitadel/schemas/noop.json", reason: "no-change" },
    ];
    const out = renderPlan(mixed, false);
    expect(out).not.toContain("noop.json");
    expect(out).toContain("Plan: 1 to add.");
  });
});

describe("renderPlan — delete block", () => {
  it("shows all fields with -> null when oldContent is provided", () => {
    const actions: SyncAction[] = [
      {
        kind: "delete",
        path: ".zitadel/schemas/old.json",
        syncer: schema,
        id: "schema-abc",
        oldContent: { kind: "user-schema", version: 1 },
      },
    ];
    const out = renderPlan(actions, false);
    expect(out).toContain("# .zitadel/schemas/old.json will be destroyed");
    expect(out).toContain('- resource "schema" "old.json" {');
    expect(out).toContain('- id      = "schema-abc" -> null');
    expect(out).toContain('- kind    = "user-schema" -> null');
    expect(out).toContain("- version = 1 -> null");
    expect(out).toContain("Plan: 1 to destroy.");
  });

  it("shows only the id when oldContent is null", () => {
    const actions: SyncAction[] = [
      {
        kind: "delete",
        path: ".zitadel/schemas/old.json",
        syncer: schema,
        id: "schema-abc",
        oldContent: null,
      },
    ];
    const out = renderPlan(actions, false);
    expect(out).toContain('- id = "schema-abc" -> null');
    expect(out).not.toContain("kind");
  });
});

describe("renderPlan — update block", () => {
  it("shows field diff when oldContent is provided", () => {
    const actions: SyncAction[] = [
      {
        kind: "update",
        path: ".zitadel/flows/default.json",
        syncer: flow,
        id: "flow-001",
        content: { name: "Default", version: 2 },
        hash: "new",
        oldContent: { name: "Default", version: 1 },
      },
    ];
    const out = renderPlan(actions, false);
    expect(out).toContain("# .zitadel/flows/default.json will be updated in-place");
    expect(out).toContain('~ resource "flow" "default.json" {');
    expect(out).toContain("~ version = 1 -> 2");      // changed field
    expect(out).toContain("  name    = \"Default\"");  // unchanged field, no prefix
    expect(out).toContain("Plan: 1 to change.");
  });

  it("shows placeholder when oldContent is null", () => {
    const actions: SyncAction[] = [
      {
        kind: "update",
        path: ".zitadel/flows/default.json",
        syncer: flow,
        id: "flow-001",
        content: { name: "Default", version: 2 },
        hash: "new",
        oldContent: null,
      },
    ];
    const out = renderPlan(actions, false);
    expect(out).toContain("field diff unavailable");
  });
});

describe("renderPlan — summary line", () => {
  it("combines multiple action types in the summary", () => {
    const actions: SyncAction[] = [
      {
        kind: "create",
        path: ".zitadel/schemas/new.json",
        syncer: schema,
        content: { kind: "user-schema" },
        hash: "a",
      },
      {
        kind: "update",
        path: ".zitadel/flows/default.json",
        syncer: flow,
        id: "flow-001",
        content: { version: 2 },
        hash: "b",
        oldContent: { version: 1 },
      },
      {
        kind: "delete",
        path: ".zitadel/schemas/old.json",
        syncer: schema,
        id: "old-id",
        oldContent: null,
      },
    ];
    expect(renderPlan(actions, false)).toContain("Plan: 1 to add, 1 to change, 1 to destroy.");
  });
});

describe("renderPlan — nested structures", () => {
  it("expands nested objects with deeper indentation", () => {
    const actions: SyncAction[] = [
      {
        kind: "create",
        path: ".zitadel/schemas/user.json",
        syncer: schema,
        content: { fields: { email: { type: "string" } } },
        hash: "x",
      },
    ];
    const out = renderPlan(actions, false);
    expect(out).toContain("+ fields = {");
    expect(out).toContain("+ email = {");
    expect(out).toContain('+ type = "string"');
  });

  it("expands arrays with item prefix", () => {
    const actions: SyncAction[] = [
      {
        kind: "create",
        path: ".zitadel/flows/default.json",
        syncer: flow,
        content: { team_ids: ["alpha", "beta"] },
        hash: "y",
      },
    ];
    const out = renderPlan(actions, false);
    expect(out).toContain("+ team_ids = [");
    expect(out).toContain('+ "alpha",');
    expect(out).toContain('+ "beta",');
  });
});

describe("renderPlan — ANSI colours", () => {
  it("omits ANSI codes when tty=false", () => {
    const actions: SyncAction[] = [
      {
        kind: "create",
        path: ".zitadel/schemas/user.json",
        syncer: schema,
        content: { kind: "user-schema" },
        hash: "a",
      },
    ];
    expect(renderPlan(actions, false)).not.toContain("\x1b[");
  });

  it("includes ANSI codes when tty=true", () => {
    const actions: SyncAction[] = [
      {
        kind: "create",
        path: ".zitadel/schemas/user.json",
        syncer: schema,
        content: { kind: "user-schema" },
        hash: "a",
      },
    ];
    expect(renderPlan(actions, true)).toContain("\x1b[");
  });
});

describe("renderPlan — string escaping", () => {
  it("escapes double quotes inside string values", () => {
    const actions: SyncAction[] = [
      {
        kind: "create",
        path: ".zitadel/schemas/user.json",
        syncer: schema,
        content: { label: 'say "hello"' },
        hash: "a",
      },
    ];
    expect(renderPlan(actions, false)).toContain('"say \\"hello\\""');
  });

  it("escapes newlines inside string values", () => {
    const actions: SyncAction[] = [
      {
        kind: "create",
        path: ".zitadel/schemas/user.json",
        syncer: schema,
        content: { text: "line1\nline2" },
        hash: "a",
      },
    ];
    expect(renderPlan(actions, false)).toContain('"line1\\nline2"');
  });
});
