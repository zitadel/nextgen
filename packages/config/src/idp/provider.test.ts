import { describe, expect, it } from "vitest";

import {
  credentialVariable,
  credentialVariables,
  isVariableReference,
  referencedVariable,
  uniquePropertyNames,
  variableReference,
} from "./provider.js";
import { secretVariable, slug } from "./test-support.js";

describe("credential variable names", () => {
  it("uppercases the slug and suffixes it", () => {
    expect(credentialVariable("google", "CLIENT_SECRET")).toBe("GOOGLE_CLIENT_SECRET");
  });

  it("replaces every non-alphanumeric", () => {
    expect(credentialVariable("corp-idp_eu", "CLIENT_SECRET")).toBe("CORP_IDP_EU_CLIENT_SECRET");
  });

  it("prefixes a leading digit, which no shell accepts", () => {
    expect(credentialVariable("1password", "CLIENT_ID")).toBe("_1PASSWORD_CLIENT_ID");
  });

  it("names both of a slug's credentials", () => {
    expect(credentialVariables(slug("google_work"))).toEqual({
      clientId: "GOOGLE_WORK_CLIENT_ID",
      clientSecret: "GOOGLE_WORK_CLIENT_SECRET",
    });
  });
});

describe("variable references", () => {
  it("references a name as a whole value", () => {
    expect(variableReference(secretVariable("GOOGLE_CLIENT_SECRET"))).toBe(
      "${{ GOOGLE_CLIENT_SECRET }}",
    );
  });

  it("reads back the name it wrote", () => {
    expect(referencedVariable(variableReference(secretVariable("ACME_SECRET")))).toBe(
      "ACME_SECRET",
    );
  });

  it("tolerates the spacing a hand-edited file may use", () => {
    expect(referencedVariable("${{ACME_SECRET}}")).toBe("ACME_SECRET");
    expect(referencedVariable("  ${{  ACME_SECRET  }}  ")).toBe("ACME_SECRET");
  });

  it("reads a literal credential as no reference at all", () => {
    // The distinction decides whether a value may be published to a variable
    // or must be left alone, so a near-miss must not read as a reference.
    expect(referencedVariable("not-a-reference")).toBeUndefined();
    expect(referencedVariable("prefix ${{ ACME }}")).toBeUndefined();
    expect(referencedVariable("${{ ACME }} suffix")).toBeUndefined();
    expect(isVariableReference("824.apps.googleusercontent.com")).toBe(false);
  });
});

describe("the unique properties of a schema", () => {
  it("names a property that scopes its uniqueness to the project or the team", () => {
    expect(
      uniquePropertyNames({
        properties: {
          email: { "x-unique": "project" },
          handle: { "x-unique": "team" },
          name: {},
        },
      }),
    ).toEqual(["email", "handle"]);
  });

  it("does not count an unspecified or null scope", () => {
    expect(
      uniquePropertyNames({
        properties: { a: { "x-unique": "unspecified" }, b: { "x-unique": null } },
      }),
    ).toEqual([]);
  });

  it("counts an object that holds a unique property, as the engine asks at the top level", () => {
    expect(
      uniquePropertyNames({
        properties: {
          address: { type: "object", properties: { street: { "x-unique": "project" } } },
        },
      }),
    ).toEqual(["address"]);
  });

  it("reads a schema with no properties, or odd ones, as having none", () => {
    expect(uniquePropertyNames({})).toEqual([]);
    expect(uniquePropertyNames({ properties: null })).toEqual([]);
    expect(uniquePropertyNames({ properties: { a: null, b: "x" } })).toEqual([]);
  });
});
