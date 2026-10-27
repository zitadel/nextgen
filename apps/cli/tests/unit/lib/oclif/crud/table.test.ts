import { describe, expect, it } from "vitest";

import {
  headerOf,
  renderCount,
  renderDetail,
  renderEmpty,
  renderList,
  renderRows,
  renderTable,
} from "../../../../../src/lib/oclif/crud";
import { COLUMN_MARK, stripColumnMarks } from "../../../../../src/lib/ui/layout";

describe("headerOf", () => {
  it("takes the path's last segment", () => {
    expect(headerOf("metadata.created_at")).toBe("created_at");
  });

  it("spells a camelCase field the way the wire spells every other one", () => {
    expect(headerOf("schema.objectType")).toBe("object_type");
  });

  it("leaves a field that is already snake_case alone", () => {
    expect(headerOf("release_id")).toBe("release_id");
  });
});

describe("renderCount", () => {
  it("uses the singular for one", () => {
    expect(renderCount(1, { singular: "schema" })).toBe("1 schema");
  });

  it("adds an s when the resource names no plural", () => {
    expect(renderCount(12, { singular: "resource" })).toBe("12 resources");
  });

  it("uses the resource's own plural when it has one", () => {
    expect(renderCount(2, { singular: "flow definition", plural: "flow definitions" })).toBe(
      "2 flow definitions",
    );
  });

  it("counts none in the plural", () => {
    expect(renderCount(0, { singular: "operation" })).toBe("0 operations");
  });
});

describe("renderEmpty", () => {
  it("says the same sentence for every resource, in that resource's plural", () => {
    expect(renderEmpty({ singular: "deployment" })).toBe("No deployments found.");
    expect(renderEmpty({ singular: "user" })).toBe("No users found.");
    expect(
      renderEmpty({
        singular: "identity provider connection",
        plural: "identity provider connections",
      }),
    ).toBe("No identity provider connections found.");
  });
});

describe("renderList", () => {
  const rows = [{ id: "dep_1" }, { id: "dep_2" }];

  it("ends a table on the count derived from the resource", () => {
    expect(renderList(["id"], rows, { plain: false, singular: "deployment" })).toBe(
      ["id", "-----", "dep_1", "dep_2", "", "2 deployments"].join("\n"),
    );
  });

  it("says the derived sentence when it found nothing", () => {
    expect(renderList(["id"], [], { plain: false, singular: "deployment" })).toBe(
      "No deployments found.",
    );
  });

  it("puts a footer line under the count", () => {
    expect(
      renderList(["id"], [rows[0]], { plain: false, singular: "deployment", footer: ["More: x"] }),
    ).toBe(["id", "-----", "dep_1", "", "1 deployment", "More: x"].join("\n"));
  });

  it("emits nothing at all for an empty plain list, so `wc -l` reports 0", () => {
    expect(renderList(["id"], [], { plain: true, singular: "deployment" })).toBe("");
  });
});

describe("renderTable", () => {
  it("aligns columns, heads them by the path's last segment, and resolves nested paths", () => {
    const table = renderTable(
      ["id", "metadata.status", "created_at"],
      [
        { id: "user_1", metadata: { status: "active" }, created_at: "2026-01-01T00:00:00Z" },
        { id: "user_22", metadata: { status: "suspended" } },
      ],
    );
    expect(table.split("\n")).toEqual([
      "id       status     created_at",
      "-------  ---------  --------------------",
      "user_1   active     2026-01-01T00:00:00Z",
      "user_22  suspended",
    ]);
  });

  it("heads a camelCase field as the wire spells every other one", () => {
    expect(renderTable(["schema.objectType"], [{ schema: { objectType: "human-user" } }])).toBe(
      ["object_type", "-----------", "human-user"].join("\n"),
    );
  });

  it("renders missing values empty and non-strings as JSON", () => {
    expect(
      renderTable(["n", "flag", "gone"], [{ n: 3, flag: true, gone: null }]).split("\n")[2],
    ).toBe("3  true");
  });

  it("renders only the header for an empty list", () => {
    expect(renderTable(["id"], [])).toBe("id\n--");
  });
});

describe("renderRows", () => {
  it("emits one tab-separated record per line, with no header", () => {
    const rows = renderRows(
      ["id", "metadata.status"],
      [
        { id: "user_1", metadata: { status: "active" } },
        { id: "user_22", metadata: { status: "suspended" } },
      ],
    );
    expect(rows).toBe("user_1\tactive\nuser_22\tsuspended");
  });

  it("keeps empty cells as empty fields so column positions hold", () => {
    expect(renderRows(["id", "gone", "n"], [{ id: "a", n: 3 }])).toBe("a\t\t3");
  });

  it("escapes tabs and newlines inside a value", () => {
    expect(renderRows(["note"], [{ note: "a\tb\nc" }])).toBe("a\\tb\\nc");
  });

  it("renders nothing for an empty list", () => {
    expect(renderRows(["id"], [])).toBe("");
  });
});

describe("renderDetail", () => {
  const user = {
    id: "user_1",
    identifier: "ada@example.com",
    metadata: { status: "active", created_at: "2026-01-01T00:00:00Z", owner: null },
  };
  /** What a record reads as, with the layout's own mark taken back out. */
  const shown = (text: string): string => stripColumnMarks(text);

  it("heads the record and labels each field by its last path segment", () => {
    expect(
      shown(
        renderDetail("ada@example.com", ["id", "metadata.status", "metadata.created_at"], user),
      ),
    ).toBe(
      [
        "ada@example.com",
        "",
        "id          user_1",
        "status      active",
        "created_at  2026-01-01T00:00:00Z",
      ].join("\n"),
    );
  });

  it("labels a camelCase field as the wire spells every other one", () => {
    expect(
      shown(renderDetail(undefined, ["schema.objectType"], { schema: { objectType: "human" } })),
    ).toBe("object_type  human");
  });

  it("omits fields the record does not carry, rather than printing blanks", () => {
    const out = renderDetail(undefined, ["id", "metadata.owner", "nope"], user);
    expect(shown(out)).toBe("id  user_1");
  });

  it("renders without a heading when the record has none", () => {
    expect(shown(renderDetail(undefined, ["id"], user))).toBe("id  user_1");
  });

  // A record of one field is one line, so nothing lines up with the columns it
  // was laid out in. The mark is how the layout is told they are columns, and
  // without it the label is folded away from the value.
  it("marks the row it aligned, so the layout leaves a one-field record whole", () => {
    expect(renderDetail(undefined, ["id"], user)).toContain(COLUMN_MARK);
  });

  // The mark leads the row, so the cells and the spaces between them are what
  // they always were and anything reading the record still sees `id  user_1`.
  it("leaves the cells and the gap between them exactly as they read", () => {
    expect(renderDetail(undefined, ["id"], user)).toMatch(/^.?id {2}user_1$/);
  });

  it("marks every field of a record, not only the first", () => {
    const marks = renderDetail(undefined, ["id", "metadata.status"], user)
      .split("\n")
      .map((line) => line.includes(COLUMN_MARK));

    expect(marks).toEqual([true, true]);
  });

  it("leaves the heading unmarked, since it is a sentence and not a row", () => {
    const [heading] = renderDetail("Set GREETING on the project", ["id"], user).split("\n");

    expect(heading).toBe("Set GREETING on the project");
  });
});
