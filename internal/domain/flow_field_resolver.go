package domain

import (
	"context"
	"errors"
	"strings"
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
// MVP ships an in-package catalog implementation; the schema-driven
// implementation lands behind the same interface once the user-schema
// library is established — callers do not move.
type FlowFieldResolver interface {
	// Resolve returns the per-field metadata for fieldNames. The
	// userSchemaURL is accepted for forward compatibility with the
	// schema-driven implementation; the stub catalog ignores it.
	Resolve(ctx context.Context, userSchemaURL string, fieldNames []string) (FlowResolvedFields, error)

	// Validate checks submitted values against the schema-derived rules.
	// Returns [FlowFieldValidationErrors] (as error) when one or more
	// rules fail. The state machine surfaces it on the current step;
	// transport-level errors bubble up as plain errors.
	Validate(ctx context.Context, userSchemaURL string, values map[string]any) error
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
//   - The server-side traits the state machine routes on (IsIdentifier,
//     Unique), derived from the user meta-schema's `x-*` annotations
//     (see api/openapi/endpoints/schemas/user-property.yaml).
//
// Annotations the meta-schema defines but the MVP state machine does
// not yet consume (`x-claim`, `x-editable`, `x-sensitive`, `x-mfa`,
// `x-verify`) are not surfaced here — they will be added as the
// consumers that need them land.
type FlowField struct {
	// Type is the UI input kind the client should render. It is
	// derived from the property's JSON `type` and `format` in the user
	// meta-schema, with the property name acting as a tiebreaker (e.g.
	// a property named `password` renders as a password input even
	// though the meta-schema only sees `type: string`).
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

	// IsIdentifier reflects `x-identifier` on the property. The state
	// machine uses it to drive identifier resolution and the
	// `user_not_found` implicit outcome.
	IsIdentifier bool

	// Unique reflects `x-unique` on the property: the scope at which
	// the value must be unique, or [FlowFieldUniqueScopeNone] when the
	// annotation is absent.
	Unique FlowFieldUniqueScope
}

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
// the resolver surfaces for any `x-identifier` field.
const FlowImplicitOutcomeUserNotFound = "user_not_found"

// ErrFlowFieldUnknown is returned by [FlowFieldResolver.Resolve] when a
// requested field name is not part of the resolver's schema or catalog.
var ErrFlowFieldUnknown = errors.New("flow field: not in resolver catalog")
