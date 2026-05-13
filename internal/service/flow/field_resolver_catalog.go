package flow

import (
	"context"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
)

// CatalogFieldResolver is the MVP stub of [domain.FlowFieldResolver].
// It is backed by an in-package catalog covering the fields the default
// flows use (email, username, password, given_name, family_name). Each
// entry carries the same shape a schema-driven resolver eventually will
// — type, validation rules, x-identifier / x-credential / x-unique —
// so call sites in the state machine don't move when the schema-backed
// implementation replaces it.
//
// The `userSchemaURL` argument on both methods is accepted for forward
// compatibility and ignored.
type CatalogFieldResolver struct {
	catalog map[string]catalogEntry
}

// NewCatalogFieldResolver returns a [domain.FlowFieldResolver] backed
// by the default in-package catalog.
func NewCatalogFieldResolver() *CatalogFieldResolver {
	return &CatalogFieldResolver{catalog: defaultCatalog}
}

var _ domain.FlowFieldResolver = (*CatalogFieldResolver)(nil)

// catalogEntry is the per-field shape the stub catalog stores. It
// mirrors the slice of the user schema a real resolver would read:
// type, validation rules, and x-* annotations.
type catalogEntry struct {
	Type       domain.FlowFieldType
	TextKey    string
	Required   bool
	Validation *domain.FlowFieldValidation
	Behavior   domain.FlowFieldBehavior
}

var defaultCatalog = map[string]catalogEntry{
	"email": {
		Type:       domain.FlowFieldTypeEmail,
		TextKey:    "field.email",
		Required:   true,
		Validation: &domain.FlowFieldValidation{Format: "email", MaxLength: 320},
		Behavior:   domain.FlowFieldBehavior{IsIdentifier: true, Unique: true},
	},
	"username": {
		Type:       domain.FlowFieldTypeText,
		TextKey:    "field.username",
		Required:   true,
		Validation: &domain.FlowFieldValidation{MinLength: 3, MaxLength: 64},
		Behavior:   domain.FlowFieldBehavior{IsIdentifier: true, Unique: true},
	},
	"password": {
		Type:       domain.FlowFieldTypePassword,
		TextKey:    "field.password",
		Required:   true,
		Validation: &domain.FlowFieldValidation{MinLength: 8},
		Behavior:   domain.FlowFieldBehavior{Credential: "password"},
	},
	"given_name": {
		Type:       domain.FlowFieldTypeText,
		TextKey:    "field.given_name",
		Required:   true,
		Validation: &domain.FlowFieldValidation{MinLength: 1, MaxLength: 200},
	},
	"family_name": {
		Type:       domain.FlowFieldTypeText,
		TextKey:    "field.family_name",
		Required:   true,
		Validation: &domain.FlowFieldValidation{MinLength: 1, MaxLength: 200},
	},
}

func (r *CatalogFieldResolver) Resolve(_ context.Context, _ string, fieldNames []string) (domain.FlowResolvedFields, error) {
	fields := make(map[string]domain.FlowField, len(fieldNames))
	behaviors := make(map[string]domain.FlowFieldBehavior, len(fieldNames))
	implicit := make(map[string][]string)

	for _, name := range fieldNames {
		entry, ok := r.catalog[name]
		if !ok {
			return domain.FlowResolvedFields{}, fmt.Errorf("%w: %q", domain.ErrFlowFieldUnknown, name)
		}
		fields[name] = domain.FlowField{
			Type:       entry.Type,
			TextKey:    entry.TextKey,
			Required:   entry.Required,
			Validation: cloneValidation(entry.Validation),
		}
		behaviors[name] = entry.Behavior
		if entry.Behavior.IsIdentifier {
			implicit[name] = append(implicit[name], domain.FlowImplicitOutcomeUserNotFound)
		}
	}

	return domain.FlowResolvedFields{
		Fields:           fields,
		Behaviors:        behaviors,
		ImplicitOutcomes: implicit,
	}, nil
}

// Validate walks the submitted values, applies the per-field validation
// rules from the catalog, and returns a [domain.FlowFieldValidationErrors]
// error when one or more rules fail. Submitted-but-empty values for
// required fields surface as [domain.FlowFieldValidationRuleRequired];
// detecting fields the step expected but the client omitted entirely is
// the caller's job, since the catalog has no notion of "which fields
// this step declared".
func (r *CatalogFieldResolver) Validate(_ context.Context, _ string, values map[string]any) error {
	var errs domain.FlowFieldValidationErrors

	for name, value := range values {
		entry, ok := r.catalog[name]
		if !ok {
			errs = append(errs, domain.FlowFieldValidationError{Field: name, Rule: domain.FlowFieldValidationRuleUnknown})
			continue
		}
		str, isString := value.(string)
		if !isString {
			errs = append(errs, domain.FlowFieldValidationError{Field: name, Rule: domain.FlowFieldValidationRuleFormat})
			continue
		}
		if entry.Required && str == "" {
			errs = append(errs, domain.FlowFieldValidationError{Field: name, Rule: domain.FlowFieldValidationRuleRequired})
			continue
		}
		if str == "" {
			continue
		}
		errs = append(errs, validateValue(name, str, entry.Validation)...)
	}

	if len(errs) > 0 {
		return errs
	}
	return nil
}

func validateValue(name, value string, v *domain.FlowFieldValidation) []domain.FlowFieldValidationError {
	if v == nil {
		return nil
	}
	var out []domain.FlowFieldValidationError
	if v.MinLength > 0 && len(value) < v.MinLength {
		out = append(out, domain.FlowFieldValidationError{Field: name, Rule: domain.FlowFieldValidationRuleMinLength})
	}
	if v.MaxLength > 0 && len(value) > v.MaxLength {
		out = append(out, domain.FlowFieldValidationError{Field: name, Rule: domain.FlowFieldValidationRuleMaxLength})
	}
	if v.Format == "email" && !looksLikeEmail(value) {
		out = append(out, domain.FlowFieldValidationError{Field: name, Rule: domain.FlowFieldValidationRuleFormat})
	}
	return out
}

// looksLikeEmail is a deliberately minimal check for the MVP stub: a
// single '@' with non-empty local and domain parts. The schema-driven
// resolver will replace this with the user-schema library's `format:
// email` rule.
func looksLikeEmail(s string) bool {
	at := strings.IndexByte(s, '@')
	if at <= 0 || at == len(s)-1 {
		return false
	}
	return strings.IndexByte(s[at+1:], '@') < 0
}

func cloneValidation(v *domain.FlowFieldValidation) *domain.FlowFieldValidation {
	if v == nil {
		return nil
	}
	out := *v
	return &out
}
