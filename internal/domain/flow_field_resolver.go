package domain

import (
	"errors"
	"strings"

	"github.com/ianlancetaylor/jsonschema"
)

//go:generate go tool mockgen -typed -package domainmock -destination ./mock/flow_field_resolver.mock.go . FlowFieldResolver

// FlowFieldResolver maps property names referenced by a flow step to
// fully-resolved [FlowField] payloads, surfaces the implicit transition
// outcomes the schema implies (a property with `x-unique` set implies a
// `user_not_found` outcome), and validates submitted values against the
// schema-derived rules.
//
// The contract is shaped to the user meta-schema at
// api/openapi/endpoints/schemas/user-schema.yaml.
type FlowFieldResolver interface {
	// Resolve returns the per-field metadata for fields against the
	// provided user schema. stepName is the flow step the fields are
	// being resolved for; it prefixes each field's text_key
	// (`<stepName>.field.<name>`). Schema loading is the caller's
	// responsibility — see [SchemaResolver].
	Resolve(schema *jsonschema.Schema, stepName string, fields []Field) (FlowResolvedFields, error)

	// Validate checks submitted values against the rules carried by a
	// previously resolved field set.
	Validate(fields FlowResolvedFields, values map[string]any) error

	// MissingRequired reports the required fields absent from values.
	// Applied only on field-collecting actions (the submit action and the
	// passkey-register issue leg); other actions legitimately submit a
	// subset of fields or none.
	MissingRequired(fields FlowResolvedFields, values map[string]any) FlowFieldValidationErrors
}

// FlowResolvedFields is the output of [FlowFieldResolver.Resolve].
type FlowResolvedFields struct {
	// Fields holds the resolved per-field metadata in the same order as
	// the property names passed to Resolve.
	Fields []FlowField

	// ImplicitOutcomes lists the reserved transition outcomes each
	// field contributes, keyed by field name. The state machine uses it
	// to validate flow definitions and route schema-derived transitions.
	ImplicitOutcomes map[string][]string
}

// FlowField is the resolved per-field metadata.
type FlowField struct {
	// Name is the user-schema property name this field collects.
	Name string

	// Type is the UI input kind the client should render. It is
	// derived from the property's JSON `type` and `format` in the user
	// meta-schema. The reserved `x-auth-methods#<method>` field name
	// forces the input kind matching that credential method
	// (e.g. `x-auth-methods#password` → password).
	Type FlowFieldType

	// TextKey is a localization key for the field label (e.g.
	// `field.email`). Resolved client-side via the `| t` filter.
	TextKey string

	// Required reflects membership in the schema's top-level `required` array.
	Required bool

	// Value is an optional pre-fill (e.g. an identifier carried over
	// from a pivot). Nil when no pre-fill applies.
	Value *string

	// Validation carries the schema-derived validation rules. Nil when
	// the property has no rules beyond its JSON type.
	Validation *FlowFieldValidation

	// Unique mirrors the property's `x-unique` annotation: the scope at
	// which the value must be unique, or [AttributeUniquenessUnspecified]
	// when absent. The user-creation path consults it to set the
	// per-attribute uniqueness scope on storage.
	Unique AttributeUniqueness

	// Challenge names the auth-attempt challenge the field maps to, or
	// [FlowFieldChallengeNone] when the field carries neither an
	// identifier nor a credential proof. Derivation paths: a non-empty
	// `x-unique` annotation on the property surfaces as
	// [FlowFieldChallengeIdentifier] (any uniquely-keyed property can
	// identify a user); the reserved `x-auth-methods#password` field
	// name combined with `x-auth-methods.password.enabled = true` at
	// the schema root surfaces as [FlowFieldChallengePassword]. Other
	// credential kinds (passkey, magic_link, sso, otp) do not have
	// field-shaped proofs and are produced by the state machine as
	// challenge steps, not by the resolver. The state machine consults
	// Challenge on submit to route the value — identifier fields drive
	// identifier resolution (and the `user_not_found` implicit outcome),
	// password fields drive the password challenge.
	Challenge FlowFieldChallenge
}

// FlowFieldChallenge names the auth-attempt challenge a field maps
// to. Values mirror the keys of `x-auth-methods` in the user
// meta-schema (api/openapi/endpoints/schemas/user-schema.yaml).
// `identifier` is sourced from a non-empty `x-unique` scope on the
// property; `password` is sourced from the reserved
// `x-auth-methods#password` field name combined with
// `x-auth-methods.password.enabled` at the schema root. The remaining
// credential values (passkey, magic_link, sso, otp) have no
// field-shaped proof and are produced by the state machine as
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

// FlowFieldValidation carries the validation rules the resolver
// surfaces to the client and enforces on submit. Each field maps to a
// user meta-schema keyword on [user-property.yaml]:
//
//   - Format    ↔ `format` (enum: email, date-time, uuid, uri)
//   - MinLength ↔ `minLength`
//   - MaxLength ↔ `maxLength`
//   - Enum      ↔ `enum` (closed set of allowed string values)
//   - Const     ↔ `const` (property pinned to a fixed value)
//
// Zero values mean "no rule". JSON Schema's `pattern` keyword is not
// part of the user meta-schema and is intentionally not surfaced.
type FlowFieldValidation struct {
	Format    string
	MinLength int
	MaxLength int
	Enum      []string

	// Const, when non-nil, pins the property to a fixed value (JSON
	// Schema `const`) of any type — e.g. a must-accept checkbox uses
	// `const: true`. A differing submission is reported as
	// [FlowFieldValidationRuleFormat].
	Const any
}

// FlowFieldType names the input kind the client should render. Mirrors
// the `type` enum in the OpenAPI flow-field component.
type FlowFieldType string

const (
	// FlowFieldTypeUnknown is a reserved field type that is only used in case of errors
	FlowFieldTypeUnknown  FlowFieldType = "unknown"
	FlowFieldTypeText     FlowFieldType = "text"
	FlowFieldTypeEmail    FlowFieldType = "email"
	FlowFieldTypePassword FlowFieldType = "password"
	FlowFieldTypeTel      FlowFieldType = "tel"
	FlowFieldTypeNumber   FlowFieldType = "number"
	FlowFieldTypeURL      FlowFieldType = "url"
	FlowFieldTypeDate     FlowFieldType = "date"
	FlowFieldTypeHidden   FlowFieldType = "hidden"
	FlowFieldTypeCheckbox FlowFieldType = "checkbox"
	FlowFieldTypeSelect   FlowFieldType = "select"
)

// FlowFieldValidationRule names a schema-derived validation rule the
// resolver enforces. Each rule doubles as the key suffix of the wire
// dialect (see [FlowFieldValidationError.TextKey]), so a new rule also
// needs a generic `error.field_<rule>` catalog entry and a suffix
// mapping in the client's `localiseFlowErrorKeys`
// (packages/components/src/orchestrator/liquid.ts).
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

// TextKey returns the client-facing localisation key for the violation:
// `error.<field>_<rule>`, with the format rule aliased to `_invalid` —
// the text catalog's existing spelling (`error.email_invalid`). Field
// names are used verbatim, credential shape included
// (`error.x-auth-methods#password_required`): tenant schemas keep field
// naming open, so clients resolve unknown keys through generic
// `error.field_<rule>` fallbacks instead of a closed catalog — see
// `localiseFlowErrorKeys` in
// packages/components/src/orchestrator/liquid.ts.
func (e FlowFieldValidationError) TextKey() string {
	suffix := string(e.Rule)
	if e.Rule == FlowFieldValidationRuleFormat {
		suffix = "invalid"
	}
	return "error." + e.Field + "_" + suffix
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

// StepError renders the violations for the wire `step.error` field: one
// [FlowFieldValidationError.TextKey] per violation, joined with "; ".
// Clients split on the joiner and localise each key. Error() stays the
// Go-side diagnostic ("flow field email: required") for logs and
// wrapped errors.
func (e FlowFieldValidationErrors) StepError() string {
	parts := make([]string, len(e))
	for i, err := range e {
		parts[i] = err.TextKey()
	}
	return strings.Join(parts, "; ")
}

// FlowImplicitOutcomeUserNotFound drives the login → register flip.
const FlowImplicitOutcomeUserNotFound = "user_not_found"

// FlowImplicitOutcomeUserAlreadyExists drives the register → login flip.
const FlowImplicitOutcomeUserAlreadyExists = "user_already_exists"

// implicitOutcomesByChallenge lists the transition outcomes a field
// contributes by virtue of its [FlowFieldChallenge]. New mappings
// (e.g. a future challenge that also implies an outcome) land here as
// additional entries.
var implicitOutcomesByChallenge = map[FlowFieldChallenge][]string{
	FlowFieldChallengeIdentifier: {FlowImplicitOutcomeUserNotFound, FlowImplicitOutcomeUserAlreadyExists},
}

// ImplicitOutcomesForChallenge returns the transition outcomes a field
// contributes by virtue of its challenge. Returns nil when the
// challenge implies no outcomes. Resolvers call it to populate
// [FlowResolvedFields.ImplicitOutcomes]; the state machine calls it to
// validate flow definitions against schema-implied outcomes.
func ImplicitOutcomesForChallenge(c FlowFieldChallenge) []string {
	return implicitOutcomesByChallenge[c]
}

// ErrFlowFieldUnknown is returned by [FlowFieldResolver.Resolve] when a
// requested field name is not a property in the user schema. The
// offending field name is appended via `fmt.Errorf("%w: %q", ...)`.
var ErrFlowFieldUnknown = errors.New("flow field: not a property in the user schema")

// ErrFlowFieldUnsupportedType is returned by [FlowFieldResolver.Resolve]
// when a property declares a JSON `type` set the resolver cannot
// reduce to a single input kind. The nullable idiom `["null", X]` is
// reduced to X and does not trigger this error; any other multi-entry
// union does.
var ErrFlowFieldUnsupportedType = errors.New("flow field: unsupported JSON type")
