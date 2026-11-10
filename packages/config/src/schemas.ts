import {
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

const BRANDING_THEME = CreateBrandingBody.shape.theme.unwrap();
const BRANDING_PALETTE = BRANDING_THEME.shape.light.unwrap().shape.palette;

/**
 * Run a check only when the checks before it found nothing wrong with the
 * value, so a value is refused once, by the first check that says so.
 *
 * @param payload - What the checks before it found.
 * @returns True when they found nothing.
 */
function whenNothingElseIsWrong(payload: { readonly issues: readonly unknown[] }): boolean {
  return payload.issues.length === 0;
}

/**
 * Whether a value holds an ASCII control character, a tab or a newline among
 * them, which the server's URL parser refuses anywhere in a URL.
 *
 * @param value - The value.
 * @returns True when it holds one.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a URL holds a percent sign that does not start an escape.
 *
 * @param value - The URL.
 * @returns True when a `%` is not followed by two hexadecimal digits.
 */
function hasMalformedPercentEscape(value: string): boolean {
  return /%(?![0-9a-fA-F]{2})/.test(value);
}

/**
 * Whether a URL holds a percent sign in its host.
 *
 * @param value - The URL.
 * @returns True when the part between the scheme and the first `/`, `?` or `#`
 *   holds a `%`.
 */
function hasPercentInHost(value: string): boolean {
  const withoutScheme = value.replace(/^[^:/?#]*:\/\//, "");
  return (withoutScheme.split(/[/?#]/, 1)[0] ?? "").includes("%");
}

/**
 * Hold a URL field to what the server enforces and the spec cannot say.
 *
 * @remarks
 * The spec's pattern leaves a URL's path and query unconstrained, but the
 * server's URL parser refuses a control character anywhere in it, a malformed
 * percent-escape in its host or path, and an escape that spells an ASCII
 * character in its host (validateBrandingAssetURL in
 * internal/domain/branding_validator.go). The checks here are the same or a
 * little stricter: a `%` is refused in the host altogether and malformed
 * escapes are refused in the query too, which the server accepts, since a
 * plan that is stricter than apply is harmless. The pattern's `maxLength`
 * counts characters while the server counts bytes, so a URL with non-ASCII
 * characters can be short in characters and still too long, and the spec has
 * no way to say bytes. Every one speaks only for a value the generated checks
 * accepted.
 *
 * @param field - The generated URL field.
 * @returns The field, refused at its own path.
 */
function holdUrl(field: z.ZodOptional<z.ZodString>): z.ZodOptional<z.ZodString> {
  return field
    .unwrap()
    .refine(
      (value) => {
        return !hasControlCharacter(value);
      },
      {
        message: "must not contain a control character, such as a tab or a newline",
        when: whenNothingElseIsWrong,
      },
    )
    .refine(
      (value) => {
        return !hasMalformedPercentEscape(value);
      },
      {
        message: "must not contain a % that is not followed by two hexadecimal digits",
        when: whenNothingElseIsWrong,
      },
    )
    .refine(
      (value) => {
        return !hasPercentInHost(value);
      },
      {
        message: "must not contain a percent-escape in its host",
        when: whenNothingElseIsWrong,
      },
    )
    .refine(
      (value) => {
        return new TextEncoder().encode(value).length <= MAX_BRANDING_URL_BYTES;
      },
      {
        message: `must be at most ${MAX_BRANDING_URL_BYTES} bytes`,
        when: whenNothingElseIsWrong,
      },
    )
    .optional();
}

/**
 * One theme side, with its logo held to the server's URL limits and its
 * colours to the colour functions the server allows.
 *
 * @param side - The generated light or dark side.
 * @returns The side.
 */
function brandingThemeSide(
  side: typeof BRANDING_THEME.shape.light,
): typeof BRANDING_THEME.shape.light {
  return side
    .unwrap()
    .extend({
      logo_url: holdUrl(side.unwrap().shape.logo_url),
      palette: withAllowedColours(side.unwrap().shape.palette),
    })
    .optional();
}

/**
 * Hold every palette colour to the colour functions the server allows.
 *
 * @remarks
 * The spec's pattern is deliberately a superset of the server's allowlist: it
 * pins the shape of a value, so it cannot leave its CSS declaration, and the
 * domain decides which functions are colours (`ValidateBrandingColor`; see
 * `branding_pattern_internal_test.go`). A value of the right shape that is not
 * one, such as `var(--brand)`, reaches the server and comes back refused, so
 * `plan` refuses it too. It speaks only for a value the generated checks
 * accepted, so a value is refused once.
 *
 * @param palette - The generated palette of a theme side.
 * @returns The palette, each colour refused at its own path.
 */
function withAllowedColours(palette: typeof BRANDING_PALETTE): typeof BRANDING_PALETTE {
  const shape = palette.unwrap().shape;
  const checked = Object.fromEntries(
    Object.entries(shape).map(([key, colour]) => {
      return [
        key,
        colour
          .unwrap()
          .refine(isBrandingColor, {
            message:
              "must be hex (#4F46E5), a CSS colour name, or one of the colour functions rgb(), rgba(), hsl(), hsla(), hwb(), lab(), lch(), oklab(), oklch(), color() or color-mix()",
            when: whenNothingElseIsWrong,
          })
          .optional(),
      ];
    }),
  ) as typeof shape;
  return palette.unwrap().extend(checked).optional();
}

/**
 * The local `.zitadel/branding/*.json` dialect: the wire shape, where
 * `liquid_template` may also be a `$file` reference to the sibling `.liquid`
 * template (the meta-schema `branding.json` mirrors this).
 *
 * @remarks
 * The values the server gates are held to the spec's own patterns, which carry
 * their messages (`x-zitadel-pattern-message`), so a refusal names its field
 * and says what a valid value looks like. What the spec cannot say is checked
 * at the field it is about: a URL's control characters and byte limit, the
 * colour functions the server allows, and the pair of a stylesheet and its
 * font stack, which the server rejects as a pair (validateBrandingFontURL), or
 * apply fails after schemas and flows have already been written.
 */
export const brandingConfigSchema = z.strictObject({
  // Strict, unlike the generated wire schema: a typo like `hero_urll`
  // must fail plan, not silently pass and get ignored by the server. The
  // editor meta-schema already rejects unknown keys; the CLI gate has to
  // agree.
  ...CreateBrandingBody.shape,
  logo_url: holdUrl(CreateBrandingBody.shape.logo_url),
  hero_url: holdUrl(CreateBrandingBody.shape.hero_url),
  theme: BRANDING_THEME.extend({
    light: brandingThemeSide(BRANDING_THEME.shape.light),
    dark: brandingThemeSide(BRANDING_THEME.shape.dark),
  }).optional(),
  typography: CreateBrandingBody.shape.typography
    .unwrap()
    .extend({
      // The spec's pattern allows a comma inside a quoted name, but the server
      // splits the stack on every comma (ValidateBrandingFontFamily), so
      // `"Acme, Inc", sans-serif` reaches it and comes back refused.
      font_family: CreateBrandingBody.shape.typography
        .unwrap()
        .shape.font_family.unwrap()
        .refine(isBrandingFontFamily, {
          message:
            'must be comma-separated font names, each an identifier (Inter, ui-sans-serif) or a quoted name ("APK Futural") with no comma inside the quotes',
          when: whenNothingElseIsWrong,
        })
        .optional(),
      font_url: holdUrl(CreateBrandingBody.shape.typography.unwrap().shape.font_url),
    })
    .refine(
      (value) => {
        return (
          value.font_url === undefined || value.font_url === "" || value.font_family !== undefined
        );
      },
      {
        message:
          "needs a typography.font_family to load; a stylesheet alone names no face to render in",
        path: ["font_url"],
        // A mistake of type in another typography field must not hide it.
        when: () => true,
      },
    )
    .optional(),
  $schema: z.string().optional(),
  liquid_template: z
    .union([CreateBrandingBody.shape.liquid_template.unwrap(), localFileReferenceSchema])
    .optional(),
});
