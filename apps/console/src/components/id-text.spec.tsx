import { describe, expect, it } from "vitest";

import { shortId, splitId } from "./id-text";

describe("shortId", () => {
  it("keeps a minted id's prefix and the first and last four of its body", () => {
    expect(shortId("proj_01M764GY8FH9BX8CTEFW3XKTFA")).toBe("proj_01M7…KTFA");
    expect(shortId("flowdef_01M764GY96FA3F58HHVAZRAC4W")).toBe("flowdef_01M7…AC4W");
  });

  it("leaves a short body, a URI or an unprefixed id whole", () => {
    expect(shortId("team_01")).toBe("team_01");
    expect(shortId("sch_0123456789")).toBe("sch_0123456789");
    expect(shortId("https://example.com/schemas/staff_v2")).toBe(
      "https://example.com/schemas/staff_v2",
    );
    expect(shortId("default-login")).toBe("default-login");
  });

  it("keeps every lowercase segment of a prefix", () => {
    expect(shortId("sig_key_01M764GY8FH9BX8CTEFW3XKTFA")).toBe("sig_key_01M7…KTFA");
  });
});

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
