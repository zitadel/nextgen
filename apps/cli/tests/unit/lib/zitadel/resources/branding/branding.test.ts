import { describe, expect, it } from "vitest";

import { BrokenFile, Branding, CONFIG_DIRECTORIES, MemoryStore } from "@/lib/zitadel";
import { aBranding, aFile, aStore } from "@tests/helpers/config";

/**
 * The descriptor's file name under `.zitadel/branding/`.
 */
const NAME = "branding.json";

/**
 * Where the descriptor in these tests sits.
 */
const PATH = `${CONFIG_DIRECTORIES.branding}/${NAME}`;

/**
 * A template the server's template rules take.
 */
const TEMPLATE = "<zl-page-shell>{% mandatory_gates %}</zl-page-shell>";

/**
 * A template the server's template rules refuse, for it renders no gates.
 */
const NO_GATES = "<zl-page-shell></zl-page-shell>";

/**
 * A reference to the template beside the descriptor.
 */
const LOGIN_TEMPLATE = { $file: "./login.liquid" };

/**
 * A reference to a template that is not there.
 */
const MISSING_TEMPLATE = { $file: "./missing.liquid" };

/**
 * A store holding {@link TEMPLATE} beside the descriptor, as `login.liquid`.
 */
const HOLDING_TEMPLATE = aStore({}, { [`${CONFIG_DIRECTORIES.branding}/login.liquid`]: TEMPLATE });

/**
 * A store holding {@link NO_GATES} beside the descriptor, as `login.liquid`.
 */
const HOLDING_NO_GATES = aStore({}, { [`${CONFIG_DIRECTORIES.branding}/login.liquid`]: NO_GATES });

describe("Branding.read", () => {
  it("takes a descriptor the branding contract takes as a branding", () => {
    const reading = Branding.read(aFile("branding", NAME, aBranding()));

    expect(reading).toBeInstanceOf(Branding);
  });

  it("takes a descriptor the branding contract refuses as a broken file", () => {
    const reading = Branding.read(aFile("branding", NAME, { layout: "sideways" }));

    expect(reading).toBeInstanceOf(BrokenFile);
  });

  it("reports what the branding contract refuses, under contract/branding", () => {
    const reading = Branding.read(aFile("branding", NAME, { layout: "sideways" }));

    expect(reading).toMatchObject({ issues: [{ rule: "contract/branding" }] });
  });

  it("tells a descriptor with the retired key how to migrate", () => {
    const reading = Branding.read(
      aFile("branding", NAME, { layout: "centered", liquid_template_file: "./brand.liquid" }),
    );

    expect(reading).toMatchObject({
      issues: [
        {
          severity: "error",
          rule: "branding/legacy-template-key",
          file: PATH,
          message:
            'liquid_template_file is no longer supported. Replace it with "liquid_template": { "$file": "./brand.liquid" }.',
        },
      ],
    });
  });

  it("keeps the other refusals beside the retired key's finding", () => {
    const reading = Branding.read(
      aFile("branding", NAME, { layout: "sideways", liquid_template_file: "./brand.liquid" }),
    );

    expect(reading).toMatchObject({
      issues: [
        { severity: "error", rule: "branding/legacy-template-key", file: PATH },
        {
          severity: "error",
          rule: "contract/branding",
          message: expect.stringMatching(/^layout /),
        },
      ],
    });
  });

  it("keeps another unknown key that the retired key was reported with", () => {
    const reading = Branding.read(
      aFile("branding", NAME, {
        hero_urll: "https://x.example/a.png",
        liquid_template_file: "./brand.liquid",
      }),
    );

    expect(reading).toMatchObject({
      issues: [
        { severity: "error", rule: "branding/legacy-template-key", file: PATH },
        {
          severity: "error",
          rule: "contract/branding",
          message: '(root) Unrecognized key: "hero_urll"',
        },
      ],
    });
  });

  it.each([
    [
      "typography.font_url",
      { typography: { font_family: "Inter", font_url: "http://localhost:3000/f.css" } },
      "typography.font_url must be an absolute https URL.",
    ],
    [
      "typography.font_url that is no URL",
      { typography: { font_family: "Inter", font_url: "not a url" } },
      "typography.font_url is not a valid URL.",
    ],
    [
      "typography.font_url without a family",
      { typography: { font_url: "https://fonts.example.com/css2" } },
      "typography.font_url needs a typography.font_family to load; a stylesheet alone names no face to render in.",
    ],
    [
      "typography.font_family",
      { typography: { font_family: "Inter;{" } },
      'typography.font_family must be comma-separated font names, each an identifier (Inter, ui-sans-serif) or a quoted name ("APK Futural").',
    ],
    [
      "theme.light.logo_url",
      { theme: { light: { logo_url: "http://cdn.example.com/logo.png" } } },
      "theme.light.logo_url must be an absolute https URL (http is allowed for canonical loopback development hosts only).",
    ],
    [
      "theme.dark.logo_url",
      { theme: { dark: { logo_url: "http://cdn.example.com/logo.png" } } },
      "theme.dark.logo_url must be an absolute https URL (http is allowed for canonical loopback development hosts only).",
    ],
    [
      "logo_url",
      { logo_url: "http://cdn.example.com/logo.png" },
      "logo_url must be an absolute https URL (http is allowed for canonical loopback development hosts only).",
    ],
  ])(
    "reports a refused %s once, in plain words and without a location",
    (_field, body, message) => {
      const reading = Branding.read(aFile("branding", NAME, aBranding(body)));

      expect(reading).toMatchObject({
        issues: [{ severity: "error", rule: "contract/branding", file: PATH, message }],
      });
    },
  );

  it("keeps the refusals of other fields beside a plain-worded one", () => {
    const reading = Branding.read(
      aFile(
        "branding",
        NAME,
        aBranding({
          layout: "sideways",
          typography: { font_family: "Inter", font_url: "http://localhost:3000/f.css" },
        }),
      ),
    );

    expect(reading).toMatchObject({
      issues: [
        { message: expect.stringMatching(/^layout /) },
        { message: "typography.font_url must be an absolute https URL." },
      ],
    });
  });

  it("words a refused URL in plain words beside an unknown key", () => {
    const reading = Branding.read(
      aFile(
        "branding",
        NAME,
        aBranding({
          hero_urll: "https://cdn.example.com/hero.png",
          typography: { font_family: "Inter", font_url: "http://localhost:3000/f.css" },
        }),
      ),
    );

    expect(reading).toMatchObject({
      issues: [
        { message: "typography.font_url must be an absolute https URL." },
        { message: '(root) Unrecognized key: "hero_urll"' },
      ],
    });
  });

  it("points a retired key that names no path at login.liquid", () => {
    const reading = Branding.read(
      aFile("branding", NAME, { layout: "centered", liquid_template_file: true }),
    );

    expect(reading).toMatchObject({
      issues: [
        {
          message:
            'liquid_template_file is no longer supported. Replace it with "liquid_template": { "$file": "./login.liquid" }.',
        },
      ],
    });
  });
});

describe("Branding.of", () => {
  it("takes the file as read", () => {
    const branding = Branding.of(aFile("branding", NAME, aBranding()));

    expect(branding.status).toBe("read");
  });
});

describe("Branding.create", () => {
  it("takes the file as new", () => {
    const branding = Branding.create(aFile("branding", NAME, aBranding()));

    expect(branding.status).toBe("created");
  });
});

describe("Branding.check", () => {
  it("finds nothing wrong with an inline template the server's rules take", () => {
    const branding = Branding.of(aFile("branding", NAME, aBranding()));

    const problems = branding.check({ store: new MemoryStore() });

    expect(problems).toEqual([]);
  });

  it("finds nothing wrong with a template read through a $file reference", () => {
    const branding = Branding.of(
      aFile("branding", NAME, aBranding({ liquid_template: LOGIN_TEMPLATE })),
    );

    const problems = branding.check({ store: HOLDING_TEMPLATE });

    expect(problems).toEqual([]);
  });

  it("reports a $file reference that cannot be read", () => {
    const branding = Branding.of(
      aFile("branding", NAME, aBranding({ liquid_template: MISSING_TEMPLATE })),
    );

    const problems = branding.check({ store: new MemoryStore() });

    expect(problems).toMatchObject([{ rule: "branding/template-file" }]);
  });

  it("holds the template to the server's template rules", () => {
    const branding = Branding.of(aFile("branding", NAME, aBranding({ liquid_template: NO_GATES })));

    const problems = branding.check({ store: new MemoryStore() });

    expect(problems).toMatchObject([{ rule: "branding/template" }]);
  });

  it("holds the template behind a $file reference to the server's template rules", () => {
    const branding = Branding.of(
      aFile("branding", NAME, aBranding({ liquid_template: LOGIN_TEMPLATE })),
    );

    const problems = branding.check({ store: HOLDING_NO_GATES });

    expect(problems).toMatchObject([{ rule: "branding/template" }]);
  });

  it("skips the template checks without a store", () => {
    const branding = Branding.of(aFile("branding", NAME, aBranding({ liquid_template: NO_GATES })));

    const problems = branding.check({});

    expect(problems).toEqual([]);
  });
});

describe("Branding.toWireBody", () => {
  it("inlines a $file reference and drops the $schema pointer", () => {
    const branding = Branding.of(
      aFile("branding", NAME, {
        $schema: "../meta/branding.json",
        layout: "centered",
        liquid_template: LOGIN_TEMPLATE,
      }),
    );

    const body = branding.toWireBody(HOLDING_TEMPLATE);

    expect(body).toEqual({ layout: "centered", liquid_template: TEMPLATE });
  });

  it("leaves out a reference that cannot be read", () => {
    const branding = Branding.of(
      aFile("branding", NAME, aBranding({ liquid_template: MISSING_TEMPLATE })),
    );

    const body = branding.toWireBody(new MemoryStore());

    expect(body).toEqual({ layout: "centered" });
  });
});

describe("Branding.listReferencedPaths", () => {
  it("names the files the references point at", () => {
    const branding = Branding.of(aFile("branding", NAME, { liquid_template: LOGIN_TEMPLATE }));

    const paths = branding.listReferencedPaths(new MemoryStore());

    expect(paths).toEqual([`${CONFIG_DIRECTORIES.branding}/login.liquid`]);
  });
});
