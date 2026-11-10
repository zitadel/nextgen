import { describe, expect, it } from "vitest";

import { attributeRows, attributesAt, capRows, countRows } from "./attribute-fields";

const SCHEMA = {
  properties: {
    givenName: { type: "string" },
    companyName: { type: "string", title: "Company name" },
    birthDate: { type: "string", format: "date" },
    newsletter: { type: "boolean" },
    roles: { type: "array", items: { type: "string" } },
    address: {
      type: "object",
      title: "Postal address",
      properties: {
        street: { type: "string" },
        geo: { type: "object", properties: { lat: { type: "number" } } },
      },
    },
  },
};

describe("attributeRows", () => {
  it("labels what the schema declares and keeps an undeclared key as spelled", () => {
    const rows = attributeRows({ givenName: "Maya", companyName: "Acme", nickname: "M" }, SCHEMA);
    expect(rows.map((row) => row.label)).toEqual(["Company name", "Given name", "nickname"]);
  });

  it("formats booleans and calendar dates, and keeps numbers' digits", () => {
    const rows = attributeRows({ newsletter: true, birthDate: "1991-04-18", desk: 1042 }, SCHEMA);
    const values = Object.fromEntries(
      rows.map((row) => [row.label, row.kind === "value" ? row.value : undefined]),
    );
    expect(values.Newsletter).toBe("Yes");
    // Local, not UTC midnight: west of UTC that would be the 17th.
    expect(values["Birth date"]).toBe(
      new Date(1991, 3, 18).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    );
    expect(values.desk).toBe("1042");
  });

  it("lists an object inline one level deep, and anything deeper as a drill row", () => {
    const [address] = attributeRows(
      { address: { street: "Main St", geo: { lat: 47.37 } } },
      SCHEMA,
    );
    expect(address).toMatchObject({ kind: "group", label: "Postal address", path: ["address"] });
    expect(address?.kind === "group" && address.rows).toEqual([
      { kind: "drill", path: ["address", "geo"], label: "Geo", count: 1 },
      {
        kind: "value",
        path: ["address", "street"],
        label: "Street",
        value: "Main St",
        empty: false,
      },
    ]);
  });

  it("shows a list of scalars as items, a list of objects as a count, and nothing as a dash", () => {
    const rows = attributeRows(
      { roles: ["admin", "billing"], devices: [{ id: 1 }, { id: 2 }], phone: null },
      SCHEMA,
    );
    expect(rows).toContainEqual({
      kind: "list",
      path: ["roles"],
      label: "Roles",
      items: ["admin", "billing"],
    });
    expect(rows).toContainEqual(
      expect.objectContaining({ label: "devices", value: "2 items", empty: false }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({ label: "phone", value: "—", empty: true }),
    );
  });
});

describe("capRows", () => {
  it("counts a group's heading and rows, and cuts a group where the cap falls", () => {
    const rows = attributeRows(
      { address: { street: "Main St", city: "Zürich", zip: "8001" }, givenName: "Maya" },
      SCHEMA,
    );
    expect(countRows(rows)).toBe(5);
    const capped = capRows(rows, 3);
    expect(countRows(capped)).toBe(3);
    expect(capped).toHaveLength(1);
  });
});

describe("attributesAt", () => {
  it("finds a nested object and refuses a path that no longer leads to one", () => {
    const attributes = { address: { geo: { lat: 1 } }, name: "x" };
    expect(attributesAt(attributes, ["address", "geo"])).toEqual({ lat: 1 });
    expect(attributesAt(attributes, ["name"])).toBeUndefined();
    expect(attributesAt(attributes, ["gone"])).toBeUndefined();
  });
});
