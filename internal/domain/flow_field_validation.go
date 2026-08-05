package domain

import (
	"cmp"
	"reflect"
	"slices"
	"strings"
)

// Validate applies the rules carried by a previously resolved field
// set to the submitted values. Pure: no I/O, no schema loading.
//
// Per-value checks (in order):
//
//   - name not in fields → [FlowFieldValidationRuleUnknown]
//   - checkbox field: non-bool value → [FlowFieldValidationRuleFormat]
//   - non-string value (non-checkbox) → [FlowFieldValidationRuleFormat]
//   - empty string + [FlowField.Required] → [FlowFieldValidationRuleRequired]
//   - value differs from a pinned [FlowFieldValidation.Const] → [FlowFieldValidationRuleFormat]
//   - rules in [FlowField.Validation] (MinLength, MaxLength, Format)
//
// Validate only visits submitted fields; an omitted required field is
// not its concern — the submit action pairs this with
// [SchemaFieldResolver.MissingRequired] to catch omissions.
//
// Caller is responsible for resolving the field set first (via
// [FlowFieldResolver.Resolve]); that is where schema loading and the
// "unknown property in schema" check happen.
func (r *SchemaFieldResolver) Validate(fields FlowResolvedFields, values map[string]any) error {
	byName := make(map[string]FlowField, len(fields.Fields))
	for _, f := range fields.Fields {
		byName[f.Name] = f
	}
	var errs FlowFieldValidationErrors
	for name, value := range values {
		field, known := byName[name]
		if !known {
			errs = append(errs, FlowFieldValidationError{Field: name, Rule: FlowFieldValidationRuleUnknown})
			continue
		}
		// A checkbox maps to a JSON `boolean` property, so its submitted value
		// is a real bool (not a string). Accept the bool and skip the
		// string-shaped rules; the schema type check runs later at create_user.
		if field.Type == FlowFieldTypeCheckbox {
			if _, isBool := value.(bool); !isBool {
				errs = append(errs, FlowFieldValidationError{Field: name, Rule: FlowFieldValidationRuleFormat})
				continue
			}
			// A must-accept checkbox pins `const: true`.
			if violatesConst(value, field.Validation) {
				errs = append(errs, FlowFieldValidationError{Field: name, Rule: FlowFieldValidationRuleFormat})
			}
			continue
		}
		str, isString := value.(string)
		if !isString {
			errs = append(errs, FlowFieldValidationError{Field: name, Rule: FlowFieldValidationRuleFormat})
			continue
		}
		if str == "" {
			if field.Required {
				errs = append(errs, FlowFieldValidationError{Field: name, Rule: FlowFieldValidationRuleRequired})
			}
			continue
		}
		if violatesConst(value, field.Validation) {
			errs = append(errs, FlowFieldValidationError{Field: name, Rule: FlowFieldValidationRuleFormat})
		}
		errs = append(errs, applyValidationRules(name, str, field.Validation)...)
	}
	if len(errs) > 0 {
		sortFlowFieldValidationErrors(errs)
		return errs
	}
	return nil
}

// MissingRequired reports a required violation for every declared
// required field absent from values — the unset controls clients omit
// (e.g. an unselected select) that [SchemaFieldResolver.Validate] never
// sees. Apply on field-collecting actions (submit, passkey-register issue
// leg); skip it where actions send a subset or none. Returns nil when none
// are missing.
func (r *SchemaFieldResolver) MissingRequired(fields FlowResolvedFields, values map[string]any) FlowFieldValidationErrors {
	var errs FlowFieldValidationErrors
	for _, f := range fields.Fields {
		if !f.Required {
			continue
		}
		if _, submitted := values[f.Name]; !submitted {
			errs = append(errs, FlowFieldValidationError{Field: f.Name, Rule: FlowFieldValidationRuleRequired})
		}
	}
	if len(errs) > 0 {
		sortFlowFieldValidationErrors(errs)
	}
	return errs
}

// sortFlowFieldValidationErrors orders violations by (field, rule).
// values is iterated as a map, so without this the wire (StepError) and
// log (Error) output would differ per run.
func sortFlowFieldValidationErrors(errs FlowFieldValidationErrors) {
	slices.SortFunc(errs, func(a, b FlowFieldValidationError) int {
		return cmp.Or(cmp.Compare(a.Field, b.Field), cmp.Compare(a.Rule, b.Rule))
	})
}

// violatesConst reports whether value differs from a pinned `const`. It
// only compares when value shares the const's type; a type mismatch
// (e.g. a numeric const submitted as a string) defers to create_user.
func violatesConst(value any, v *FlowFieldValidation) bool {
	if v == nil || v.Const == nil {
		return false
	}
	if reflect.TypeOf(value) != reflect.TypeOf(v.Const) {
		return false
	}
	return !reflect.DeepEqual(value, v.Const)
}

// applyValidationRules runs the [FlowFieldValidation] keyword checks
// for a single non-empty string value. Returns nil when v is nil
// (the field has no rules beyond its type).
func applyValidationRules(name, value string, v *FlowFieldValidation) []FlowFieldValidationError {
	if v == nil {
		return nil
	}
	var out []FlowFieldValidationError
	if v.MinLength > 0 && len(value) < v.MinLength {
		out = append(out, FlowFieldValidationError{Field: name, Rule: FlowFieldValidationRuleMinLength})
	}
	if v.MaxLength > 0 && len(value) > v.MaxLength {
		out = append(out, FlowFieldValidationError{Field: name, Rule: FlowFieldValidationRuleMaxLength})
	}
	if v.Format == "email" && !looksLikeEmail(value) {
		out = append(out, FlowFieldValidationError{Field: name, Rule: FlowFieldValidationRuleFormat})
	}
	return out
}

// looksLikeEmail is a deliberately minimal MVP check: one '@' with
// non-empty local and domain parts.
func looksLikeEmail(s string) bool {
	at := strings.IndexByte(s, '@')
	if at <= 0 || at == len(s)-1 {
		return false
	}
	return strings.IndexByte(s[at+1:], '@') < 0
}
