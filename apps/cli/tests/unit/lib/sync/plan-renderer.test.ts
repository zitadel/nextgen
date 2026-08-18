import { describe, expect, it } from "vitest";

import { normalizeFlowBody, normalizeSchemaBody } from "@zitadel/config/normalize";

import {
  enumeratePlanResources,
  renderPlan,
  summarizePlan,
} from "../../../../src/lib/sync/plan-renderer";
import type { ResourceSyncer, SyncAction } from "../../../../src/lib/sync/types";

function makeSyncer(
  kind: string,
  directory: string,
  {
    mutable = false,
    revisioned = false,
    normalize,
  }: {
    mutable?: boolean;
    revisioned?: boolean;
    normalize?: (data: object) => object;
  } = {},
): ResourceSyncer {
  return {
    kind,
    directory,
    mutable,
    revisioned,
    ...(normalize ? { normalize } : {}),
    validate() { /* no-op: renderer tests do not exercise validation */ },
    async create(_d: object) { return { id: "id" }; },
    async update() { return {}; },
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

describe("enumeratePlanResources", () => {
  it("maps every non-skip action to an envelope row, in plan order", () => {
    const actions: SyncAction[] = [
      { kind: "create", path: ".zitadel/schemas/user.json", syncer: schema, content: {}, hash: "h" },
      {
        kind: "update",
        path: ".zitadel/flows/login.json",
        syncer: flow,
        id: "flow_1",
        content: {},
        hash: "h",
        oldContent: null,
      },
      {
        kind: "revise",
        path: ".zitadel/schemas/user.json",
        syncer: schema,
        content: {},
        hash: "h",
        previousId: "sch_1",
        oldContent: null,
        affectedPaths: [".zitadel/flows/login.json"],
      },
      { kind: "delete", path: ".zitadel/flows/old.json", syncer: flow, id: "flow_0", oldContent: null },
      { kind: "skip", path: ".zitadel/schemas/other.json", reason: "no-change" },
    ];

    // `revise` speaks the envelope's public vocabulary: `revision`,
    // matching the `revisions` counter.
    expect(enumeratePlanResources(actions)).toEqual([
      { kind: "schema", action: "create", file: ".zitadel/schemas/user.json" },
      { kind: "flow", action: "update", file: ".zitadel/flows/login.json", id: "flow_1" },
      {
        kind: "schema",
        action: "revision",
        file: ".zitadel/schemas/user.json",
        previous_id: "sch_1",
      },
      { kind: "flow", action: "delete", file: ".zitadel/flows/old.json", id: "flow_0" },
    ]);
  });

  it("agrees with summarizePlan on what counts", () => {
    const actions: SyncAction[] = [
      { kind: "create", path: "a", syncer: schema, content: {}, hash: "h" },
      { kind: "skip", path: "b", reason: "immutable" },
      { kind: "delete", path: "c", syncer: flow, id: "1", oldContent: null },
    ];
    expect(enumeratePlanResources(actions)).toHaveLength(summarizePlan(actions).total);
  });

  it("returns an empty array for an empty or skip-only plan", () => {
    expect(enumeratePlanResources([])).toEqual([]);
    expect(enumeratePlanResources([{ kind: "skip", path: "a", reason: "no-change" }])).toEqual([]);
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

  it("escapes tabs and carriage returns inside single-line string values", () => {
    const actions: SyncAction[] = [
      {
        kind: "create",
        path: ".zitadel/schemas/user.json",
        syncer: schema,
        content: { text: "col1\tcol2\r" },
        hash: "a",
      },
    ];
    expect(renderPlan(actions, false)).toContain('"col1\\tcol2\\r"');
  });

  // Multi-line strings are documents, not scalars — see the block-string
  // suite below. Escaping one onto a single line is what made a branding
  // plan unreadable.
  it("summarises a multi-line string instead of escaping it", () => {
    const actions: SyncAction[] = [
      {
        kind: "create",
        path: ".zitadel/schemas/user.json",
        syncer: schema,
        content: { text: "line1\nline2" },
        hash: "a",
      },
    ];
    const out = renderPlan(actions, false);
    expect(out).not.toContain('"line1\\nline2"');
    expect(out).toMatch(/\+ text = \(2 lines, sha256:[0-9a-f]{8}\)/);
  });
});

describe("renderPlan — normalized diffs", () => {
  const normalizedFlow = makeSyncer("flow", ".zitadel/flows", {
    mutable: true,
    normalize: normalizeFlowBody,
  });
  const normalizedSchema = makeSyncer("schema", ".zitadel/schemas", {
    revisioned: true,
    normalize: normalizeSchemaBody,
  });

  it("does not render a server-echoed empty audience as a deletion", () => {
    const actions: SyncAction[] = [
      {
        kind: "update",
        path: ".zitadel/flows/default.json",
        syncer: normalizedFlow,
        id: "flow-1",
        content: { name: "login", version: 2 },
        hash: "h",
        oldContent: { name: "login", version: 1, audience: {} },
      },
    ];

    const out = renderPlan(actions, false);
    expect(out).not.toContain("audience");
    expect(out).toContain('~ version = 1 -> 2');
  });

  it("does not render spelled-out meta-schema defaults as schema changes", () => {
    const actions: SyncAction[] = [
      {
        kind: "revise",
        path: ".zitadel/schemas/user.json",
        syncer: normalizedSchema,
        content: {
          properties: {
            email: { type: "string" },
            company: { type: "string" },
          },
        },
        hash: "h",
        previousId: "sch_A",
        oldContent: {
          properties: {
            email: { type: "string", "x-audit": false },
          },
        },
        affectedPaths: [],
      },
    ];

    const out = renderPlan(actions, false);
    // The only property-level change is the added `company`; the defaults
    // spelled out on the server side must not read as removals.
    expect(out).not.toContain("x-audit");
    expect(out).toContain("company");
  });
});

describe("renderPlan — re-pin messaging", () => {
  it("announces the pending re-pin on the revise block", () => {
    const actions: SyncAction[] = [
      {
        kind: "revise",
        path: ".zitadel/schemas/user.json",
        syncer: schema,
        content: { kind: "user-schema", v: 2 },
        hash: "h",
        previousId: "sch_A",
        oldContent: { kind: "user-schema", v: 1 },
        affectedPaths: [".zitadel/flows/default.json"],
      },
    ];

    const out = renderPlan(actions, false);
    expect(out).toContain(
      "# user_schema will be re-pinned to the new revision (known after apply) in:",
    );
    expect(out).toContain("#   - .zitadel/flows/default.json");
    expect(out).not.toContain("after apply, update user_schema");
  });

  it("renders a repin update as a user_schema change to (known after apply)", () => {
    const actions: SyncAction[] = [
      {
        kind: "update",
        path: ".zitadel/flows/default.json",
        syncer: flow,
        id: "flow-001",
        content: { name: "login", user_schema: "sch_A" },
        hash: "h",
        oldContent: { name: "login", user_schema: "sch_A" },
        repin: { previousId: "sch_A", schemaPath: ".zitadel/schemas/user.json" },
      },
    ];

    const out = renderPlan(actions, false);
    expect(out).toContain("will be updated in-place (re-pin user_schema)");
    expect(out).toContain('~ user_schema = "sch_A" -> (known after apply)');
  });

  it("renders a recovered repin with the concrete revision id", () => {
    const actions: SyncAction[] = [
      {
        kind: "update",
        path: ".zitadel/flows/default.json",
        syncer: flow,
        id: "flow-001",
        content: { name: "login", user_schema: "sch_A" },
        hash: "h",
        oldContent: { name: "login", user_schema: "sch_A" },
        repin: {
          previousId: "sch_A",
          schemaPath: ".zitadel/schemas/user.json",
          newId: "sch_B",
        },
      },
    ];

    const out = renderPlan(actions, false);
    expect(out).toContain('~ user_schema = "sch_A" -> "sch_B"');
  });
});

describe("renderPlan — validation warnings", () => {
  const warning = {
    rule: "warn/password-without-identifier",
    message:
      'step "start" collects x-auth-methods#password on the login path but no upstream step collects an identifier field — the engine cannot resolve which user to challenge',
  };

  it("renders a # warning comment line under a create block", () => {
    const actions: SyncAction[] = [
      {
        kind: "create",
        path: ".zitadel/flows/default.json",
        syncer: flow,
        content: { name: "login" },
        hash: "h",
        warnings: [warning],
      },
    ];

    const out = renderPlan(actions, false);
    expect(out).toContain(`# warning: ${warning.message}`);
    expect(out).toContain("Warnings: 1 (non-blocking");
  });

  it("renders warnings under an update block", () => {
    const actions: SyncAction[] = [
      {
        kind: "update",
        path: ".zitadel/flows/default.json",
        syncer: flow,
        id: "flow-001",
        content: { name: "login" },
        hash: "h",
        oldContent: { name: "login" },
        warnings: [warning],
      },
    ];

    expect(renderPlan(actions, false)).toContain(`# warning: ${warning.message}`);
  });

  // Branding is revisioned, so a broken logo_url can only ever surface on a
  // `revise` — the kind that used to have nowhere to put a warning.
  it("renders warnings under a revise block and counts them in the summary", () => {
    const assetWarning = {
      rule: "warn/asset-unreachable",
      message: "logo_url https://cdn.example.com/logo.svg returned HTTP 404",
    };
    const actions: SyncAction[] = [
      {
        kind: "revise",
        path: ".zitadel/branding/branding.json",
        syncer: makeSyncer("branding", ".zitadel/branding", { revisioned: true }),
        content: { logo_url: "https://cdn.example.com/logo.svg" },
        hash: "h",
        previousId: "brd_1",
        oldContent: { logo_url: "https://cdn.example.com/old.svg" },
        affectedPaths: [],
        warnings: [assetWarning],
      },
    ];

    const out = renderPlan(actions, false);
    expect(out).toContain(`# warning: ${assetWarning.message}`);
    expect(out).toContain("Warnings: 1 (non-blocking");
  });

  it("emits no warning summary when the plan is warning-free", () => {
    const actions: SyncAction[] = [
      { kind: "create", path: "a", syncer: flow, content: {}, hash: "h" },
    ];
    expect(renderPlan(actions, false)).not.toContain("Warnings:");
  });
});

describe("renderPlan — block strings (liquid_template)", () => {
  const branding = makeSyncer("branding", ".zitadel/branding", { revisioned: true });
  const template = [
    "<zl-page-shell>",
    "  <aside class=\"zl-split__brand\">",
    "    {% if branding.logo_url %}",
    "      <img class=\"zl-split__logo\" src=\"{{ branding.logo_url }}\" alt=\"\" />",
    "    {% endif %}",
    "  </aside>",
    "</zl-page-shell>",
    "",
  ].join("\n");

  function revise(content: object, oldContent: object): SyncAction[] {
    return [
      {
        kind: "revise",
        path: ".zitadel/branding/branding.json",
        syncer: branding,
        content,
        hash: "h",
        previousId: "brd_1",
        oldContent,
        affectedPaths: [],
      },
    ];
  }

  it("summarises an unchanged template instead of dumping it on one line", () => {
    const out = renderPlan(
      revise({ layout: "split", liquid_template: template }, { layout: "centered", liquid_template: template }),
      false,
    );

    expect(out).toMatch(/liquid_template = \(unchanged, 7 lines, sha256:[0-9a-f]{8}\)/);
    expect(out).not.toContain("zl-split__brand");
    // The field that really moved stays visible.
    expect(out).toContain('~ layout          = "centered" -> "split"');
  });

  it("renders a changed template as a line diff, not two escaped blobs", () => {
    const edited = template.replace('alt=""', 'alt="Acme"');

    const out = renderPlan(
      revise({ liquid_template: edited }, { liquid_template: template }),
      false,
    );

    expect(out).toMatch(/~ liquid_template = \(2 lines changed of 7, sha256:[0-9a-f]{8} -> sha256:[0-9a-f]{8}\)/);
    expect(out).toContain('- ' + '      <img class="zl-split__logo" src="{{ branding.logo_url }}" alt="" />');
    expect(out).toContain('+ ' + '      <img class="zl-split__logo" src="{{ branding.logo_url }}" alt="Acme" />');
    // Untouched lines never reach the output.
    expect(out).not.toContain("<zl-page-shell>");
  });

  it("caps the changed-line body and says how much it dropped", () => {
    const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const rewritten = Array.from({ length: 40 }, (_, i) => `LINE ${i}`).join("\n");

    const out = renderPlan(revise({ liquid_template: rewritten }, { liquid_template: long }), false);

    expect(out).toContain("(80 lines changed of 40");
    expect(out).toContain("# (60 more changed lines not shown)");
  });

  it("summarises the template on a first-revision create", () => {
    const out = renderPlan(
      [
        {
          kind: "create",
          path: ".zitadel/branding/branding.json",
          syncer: branding,
          content: { layout: "split", liquid_template: template },
          hash: "h",
        },
      ],
      false,
    );

    expect(out).toMatch(/\+ liquid_template = \(7 lines, sha256:[0-9a-f]{8}\)/);
    expect(out).not.toContain("zl-split__brand");
  });
});
