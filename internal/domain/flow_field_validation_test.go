package domain_test

import (
	"errors"
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/zitadel/nextgen/internal/domain"
)

// resolveDefaultFields resolves every property in defaultSchemaBytes()
// so Validate tests start from a realistic FlowResolvedFields value
// (Required, Validation rules, etc. all populated as in production).
func resolveDefaultFields(t *testing.T) domain.FlowResolvedFields {
	t.Helper()

	resolver := domain.NewSchemaFieldResolver()
	schema := mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent)

	fields, err := resolver.Resolve(schema, "step",
		[]domain.Field{"email", "username", "x-auth-methods#password", "given_name", "family_name"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	return fields
}

func TestSchemaFieldResolver_Validate_RequiredEmptyValue(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	fields := resolveDefaultFields(t)

	err := resolver.Validate(fields, map[string]any{"email": ""})
	if !hasValidationRule(t, err, "email", domain.FlowFieldValidationRuleRequired) {
		t.Fatalf("Validate err = %v,  newDefaultSchemaLoader(t).Reswant required violation for email", err)
	}
}

func TestSchemaFieldResolver_Validate_EmailFormat(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	fields := resolveDefaultFields(t)

	err := resolver.Validate(fields, map[string]any{"email": "not-an-email"})
	if !hasValidationRule(t, err, "email", domain.FlowFieldValidationRuleFormat) {
		t.Fatalf("Validate err = %v, want format violation for email", err)
	}
}

func TestSchemaFieldResolver_Validate_MinLength(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	fields := resolveDefaultFields(t)

	err := resolver.Validate(fields, map[string]any{"username": "a"})
	if !hasValidationRule(t, err, "username", domain.FlowFieldValidationRuleMinLength) {
		t.Fatalf("Validate err = %v, want min_length violation for password", err)
	}
}

func TestSchemaFieldResolver_Validate_MaxLength(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
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
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
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
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	fields := resolveDefaultFields(t)

	err := resolver.Validate(fields, map[string]any{"not_in_schema": "x"})
	if !hasValidationRule(t, err, "not_in_schema", domain.FlowFieldValidationRuleUnknown) {
		t.Fatalf("Validate err = %v, want unknown_field violation", err)
	}
}

func TestSchemaFieldResolver_Validate_NonStringValueReportsFormat(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	fields := resolveDefaultFields(t)

	err := resolver.Validate(fields, map[string]any{"email": 123})
	if !hasValidationRule(t, err, "email", domain.FlowFieldValidationRuleFormat) {
		t.Fatalf("Validate err = %v, want format violation for non-string email", err)
	}
}

func TestSchemaFieldResolver_Validate_CheckboxAcceptsBool(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	fields := domain.FlowResolvedFields{
		Fields: []domain.FlowField{{Name: "newsletterOptIn", Type: domain.FlowFieldTypeCheckbox}},
	}

	for _, v := range []any{true, false} {
		if err := resolver.Validate(fields, map[string]any{"newsletterOptIn": v}); err != nil {
			t.Fatalf("Validate(newsletterOptIn=%v) returned error: %v", v, err)
		}
	}
}

func TestSchemaFieldResolver_Validate_CheckboxRejectsString(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	fields := domain.FlowResolvedFields{
		Fields: []domain.FlowField{{Name: "newsletterOptIn", Type: domain.FlowFieldTypeCheckbox}},
	}

	// A checkbox is a boolean property; the "true" string the client used to
	// send must be rejected so the schema-type mismatch surfaces early.
	err := resolver.Validate(fields, map[string]any{"newsletterOptIn": "true"})
	if !hasValidationRule(t, err, "newsletterOptIn", domain.FlowFieldValidationRuleFormat) {
		t.Fatalf("Validate err = %v, want format violation for string checkbox value", err)
	}
}

// TestFlowFieldValidationError_TextKey pins the wire dialect for
// `step.error`: `error.<field>_<rule>`, with the format rule aliased to
// the catalog's `_invalid` spelling and field names used verbatim
// (credential shape included). The client's `localiseFlowErrorKeys`
// (packages/components/src/orchestrator/liquid.ts) parses exactly this.
func TestFlowFieldValidationError_TextKey(t *testing.T) {
	t.Parallel()
	cases := []struct {
		field string
		rule  domain.FlowFieldValidationRule
		want  string
	}{
		{"email", domain.FlowFieldValidationRuleRequired, "error.email_required"},
		{"email", domain.FlowFieldValidationRuleFormat, "error.email_invalid"},
		{"username", domain.FlowFieldValidationRuleMinLength, "error.username_min_length"},
		{"username", domain.FlowFieldValidationRuleMaxLength, "error.username_max_length"},
		{"nickname", domain.FlowFieldValidationRuleUnknown, "error.nickname_unknown_field"},
		{"x-auth-methods#password", domain.FlowFieldValidationRuleRequired, "error.x-auth-methods#password_required"},
	}
	for _, tc := range cases {
		err := domain.FlowFieldValidationError{Field: tc.field, Rule: tc.rule}
		if got := err.TextKey(); got != tc.want {
			t.Errorf("TextKey(%s, %s) = %q, want %q", tc.field, tc.rule, got, tc.want)
		}
	}
}

func TestFlowFieldValidationErrors_StepErrorJoinsKeys(t *testing.T) {
	t.Parallel()
	errs := domain.FlowFieldValidationErrors{
		{Field: "email", Rule: domain.FlowFieldValidationRuleFormat},
		{Field: "username", Rule: domain.FlowFieldValidationRuleMinLength},
	}
	want := "error.email_invalid; error.username_min_length"
	if got := errs.StepError(); got != want {
		t.Errorf("StepError() = %q, want %q", got, want)
	}
}

// Validate iterates the submitted values map, so without sorting the
// violation order (and thus the wire string) would differ per run.
func TestSchemaFieldResolver_Validate_DeterministicOrder(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	fields := resolveDefaultFields(t)

	err := resolver.Validate(fields, map[string]any{
		"username": "a",
		"email":    "not-an-email",
	})
	var errs domain.FlowFieldValidationErrors
	if !errors.As(err, &errs) {
		t.Fatalf("Validate err = %v, want FlowFieldValidationErrors", err)
	}
	want := "error.email_invalid; error.username_min_length"
	if got := errs.StepError(); got != want {
		t.Errorf("StepError() = %q, want %q", got, want)
	}
}

func TestSchemaFieldResolver_Validate_CheckboxConstMustBeTrue(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	fields := domain.FlowResolvedFields{
		Fields: []domain.FlowField{
			{
				Name:       "acceptedTermsAndConditions",
				Type:       domain.FlowFieldTypeCheckbox,
				Validation: &domain.FlowFieldValidation{Const: true},
			},
		},
	}

	// An unchecked must-accept box submits false, which violates const: true.
	err := resolver.Validate(fields, map[string]any{"acceptedTermsAndConditions": false})
	if !hasValidationRule(t, err, "acceptedTermsAndConditions", domain.FlowFieldValidationRuleFormat) {
		t.Fatalf("Validate err = %v, want format violation for unaccepted terms", err)
	}

	// Checked satisfies the const.
	if err := resolver.Validate(fields, map[string]any{"acceptedTermsAndConditions": true}); err != nil {
		t.Fatalf("Validate returned error for accepted terms: %v", err)
	}
}

func TestSchemaFieldResolver_Validate_StringConst(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	fields := domain.FlowResolvedFields{
		Fields: []domain.FlowField{
			{Name: "tier", Type: domain.FlowFieldTypeText, Validation: &domain.FlowFieldValidation{Const: "free"}},
		},
	}

	// A value differing from the pinned const is rejected.
	err := resolver.Validate(fields, map[string]any{"tier": "premium"})
	if !hasValidationRule(t, err, "tier", domain.FlowFieldValidationRuleFormat) {
		t.Fatalf("Validate err = %v, want format violation for non-const string", err)
	}

	// The pinned value passes.
	if err := resolver.Validate(fields, map[string]any{"tier": "free"}); err != nil {
		t.Fatalf("Validate returned error for const-matching string: %v", err)
	}
}

func TestSchemaFieldResolver_MissingRequired(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	fields := domain.FlowResolvedFields{
		Fields: []domain.FlowField{
			{
				Name:       "maritalStatus",
				Type:       domain.FlowFieldTypeSelect,
				Required:   true,
				Validation: &domain.FlowFieldValidation{Enum: []string{"Single", "Married"}},
			},
			{Name: "newsletterOptIn", Type: domain.FlowFieldTypeCheckbox},
		},
	}

	// The client drops an unselected select entirely, so the required field
	// is absent from the submission rather than submitted empty.
	errs := resolver.MissingRequired(fields, map[string]any{})
	if !hasValidationRule(t, errs, "maritalStatus", domain.FlowFieldValidationRuleRequired) {
		t.Fatalf("MissingRequired = %v, want required violation for omitted maritalStatus", errs)
	}

	// A submitted required field, and any optional field, is not missing.
	if errs := resolver.MissingRequired(fields, map[string]any{"maritalStatus": "Single"}); errs != nil {
		t.Fatalf("MissingRequired = %v, want no violations when required field present", errs)
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
