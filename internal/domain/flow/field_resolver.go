package flow

import "context"

// FieldResolver maps the field names declared on a step to fully-resolved
// runtime [Field] payloads, exposes schema-derived implicit transition
// outcomes, and validates submitted values against the user schema.
//
// Resolution is a pure function of (schemaURL, schemaETag, fieldNames).
// Implementations should cache aggressively and invalidate on schema
// publish.
type FieldResolver interface {
	// Resolve returns the runtime view of the requested fields plus the
	// implicit outcomes contributed by each field's schema extensions
	// (for example, an x-identifier field contributes "user_not_found").
	Resolve(ctx context.Context, userSchemaURL string, fieldNames []string) (Resolved, error)

	// Validate checks submitted values against the user schema. The
	// state machine calls it once per [StateMachine.Process].
	Validate(ctx context.Context, userSchemaURL string, values map[string]any) error
}

// Resolved is the output of [FieldResolver.Resolve].
type Resolved struct {
	// Fields is the runtime view keyed by field name.
	Fields map[string]Field

	// ImplicitOutcomes maps a field name to the reserved transition
	// outcomes its schema extensions contribute (for example,
	// {"email": ["user_not_found"]}).
	ImplicitOutcomes map[string][]string

	// Behaviors is a convenience projection of the schema extensions
	// the state machine needs without re-walking [Fields].
	Behaviors map[string]FieldBehavior
}
