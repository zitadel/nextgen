import { CreateIdpBody, CreateUserBody } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { describe, expect, it } from "vitest";

import {
  describeBody,
  documentSchemaOf,
  readAssignment,
  readAssignments,
} from "../../../../../src/lib/oclif/crud";

const connection = documentSchemaOf(CreateIdpBody, "idp");
const connectionFields = describeBody(CreateIdpBody, { root: "idp" });
const set = (raw: string) => readAssignment(raw, connection, connectionFields);

describe("readAssignment", () => {
  it("assigns text to a path the schema types as a string", () => {
    expect(set("oidc.issuer=https://sso.acme.example")).toMatchObject({
      name: "oidc.issuer",
      path: ["oidc", "issuer"],
      value: "https://sso.acme.example",
    });
  });

  it("reads `=` as the type the schema declares", () => {
    expect(set("oidc.pkce_enabled=false").value).toBe(false);
  });

  it("reads `:=` as JSON", () => {
    expect(set('oidc.scopes:=["openid","email"]').value).toEqual(["openid", "email"]);
    expect(set("oidc.static_authorize_parameters:=null").value).toBeNull();
  });

  it("keeps `=` inside a value", () => {
    expect(set("display_name=a=b").value).toBe("a=b");
  });

  it("takes any key below an open record", () => {
    expect(set("claim_mapping.email=email").path).toEqual(["claim_mapping", "email"]);
    const user = readAssignment(
      "attributes.address.city=Zurich",
      documentSchemaOf(CreateUserBody),
      describeBody(CreateUserBody),
    );
    expect(user).toMatchObject({ path: ["attributes", "address", "city"], value: "Zurich" });
  });

  it("refuses a path the schema does not have, naming the fields near it", () => {
    expect(() => set("oidc.isuer=https://x")).toThrowError(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: "--set oidc.isuer names no field of this body",
        hint: expect.stringContaining("oidc.issuer"),
      }),
    );
  });

  it("refuses a path that runs on past a value with no fields", () => {
    expect(() => set("slug.first=x")).toThrowError(
      expect.objectContaining({ message: "--set slug.first names no field of this body" }),
    );
  });

  it("asks for JSON where the path names a list or an object", () => {
    expect(() => set("oidc.scopes=openid")).toThrowError(
      expect.objectContaining({
        message: "--set oidc.scopes names a list, which takes JSON",
        hint: expect.stringContaining("--oidc-scopes"),
      }),
    );
    expect(() => set("oidc=x")).toThrowError(
      expect.objectContaining({ message: "--set oidc names an object, which takes JSON" }),
    );
  });

  it("refuses a value that does not fit the declared type", () => {
    expect(() => set("oidc.pkce_enabled=maybe")).toThrowError(
      expect.objectContaining({
        message: '--set oidc.pkce_enabled expects true or false, got "maybe"',
      }),
    );
  });

  it.each(["nonsense", "=x", "oidc..issuer=x"])("refuses the malformed entry %s", (raw) => {
    expect(() => set(raw)).toThrowError(expect.objectContaining({ code: "E_VALIDATION" }));
  });

  it("takes any path, as text, when there is no schema to check against", () => {
    expect(readAssignment("a.b=1", undefined, [])).toMatchObject({ path: ["a", "b"], value: "1" });
  });
});

describe("readAssignments", () => {
  it("reads every entry in the order given, and none when there are none", () => {
    expect(
      readAssignments(["slug=a", "slug=b"], connection, connectionFields).map(
        (entry) => entry.value,
      ),
    ).toEqual(["a", "b"]);
    expect(readAssignments(undefined, connection, connectionFields)).toEqual([]);
  });
});
