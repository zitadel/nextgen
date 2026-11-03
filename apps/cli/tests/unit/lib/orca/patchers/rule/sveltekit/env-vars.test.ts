import { describe, expect, it } from "vitest";

import {
  envTemplate,
  envVarsEdit,
} from "../../../../../../../src/lib/orca/patchers/rule/sveltekit/env-vars";

const NAMES = ["ZITADEL_URL", "ZITADEL_PROJECT_SECRET", "ZITADEL_PROJECT_ID"];

describe("envTemplate", () => {
  it.each(NAMES)("declares %s", (name) => {
    expect(envTemplate()).toMatch(new RegExp(`^  ${name}: \\{`, "m"));
  });

  it("keeps every variable server-only", () => {
    expect(envTemplate()).not.toMatch(/\bpublic:/);
  });
});

describe("envVarsEdit", () => {
  const edit = envVarsEdit();

  it("writes the template when the app has no env declarations", () => {
    expect(edit(undefined)).toBe(envTemplate());
  });

  it("leaves a file that declares all three untouched", () => {
    expect(edit(envTemplate())).toBe(envTemplate());
  });

  it("adds the missing settings after the app's own, at their indentation", () => {
    const source = [
      "import { defineEnvVars } from '@sveltejs/kit/env';",
      "import * as v from 'valibot';",
      "",
      "export const variables = defineEnvVars({",
      "\tDATABASE_URL: { schema: v.pipe(v.string(), v.url()) },",
      "\tZITADEL_URL: {},",
      "});",
      "",
    ].join("\n");

    const result = edit(source);

    expect(result).toBe(
      [
        "import { defineEnvVars } from '@sveltejs/kit/env';",
        "import * as v from 'valibot';",
        "",
        "export const variables = defineEnvVars({",
        "\tDATABASE_URL: { schema: v.pipe(v.string(), v.url()) },",
        "\tZITADEL_URL: {},",
        '\tZITADEL_PROJECT_SECRET: { description: "The project\'s service key, sent on the session exchange only." },',
        '\tZITADEL_PROJECT_ID: { description: "The project whose sessions count as signed in." },',
        "});",
        "",
      ].join("\n"),
    );
    expect(edit(result)).toBe(result);
  });

  it("keeps a last entry without a trailing comma without one", () => {
    const result = edit("export const variables = defineEnvVars({\n  A: {}\n});\n");

    expect(result).toMatch(/ {2}A: \{\},\n {2}ZITADEL_URL: /);
    expect(result).toMatch(/ZITADEL_PROJECT_ID: \{ description: "[^"]+" \}\n\}\);\n$/);
  });

  it("keeps an object written on one line on one line", () => {
    const result = edit("export const variables = defineEnvVars({ A: {} });\n");

    expect(result.split("\n")).toHaveLength(2);
    expect(result).toMatch(/^export const variables = defineEnvVars\(\{ A: \{\}, ZITADEL_URL: /);
  });

  it("fills an empty declaration", () => {
    const result = edit("export const variables = defineEnvVars({});\n");

    expect(result).toMatch(/^export const variables = defineEnvVars\(\{\n {2}ZITADEL_URL: /);
    expect(result).toMatch(/\n\}\);\n$/);
  });

  it("recognises quoted keys and a plain object", () => {
    const source = `export const variables = { "ZITADEL_URL": {}, 'ZITADEL_PROJECT_SECRET': {}, ZITADEL_PROJECT_ID: {} };\n`;

    expect(edit(source)).toBe(source);
  });

  it("keeps a file's CRLF line ends", () => {
    const result = edit("export const variables = defineEnvVars({\r\n\tA: {},\r\n});\r\n");

    expect(result).toContain("\tA: {},\r\n\tZITADEL_URL: ");
    expect(result.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("refuses a file that exports no variables", () => {
    expect(() => edit("export const settings = {};\n")).toThrow(
      expect.objectContaining({ code: "E_VALIDATION" }),
    );
  });

  it("refuses variables it cannot edit in place", () => {
    expect(() => edit("export const variables = defineEnvVars(shared);\n")).toThrow(
      expect.objectContaining({ code: "E_VALIDATION" }),
    );
  });
});
