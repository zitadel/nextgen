import { describe, expect, it } from "vitest";

import {
  credentialVariable,
  credentialVariables,
  isVariableReference,
  referencedVariable,
  variableReference,
} from "./provider.js";

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
    expect(credentialVariables("google_work")).toEqual({
      clientId: "GOOGLE_WORK_CLIENT_ID",
      clientSecret: "GOOGLE_WORK_CLIENT_SECRET",
    });
  });
});

describe("variable references", () => {
  it("references a name as a whole value", () => {
    expect(variableReference("GOOGLE_CLIENT_SECRET")).toBe("${{ GOOGLE_CLIENT_SECRET }}");
  });

  it("reads back the name it wrote", () => {
    expect(referencedVariable(variableReference("ACME_SECRET"))).toBe("ACME_SECRET");
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
