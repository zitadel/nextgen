import {
  createBrandingBodyHeroUrlRegExp,
  createBrandingBodyLogoUrlRegExp,
  createBrandingBodyThemeDarkLogoUrlRegExp,
  createBrandingBodyThemeLightLogoUrlRegExp,
  createBrandingBodyTypographyFontUrlRegExp,
  CreateBrandingBody,
  CreateFlowDefinitionBody,
  CreateIdpBody,
  CreateSchemaBody,
  EvaluatePolicyBody,
  PublishPolicyBody,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { distance } from "fastest-levenshtein";
import { z } from "zod";

import defaultPasswordPolicy from "../defaults/default-password-policy.json" with { type: "json" };
import { isBrandingColor, isBrandingFontFamily, MAX_BRANDING_URL_BYTES } from "./branding-css.js";
import { isCanonicalLoopbackHttpUrl } from "./branding-url.js";

const [userSchemaBody, schemaUrlBody] = CreateSchemaBody.options;
const authMethodsBody = userSchemaBody.shape["x-auth-methods"];
const AUTH_METHODS = Object.keys(authMethodsBody.shape);

/** Why `key` is refused under `x-auth-methods`, with the method it is closest to. */
function unknownAuthMethod(key: string): string {
  const [near] = AUTH_METHODS.map((method) => ({ method, cost: distance(key, method) }))
    .filter(({ cost }) => cost <= 2)
    .sort((a, b) => a.cost - b.cost);
  return (
    `${key} is not an authentication method.` +
    (near ? ` Did you mean ${near.method}?` : "") +
    ` Allowed: ${AUTH_METHODS.join(", ")}.`
  );
}

/**
 * `x-auth-methods` as `auth-methods.json` states it, unlike the generated body:
 * strict about its own keys and each method's, and at least one method. The
 * generated Zod drops an unknown key, so a misspelt `pasword` would pass
 * `deploy --dry-run` and the server would refuse the request with a
 * `req.invalid` that names no field. Built from the generated shape, so a
 * method the API adds is allowed here without an edit; the cast keeps the
 * generated types, which strictness does not change.
 */
const strictAuthMethods = z
  .strictObject(
    Object.fromEntries(
      Object.entries(authMethodsBody.shape).map(([name, method]) => [
        name,
        z.strictObject(method.unwrap().shape).optional(),
      ]),
    ) as typeof authMethodsBody.shape,
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? issue.keys.map(unknownAuthMethod).join(" ")
          : undefined,
    },
  )
  .refine((methods) => Object.keys(methods).length > 0, {
    message: "must list at least one authentication method",
    // Only when every key was a method: a lone `pasword` already has its issue.
    when: ({ issues }) => issues.length === 0,
  });

/**
 * A `.zitadel/schemas/*.json` file: the create body, told apart by `kind` so
 * an issue is reported at its key rather than as no union branch matching,
 * with {@link strictAuthMethods} in place of the generated `x-auth-methods`.
 */
export const schemaConfigSchema = z.discriminatedUnion("kind", [
  userSchemaBody.extend({ "x-auth-methods": strictAuthMethods }),
  schemaUrlBody,
]);

export const flowConfigSchema = CreateFlowDefinitionBody.shape.flow_definition;
export const createFlowDefinitionRequestSchema = CreateFlowDefinitionBody;

/**
 * One `.zitadel/idps/<slug>.json` body: the connection document `POST /idps`
 * carries under `idp`. The generated Zod enforces the contract the meta-schema
 * states, including that `client_secret` is a `${{ NAME }}` reference and
 * never a literal.
 */
export const idpConnectionConfigSchema = CreateIdpBody.shape.idp;

/**
 * A `.zitadel/policies/<operation>.json` file: the publish body
 * (`POST /policies`) plus `$schema`. Strict at both levels, unlike the
 * generated body: a typo in a setting must fail `deploy --dry-run`, as the editor's
 * meta-schema (`policy.json`) already flags it.
 *
 * With one operation the generated body is a single object. A second
 * operation turns it into a union without `.shape`, so this stops compiling
 * and has to become a discriminated union on `operation`, strict per branch.
 */
export const policyConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  operation: PublishPolicyBody.shape.operation,
  config: z.strictObject(PublishPolicyBody.shape.config.shape),
});

/**
 * The minimum password length NIST SP 800-63B-4 sets for a password that is
 * the only factor. `setup` recommends it and writes it when given none.
 */
export const RECOMMENDED_PASSWORD_MIN_LENGTH: number = defaultPasswordPolicy.config.min_length;

/**
 * A `.zitadel/policies/<operation>.test.json` file: cases `zitadel policies
 * test` evaluates (`POST /policies/evaluate`), each with the operation's
 * input, the facts it would look up, and the decision it expects. `input` and
 * `facts` come from the generated evaluate body, strict like the policy file,
 * so the editor's `policy-test.json` and this check refuse the same typos.
 *
 * With one operation the generated body is a single object; a second turns
 * this into a discriminated union on `operation`, as for `policyConfigSchema`.
 */
export const policyTestFileSchema = z.strictObject({
  $schema: z.string().optional(),
  operation: EvaluatePolicyBody.shape.operation,
  cases: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        input: z.strictObject(EvaluatePolicyBody.shape.input.shape),
        facts: z.strictObject(EvaluatePolicyBody.shape.facts.unwrap().shape).optional(),
        expect: z
          .strictObject({
            allowed: z.boolean(),
            code: z.string().min(1).optional(),
            violations: z.array(z.string().min(1)).optional(),
          })
          // Only a refusal carries a code or violations, so an allowed case
          // that names one could never pass.
          .refine(
            (expect) =>
              !expect.allowed || (expect.code === undefined && expect.violations === undefined),
            "an allowed case names no code or violations",
          ),
      }),
    )
    .min(1),
});

/** The wire shape of a branding revision (`POST /branding` request body). */
export const brandingWireSchema = CreateBrandingBody;

/**
 * `{ "$file": "<path>" }`, which a `.zitadel/` file may hold in place of a
 * string field the OpenAPI YAML marks `x-local: file`. The path is relative to
 * the file holding it; the CLI inlines the content before publishing.
 */
export const localFileReferenceSchema = z.strictObject({ $file: z.string().min(1) });

const BRANDING_THEME_SIDE = CreateBrandingBody.shape.theme.unwrap().shape.light.unwrap();
const BRANDING_PALETTE = BRANDING_THEME_SIDE.shape.palette.unwrap();

/**
 * A string field the CLI holds to the server's asset URL gate itself, so the
 * refusal sits at the field, in plain words, and the generated URL format and
 * pattern checks, which would refuse the same value in regex wording beside
 * it, do not run.
 *
 * @param pattern - The URL pattern the OpenAPI spec gives the field.
 * @param options - `loopback: false` for a stylesheet, which has no carve-out.
 * @returns The field's schema; an empty string passes, as it does the server.
 */
function brandingAssetUrl(
  pattern: RegExp,
  options: { loopback?: boolean } = {},
): z.ZodOptional<z.ZodString> {
  return z
    .string()
    .superRefine((value, ctx) => {
      const problem = brandingAssetUrlProblem(value, pattern, options);
      if (problem !== undefined) {
        ctx.addIssue({ code: "custom", message: problem });
      }
    })
    .optional();
}

/**
 * A palette colour held to the server's colour gate at the colour itself, in
 * place of the generated length and pattern checks.
 */
const brandingColour = z
  .string()
  .superRefine((value, ctx) => {
    if (!isBrandingColor(value)) {
      ctx.addIssue({
        code: "custom",
        message:
          "must be hex (#4F46E5), a CSS colour name, or a colour function such as rgb(), hsl() or oklch().",
      });
    }
  })
  .optional();

/**
 * One theme side with its logo and every palette colour held to the server's
 * gates at the field that holds them.
 */
const brandingThemeSide = (sidePattern: RegExp) =>
  BRANDING_THEME_SIDE.extend({
    logo_url: brandingAssetUrl(sidePattern),
    palette: z
      .object(
        Object.fromEntries(
          Object.keys(BRANDING_PALETTE.shape).map((key) => [key, brandingColour]),
        ) as { [Key in keyof typeof BRANDING_PALETTE.shape]: typeof brandingColour },
      )
      .optional(),
  }).optional();

/**
 * The typeface, with its stylesheet and font stack held to the server's gates
 * at the field, and the pair held to each other at the stylesheet.
 *
 * A stylesheet alone names no face to render in, so the server rejects the
 * pair as a pair (validateBrandingFontURL in
 * internal/domain/branding_validator.go). plan has to agree, or apply fails
 * after schemas and flows have already been written.
 */
const brandingTypography = CreateBrandingBody.shape.typography
  .unwrap()
  .extend({
    // The appearance values land in a CSS declaration, so the server stores
    // only forms it recognises (ValidateBrandingColor / ValidateBrandingFontFamily
    // in internal/domain/branding_css.go).
    font_family: z
      .string()
      .superRefine((value, ctx) => {
        if (!isBrandingFontFamily(value)) {
          ctx.addIssue({
            code: "custom",
            message:
              'must be comma-separated font names, each an identifier (Inter, ui-sans-serif) or a quoted name ("APK Futural").',
          });
        }
      })
      .optional(),
    // A stylesheet is styling rather than an image, so it has no loopback
    // carve-out.
    font_url: brandingAssetUrl(createBrandingBodyTypographyFontUrlRegExp, { loopback: false }),
  })
  .superRefine((value, ctx) => {
    if (value.font_url !== undefined && value.font_url !== "" && value.font_family === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["font_url"],
        message:
          "needs a typography.font_family to load; a stylesheet alone names no face to render in.",
      });
    }
  })
  .optional();

/**
 * The local `.zitadel/branding/*.json` dialect: the wire shape, where
 * `liquid_template` may also be a `$file` reference to the sibling `.liquid`
 * template (the meta-schema `branding.json` mirrors this).
 *
 * Every value the server gates is checked at the field that holds it, so a
 * refusal carries the field's path and is said once, in plain words, whatever
 * else is wrong with the file. Mirror the server's asset URL gate
 * (validateBrandingAssetURL in internal/domain/branding_validator.go) so plan
 * rejects what apply would: apply mutates schemas and flows before branding,
 * so a late 400 would leave a half-applied run.
 */
export const brandingConfigSchema = z.strictObject({
  // Strict, unlike the generated wire schema: a typo like `hero_urll`
  // must fail plan, not silently pass and get ignored by the server. The
  // editor meta-schema already rejects unknown keys; the CLI gate has to
  // agree.
  ...CreateBrandingBody.shape,
  // Raw strings instead of the generated uri fields: those trim and
  // normalize before refinement runs, hiding exactly the forms the wire
  // body still carries verbatim and Go's url.Parse rejects.
  logo_url: brandingAssetUrl(createBrandingBodyLogoUrlRegExp),
  hero_url: brandingAssetUrl(createBrandingBodyHeroUrlRegExp),
  theme: CreateBrandingBody.shape.theme
    .unwrap()
    .extend({
      light: brandingThemeSide(createBrandingBodyThemeLightLogoUrlRegExp),
      dark: brandingThemeSide(createBrandingBodyThemeDarkLogoUrlRegExp),
    })
    .optional(),
  typography: brandingTypography,
  $schema: z.string().optional(),
  liquid_template: z
    .union([CreateBrandingBody.shape.liquid_template.unwrap(), localFileReferenceSchema])
    .optional(),
});

/**
 * Why an asset URL is refused, in the words the server uses.
 *
 * @param value - The URL as written.
 * @param pattern - The URL pattern the OpenAPI spec gives the field, which the
 *   API enforces too and which refuses forms the checks above it let through,
 *   such as `https:///host`.
 * @param options - `loopback: false` for a stylesheet.
 * @returns What is wrong with it, to follow the field's path; `undefined` when
 *   it passes. An empty string passes, as it does the server.
 */
function brandingAssetUrlProblem(
  value: string,
  pattern: RegExp,
  options: { loopback?: boolean },
): string | undefined {
  if (value === "") {
    return undefined;
  }
  // The server counts bytes (validateBrandingAssetURL), so a URL with
  // non-ASCII characters can be short in characters and still too long.
  if (new TextEncoder().encode(value).length > MAX_BRANDING_URL_BYTES) {
    return `must be at most ${MAX_BRANDING_URL_BYTES} bytes.`;
  }
  // Stricter-or-equal than the Go gate (validateBrandingAssetURL): the WHATWG
  // parser forgives what Go's url.Parse rejects — `https:example.com`,
  // backslashes, and whitespace all get silently normalized. plan must never
  // accept what apply would reject (the reverse is harmless), so reject the
  // raw forms before parsing.
  if (/[\s\\]/.test(value)) {
    return "is not a valid URL.";
  }
  if (!/^https?:\/\//i.test(value)) {
    return "must be an absolute https URL.";
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "is not a valid URL.";
  }
  // Fetched by every visitor's browser, so userinfo in it is a credential in
  // every access log — the server refuses it and so must plan.
  if (parsed.username !== "" || parsed.password !== "") {
    return "must not carry credentials; the URL is fetched by every visitor's browser.";
  }
  // Loopback HTTP is the dev-posture carve-out (assets served from the app's
  // own dev server), and it covers images only: a stylesheet is styling rather
  // than an image, so it stays https everywhere. Check the raw URL so WHATWG
  // normalisation cannot make plan accept a host spelling that the Go save
  // gate rejects.
  const loopback =
    options.loopback !== false && parsed.protocol === "http:" && isCanonicalLoopbackHttpUrl(value);
  if (!loopback && (parsed.protocol !== "https:" || parsed.host === "")) {
    // Worded as the server words it (validateBrandingFontURL,
    // validateBrandingAssetURL): only a field with the carve-out mentions it.
    return options.loopback === false
      ? "must be an absolute https URL."
      : "must be an absolute https URL (http is allowed for canonical loopback development hosts only).";
  }
  return pattern.test(value) ? undefined : "is not a valid URL.";
}
