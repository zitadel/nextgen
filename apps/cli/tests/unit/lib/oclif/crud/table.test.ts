import { describe, expect, it } from "vitest";

import { renderDetail, renderRows, renderTable } from "../../../../../src/lib/oclif/crud";

describe("renderTable", () => {
  it("aligns columns, heads them by the path's last segment, and resolves nested paths", async () => {
    const table = await renderTable(
      ["id", "metadata.status", "created_at"],
      [
        { id: "user_1", metadata: { status: "active" }, created_at: "2026-01-01T00:00:00Z" },
        { id: "user_22", metadata: { status: "suspended" } },
      ],
    );
    expect(table.split("\n")).toEqual([
      "  id        status      created_at",
      " ────────────────────────────────────────────",
      "  user_1    active      2026-01-01T00:00:00Z",
      "  user_22   suspended",
    ]);
  });

  it("renders missing values empty and non-strings as JSON", async () => {
    const table = await renderTable(["n", "flag", "gone"], [{ n: 3, flag: true, gone: null }]);
    expect(table.split("\n")[2]).toBe("  3   true");
  });

  it("renders the header and its rule for an empty list", async () => {
    expect((await renderTable(["id"], [])).split("\n")).toEqual(["  id", " ────"]);
  });

  it("measures wide characters by how they are drawn, so the column after them lines up", async () => {
    const table = await renderTable(
      ["name", "id"],
      [
        { name: "你好世界", id: "x" },
        { name: "ab", id: "yy" },
      ],
    );
    expect(table.split("\n")).toEqual([
      "  name       id",
      " ───────────────",
      "  你好世界   x",
      "  ab         yy",
    ]);
  });

  it("escapes control characters so a value cannot drive the terminal or split its row", async () => {
    const table = await renderTable(["id", "name"], [{ id: "a\u001b[2Jb", name: "x\ty\nz" }]);

    expect(table).not.toContain("\u001b");
    expect(table).not.toContain("\t");
    expect(table.split("\n")[2]).toBe("  a\\x1b[2Jb   x\\x09y\\x0az");
  });

  describe("on a narrow terminal", () => {
    const id = `usr_${"a".repeat(40)}`;
    const url = `https://example.com/${"b".repeat(60)}`;

    const render = async (tty: boolean): Promise<string> => {
      const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
      const columns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
      Object.defineProperty(process.stdout, "isTTY", { value: tty, configurable: true });
      Object.defineProperty(process.stdout, "columns", { value: 30, configurable: true });
      try {
        return await renderTable(["id", "url"], [{ id, url }]);
      } finally {
        for (const [key, saved] of [
          ["isTTY", isTTY],
          ["columns", columns],
        ] as const) {
          if (saved) Object.defineProperty(process.stdout, key, saved);
          else delete (process.stdout as unknown as Record<string, unknown>)[key];
        }
      }
    };

    it("keeps a long id and url whole on one row instead of breaking them across lines", async () => {
      const row = (await render(true)).split("\n")[2] ?? "";

      expect(row).toContain(id);
      expect(row).toContain(url);
      expect((await render(true)).split("\n")).toHaveLength(3);
    });

    it("prints the same table as a pipe does", async () => {
      expect(await render(true)).toBe(await render(false));
    });
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
      [
        "ada@example.com",
        "",
        "id          user_1",
        "status      active",
        "created_at  2026-01-01T00:00:00Z",
      ].join("\n"),
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
