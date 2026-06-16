package domain

import "strings"

// Validate applies the rules carried by a previously resolved field
// set to the submitted values. Pure: no I/O, no schema loading.
//
// Per-value checks (in order):
//
//   - name not in fields → [FlowFieldValidationRuleUnknown]
//   - non-string value → [FlowFieldValidationRuleFormat]
//   - empty string + [FlowField.Required] → [FlowFieldValidationRuleRequired]
//   - rules in [FlowField.Validation] (MinLength, MaxLength, Format)
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
		errs = append(errs, applyValidationRules(name, str, field.Validation)...)
	}
	if len(errs) > 0 {
		return errs
	}
	return nil
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
