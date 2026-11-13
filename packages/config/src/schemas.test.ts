import {
  EvaluatePolicyBody,
  PublishPolicyBody,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { describe, expect, it } from "vitest";

import { getDefaultLoginFlow } from "./defaults.js";
import {
  brandingConfigSchema,
  DEFAULT_USER_CREATE_POLICY,
  flowConfigSchema,
  policyConfigSchema,
  policyTestFileSchema,
  schemaConfigSchema,
} from "./schemas.js";

/**
 * Direct coverage for the branding descriptor gate `zitadel plan`/`apply`
 * run. The URL rules mirror the Go save gate
 * (`internal/domain/branding_validator.go`) and the component's paint-time
 * sanitiser — a descriptor plan accepts must never be one apply rejects.
 */
describe("brandingConfigSchema", () => {
  const base = { layout: "split", liquid_template: { $file: "./login.liquid" } };

  /** What the descriptor is refused for, each as `path message`, as a person reads it. */
  const refusalsOf = (descriptor: object): string[] => {
    const result = brandingConfigSchema.safeParse(descriptor);
    return (result.error?.issues ?? []).map((issue) => {
      return `${issue.path.join(".") || "(root)"} ${issue.message}`;
    });
  };

  it("accepts the template inline or as a $file reference, and rejects the old key", () => {
    const parses = (descriptor: object): boolean =>
      brandingConfigSchema.safeParse(descriptor).success;
    expect(parses({ layout: "split", liquid_template: "<p></p>" })).toBe(true);
    expect(parses(base)).toBe(true);
    expect(parses({ layout: "split", liquid_template: { $file: "" } })).toBe(false);
    expect(parses({ layout: "split", liquid_template_file: "./login.liquid" })).toBe(false);
  });

  it("accepts a descriptor with https asset URLs", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      $schema: "../meta/branding.json",
      logo_url: "https://cdn.example.com:8443/logo.svg",
      hero_url: "https://cdn.example.com:8443/hero.png",
      typography: {
        font_family: "Inter, ui-sans-serif, sans-serif",
        font_url: "https://fonts.example.com:8443/css2",
      },
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("measures asset URL length in bytes, like the server", () => {
    const prefix = "https://cdn.example.com/";
    const atLimit = `${prefix}${"a".repeat(2048 - prefix.length)}`;
    // 1124 characters, but "é" is two bytes in UTF-8, so 2224 bytes.
    const multiByte = `${prefix}${"é".repeat(1100)}`;
    expect(brandingConfigSchema.safeParse({ ...base, logo_url: atLimit }).success).toBe(true);
    const result = brandingConfigSchema.safeParse({ ...base, logo_url: multiByte });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("2048 bytes");
  });

  it("rejects non-loopback http asset URLs", () => {
    for (const url of [
      "http://cdn.example.com/logo.svg",
      "http://localhost.evil.example/logo.svg",
      "http://localhost:3000@evil.example/logo.svg",
      "http://192.168.1.10/logo.svg",
      "http://127.1/logo.svg",
      "http://2130706433/logo.svg",
      "http://0x7f000001/logo.svg",
      "http://127.00.0.1/logo.svg",
      "http://[0:0:0:0:0:0:0:1]/logo.svg",
      "http://[::ffff:127.0.0.1]/logo.svg",
    ]) {
      const result = brandingConfigSchema.safeParse({ ...base, logo_url: url });
      expect(result.success, url).toBe(false);
    }
  });

  it("accepts loopback http asset URLs (local-dev carve-out)", () => {
    for (const url of [
      "http://localhost:3000/logo.svg",
      "HTTP://LOCALHOST:3000/logo.svg",
      "http://127.0.0.1:8080/logo.svg",
      "http://127.255.255.255/logo.svg",
      "http://[::1]:3000/logo.svg",
    ]) {
      const result = brandingConfigSchema.safeParse({ ...base, logo_url: url });
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    }
  });

  it("rejects font_url without a font family", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      typography: { font_url: "https://fonts.example.com/css2" },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("needs a typography.font_family");
  });

  it("accepts font_url alongside the family it loads", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      typography: {
        font_family: "Inter, ui-sans-serif, sans-serif",
        font_url: "https://fonts.example.com/css2",
      },
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  describe("says each refusal once, at its own field, in the words of the spec", () => {
    const COLOUR =
      "must be hex (#4F46E5), a CSS colour name, or a colour function such as rgb(), hsl() or oklch()";
    const COLOUR_FUNCTIONS =
      "must be hex (#4F46E5), a CSS colour name, or one of the colour functions rgb(), rgba(), hsl(), hsla(), hwb(), lab(), lch(), oklab(), oklch(), color() or color-mix()";
    const FONT_STACK =
      'must be comma-separated font names, each an identifier (Inter, ui-sans-serif) or a quoted name ("APK Futural")';
    const IMAGE_URL =
      "must be a valid absolute https URL without credentials (http is allowed for canonical loopback development hosts only)";
    const STYLESHEET_URL = "must be a valid absolute https URL without credentials";
    const NEEDS_FAMILY =
      "typography.font_url needs a typography.font_family to load; a stylesheet alone names no face to render in";
    const FONT_STACK_NO_COMMA =
      'must be comma-separated font names, each an identifier (Inter, ui-sans-serif) or a quoted name ("APK Futural") with no comma inside the quotes';
    const INTER = "Inter";

    it.each([
      [
        "a palette colour that could close its CSS declaration",
        { theme: { light: { palette: { primary: "red; } :host { display: none" } } } },
        [`theme.light.palette.primary ${COLOUR}`],
      ],
      [
        "a colour that fetches a URL",
        { theme: { dark: { palette: { background: "url(https://evil.example/beacon.png)" } } } },
        [`theme.dark.palette.background ${COLOUR}`],
      ],
      [
        "a colour function the server does not allow, which the spec's pattern admits",
        { theme: { light: { palette: { primary: "var(--brand)" } } } },
        [`theme.light.palette.primary ${COLOUR_FUNCTIONS}`],
      ],
      [
        "an unknown function, which the spec's pattern admits",
        { theme: { dark: { palette: { primary: "local(red)" } } } },
        [`theme.dark.palette.primary ${COLOUR_FUNCTIONS}`],
      ],
      [
        "a font stack that could close its CSS declaration",
        { typography: { font_family: "Inter; } :host { display: none" } },
        [`typography.font_family ${FONT_STACK}`],
      ],
      [
        "an empty font family",
        { typography: { font_family: "" } },
        [`typography.font_family ${FONT_STACK}`],
      ],
      [
        "an http theme-side logo",
        { theme: { dark: { logo_url: "http://cdn.example.com/on-dark.svg" } } },
        [`theme.dark.logo_url ${IMAGE_URL}`],
      ],
      [
        "a theme-side logo with leading space",
        { theme: { light: { logo_url: " https://cdn.example.com/logo.png" } } },
        [`theme.light.logo_url ${IMAGE_URL}`],
      ],
      [
        "a theme-side logo with no host",
        { theme: { dark: { logo_url: "https:///cdn.example.com/logo.png" } } },
        [`theme.dark.logo_url ${IMAGE_URL}`],
      ],
      [
        "an empty theme-side logo, which the API cannot decode",
        { theme: { dark: { logo_url: "" } } },
        [`theme.dark.logo_url ${IMAGE_URL}`],
      ],
      [
        "an empty logo and hero, which the API cannot decode",
        { logo_url: "", hero_url: "" },
        [`logo_url ${IMAGE_URL}`, `hero_url ${IMAGE_URL}`],
      ],
      [
        "a logo carrying credentials",
        { logo_url: "https://user:pass@cdn.example.com/logo.svg" },
        [`logo_url ${IMAGE_URL}`],
      ],
      [
        "an http font_url, which has no loopback carve-out",
        { typography: { font_family: INTER, font_url: "http://localhost:3000/font.css" } },
        [`typography.font_url ${STYLESHEET_URL}`],
      ],
      [
        "a font_url with no host",
        { typography: { font_family: INTER, font_url: "https:///fonts.example.com/css2" } },
        [`typography.font_url ${STYLESHEET_URL}`],
      ],
      [
        "a font_url that is no URL",
        { typography: { font_family: INTER, font_url: "not a url" } },
        [`typography.font_url ${STYLESHEET_URL}`],
      ],
      [
        "an empty font_url, which the API cannot decode",
        { typography: { font_url: "" } },
        [`typography.font_url ${STYLESHEET_URL}`],
      ],
      [
        "a font_url carrying credentials",
        { typography: { font_family: INTER, font_url: "https://user:pass@fonts.example.com/c" } },
        [`typography.font_url ${STYLESHEET_URL}`],
      ],
      [
        "a font_url over the length limit",
        { typography: { font_family: INTER, font_url: `https://f.example/${"a".repeat(2100)}` } },
        ["typography.font_url Too big: expected string to have <=2048 characters"],
      ],
      [
        "a logo with a tab in its path, which the server's URL parser refuses",
        { logo_url: "https://cdn.example.com/a\tb.png" },
        [`logo_url ${IMAGE_URL}`],
      ],
      [
        "a hero with a newline in its path",
        { hero_url: "https://cdn.example.com/a\nb.png" },
        [`hero_url ${IMAGE_URL}`],
      ],
      [
        "a theme logo with a control character in its query",
        { theme: { dark: { logo_url: "https://cdn.example.com/a?x=\u0001" } } },
        [`theme.dark.logo_url ${IMAGE_URL}`],
      ],
      [
        "a font_url with a control character in its path",
        { typography: { font_family: INTER, font_url: "https://f.example/a\tb.css" } },
        [`typography.font_url ${STYLESHEET_URL}`],
      ],
      [
        "a logo with a malformed escape in its host, which the server's URL parser refuses",
        { logo_url: "https://%zz/logo.svg" },
        [`logo_url ${IMAGE_URL}`],
      ],
      [
        "a logo with a malformed escape in its path",
        { logo_url: "https://cdn.example.com/%zz" },
        [`logo_url ${IMAGE_URL}`],
      ],
      [
        "a theme logo with a well-formed escape that spells a letter in its host",
        { theme: { light: { logo_url: "https://%41.example.com/logo.svg" } } },
        [`theme.light.logo_url ${IMAGE_URL}`],
      ],
      [
        "a font_url with a malformed escape in its host",
        { typography: { font_family: INTER, font_url: "https://%zz/c.css" } },
        [`typography.font_url ${STYLESHEET_URL}`],
      ],
      [
        "a logo with a well-formed escape in its path",
        { logo_url: "https://cdn.example.com/a%20b.png" },
        [],
      ],
      [
        "a font stack with a comma inside a quoted name, which the server splits on",
        { typography: { font_family: '"Acme, Inc", sans-serif' } },
        [`typography.font_family ${FONT_STACK_NO_COMMA}`],
      ],
      [
        "a font stack with a quoted name and no comma inside it",
        { typography: { font_family: '"Acme Inc", sans-serif' } },
        [],
      ],
      [
        "a logo with a space in its host",
        { logo_url: "https://cdn example.com/logo.png" },
        [`logo_url ${IMAGE_URL}`],
      ],
      [
        "a logo with a backslash in its host",
        { logo_url: "https://cdn\\example.com/logo.png" },
        [`logo_url ${IMAGE_URL}`],
      ],
      [
        "a font_url with a space in its host",
        { typography: { font_family: INTER, font_url: "https://f example.com/c.css" } },
        [`typography.font_url ${STYLESHEET_URL}`],
      ],
      [
        "a colour function that is long as well as not allowed, said once",
        { theme: { light: { palette: { primary: `var(${"a".repeat(130)})` } } } },
        ["theme.light.palette.primary Too big: expected string to have <=128 characters"],
      ],
      [
        "a font_url without a font family",
        { typography: { font_url: "https://fonts.example.com/css2" } },
        [NEEDS_FAMILY],
      ],
      [
        "a font_url without a font family beside a mistake of type in another typography field",
        { typography: { scale: "big", font_url: "https://fonts.example.com/css2" } },
        ["typography.scale Invalid input: expected number, received string", NEEDS_FAMILY],
      ],
      [
        "a font_url that is refused and has no font family",
        { typography: { font_url: "http://x.example/f" } },
        [`typography.font_url ${STYLESHEET_URL}`, NEEDS_FAMILY],
      ],
      [
        "an unknown key beside a palette colour",
        {
          name: "Acme",
          theme: { light: { palette: { primary: "var(--brand)" } } },
        },
        ['(root) Unrecognized key: "name"', `theme.light.palette.primary ${COLOUR_FUNCTIONS}`],
      ],
      [
        "a mistake of type beside a refused URL and a missing family",
        { layout: "sideways", typography: { font_url: "http://x.example/f" } },
        [
          'layout Invalid option: expected one of "centered"|"split"',
          `typography.font_url ${STYLESHEET_URL}`,
          NEEDS_FAMILY,
        ],
      ],
    ])("%s", (_name, extra, expected) => {
      expect(refusalsOf({ ...base, ...extra }).sort()).toEqual([...expected].sort());
    });

    it("refuses a non-string palette value", () => {
      expect(refusalsOf({ ...base, theme: { light: { palette: { primary: 123 } } } })).toEqual([
        expect.stringContaining("expected string"),
      ]);
    });
  });

  it("accepts the appearance blocks", () => {
    const result = brandingConfigSchema.safeParse({
      ...base,
      theme: {
        mode: "auto",
        light: {
          logo_url: "https://cdn.example.com/on-light.svg",
          palette: { primary: "#4F46E5", link: "rebeccapurple" },
        },
        dark: {
          logo_url: "https://cdn.example.com/on-dark.svg",
          palette: { primary: "color-mix(in oklab, #A5B4FC 40%, white)" },
        },
      },
      shape: { radius: 10, density: "regular", logo_scale: 1.5 },
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("rejects unknown keys, including inside a $file reference", () => {
    expect(brandingConfigSchema.safeParse({ ...base, hero_urll: "x" }).success).toBe(false);
    expect(
      brandingConfigSchema.safeParse({
        ...base,
        liquid_template: { $file: "./login.liquid", extra: 1 },
      }).success,
    ).toBe(false);
  });
});

describe("flowConfigSchema", () => {
  it("refuses a key the definition does not have, as the server does", () => {
    const flow = getDefaultLoginFlow();
    expect(flowConfigSchema.safeParse(flow).success).toBe(true);
    const result = flowConfigSchema.safeParse({ ...flow, status: "active" });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: "unrecognized_keys", keys: ["status"] }),
    ]);
  });
});

/**
 * The gate `zitadel policies test` runs on a `.zitadel/policies/*.test.json`
 * file before it sends a case: strict like the editor's `policy-test.json`.
 */
describe("policyTestFileSchema", () => {
  const testCase = {
    name: "too short",
    input: { password: "short1" },
    expect: { allowed: false, violations: ["min_length"] },
  };
  const file = { operation: "auth.factor.password.set", cases: [testCase] };
  const parses = (value: object): boolean => policyTestFileSchema.safeParse(value).success;

  it("accepts cases with input, facts and an expectation", () => {
    expect(parses(file)).toBe(true);
    expect(
      parses({
        ...file,
        cases: [{ ...testCase, facts: { self_service: false, history_matches: [true] } }],
      }),
    ).toBe(true);
  });

  it.each([
    ["no cases", { ...file, cases: [] }],
    ["an unknown input", { ...file, cases: [{ ...testCase, input: { passwd: "x" } }] }],
    ["an unknown fact", { ...file, cases: [{ ...testCase, facts: { admin: true } }] }],
    ["an unnamed case", { ...file, cases: [{ ...testCase, name: "" }] }],
    ["no expectation", { ...file, cases: [{ name: "x", input: { password: "x" } }] }],
    ["an unknown top-level key", { ...file, config: {} }],
    [
      "an allowed case with violations",
      { ...file, cases: [{ ...testCase, expect: { allowed: true, violations: ["min_length"] } }] },
    ],
    [
      "an allowed case with a code",
      { ...file, cases: [{ ...testCase, expect: { allowed: true, code: "user.password_empty" } }] },
    ],
  ])("refuses %s", (_, value) => {
    expect(parses(value)).toBe(false);
  });

  it("takes each operation's own input and no facts it does not have", () => {
    const signup = {
      operation: "user.create",
      cases: [
        {
          name: "the built-in proof of work",
          input: { solved_challenge: "zitadel_pow" },
          expect: { allowed: true },
        },
      ],
    };
    expect(parses(signup)).toBe(true);
    expect(parses({ ...signup, cases: [{ ...signup.cases[0], input: { password: "x" } }] })).toBe(
      false,
    );
    expect(
      parses({ ...signup, cases: [{ ...signup.cases[0], facts: { self_service: true } }] }),
    ).toBe(false);
  });

  it("has a branch for every operation the evaluate body takes", () => {
    expect(
      policyTestFileSchema.options.flatMap((branch) => branch.shape.operation.options),
    ).toEqual(EvaluatePolicyBody.options.flatMap((branch) => branch.shape.operation.options));
  });
});

/**
 * The gate `deploy --dry-run` runs on a `.zitadel/policies/<operation>.json`
 * file: strict per operation, like the editor's `policy.json`.
 */
describe("policyConfigSchema", () => {
  const parses = (value: object): boolean => policyConfigSchema.safeParse(value).success;

  it("accepts each operation's own settings", () => {
    expect(parses({ operation: "auth.factor.password.set", config: { min_length: 15 } })).toBe(
      true,
    );
    expect(parses({ operation: "user.create", config: { challenge: "zitadel_pow" } })).toBe(true);
    expect(parses({ operation: "user.create", config: {} })).toBe(true);
  });

  it.each([
    ["another operation's setting", { operation: "user.create", config: { min_length: 15 } }],
    [
      "a challenge the server cannot issue",
      { operation: "user.create", config: { challenge: "turnstile" } },
    ],
    ["an unknown operation", { operation: "auth.check", config: {} }],
  ])("refuses %s", (_, value) => {
    expect(parses(value)).toBe(false);
  });

  it("has a branch for every operation the publish body takes", () => {
    expect(policyConfigSchema.options.flatMap((branch) => branch.shape.operation.options)).toEqual(
      PublishPolicyBody.options.flatMap((branch) => branch.shape.operation.options),
    );
  });

  it("ships the default sign-up policy as a valid file", () => {
    expect(DEFAULT_USER_CREATE_POLICY).toEqual({
      operation: "user.create",
      config: { challenge: "zitadel_pow" },
    });
  });
});

/**
 * The gate `deploy --dry-run` and `doctor` run on a `.zitadel/schemas/*.json`
 * file: strict about `x-auth-methods` like the editor's `auth-methods.json`.
 */
describe("schemaConfigSchema", () => {
  const userSchema = (methods: unknown) => ({
    objectType: "human-user",
    kind: "user-schema",
    metaSchema: "https://example.com/meta/user-schema.json",
    "x-identifier": "email",
    properties: { email: { type: "string" } },
    "x-auth-methods": methods,
  });
  const issues = (document: unknown) => {
    const result = schemaConfigSchema.safeParse(document);
    return result.success
      ? []
      : result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
  };

  it("accepts every method the meta-schema allows", () => {
    const all = Object.fromEntries(
      ["password", "passkey", "magic_link", "otp"].map((method) => [method, { enabled: true }]),
    );
    expect(issues(userSchema({ ...all, sso: { enabled: true, providers: ["google"] } }))).toEqual(
      [],
    );
  });

  it("names a misspelt method and the one it is closest to", () => {
    expect(issues(userSchema({ password: { enabled: true }, pasword: { enabled: true } }))).toEqual(
      [
        [
          "x-auth-methods",
          "pasword is not an authentication method. Did you mean password? Allowed: password, passkey, magic_link, sso, otp.",
        ],
      ],
    );
  });

  it("suggests nothing for a key close to no method", () => {
    expect(issues(userSchema({ webauthn: { enabled: true } }))).toEqual([
      [
        "x-auth-methods",
        "webauthn is not an authentication method. Allowed: password, passkey, magic_link, sso, otp.",
      ],
    ]);
  });

  it("refuses an unknown key inside a method", () => {
    expect(issues(userSchema({ sso: { enabled: false, provider: ["google"] } }))).toEqual([
      ["x-auth-methods.sso", 'Unrecognized key: "provider"'],
    ]);
  });

  it("refuses an x-auth-methods that lists no method", () => {
    expect(issues(userSchema({}))).toEqual([
      ["x-auth-methods", "must list at least one authentication method"],
    ]);
  });

  it("reports a misspelt kind at kind", () => {
    expect(issues({ ...userSchema({ password: { enabled: true } }), kind: "user_schema" })).toEqual(
      [["kind", "Invalid discriminator value. Expected 'user-schema' | 'schema-url'"]],
    );
  });

  it("accepts a schema-url reference", () => {
    expect(
      issues({ objectType: "human-user", kind: "schema-url", url: "https://example.com/s.json" }),
    ).toEqual([]);
  });
});
