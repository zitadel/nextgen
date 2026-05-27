package domain_test

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"testing"

	"github.com/ianlancetaylor/jsonschema"

	"github.com/zitadel/nextgen/internal/domain"
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

func newFakeResolver(t *testing.T, schemas map[string][]byte) domain.SchemaResolver {
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
			"email":       { "type": "string", "format": "email", "maxLength": 320, "x-unique": "team" },
			"username":    { "type": "string", "minLength": 3, "maxLength": 64, "x-unique": "team" },
			"password":    { "type": "string", "minLength": 8, "x-password": true },
			"given_name":  { "type": "string", "minLength": 1, "maxLength": 200 },
			"family_name": { "type": "string", "minLength": 1, "maxLength": 200 }
		}
	}`)
}

func newDefaultResolver(t *testing.T) *domain.SchemaFieldResolver {
	t.Helper()
	return domain.NewSchemaFieldResolver(newFakeResolver(t, map[string][]byte{
		defaultSchemaURL: defaultSchemaBytes(),
	}))
}

func TestSchemaFieldResolver_Resolve_DefaultFields(t *testing.T) {
	resolver := newDefaultResolver(t)

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL, "identifier",
		[]string{"email", "username", "password", "given_name", "family_name"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}

	tests := []struct {
		name        string
		wantType    domain.FlowFieldType
		wantTextKey string
	}{
		{"email", domain.FlowFieldTypeEmail, "identifier.field.email"},
		{"username", domain.FlowFieldTypeText, "identifier.field.username"},
		{"password", domain.FlowFieldTypePassword, "identifier.field.password"},
		{"given_name", domain.FlowFieldTypeText, "identifier.field.given_name"},
		{"family_name", domain.FlowFieldTypeText, "identifier.field.family_name"},
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

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL, "step", []string{"email", "password"})
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

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL, "step", []string{"email", "password", "given_name"})
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
			"password": { "type": "string", "minLength": 8, "x-password": true }
		}
	}`)
	resolver := domain.NewSchemaFieldResolver(newFakeResolver(t, map[string][]byte{url: bytes}))

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, url, "step", []string{"password"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got.Fields["password"].Challenge != domain.FlowFieldChallengeNone {
		t.Errorf("Resolve password Challenge = %q, want None (auth-methods absent)", got.Fields["password"].Challenge)
	}
}

func TestSchemaFieldResolver_Resolve_PasswordChallengeRequiresXPassword(t *testing.T) {
	const url = "https://example.test/no-x-password.json"
	bytes := []byte(`{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true } },
		"properties": {
			"password": { "type": "string", "minLength": 8 }
		}
	}`)
	resolver := domain.NewSchemaFieldResolver(newFakeResolver(t, map[string][]byte{url: bytes}))

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, url, "step", []string{"password"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got.Fields["password"].Challenge != domain.FlowFieldChallengeNone {
		t.Errorf("Resolve password Challenge = %q, want None (x-password absent on property)", got.Fields["password"].Challenge)
	}
	if got.Fields["password"].Type != domain.FlowFieldTypeText {
		t.Errorf("Resolve password Type = %q, want text (no x-password annotation)", got.Fields["password"].Type)
	}
}

func TestSchemaFieldResolver_Resolve_RenamedPasswordField(t *testing.T) {
	const url = "https://example.test/renamed-password.json"
	bytes := []byte(`{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true } },
		"properties": {
			"secret": { "type": "string", "minLength": 8, "x-password": true }
		}
	}`)
	resolver := domain.NewSchemaFieldResolver(newFakeResolver(t, map[string][]byte{url: bytes}))

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, url, "step", []string{"secret"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got.Fields["secret"].Challenge != domain.FlowFieldChallengePassword {
		t.Errorf("Resolve secret Challenge = %q, want %q", got.Fields["secret"].Challenge, domain.FlowFieldChallengePassword)
	}
	if got.Fields["secret"].Type != domain.FlowFieldTypePassword {
		t.Errorf("Resolve secret Type = %q, want %q", got.Fields["secret"].Type, domain.FlowFieldTypePassword)
	}
}

func TestSchemaFieldResolver_Resolve_UniqueScopeSurfaces(t *testing.T) {
	resolver := newDefaultResolver(t)

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL, "step", []string{"email", "password"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}

	if got.Fields["email"].Unique != domain.FlowFieldUniqueScopeTeam {
		t.Errorf("Resolve email Unique = %q, want %q", got.Fields["email"].Unique, domain.FlowFieldUniqueScopeTeam)
	}
	if got.Fields["password"].Unique != domain.FlowFieldUniqueScopeNone {
		t.Errorf("Resolve password Unique = %q, want %q", got.Fields["password"].Unique, domain.FlowFieldUniqueScopeNone)
	}
}

func TestSchemaFieldResolver_Resolve_UniqueScopeProject(t *testing.T) {
	const url = "https://example.test/project-unique.json"
	bytes := []byte(`{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"properties": {
			"handle": { "type": "string", "x-unique": "project" }
		}
	}`)
	resolver := domain.NewSchemaFieldResolver(newFakeResolver(t, map[string][]byte{url: bytes}))

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, url, "step", []string{"handle"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got.Fields["handle"].Unique != domain.FlowFieldUniqueScopeProject {
		t.Errorf("Resolve handle Unique = %q, want %q", got.Fields["handle"].Unique, domain.FlowFieldUniqueScopeProject)
	}
}

func TestSchemaFieldResolver_Resolve_UnknownField(t *testing.T) {
	resolver := newDefaultResolver(t)

	_, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL, "step", []string{"not_in_schema"})
	if !errors.Is(err, domain.ErrFlowFieldUnknown) {
		t.Fatalf("Resolve err = %v, want ErrFlowFieldUnknown", err)
	}
}

func TestSchemaFieldResolver_Resolve_SchemaLoadFailurePropagates(t *testing.T) {
	resolver := domain.NewSchemaFieldResolver(newFakeResolver(t, nil))

	_, err := resolver.Resolve(t.Context(), nil, testProjectID, "https://example.test/missing.json", "step", []string{"email"})
	if err == nil {
		t.Fatal("Resolve err = nil, want load failure")
	}
}

func TestSchemaFieldResolver_Resolve_FormatAndTypeVariants(t *testing.T) {
	const url = "https://example.test/variants.json"
	bytes := []byte(`{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"properties": {
			"website":  { "type": "string", "format": "uri" },
			"birthday": { "type": "string", "format": "date" },
			"created":  { "type": "string", "format": "date-time" },
			"nickname": { "type": "string" }
		}
	}`)
	resolver := domain.NewSchemaFieldResolver(newFakeResolver(t, map[string][]byte{url: bytes}))

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, url, "step",
		[]string{"website", "birthday", "created", "nickname"})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}

	wantTypes := map[string]domain.FlowFieldType{
		"website":  domain.FlowFieldTypeURL,
		"birthday": domain.FlowFieldTypeDate,
		"created":  domain.FlowFieldTypeDate,
		"nickname": domain.FlowFieldTypeText,
	}
	for name, want := range wantTypes {
		if got.Fields[name].Type != want {
			t.Errorf("Resolve field %q Type = %q, want %q", name, got.Fields[name].Type, want)
		}
	}
	if got.Fields["nickname"].Validation != nil {
		t.Errorf("Resolve nickname Validation = %+v, want nil (no rules)", got.Fields["nickname"].Validation)
	}
}

