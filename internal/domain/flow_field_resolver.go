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
// MVP ships an in-package catalog implementation backed by a small,
// hardcoded set of fields. A schema-driven implementation lands behind
// the same interface once the user-schema library is established —
// callers do not move.
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
// carries the per-render field payloads (Fields), the implicit
// transition outcomes the resolver derived from schema annotations
// (ImplicitOutcomes), and the boolean traits the state machine uses to
// route credential / identifier handling (Behaviors).
type FlowResolvedFields struct {
	// Fields is the per-render shape emitted under step.fields[name].
	// Keys match the property names passed to Resolve.
	Fields map[string]FlowField

	// ImplicitOutcomes lists the reserved transition outcomes each
	// field contributes. The state machine uses it to validate flow
	// definitions and route schema-derived transitions.
	ImplicitOutcomes map[string][]string

	// Behaviors carries the resolver-derived traits for each field. The
	// state machine consults it to know which field is the identifier,
	// which one is a credential (and of what kind), and which ones
	// require uniqueness checks on submit.
	Behaviors map[string]FlowFieldBehavior
}

// FlowFieldBehavior carries the resolver-derived traits for a field.
// Values are derived from schema annotations (`x-identifier`,
// `x-credential`, `x-unique`).
type FlowFieldBehavior struct {
	// IsIdentifier reports whether the field is the user identifier
	// (`x-identifier`). The state machine uses it to drive identifier
	// resolution and the `user_not_found` implicit outcome.
	IsIdentifier bool

	// Credential names the credential kind the field carries when
	// non-empty (e.g. "password"). Empty for non-credential fields.
	Credential string

	// Unique reports whether the field's value must be unique within
	// its schema scope (`x-unique`).
	Unique bool
}

// FlowField is the per-render shape emitted under step.fields[name] in
// a flow step response. It mirrors the OpenAPI flow-field component.
type FlowField struct {
	Type       FlowFieldType
	TextKey    string
	Required   bool
	Value      *string
	Validation *FlowFieldValidation
}

// FlowFieldValidation carries the validation rules the resolver
// surfaces to the client and enforces on submit. Zero values mean "no
// rule".
type FlowFieldValidation struct {
	Format    string
	Pattern   string
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
	FlowFieldValidationRulePattern   FlowFieldValidationRule = "pattern"
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
