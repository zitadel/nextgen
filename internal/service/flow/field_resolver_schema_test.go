package flow_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"slices"
	"testing"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/ianlancetaylor/jsonschema"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service/flow"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const testProjectID = "proj-1"

// fakeSchemaResolver feeds inline JSON bytes through a real
// [jsonschema.SchemaFromJSON] parser so tests exercise the same
// keyword extraction the production path uses, without needing a
// database or HTTP client.
type fakeSchemaResolver struct {
	bytesByURL map[string][]byte
}

func (f *fakeSchemaResolver) Resolve(_ context.Context, _ database.QueryExecutor, _, schemaURL string, _ []byte) (*jsonschema.Schema, error) {
	raw, ok := f.bytesByURL[schemaURL]
	if !ok {
		return nil, errors.New("fakeSchemaResolver: schema not found: " + schemaURL)
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return jsonschema.SchemaFromJSON("https://json-schema.org/draft/2020-12/schema", nil, v)
}

func newFakeResolver(t *testing.T, schemas map[string][]byte) flow.SchemaResolver {
	t.Helper()
	return &fakeSchemaResolver{bytesByURL: schemas}
}

// defaultSchema covers email/username/password/given_name/family_name
// with the same shape as the embedded built-in. Inlining it keeps test
// setup self-contained.
const defaultSchemaURL = "https://example.test/user/v1/default.user.schema.json"

func defaultSchemaBytes() []byte {
	return []byte(`{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true } },
		"required": ["email", "username", "password", "given_name", "family_name"],
		"properties": {
			"email":       { "type": "string", "format": "email", "maxLength": 320, "x-identifier": true, "x-unique": "organization" },
			"username":    { "type": "string", "minLength": 3, "maxLength": 64, "x-identifier": true, "x-unique": "organization" },
			"password":    { "type": "string", "minLength": 8 },
			"given_name":  { "type": "string", "minLength": 1, "maxLength": 200 },
			"family_name": { "type": "string", "minLength": 1, "maxLength": 200 }
		}
	}`)
}

func newDefaultResolver(t *testing.T) *flow.SchemaFieldResolver {
	t.Helper()
	return flow.NewSchemaFieldResolver(newFakeResolver(t, map[string][]byte{
		defaultSchemaURL: defaultSchemaBytes(),
	}))
}

func TestSchemaFieldResolver_Resolve_DefaultFields(t *testing.T) {
	resolver := newDefaultResolver(t)

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL,
		[]string{"email", "username", "password", "given_name", "family_name"})
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

func TestSchemaFieldResolver_Resolve_IdentifierImpliesUserNotFound(t *testing.T) {
	resolver := newDefaultResolver(t)

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL, []string{"email", "password"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}

	if !slices.Contains(got.ImplicitOutcomes["email"], domain.FlowImplicitOutcomeUserNotFound) {
		t.Errorf("Resolve email ImplicitOutcomes = %v, want user_not_found", got.ImplicitOutcomes["email"])
	}
	if got.Fields["email"].Challenge != domain.FlowFieldChallengeIdentifier {
		t.Errorf("Resolve email Challenge = %q, want %q", got.Fields["email"].Challenge, domain.FlowFieldChallengeIdentifier)
	}
	if len(got.ImplicitOutcomes["password"]) != 0 {
		t.Errorf("Resolve password ImplicitOutcomes = %v, want empty", got.ImplicitOutcomes["password"])
	}
	if got.Fields["password"].Challenge == domain.FlowFieldChallengeIdentifier {
		t.Error("Resolve password Challenge = identifier, want non-identifier")
	}
}

func TestSchemaFieldResolver_Resolve_ChallengeSurfaces(t *testing.T) {
	resolver := newDefaultResolver(t)

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL, []string{"email", "password", "given_name"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}

	if got.Fields["email"].Challenge != domain.FlowFieldChallengeIdentifier {
		t.Errorf("Resolve email Challenge = %q, want %q", got.Fields["email"].Challenge, domain.FlowFieldChallengeIdentifier)
	}
	if got.Fields["password"].Challenge != domain.FlowFieldChallengePassword {
		t.Errorf("Resolve password Challenge = %q, want %q", got.Fields["password"].Challenge, domain.FlowFieldChallengePassword)
	}
	if got.Fields["given_name"].Challenge != domain.FlowFieldChallengeNone {
		t.Errorf("Resolve given_name Challenge = %q, want %q", got.Fields["given_name"].Challenge, domain.FlowFieldChallengeNone)
	}
}

func TestSchemaFieldResolver_Resolve_PasswordChallengeRequiresAuthMethodEnabled(t *testing.T) {
	const url = "https://example.test/no-auth-methods.json"
	bytes := []byte(`{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"properties": {
			"password": { "type": "string", "minLength": 8 }
		}
	}`)
	resolver := flow.NewSchemaFieldResolver(newFakeResolver(t, map[string][]byte{url: bytes}))

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, url, []string{"password"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got.Fields["password"].Challenge != domain.FlowFieldChallengeNone {
		t.Errorf("Resolve password Challenge = %q, want None (auth-methods absent)", got.Fields["password"].Challenge)
	}
}

func TestSchemaFieldResolver_Resolve_UniqueScopeSurfaces(t *testing.T) {
	resolver := newDefaultResolver(t)

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL, []string{"email", "password"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}

	if got.Fields["email"].Unique != domain.FlowFieldUniqueScopeOrganization {
		t.Errorf("Resolve email Unique = %q, want %q", got.Fields["email"].Unique, domain.FlowFieldUniqueScopeOrganization)
	}
	if got.Fields["password"].Unique != domain.FlowFieldUniqueScopeNone {
		t.Errorf("Resolve password Unique = %q, want %q", got.Fields["password"].Unique, domain.FlowFieldUniqueScopeNone)
	}
}

func TestSchemaFieldResolver_Resolve_UnknownField(t *testing.T) {
	resolver := newDefaultResolver(t)

	_, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL, []string{"not_in_schema"})
	if !errors.Is(err, domain.ErrFlowFieldUnknown) {
		t.Fatalf("Resolve err = %v, want ErrFlowFieldUnknown", err)
	}
}

func TestSchemaFieldResolver_Resolve_SchemaLoadFailurePropagates(t *testing.T) {
	resolver := flow.NewSchemaFieldResolver(newFakeResolver(t, nil))

	_, err := resolver.Resolve(t.Context(), nil, testProjectID, "https://example.test/missing.json", []string{"email"})
	if err == nil {
		t.Fatal("Resolve err = nil, want load failure")
	}
}

func TestSchemaFieldResolver_Validate_RequiredEmptyValue(t *testing.T) {
	resolver := newDefaultResolver(t)

	err := resolver.Validate(t.Context(), nil, testProjectID, defaultSchemaURL, map[string]any{"email": ""})
	if !hasValidationRule(t, err, "email", domain.FlowFieldValidationRuleRequired) {
		t.Fatalf("Validate err = %v, want required violation for email", err)
	}
}

func TestSchemaFieldResolver_Validate_EmailFormat(t *testing.T) {
	resolver := newDefaultResolver(t)

	err := resolver.Validate(t.Context(), nil, testProjectID, defaultSchemaURL, map[string]any{"email": "not-an-email"})
	if !hasValidationRule(t, err, "email", domain.FlowFieldValidationRuleFormat) {
		t.Fatalf("Validate err = %v, want format violation for email", err)
	}
}

func TestSchemaFieldResolver_Validate_MinLength(t *testing.T) {
	resolver := newDefaultResolver(t)

	err := resolver.Validate(t.Context(), nil, testProjectID, defaultSchemaURL, map[string]any{"password": "short"})
	if !hasValidationRule(t, err, "password", domain.FlowFieldValidationRuleMinLength) {
		t.Fatalf("Validate err = %v, want min_length violation for password", err)
	}
}

func TestSchemaFieldResolver_Validate_MaxLength(t *testing.T) {
	resolver := newDefaultResolver(t)
	long := make([]byte, 65)
	for i := range long {
		long[i] = 'a'
	}

	err := resolver.Validate(t.Context(), nil, testProjectID, defaultSchemaURL, map[string]any{"username": string(long)})
	if !hasValidationRule(t, err, "username", domain.FlowFieldValidationRuleMaxLength) {
		t.Fatalf("Validate err = %v, want max_length violation for username", err)
	}
}

func TestSchemaFieldResolver_Validate_HappyPath(t *testing.T) {
	resolver := newDefaultResolver(t)

	err := resolver.Validate(t.Context(), nil, testProjectID, defaultSchemaURL, map[string]any{
		"email":       "alice@example.com",
		"password":    "correct-horse-battery-staple",
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

	err := resolver.Validate(t.Context(), nil, testProjectID, defaultSchemaURL, map[string]any{"not_in_schema": "x"})
	if !hasValidationRule(t, err, "not_in_schema", domain.FlowFieldValidationRuleUnknown) {
		t.Fatalf("Validate err = %v, want unknown_field violation", err)
	}
}

func TestSchemaFieldResolver_Validate_NonStringValueReportsFormat(t *testing.T) {
	resolver := newDefaultResolver(t)

	err := resolver.Validate(t.Context(), nil, testProjectID, defaultSchemaURL, map[string]any{"email": 123})
	if !hasValidationRule(t, err, "email", domain.FlowFieldValidationRuleFormat) {
		t.Fatalf("Validate err = %v, want format violation for non-string email", err)
	}
}

// TestSchemaFieldResolver_BuiltinDefaultSchema exercises the embedded
// built-in default user schema through a real [domain.JSONSchemaResolver].
// This guards against drift between the embedded JSON template and the
// resolver's keyword extraction.
func TestSchemaFieldResolver_BuiltinDefaultSchema(t *testing.T) {
	base, err := url.Parse("https://example.test/schemas")
	if err != nil {
		t.Fatalf("url.Parse: %v", err)
	}
	cache, err := lru.New2Q[string, *jsonschema.Schema](128)
	if err != nil {
		t.Fatalf("lru.New2Q: %v", err)
	}
	jsonResolver := domain.NewJSONSchemaResolver(nil, cache, 0, 0, nil, base)
	resolver := flow.NewSchemaFieldResolver(jsonResolver)
	const schemaURL = "https://example.test/schemas/user/v1/default.user.schema.json"

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, schemaURL,
		[]string{"email", "username", "password", "given_name", "family_name"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got.Fields["email"].Challenge != domain.FlowFieldChallengeIdentifier {
		t.Errorf("builtin email Challenge = %q, want identifier", got.Fields["email"].Challenge)
	}
	if got.Fields["password"].Challenge != domain.FlowFieldChallengePassword {
		t.Errorf("builtin password Challenge = %q, want password", got.Fields["password"].Challenge)
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
