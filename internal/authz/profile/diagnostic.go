package profile

import (
	"fmt"
	"strings"
)

// Code identifies a profile violation. Codes are stable so the schema upload
// API can render them inside details and clients can branch on them. They stay
// plain snake_case; the dotted authz.* prefix belongs on the outer
// [domain.Error] that wraps [Diagnostics] at the service boundary. Where
// OpenFGA already names the same condition (openfga/api ErrorCode), the code
// reuses that vocabulary.
type Code string

// Codes reused from OpenFGA's own ErrorCode enum (openfga/api,
// openfga/v1/errors_ignore.proto). These name conditions OpenFGA itself
// rejects, so a customer who knows OpenFGA meets the same word here.
const (
	// CodeUnsupportedSchemaVersion mirrors OpenFGA 2057: the model declares a
	// schema version we do not accept.
	CodeUnsupportedSchemaVersion Code = "unsupported_schema_version"
	// CodeTypeNotFound mirrors OpenFGA 2021: a restriction names a type the
	// model never defines.
	CodeTypeNotFound Code = "type_not_found"
	// CodeRelationNotFound mirrors OpenFGA 2022: a rewrite or restriction names
	// a relation the target type never defines.
	CodeRelationNotFound Code = "relation_not_found"
)

// Codes specific to Zitadel's profile. OpenFGA accepts every construct below;
// we reject it because it cannot be compiled into a bounded, portable query
// plan (ADR 032 §2). OpenFGA's nearest concept,
// authorization_model_resolution_too_complex (2002), is a runtime complexity
// signal rather than an upload-time rejection, so it is deliberately not
// reused.
const (
	// CodeUnsupportedOperator: an `and` or `but not` expression. The profile
	// starts with union only.
	CodeUnsupportedOperator Code = "unsupported_operator"
	// CodeUnsupportedRewrite: a relation whose definition the IR could not
	// classify — a parser or profile gap rather than an authoring mistake.
	CodeUnsupportedRewrite Code = "unsupported_rewrite"
	// CodeUnsupportedWildcard: a `[type:*]` restriction, which has no bounded
	// expansion in a list predicate.
	CodeUnsupportedWildcard Code = "unsupported_wildcard"
	// CodeUnsupportedCondition: a caveat definition or a `with <condition>`
	// restriction, which would need attribute evaluation off the indexed path.
	CodeUnsupportedCondition Code = "unsupported_condition"
	// CodeUnboundedRecursion: a relation that resolves back to itself, so its
	// closure cannot be precomputed at upload time.
	CodeUnboundedRecursion Code = "unbounded_recursion"
	// CodeUnboundedTupleToUserset: a `<relation> from <tupleset>` whose tupleset
	// is not a plain direct assignment onto a known hierarchy edge.
	CodeUnboundedTupleToUserset Code = "unbounded_tuple_to_userset"
	// CodeMissingTypeRestriction: a direct assignment with no `[...]` list.
	// Distinct from OpenFGA's empty_relation_definition (2023), which is about a
	// relation carrying no definition at all.
	CodeMissingTypeRestriction Code = "missing_type_restriction"
	// CodeEmptyRelationDefinition: a union (or nested union) with no assignable
	// leaves — present in the catalog but never satisfiable. Crafted JSON can
	// produce this; the DSL grammar cannot.
	CodeEmptyRelationDefinition Code = "empty_relation_definition"
)

// Diagnostic is a single profile violation. Type, Relation, and Condition are
// set when the violation can be attributed to one of them.
type Diagnostic struct {
	Code      Code
	Message   string
	Type      string
	Relation  string
	Condition string
}

func (d Diagnostic) Error() string {
	if subject := d.subject(); subject != "" {
		return fmt.Sprintf("%s: %s: %s", d.Code, subject, d.Message)
	}
	return fmt.Sprintf("%s: %s", d.Code, d.Message)
}

// subject renders the model coordinates a violation belongs to, preferring the
// most specific one available: type#relation, then type, then condition.
func (d Diagnostic) subject() string {
	switch {
	case d.Type != "" && d.Relation != "":
		return d.Type + "#" + d.Relation
	case d.Type != "":
		return d.Type
	default:
		return d.Condition
	}
}

// Diagnostics is the full set of violations found in one model. Validation
// collects every violation instead of failing on the first, so an upload
// reports all problems at once.
type Diagnostics []Diagnostic

func (d Diagnostics) Error() string {
	messages := make([]string, 0, len(d))
	for _, diagnostic := range d {
		messages = append(messages, diagnostic.Error())
	}
	return fmt.Sprintf("model violates the supported OpenFGA profile: %s", strings.Join(messages, "; "))
}

// Unwrap exposes the individual diagnostics to [errors.Is] and [errors.As].
// Diagnostic holds only comparable fields, so errors.Is matches a diagnostic by
// value — a caller can test for one exact violation without scanning the slice.
func (d Diagnostics) Unwrap() []error {
	errs := make([]error, 0, len(d))
	for _, diagnostic := range d {
		errs = append(errs, diagnostic)
	}
	return errs
}
