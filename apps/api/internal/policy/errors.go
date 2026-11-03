package policy

import (
	"errors"
	"slices"
	"strings"
)

var (
	// ErrUnknownOperation is returned for an operation the catalog does not
	// define.
	ErrUnknownOperation = errors.New("policy: unknown operation")
	// ErrInvalidInstance is returned when an instance does not fit its
	// template: an unknown setting, a value of the wrong type or outside the
	// bounds, or a failed config rule.
	ErrInvalidInstance = errors.New("policy: invalid instance")
	// ErrUnknownRule is returned when a caller names a rule the operation's
	// template does not have.
	ErrUnknownRule = errors.New("policy: unknown rule")
	// ErrUnbound is returned when a [Bound] was not made by [Engine.Bind].
	// Evaluating it fails rather than allowing everything.
	ErrUnbound = errors.New("policy: instance is not bound")
	// ErrContextMismatch is returned when the request context does not match
	// the template's context schema. Evaluation fails closed.
	ErrContextMismatch = errors.New("policy: request context does not match the schema")
)

// Violation is one way an instance does not fit its template: a setting that
// is unknown, of the wrong type or out of bounds, or a config rule that does
// not hold. [Engine.Bind] reports every violation at once; [Violations] reads
// them back.
type Violation struct {
	// Setting names the setting that failed; empty for a config rule.
	Setting string
	// ConfigRule names the config rule that does not hold; empty for a
	// setting.
	ConfigRule string
	// Settings are the settings a failed config rule reads, sorted.
	Settings []string
	// Reason says what is wrong, for the error message.
	Reason string
}

// invalidInstanceError carries every violation Bind found. It is
// [ErrInvalidInstance] to errors.Is.
type invalidInstanceError struct {
	violations []Violation
}

func (e *invalidInstanceError) Error() string {
	reasons := make([]string, 0, len(e.violations))
	for _, v := range e.violations {
		reasons = append(reasons, v.Reason)
	}
	return ErrInvalidInstance.Error() + ": " + strings.Join(reasons, "\n")
}

func (e *invalidInstanceError) Unwrap() error { return ErrInvalidInstance }

// Violations returns the violations err carries, in the order Bind found
// them: the settings by name, then the config rules in template order. It
// returns nil for an error that names none, such as a missing config or a
// wrong kind.
func Violations(err error) []Violation {
	var invalid *invalidInstanceError
	if !errors.As(err, &invalid) {
		return nil
	}
	out := make([]Violation, 0, len(invalid.violations))
	for _, v := range invalid.violations {
		v.Settings = slices.Clone(v.Settings)
		out = append(out, v)
	}
	return out
}
