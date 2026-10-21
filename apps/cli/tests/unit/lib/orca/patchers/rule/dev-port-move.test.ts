import { describe, expect, it } from "vitest";

import {
  configIssuerEdit,
  envValueEdit,
  replaceOrigin,
} from "../../../../../../src/lib/orca/patchers/rule/dev-port-move";

describe("envValueEdit", () => {
  const edit = envValueEdit("ZITADEL_ISSUER", "http://localhost:3101");

  it("rewrites the value in place and keeps every other line", () => {
    const source =
      "# comment\nZITADEL_PROJECT_ID=proj\nZITADEL_ISSUER=http://localhost:3000\nZITADEL_URL=x\n";

    expect(edit(source)).toBe(
      "# comment\nZITADEL_PROJECT_ID=proj\nZITADEL_ISSUER=http://localhost:3101\nZITADEL_URL=x\n",
    );
  });

  it("rewrites an exported assignment", () => {
    expect(edit("export ZITADEL_ISSUER=http://localhost:3000\n")).toBe(
      "export ZITADEL_ISSUER=http://localhost:3101\n",
    );
  });

  it("leaves a key that only starts with the name alone", () => {
    expect(edit("ZITADEL_ISSUER_OLD=a\n")).toBe(
      "ZITADEL_ISSUER_OLD=a\nZITADEL_ISSUER=http://localhost:3101\n",
    );
  });

  it("appends the key to a file without it", () => {
    expect(edit("A=1")).toBe("A=1\nZITADEL_ISSUER=http://localhost:3101\n");
    expect(edit(undefined)).toBe("ZITADEL_ISSUER=http://localhost:3101\n");
  });
});

describe("configIssuerEdit", () => {
  const edit = configIssuerEdit("http://localhost:3000", "http://localhost:3101");

  it("moves the development issuer and its preview pattern, keeping the rest", () => {
    const source = `${JSON.stringify(
      {
        project: "proj",
        environments: {
          development: { issuer: "http://localhost:3000" },
          preview: { issuer_pattern: ["https://*-acme.vercel.app", "http://localhost:3000"] },
        },
        preset: "password-first",
      },
      null,
      2,
    )}\n`;

    const out = JSON.parse(edit(source));

    expect(out.environments).toEqual({
      development: { issuer: "http://localhost:3101" },
      preview: { issuer_pattern: ["https://*-acme.vercel.app", "http://localhost:3101"] },
    });
    expect(out.preset).toBe("password-first");
  });

  it("returns a config already on the new issuer unchanged", () => {
    const source = JSON.stringify({
      environments: { development: { issuer: "http://localhost:3101" } },
    });

    expect(edit(source)).toBe(source);
  });

  it("refuses a missing zitadel.json", () => {
    expect(() => edit(undefined)).toThrow("zitadel.json was not found");
  });
});

describe("replaceOrigin", () => {
  it("replaces the previous origin in place", () => {
    expect(replaceOrigin(["a", "old", "b"], "old", "new")).toEqual(["a", "new", "b"]);
  });

  it("keeps the new origin once when both are listed", () => {
    expect(replaceOrigin(["old", "new"], "old", "new")).toEqual(["new"]);
  });

  it("appends the new origin when the previous one is absent", () => {
    expect(replaceOrigin(["a"], "old", "new")).toEqual(["a", "new"]);
  });
});
