package domain_test

import (
	"errors"
	"strings"
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

// Validate judges a submission by the default schema's rules; a case without
// a rule passes.
func TestSchemaFieldResolver_Validate_DefaultSchema(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	fields := resolveDefaultFields(t)

	for _, tc := range []struct {
		name   string
		values map[string]any
		field  string
		rule   domain.FlowFieldValidationRule
	}{
		{name: "required empty value", values: map[string]any{"email": ""}, field: "email", rule: domain.FlowFieldValidationRuleRequired},
		{name: "email format", values: map[string]any{"email": "not-an-email"}, field: "email", rule: domain.FlowFieldValidationRuleFormat},
		// A display-name form has one '@', but is no address.
		{name: "email display name", values: map[string]any{"email": "Alice <alice@example.com>"}, field: "email", rule: domain.FlowFieldValidationRuleFormat},
		{name: "non-string value reports format", values: map[string]any{"email": 123}, field: "email", rule: domain.FlowFieldValidationRuleFormat},
		{name: "min length", values: map[string]any{"username": "a"}, field: "username", rule: domain.FlowFieldValidationRuleMinLength},
		{name: "max length", values: map[string]any{"username": strings.Repeat("a", 65)}, field: "username", rule: domain.FlowFieldValidationRuleMaxLength},
		// Length rules count code points (JSON Schema), not UTF-8 bytes:
		// "äö" is 2 code points in 4 bytes, under minLength 3; 64 "ä" are
		// 64 code points in 128 bytes, exactly at maxLength 64.
		{name: "min length counts code points", values: map[string]any{"username": "äö"}, field: "username", rule: domain.FlowFieldValidationRuleMinLength},
		{name: "max length counts code points", values: map[string]any{"username": strings.Repeat("ä", 64)}},
		{name: "unknown field", values: map[string]any{"not_in_schema": "x"}, field: "not_in_schema", rule: domain.FlowFieldValidationRuleUnknown},
		{name: "happy path", values: map[string]any{"email": "alice@example.com", "given_name": "Alice", "family_name": "Doe", "username": "alice"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := resolver.Validate(fields, tc.values)
			if tc.rule == "" {
				if err != nil {
					t.Fatalf("Validate returned error: %v", err)
				}
				return
			}
			if !hasValidationRule(t, err, tc.field, tc.rule) {
				t.Fatalf("Validate err = %v, want %s violation for %s", err, tc.rule, tc.field)
			}
		})
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

// Every format a field carries is judged, by the rule the stored document
// faces; a format the validator does not know passes.
func TestSchemaFieldResolver_Validate_FormatRules(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	for _, tc := range []struct {
		format, value string
		valid         bool
	}{
		{"date", "2024-01-31", true},
		{"date", "31.01.2024", false},
		{"uri", "https://example.com/x", true},
		{"uri", "not a uri", false},
		{"password", "anything goes", true},
	} {
		fields := domain.FlowResolvedFields{
			Fields: []domain.FlowField{{Name: "f", Type: domain.FlowFieldTypeText, Validation: &domain.FlowFieldValidation{Format: tc.format}}},
		}
		err := resolver.Validate(fields, map[string]any{"f": tc.value})
		if tc.valid && err != nil {
			t.Errorf("Validate(%s %q) = %v, want nil", tc.format, tc.value, err)
		}
		if !tc.valid && !hasValidationRule(t, err, "f", domain.FlowFieldValidationRuleFormat) {
			t.Errorf("Validate(%s %q) = %v, want format violation", tc.format, tc.value, err)
		}
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

// A password is counted after NFC normalization, as the password policy
// counts it: a decomposed "é" is one code point, not two.
func TestSchemaFieldResolver_Validate_PasswordCountsNormalized(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	fields := resolveDefaultFields(t)
	for i := range fields.Fields {
		if fields.Fields[i].Name == "x-auth-methods#password" {
			fields.Fields[i].Validation = &domain.FlowFieldValidation{MinLength: 12, MaxLength: 20}
		}
	}

	decomposed := strings.Repeat("é", 12) // 24 code points before NFC, 12 after
	if err := resolver.Validate(fields, map[string]any{"x-auth-methods#password": decomposed}); err != nil {
		t.Fatalf("Validate err = %v, want none: 12 code points after NFC fit 12 to 20", err)
	}
	short := strings.Repeat("é", 11)
	err := resolver.Validate(fields, map[string]any{"x-auth-methods#password": short})
	if !hasValidationRule(t, err, "x-auth-methods#password", domain.FlowFieldValidationRuleMinLength) {
		t.Fatalf("Validate err = %v, want min_length violation for the password", err)
	}
}
