package flow_test

import (
	"errors"
	"slices"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service/flow"
)

func TestCatalogFieldResolver_Resolve_DefaultCatalogFields(t *testing.T) {
	resolver := flow.NewCatalogFieldResolver()

	got, err := resolver.Resolve(t.Context(), "", []string{"email", "username", "password", "given_name", "family_name"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}

	tests := []struct {
		name        string
		wantType    domain.FlowFieldType
		wantTextKey string
	}{
		{"email", domain.FlowFieldTypeEmail, "field.email"},
		{"username", domain.FlowFieldTypeText, "field.username"},
		{"password", domain.FlowFieldTypePassword, "field.password"},
		{"given_name", domain.FlowFieldTypeText, "field.given_name"},
		{"family_name", domain.FlowFieldTypeText, "field.family_name"},
	}
	for _, tc := range tests {
		f, ok := got.Fields[tc.name]
		if !ok {
			t.Errorf("Resolve missing field %q", tc.name)
			continue
		}
		if f.Type != tc.wantType {
			t.Errorf("Resolve field %q type = %v, want %v", tc.name, f.Type, tc.wantType)
		}
		if f.TextKey != tc.wantTextKey {
			t.Errorf("Resolve field %q text_key = %q, want %q", tc.name, f.TextKey, tc.wantTextKey)
		}
		if !f.Required {
			t.Errorf("Resolve field %q required = false, want true", tc.name)
		}
	}
}

func TestCatalogFieldResolver_Resolve_IdentifierImpliesUserNotFound(t *testing.T) {
	resolver := flow.NewCatalogFieldResolver()

	got, err := resolver.Resolve(t.Context(), "", []string{"email", "password"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}

	if !slices.Contains(got.ImplicitOutcomes["email"], domain.FlowImplicitOutcomeUserNotFound) {
		t.Errorf("Resolve email ImplicitOutcomes = %v, want user_not_found", got.ImplicitOutcomes["email"])
	}
	if !got.Behaviors["email"].IsIdentifier {
		t.Error("Resolve email IsIdentifier = false, want true")
	}
	if len(got.ImplicitOutcomes["password"]) != 0 {
		t.Errorf("Resolve password ImplicitOutcomes = %v, want empty", got.ImplicitOutcomes["password"])
	}
	if got.Behaviors["password"].IsIdentifier {
		t.Error("Resolve password IsIdentifier = true, want false")
	}
}

func TestCatalogFieldResolver_Resolve_UniqueScopeSurfaces(t *testing.T) {
	resolver := flow.NewCatalogFieldResolver()

	got, err := resolver.Resolve(t.Context(), "", []string{"email", "password"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}

	if got.Behaviors["email"].Unique != domain.FlowFieldUniqueScopeOrganization {
		t.Errorf("Resolve email Unique = %q, want %q", got.Behaviors["email"].Unique, domain.FlowFieldUniqueScopeOrganization)
	}
	if got.Behaviors["password"].Unique != domain.FlowFieldUniqueScopeNone {
		t.Errorf("Resolve password Unique = %q, want %q", got.Behaviors["password"].Unique, domain.FlowFieldUniqueScopeNone)
	}
}

func TestCatalogFieldResolver_Resolve_UnknownField(t *testing.T) {
	resolver := flow.NewCatalogFieldResolver()

	_, err := resolver.Resolve(t.Context(), "", []string{"not_in_catalog"})
	if !errors.Is(err, domain.ErrFlowFieldUnknown) {
		t.Fatalf("Resolve err = %v, want ErrFlowFieldUnknown", err)
	}
}

func TestCatalogFieldResolver_Resolve_ReturnsValidationCopy(t *testing.T) {
	resolver := flow.NewCatalogFieldResolver()

	first, err := resolver.Resolve(t.Context(), "", []string{"password"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	first.Fields["password"].Validation.MinLength = 999

	second, err := resolver.Resolve(t.Context(), "", []string{"password"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if second.Fields["password"].Validation.MinLength == 999 {
		t.Error("Resolve returned shared validation pointer; expected per-call copy")
	}
}

func TestCatalogFieldResolver_Validate_RequiredEmptyValue(t *testing.T) {
	resolver := flow.NewCatalogFieldResolver()

	err := resolver.Validate(t.Context(), "", map[string]any{"email": ""})

	if !hasValidationRule(t, err, "email", domain.FlowFieldValidationRuleRequired) {
		t.Fatalf("Validate err = %v, want required violation for email", err)
	}
}

func TestCatalogFieldResolver_Validate_EmailFormat(t *testing.T) {
	resolver := flow.NewCatalogFieldResolver()

	err := resolver.Validate(t.Context(), "", map[string]any{"email": "not-an-email"})

	if !hasValidationRule(t, err, "email", domain.FlowFieldValidationRuleFormat) {
		t.Fatalf("Validate err = %v, want format violation for email", err)
	}
}

func TestCatalogFieldResolver_Validate_MinLength(t *testing.T) {
	resolver := flow.NewCatalogFieldResolver()

	err := resolver.Validate(t.Context(), "", map[string]any{"password": "short"})

	if !hasValidationRule(t, err, "password", domain.FlowFieldValidationRuleMinLength) {
		t.Fatalf("Validate err = %v, want min_length violation for password", err)
	}
}

func TestCatalogFieldResolver_Validate_HappyPath(t *testing.T) {
	resolver := flow.NewCatalogFieldResolver()

	err := resolver.Validate(t.Context(), "", map[string]any{
		"email":       "alice@example.com",
		"password":    "correct-horse-battery-staple",
		"given_name":  "Alice",
		"family_name": "Doe",
	})
	if err != nil {
		t.Fatalf("Validate returned error: %v", err)
	}
}

func TestCatalogFieldResolver_Validate_UnknownField(t *testing.T) {
	resolver := flow.NewCatalogFieldResolver()

	err := resolver.Validate(t.Context(), "", map[string]any{"not_in_catalog": "x"})

	if !hasValidationRule(t, err, "not_in_catalog", domain.FlowFieldValidationRuleUnknown) {
		t.Fatalf("Validate err = %v, want unknown_field violation", err)
	}
}

func TestCatalogFieldResolver_Validate_NonStringValueReportsFormat(t *testing.T) {
	resolver := flow.NewCatalogFieldResolver()

	err := resolver.Validate(t.Context(), "", map[string]any{"email": 123})

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
