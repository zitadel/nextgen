import { describe, expect, it } from "vitest";

import { renderDetail, renderRows, renderTable } from "../../../../../src/lib/oclif/crud";

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

  it("heads the record and labels each field by its last path segment", () => {
    expect(
      renderDetail("ada@example.com", ["id", "metadata.status", "metadata.created_at"], user),
    ).toBe(
      ["ada@example.com", "", "id          user_1", "status      active", "created_at  2026-01-01T00:00:00Z"].join(
        "\n",
      ),
    );
  });

  it("omits fields the record does not carry, rather than printing blanks", () => {
    const out = renderDetail(undefined, ["id", "metadata.owner", "nope"], user);
    expect(out).toBe("id  user_1");
  });

  it("renders without a heading when the record has none", () => {
    expect(renderDetail(undefined, ["id"], user)).toBe("id  user_1");
  });
});
