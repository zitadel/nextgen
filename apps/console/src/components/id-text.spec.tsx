import { describe, expect, it } from "vitest";

import { splitId } from "./id-text";

describe("splitId", () => {
  it("keeps a URI's last two path segments as its tail", () => {
    expect(splitId("https://partners.example/user_schemas/partner/v2/profile.schema.json")).toEqual(
      ["https://partners.example/user_schemas/partner", "/v2/profile.schema.json"],
    );
  });

  it("keeps one segment when the path has one, and none for a bare host", () => {
    expect(splitId("https://example.com/staff.json")).toEqual([
      "https://example.com",
      "/staff.json",
    ]);
    expect(splitId("https://example.com")).toEqual(["https://example.com", ""]);
  });

  it("splits an id without a path at its last colon", () => {
    expect(splitId("urn:acme:user_schema:v2")).toEqual(["urn:acme:user_schema", ":v2"]);
  });

  it("keeps a minted id's last six characters, and a short id whole", () => {
    expect(splitId("user_01M6HBZ0P9WR314G5H7YPQFJA0")).toEqual([
      "user_01M6HBZ0P9WR314G5H7Y",
      "PQFJA0",
    ]);
    expect(splitId("sch_…ZNP02S")).toEqual(["sch_…ZNP02S", ""]);
    expect(splitId("default")).toEqual(["default", ""]);
  });
});
