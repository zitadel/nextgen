package domain_test

import (
	"errors"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
)

// resolveDefaultFields resolves every property in defaultSchemaBytes()
// so Validate tests start from a realistic FlowResolvedFields value
// (Required, Validation rules, etc. all populated as in production).
func resolveDefaultFields(t *testing.T) domain.FlowResolvedFields {
	t.Helper()
	resolver := newDefaultResolver(t)
	fields, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL, "step",
		[]string{"email", "username", "x-auth-methods#password", "given_name", "family_name"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	return fields
}

func TestSchemaFieldResolver_Validate_RequiredEmptyValue(t *testing.T) {
	resolver := newDefaultResolver(t)
	fields := resolveDefaultFields(t)

	err := resolver.Validate(fields, map[string]any{"email": ""})
	if !hasValidationRule(t, err, "email", domain.FlowFieldValidationRuleRequired) {
		t.Fatalf("Validate err = %v, want required violation for email", err)
	}
}

func TestSchemaFieldResolver_Validate_EmailFormat(t *testing.T) {
	resolver := newDefaultResolver(t)
	fields := resolveDefaultFields(t)

	err := resolver.Validate(fields, map[string]any{"email": "not-an-email"})
	if !hasValidationRule(t, err, "email", domain.FlowFieldValidationRuleFormat) {
		t.Fatalf("Validate err = %v, want format violation for email", err)
	}
}

func TestSchemaFieldResolver_Validate_MinLength(t *testing.T) {
	resolver := newDefaultResolver(t)
	fields := resolveDefaultFields(t)

	err := resolver.Validate(fields, map[string]any{"username": "a"})
	if !hasValidationRule(t, err, "username", domain.FlowFieldValidationRuleMinLength) {
		t.Fatalf("Validate err = %v, want min_length violation for password", err)
	}
}

func TestSchemaFieldResolver_Validate_MaxLength(t *testing.T) {
	resolver := newDefaultResolver(t)
	fields := resolveDefaultFields(t)
	long := make([]byte, 65)
	for i := range long {
		long[i] = 'a'
	}

	err := resolver.Validate(fields, map[string]any{"username": string(long)})
	if !hasValidationRule(t, err, "username", domain.FlowFieldValidationRuleMaxLength) {
		t.Fatalf("Validate err = %v, want max_length violation for username", err)
	}
}

func TestSchemaFieldResolver_Validate_HappyPath(t *testing.T) {
	resolver := newDefaultResolver(t)
	fields := resolveDefaultFields(t)

	err := resolver.Validate(fields, map[string]any{
		"email":       "alice@example.com",
		"given_name":  "Alice",
		"family_name": "Doe",
		"username":    "alice",
	})
	if err != nil {
		t.Fatalf("Validate returned error: %v", err)
	}
}

func TestSchemaFieldResolver_Validate_UnknownField(t *testing.T) {
	resolver := newDefaultResolver(t)
	fields := resolveDefaultFields(t)

	err := resolver.Validate(fields, map[string]any{"not_in_schema": "x"})
	if !hasValidationRule(t, err, "not_in_schema", domain.FlowFieldValidationRuleUnknown) {
		t.Fatalf("Validate err = %v, want unknown_field violation", err)
	}
}

func TestSchemaFieldResolver_Validate_NonStringValueReportsFormat(t *testing.T) {
	resolver := newDefaultResolver(t)
	fields := resolveDefaultFields(t)

	err := resolver.Validate(fields, map[string]any{"email": 123})
	if !hasValidationRule(t, err, "email", domain.FlowFieldValidationRuleFormat) {
		t.Fatalf("Validate err = %v, want format violation for non-string email", err)
	}
}

func hasValidationRule(t *testing.T, err error, field string, rule domain.FlowFieldValidationRule) bool {
	t.Helper()
	var errs domain.FlowFieldValidationErrors
	if !errors.As(err, &errs) {
		return false
	}
	for _, e := range errs {
		if e.Field == field && e.Rule == rule {
			return true
		}
	}
	return false
}
