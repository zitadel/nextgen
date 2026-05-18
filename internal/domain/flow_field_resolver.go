package domain

import (
	"context"
	"errors"
	"strings"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowFieldResolver maps property names referenced by a flow step to
// fully-resolved [FlowField] payloads, surfaces the implicit transition
// outcomes the schema implies (an `x-identifier` field implies a
// `user_not_found` outcome), and validates submitted values against the
// schema-derived rules.
//
// The contract is shaped to the user meta-schema at
// api/openapi/endpoints/schemas/user-schema.yaml — customers author
// schemas conforming to that meta-schema, and every trait the resolver
// surfaces on [FlowField] must be derivable from one of its keywords.
// The implementation loads the user schema via [JSONSchemaResolver],
// which handles caching, `$ref` resolution, and the optional built-in
// embedded schemas (the flow engine ships a default user schema this
// way).
type FlowFieldResolver interface {
	// Resolve returns the per-field metadata for fieldNames sourced
	// from the user schema at userSchemaURL.
	Resolve(ctx context.Context, client database.QueryExecutor, projectID, userSchemaURL string, fieldNames []string) (FlowResolvedFields, error)

	// Validate checks submitted values against the rules derived from
	// the user schema at userSchemaURL. Returns
	// [FlowFieldValidationErrors] (as error) when one or more rules
	// fail. The state machine surfaces it on the current step;
	// transport-level errors bubble up as plain errors.
	Validate(ctx context.Context, client database.QueryExecutor, projectID, userSchemaURL string, values map[string]any) error
}

// FlowResolvedFields is the output of [FlowFieldResolver.Resolve]. It
// carries the per-field payloads (Fields) and the implicit transition
// outcomes the resolver derived from schema annotations
// (ImplicitOutcomes).
type FlowResolvedFields struct {
	// Fields holds the resolved per-field metadata. Keys match the
	// property names passed to Resolve.
	Fields map[string]FlowField

	// ImplicitOutcomes lists the reserved transition outcomes each
	// field contributes. The state machine uses it to validate flow
	// definitions and route schema-derived transitions.
	ImplicitOutcomes map[string][]string
}

// FlowField is the resolved per-field metadata. It mixes:
//
//   - The render-time shape mirrored in the OpenAPI flow-field
//     component (Type, TextKey, Required, Value, Validation), which the
//     API layer maps to the response DTO.
//   - The server-side traits the state machine routes on (Challenge,
//     Unique). Unique comes directly from the property's `x-unique`
//     annotation in the user meta-schema
//     (api/openapi/endpoints/schemas/user-property.yaml). Challenge
//     unifies two routing signals onto one enum: `x-identifier`
//     produces [FlowFieldChallengeIdentifier], and the schema-level
//     `x-auth-methods` map cross-referenced with the property name
//     produces the matching credential kind.
//
// Annotations the meta-schema defines but the MVP state machine does
// not yet consume (`x-claim`, `x-editable`, `x-sensitive`, `x-mfa`,
// `x-verify`) are not surfaced here — they will be added as the
// consumers that need them land.
type FlowField struct {
	// Type is the UI input kind the client should render. It is
	// derived from the property's JSON `type` and `format` in the user
	// meta-schema. The property's `x-password: true` annotation forces
	// a password input regardless of `format`.
	Type FlowFieldType

	// TextKey is a localization key for the field label (e.g.
	// `field.email`). Resolved client-side via the `| t` filter.
	TextKey string

	// Required reflects membership in the schema's top-level `required`
	// array.
	Required bool

	// Value is an optional pre-fill (e.g. an identifier carried over
	// from a pivot). Nil when no pre-fill applies.
	Value *string

	// Validation carries the schema-derived validation rules. Nil when
	// the property has no rules beyond its JSON type.
	Validation *FlowFieldValidation

	// Unique reflects `x-unique` on the property: the scope at which
	// the value must be unique, or [FlowFieldUniqueScopeNone] when the
	// annotation is absent.
	Unique FlowFieldUniqueScope

	// Challenge names the auth-attempt challenge the field maps to, or
	// [FlowFieldChallengeNone] when the field carries neither an
	// identifier nor a credential proof. Derivation paths:
	// `x-identifier: true` on the property surfaces as
	// [FlowFieldChallengeIdentifier]; `x-password: true` on the
	// property combined with `x-auth-methods.password.enabled = true`
	// at the schema root surfaces as [FlowFieldChallengePassword].
	// Other credential kinds (passkey, magic_link, sso, otp) do not
	// have user-property-shaped proofs and are produced by the state
	// machine as challenge steps, not by the resolver. The state
	// machine consults Challenge on submit to route the value —
	// identifier fields drive identifier resolution (and the
	// `user_not_found` implicit outcome), password fields drive the
	// password challenge.
	Challenge FlowFieldChallenge
}

// FlowFieldChallenge names the auth-attempt challenge a field maps
// to. Values mirror the keys of `x-auth-methods` in the user
// meta-schema (api/openapi/endpoints/schemas/user-schema.yaml).
// `identifier` is sourced from `x-identifier` on the property;
// `password` is sourced from `x-password` on the property combined
// with `x-auth-methods.password.enabled` at the schema root. The
// remaining credential values (passkey, magic_link, sso, otp) have no
// user-property-shaped proof and are produced by the state machine as
// challenge steps rather than by the resolver. Empty means the field
// maps to no challenge.
type FlowFieldChallenge string

const (
	FlowFieldChallengeNone       FlowFieldChallenge = ""
	FlowFieldChallengeIdentifier FlowFieldChallenge = "identifier"
	FlowFieldChallengePassword   FlowFieldChallenge = "password"
	FlowFieldChallengePasskey    FlowFieldChallenge = "passkey"
	FlowFieldChallengeMagicLink  FlowFieldChallenge = "magic_link"
	FlowFieldChallengeSSO        FlowFieldChallenge = "sso"
	FlowFieldChallengeOTP        FlowFieldChallenge = "otp"
)

// FlowFieldUniqueScope mirrors the `x-unique` enum in the user
// meta-schema (api/openapi/endpoints/schemas/user-property.yaml).
type FlowFieldUniqueScope string

const (
	// FlowFieldUniqueScopeNone means the property has no `x-unique`
	// annotation; no uniqueness check is enforced.
	FlowFieldUniqueScopeNone FlowFieldUniqueScope = ""

	// FlowFieldUniqueScopeInstance enforces uniqueness across the
	// entire deployment.
	FlowFieldUniqueScopeInstance FlowFieldUniqueScope = "instance"

	// FlowFieldUniqueScopeOrganization enforces uniqueness within the
	// owning organization.
	FlowFieldUniqueScopeOrganization FlowFieldUniqueScope = "organization"
)

// FlowFieldValidation carries the validation rules the resolver
// surfaces to the client and enforces on submit. Each field maps to a
// user meta-schema keyword on [user-property.yaml]:
//
//   - Format    ↔ `format` (enum: email, date-time, uuid, uri)
//   - MinLength ↔ `minLength`
//   - MaxLength ↔ `maxLength`
//
// Zero values mean "no rule". JSON Schema's `pattern` keyword is not
// part of the user meta-schema and is intentionally not surfaced.
type FlowFieldValidation struct {
	Format    string
	MinLength int
	MaxLength int
}

// FlowFieldType names the input kind the client should render. Mirrors
// the `type` enum in the OpenAPI flow-field component.
type FlowFieldType string

const (
	FlowFieldTypeText     FlowFieldType = "text"
	FlowFieldTypeEmail    FlowFieldType = "email"
	FlowFieldTypePassword FlowFieldType = "password"
	FlowFieldTypeTel      FlowFieldType = "tel"
	FlowFieldTypeNumber   FlowFieldType = "number"
	FlowFieldTypeURL      FlowFieldType = "url"
	FlowFieldTypeDate     FlowFieldType = "date"
	FlowFieldTypeHidden   FlowFieldType = "hidden"
)

// FlowFieldValidationRule names a schema-derived validation rule the
// resolver enforces.
type FlowFieldValidationRule string

const (
	FlowFieldValidationRuleRequired  FlowFieldValidationRule = "required"
	FlowFieldValidationRuleFormat    FlowFieldValidationRule = "format"
	FlowFieldValidationRuleMinLength FlowFieldValidationRule = "min_length"
	FlowFieldValidationRuleMaxLength FlowFieldValidationRule = "max_length"
	FlowFieldValidationRuleUnknown   FlowFieldValidationRule = "unknown_field"
)

// FlowFieldValidationError is a single rule violation reported by
// [FlowFieldResolver.Validate].
type FlowFieldValidationError struct {
	Field string
	Rule  FlowFieldValidationRule
}

func (e FlowFieldValidationError) Error() string {
	return "flow field " + e.Field + ": " + string(e.Rule)
}

// FlowFieldValidationErrors collects rule violations. Returned as
// `error` by [FlowFieldResolver.Validate].
type FlowFieldValidationErrors []FlowFieldValidationError

func (e FlowFieldValidationErrors) Error() string {
	parts := make([]string, len(e))
	for i, err := range e {
		parts[i] = err.Error()
	}
	return strings.Join(parts, "; ")
}

// FlowImplicitOutcomeUserNotFound is the implicit transition outcome
// the resolver surfaces for any [FlowFieldChallengeIdentifier] field.
const FlowImplicitOutcomeUserNotFound = "user_not_found"

// ErrFlowFieldUnknown is returned by [FlowFieldResolver.Resolve] when a
// requested field name is not part of the resolver's schema or catalog.
var ErrFlowFieldUnknown = errors.New("flow field: not in resolver catalog")
