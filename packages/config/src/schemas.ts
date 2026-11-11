import {
  PublishBrandingBody,
  PublishFlowDefinitionBody,
  PublishIdpBody,
  PublishSchemaBody,
  EvaluatePolicyBody,
  PublishPolicyBody,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { distance } from "fastest-levenshtein";
import { z } from "zod";

import defaultPasswordPolicy from "../defaults/default-password-policy.json" with { type: "json" };
import defaultUserCreatePolicy from "../defaults/default-user-create-policy.json" with {
  type: "json",
};
import { isBrandingColor, isBrandingFontFamily, MAX_BRANDING_URL_BYTES } from "./branding-css.js";

const [userSchemaBody, schemaUrlBody] = PublishSchemaBody.options;
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

export const flowConfigSchema = PublishFlowDefinitionBody.shape.flow_definition;
export const createFlowDefinitionRequestSchema = PublishFlowDefinitionBody;

/**
 * One `.zitadel/idps/<slug>.json` body: the connection document `POST /idps`
 * carries under `idp`. The generated Zod enforces the contract the meta-schema
 * states, including that `client_secret` is a `${{ NAME }}` reference and
 * never a literal.
 */
export const idpConnectionConfigSchema = PublishIdpBody.shape.idp;

// The generated publish body's branches, in the spec's order.
const [passwordSetPolicyBody, userCreatePolicyBody] = PublishPolicyBody.options;

/** A `.zitadel/policies/auth.factor.password.set.json` file, the password policy. */
export const passwordSetPolicyFileSchema = z.strictObject({
  $schema: z.string().optional(),
  operation: passwordSetPolicyBody.shape.operation,
  config: z.strictObject(passwordSetPolicyBody.shape.config.shape),
});

/** A `.zitadel/policies/user.create.json` file, the sign-up policy. */
export const userCreatePolicyFileSchema = z.strictObject({
  $schema: z.string().optional(),
  operation: userCreatePolicyBody.shape.operation,
  config: z.strictObject(userCreatePolicyBody.shape.config.shape),
});

/**
 * A `.zitadel/policies/<operation>.json` file: the publish body
 * (`POST /policies`) plus `$schema`, one branch per operation. Strict at both
 * levels, unlike the generated body: a typo in a setting must fail
 * `deploy --dry-run`, as the editor's meta-schema (`policy.json`) already
 * flags it. An operation the spec adds is a branch here too, or this stops
 * matching `PublishPolicyBody` and the policy tests fail.
 */
export const policyConfigSchema = z.discriminatedUnion("operation", [
  passwordSetPolicyFileSchema,
  userCreatePolicyFileSchema,
]);

/**
 * The minimum password length NIST SP 800-63B-4 sets for a password that is
 * the only factor. `setup` recommends it and writes it when given none.
 */
export const RECOMMENDED_PASSWORD_MIN_LENGTH: number = defaultPasswordPolicy.config.min_length;

/**
 * The sign-up protection every project starts with: the server's own guard,
 * a proof of work on every password or passkey sign-up, written down as the
 * `user.create` policy (ADR 088 §5). `setup` writes it and the platform
 * project deploys it; a server test keeps it equal to the guard, so deleting
 * it loosens nothing.
 */
export const DEFAULT_USER_CREATE_POLICY = userCreatePolicyFileSchema.parse(defaultUserCreatePolicy);

/** The decision a policy test case expects. */
const policyTestExpectSchema = z
  .strictObject({
    allowed: z.boolean(),
    code: z.string().min(1).optional(),
    violations: z.array(z.string().min(1)).optional(),
  })
  // Only a refusal carries a code or violations, so an allowed case that
  // names one could never pass.
  .refine(
    (expect) => !expect.allowed || (expect.code === undefined && expect.violations === undefined),
    "an allowed case names no code or violations",
  );

const [passwordSetEvaluateBody, userCreateEvaluateBody] = EvaluatePolicyBody.options;

/**
 * A `.zitadel/policies/<operation>.test.json` file: cases `zitadel policies
 * test` evaluates (`POST /policies/evaluate`), each with the operation's
 * input, the facts it would look up where it has any, and the decision it
 * expects, one branch per operation. `input` and `facts` come from the
 * generated evaluate body, strict like the policy file, so the editor's
 * `policy-test.json` and this check refuse the same typos.
 */
export const policyTestFileSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    $schema: z.string().optional(),
    operation: passwordSetEvaluateBody.shape.operation,
    cases: z
      .array(
        z.strictObject({
          name: z.string().min(1),
          input: z.strictObject(passwordSetEvaluateBody.shape.input.shape),
          facts: z.strictObject(passwordSetEvaluateBody.shape.facts.unwrap().shape).optional(),
          expect: policyTestExpectSchema,
        }),
      )
      .min(1),
  }),
  z.strictObject({
    $schema: z.string().optional(),
    operation: userCreateEvaluateBody.shape.operation,
    cases: z
      .array(
        z.strictObject({
          name: z.string().min(1),
          input: z.strictObject(userCreateEvaluateBody.shape.input.shape),
          expect: policyTestExpectSchema,
        }),
      )
      .min(1),
  }),
]);

/** The wire shape of a branding revision (`POST /branding` request body). */
export const brandingWireSchema = PublishBrandingBody;

/**
 * `{ "$file": "<path>" }`, which a `.zitadel/` file may hold in place of a
 * string field the OpenAPI YAML marks `x-local: file`. The path is relative to
 * the file holding it; the CLI inlines the content before publishing.
 */
export const localFileReferenceSchema = z.strictObject({ $file: z.string().min(1) });

const BRANDING_THEME = PublishBrandingBody.shape.theme.unwrap();
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
 * Hold a URL field to the server's byte limit.
 *
 * @remarks
 * The spec's `maxLength` counts characters while the server counts bytes, so a
 * URL with non-ASCII characters can be short in characters and still too long,
 * and the spec has no way to say bytes. It speaks only for a value the
 * generated checks accepted, so a value is refused once.
 *
 * @param field - The generated URL field.
 * @returns The field, refused at its own path above the limit.
 */
function withinUrlBytes(field: z.ZodOptional<z.ZodString>): z.ZodOptional<z.ZodString> {
  return field
    .unwrap()
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
 * One theme side, with its logo held to the server's byte limit and its
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
      logo_url: withinUrlBytes(side.unwrap().shape.logo_url),
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
      if (!(colour instanceof z.ZodOptional)) {
        return [key, colour];
      }
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
 * at the field it is about: a URL's byte limit, the
 * colour functions the server allows, and the pair of a stylesheet and its
 * font stack, which the server rejects as a pair (validateBrandingFontURL), or
 * apply fails after schemas and flows have already been written.
 */
export const brandingConfigSchema = z.strictObject({
  // Strict, unlike the generated wire schema: a typo like `hero_urll`
  // must fail plan, not silently pass and get ignored by the server. The
  // editor meta-schema already rejects unknown keys; the CLI gate has to
  // agree.
  ...PublishBrandingBody.shape,
  logo_url: withinUrlBytes(PublishBrandingBody.shape.logo_url),
  hero_url: withinUrlBytes(PublishBrandingBody.shape.hero_url),
  theme: BRANDING_THEME.extend({
    light: brandingThemeSide(BRANDING_THEME.shape.light),
    dark: brandingThemeSide(BRANDING_THEME.shape.dark),
  }).optional(),
  typography: PublishBrandingBody.shape.typography
    .unwrap()
    .extend({
      // The spec's pattern allows a comma inside a quoted name, but the server
      // splits the stack on every comma (ValidateBrandingFontFamily), so
      // `"Acme, Inc", sans-serif` reaches it and comes back refused.
      font_family: PublishBrandingBody.shape.typography
        .unwrap()
        .shape.font_family.unwrap()
        .refine(isBrandingFontFamily, {
          message:
            'must be comma-separated font names, each an identifier (Inter, ui-sans-serif) or a quoted name ("APK Futural") with no comma inside the quotes',
          when: whenNothingElseIsWrong,
        })
        .optional(),
      font_url: withinUrlBytes(PublishBrandingBody.shape.typography.unwrap().shape.font_url),
    })
    .refine(
      (value) => {
        // `when: () => true` runs this even when the value is not an object,
        // such as `null`, which the object check has already refused.
        if (typeof value !== "object" || value === null) {
          return true;
        }
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
    .union([PublishBrandingBody.shape.liquid_template.unwrap(), localFileReferenceSchema])
    .optional(),
});
