import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@oclif/table", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oclif/table")>();
  return { ...actual, makeTable: vi.fn(actual.makeTable) };
});

import { makeTable } from "@oclif/table";

import { aTabulatingCommand } from "../../../helpers/tabulate";

const draw = (argv: string[] = []) => aTabulatingCommand(argv);

beforeEach(() => {
  vi.mocked(makeTable).mockClear();
});

describe("tabulate", () => {
  it("aligns columns, heads them by the path's last segment, and resolves nested paths", async () => {
    const table = await draw().draw(
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
    const table = await draw().draw(["n", "flag", "gone"], [{ n: 3, flag: true, gone: null }]);
    expect(table.split("\n")[2]).toBe("  3   true");
  });

  it("renders the header and its rule for an empty list", async () => {
    expect((await draw().draw(["id"], [])).split("\n")).toEqual(["  id", " ────"]);
  });

  it("measures wide characters by how they are drawn, so the column after them lines up", async () => {
    const table = await draw().draw(
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
    const table = await draw().draw(["id", "name"], [{ id: "a\u001b[2Jb", name: "x\ty\nz" }]);

    expect(table).not.toContain("\u001b");
    expect(table).not.toContain("\t");
    expect(table.split("\n")[2]).toBe("  a\\x1b[2Jb   x\\x09y\\x0az");
  });

  it("draws nothing under --json, so a machine does not pay for a table it throws away", async () => {
    expect(await draw(["--json"]).draw(["id"], [{ id: "a" }])).toBe("");
    expect(makeTable).not.toHaveBeenCalled();
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
        return await draw().draw(["id", "url"], [{ id, url }]);
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
      const table = (await render(true)).split("\n");

      expect(table).toHaveLength(3);
      expect(table[2]).toContain(id);
      expect(table[2]).toContain(url);
    });

    it("prints the same table as a pipe does", async () => {
      expect(await render(true)).toBe(await render(false));
    });
  });
});

describe("tabulateList", () => {
  const options = { plain: false, singular: "thing", empty: "No things." };

  it("draws the table, a blank line, a count and the footer for a person", async () => {
    const list = await draw().drawList(["id"], [{ id: "a" }], { ...options, footer: ["More."] });

    expect(list).toBe("  id\n ────\n  a\n\n1 thing\nMore.");
  });

  it("says so when the list is empty", async () => {
    expect(await draw().drawList(["id"], [], options)).toBe("No things.");
  });

  it("gives a script tab-separated rows and nothing for an empty list", async () => {
    expect(await draw().drawList(["id"], [{ id: "a" }], { ...options, plain: true })).toBe("a");
    expect(await draw().drawList(["id"], [], { ...options, plain: true })).toBe("");
  });

  it("draws nothing under --json", async () => {
    expect(await draw(["--json"]).drawList(["id"], [{ id: "a" }], options)).toBe("");
    expect(makeTable).not.toHaveBeenCalled();
  });
});

describe("tabulateRows", () => {
  it("emits one tab-separated record per line, with no header", () => {
    const rows = draw().drawRows(
      ["id", "metadata.status"],
      [
        { id: "user_1", metadata: { status: "active" } },
        { id: "user_22", metadata: { status: "suspended" } },
      ],
    );
    expect(rows).toBe("user_1\tactive\nuser_22\tsuspended");
  });

  it("keeps empty cells as empty fields so column positions hold", () => {
    expect(draw().drawRows(["id", "gone", "n"], [{ id: "a", n: 3 }])).toBe("a\t\t3");
  });

  it("escapes tabs and newlines inside a value", () => {
    expect(draw().drawRows(["note"], [{ note: "a\tb\nc" }])).toBe("a\\tb\\nc");
  });

  it("escapes control characters so a value cannot drive the terminal", () => {
    const rows = draw().drawRows(["id"], [{ id: "a\u001b[2Jb" }]);

    expect(rows).not.toContain("\u001b");
    expect(rows).toBe("a\\x1b[2Jb");
  });

  it("renders nothing for an empty list", () => {
    expect(draw().drawRows(["id"], [])).toBe("");
  });
});

describe("tabulateDetail", () => {
  const user = {
    id: "user_1",
    identifier: "ada@example.com",
    metadata: { status: "active", created_at: "2026-01-01T00:00:00Z", owner: null },
  };

  it("heads the record and labels each field by its last path segment", () => {
    expect(
      draw().drawDetail("ada@example.com", ["id", "metadata.status", "metadata.created_at"], user),
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
    expect(draw().drawDetail(undefined, ["id", "metadata.owner", "nope"], user)).toBe("id  user_1");
  });

  it("renders without a heading when the record has none", () => {
    expect(draw().drawDetail(undefined, ["id"], user)).toBe("id  user_1");
  });

  it("escapes control characters but keeps a value's own line breaks", () => {
    const out = draw().drawDetail(undefined, ["note"], { note: "a\u001b[2Jb\nc" });

    expect(out).not.toContain("\u001b");
    expect(out).toBe("note  a\\x1b[2Jb\nc");
  });
});

describe("isPlain", () => {
  it("is true for the --plain flag, and when there is no terminal", () => {
    const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    try {
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
      expect(draw().plain(true)).toBe(true);
      expect(draw().plain(false)).toBe(false);
      expect(draw().plain()).toBe(false);
      Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
      expect(draw().plain(false)).toBe(true);
    } finally {
      if (isTTY) Object.defineProperty(process.stdout, "isTTY", isTTY);
      else delete (process.stdout as unknown as Record<string, unknown>).isTTY;
    }
  });
});

describe("Tabulatable", () => {
  it("is the only code that imports the table library, so no command can bypass the --json skip", async () => {
    const root = fileURLToPath(new URL("../../../../src", import.meta.url));
    const importing: string[] = [];

    for (const file of await readdir(root, { recursive: true })) {
      if (!file.endsWith(".ts") || file === join("lib", "oclif", "tabulatable.ts")) continue;
      if (/["']@oclif\/table["']/.test(await readFile(join(root, file), "utf8"))) {
        importing.push(file);
      }
    }

    expect(importing).toEqual([]);
  });
});
