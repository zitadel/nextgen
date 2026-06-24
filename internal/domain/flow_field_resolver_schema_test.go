package domain_test

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const testProjectID = "proj-1"

// findField returns the resolved field with the given name. ok is false
// when no field matches.
func findField(r domain.FlowResolvedFields, name string) (domain.FlowField, bool) {
	for _, f := range r.Fields {
		if f.Name == name {
			return f, true
		}
	}
	return domain.FlowField{}, false
}

// mustField returns the resolved field with the given name. Fails the
// test loudly when the field is absent so a missing entry can't silently
// pass single-property assertions on a zero FlowField.
func mustField(t *testing.T, r domain.FlowResolvedFields, name string) domain.FlowField {
	t.Helper()
	f, ok := findField(r, name)
	if !ok {
		t.Fatalf("resolved fields missing %q", name)
	}
	return f
}

func mustUnmarshal[T any](t *testing.T, content string) *T {
	value := new(T)
	err := json.Unmarshal([]byte(content), value)
	require.NoError(t, err)
	return value
}

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

const defaultSchemaContent string = `{
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
	}`

func newDefaultResolver(t *testing.T) *domain.SchemaFieldResolver {
	t.Helper()
	return domain.NewSchemaFieldResolver(newFakeResolver(t, map[string][]byte{
		defaultSchemaURL: []byte(defaultSchemaContent),
	}))
}

func TestSchemaFieldResolver_Resolve_DefaultFields(t *testing.T) {
	t.Parallel()
	mock := gomock.NewController(t)
	schemaResolver := domainmock.NewMockSchemaResolver(mock)
	schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil)

	resolver := domain.NewSchemaFieldResolver(schemaResolver)

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL, "identifier",
		[]string{"email", "username", "password", "given_name", "family_name"})
	require.NoError(t, err)

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
		t.Run(tc.name, func(t *testing.T) {
			f, ok := findField(got, tc.name)
			require.True(t, ok, "Resolve missing field %q", tc.name)
			assert.Equal(t, tc.wantType, f.Type)
			assert.Equal(t, tc.wantTextKey, f.TextKey)
			assert.True(t, f.Required)
		})
	}
}

func TestSchemaFieldResolver_Resolve_IdentifierImpliesUserNotFound(t *testing.T) {
	t.Parallel()
	mock := gomock.NewController(t)
	schemaResolver := domainmock.NewMockSchemaResolver(mock)
	schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil)

	resolver := domain.NewSchemaFieldResolver(schemaResolver)

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL, "step", []string{"email", "password"})
	require.NoError(t, err)

	if !slices.Contains(got.ImplicitOutcomes["email"], domain.FlowImplicitOutcomeUserNotFound) {
		t.Errorf("Resolve email ImplicitOutcomes = %v, want user_not_found", got.ImplicitOutcomes["email"])
	}
	if mustField(t, got, "email").Challenge != domain.FlowFieldChallengeIdentifier {
		t.Errorf("Resolve email Challenge = %q, want %q", mustField(t, got, "email").Challenge, domain.FlowFieldChallengeIdentifier)
	}
	if len(got.ImplicitOutcomes["password"]) != 0 {
		t.Errorf("Resolve password ImplicitOutcomes = %v, want empty", got.ImplicitOutcomes["password"])
	}
	if mustField(t, got, "password").Challenge == domain.FlowFieldChallengeIdentifier {
		t.Error("Resolve password Challenge = identifier, want non-identifier")
	}
}

func TestSchemaFieldResolver_Resolve_ChallengeSurfaces(t *testing.T) {
	t.Parallel()
	mock := gomock.NewController(t)
	schemaResolver := domainmock.NewMockSchemaResolver(mock)
	schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil)

	resolver := domain.NewSchemaFieldResolver(schemaResolver)

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL, "step", []string{"email", "password", "given_name"})
	require.NoError(t, err)

	if mustField(t, got, "email").Challenge != domain.FlowFieldChallengeIdentifier {
		t.Errorf("Resolve email Challenge = %q, want %q", mustField(t, got, "email").Challenge, domain.FlowFieldChallengeIdentifier)
	}
	if mustField(t, got, "password").Challenge != domain.FlowFieldChallengePassword {
		t.Errorf("Resolve password Challenge = %q, want %q", mustField(t, got, "password").Challenge, domain.FlowFieldChallengePassword)
	}
	if mustField(t, got, "given_name").Challenge != domain.FlowFieldChallengeNone {
		t.Errorf("Resolve given_name Challenge = %q, want %q", mustField(t, got, "given_name").Challenge, domain.FlowFieldChallengeNone)
	}
}

func TestSchemaFieldResolver_Resolve_PasswordChallengeRequiresAuthMethodEnabled(t *testing.T) {
	t.Parallel()
	const url = "https://example.test/no-auth-methods.json"
	schemaContent := `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"properties": {
			"password": { "type": "string", "minLength": 8, "x-password": true }
		}
	}`
	mock := gomock.NewController(t)
	schemaResolver := domainmock.NewMockSchemaResolver(mock)
	schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), url, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, schemaContent), nil)

	resolver := domain.NewSchemaFieldResolver(schemaResolver)

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, url, "step", []string{"password"})
	require.NoError(t, err)
	if mustField(t, got, "password").Challenge != domain.FlowFieldChallengeNone {
		t.Errorf("Resolve password Challenge = %q, want None (auth-methods absent)", mustField(t, got, "password").Challenge)
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
	require.NoError(t, err)

	if mustField(t, got, "password").Challenge != domain.FlowFieldChallengeNone {
		t.Errorf("Resolve password Challenge = %q, want None (x-password absent on property)", mustField(t, got, "password").Challenge)
	}
	if mustField(t, got, "password").Type != domain.FlowFieldTypeText {
		t.Errorf("Resolve password Type = %q, want text (no x-password annotation)", mustField(t, got, "password").Type)
	}
}

func TestSchemaFieldResolver_Resolve_RenamedPasswordField(t *testing.T) {
	t.Parallel()
	const url = "https://example.test/renamed-password.json"
	schemaContent := `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true } },
		"properties": {
			"secret": { "type": "string", "minLength": 8, "x-password": true }
		}
	}`
	mock := gomock.NewController(t)
	schemaResolver := domainmock.NewMockSchemaResolver(mock)
	schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), url, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, schemaContent), nil)

	resolver := domain.NewSchemaFieldResolver(schemaResolver)

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, url, "step", []string{"secret"})
	require.NoError(t, err)

	if mustField(t, got, "secret").Challenge != domain.FlowFieldChallengePassword {
		t.Errorf("Resolve secret Challenge = %q, want %q", mustField(t, got, "secret").Challenge, domain.FlowFieldChallengePassword)
	}
	if mustField(t, got, "secret").Type != domain.FlowFieldTypePassword {
		t.Errorf("Resolve secret Type = %q, want %q", mustField(t, got, "secret").Type, domain.FlowFieldTypePassword)
	}
}

func TestSchemaFieldResolver_Resolve_UniqueScopeSurfaces(t *testing.T) {
	t.Parallel()
	mock := gomock.NewController(t)
	schemaResolver := domainmock.NewMockSchemaResolver(mock)
	schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil)

	resolver := domain.NewSchemaFieldResolver(schemaResolver)

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL, "step", []string{"email", "password"})
	require.NoError(t, err)

	if mustField(t, got, "email").Unique != domain.AttributeUniquenessTeam {
		t.Errorf("Resolve email Unique = %v, want %v", mustField(t, got, "email").Unique, domain.AttributeUniquenessTeam)
	}
	if mustField(t, got, "password").Unique != domain.AttributeUniquenessUnspecified {
		t.Errorf("Resolve password Unique = %v, want %v", mustField(t, got, "password").Unique, domain.AttributeUniquenessUnspecified)
	}
}

func TestSchemaFieldResolver_Resolve_UniqueScopeProject(t *testing.T) {
	t.Parallel()
	const url = "https://example.test/project-unique.json"
	schemaContent := `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"properties": {
			"handle": { "type": "string", "x-unique": "project" }
		}
	}`
	mock := gomock.NewController(t)
	schemaResolver := domainmock.NewMockSchemaResolver(mock)
	schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), url, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, schemaContent), nil)

	resolver := domain.NewSchemaFieldResolver(schemaResolver)

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, url, "step", []string{"handle"})
	require.NoError(t, err)

	if mustField(t, got, "handle").Unique != domain.AttributeUniquenessProject {
		t.Errorf("Resolve handle Unique = %v, want %v", mustField(t, got, "handle").Unique, domain.AttributeUniquenessProject)
	}
}

func TestSchemaFieldResolver_Resolve_UnknownField(t *testing.T) {
	t.Parallel()
	mock := gomock.NewController(t)
	schemaResolver := domainmock.NewMockSchemaResolver(mock)
	schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil)

	resolver := domain.NewSchemaFieldResolver(schemaResolver)

	_, err := resolver.Resolve(t.Context(), nil, testProjectID, defaultSchemaURL, "step", []string{"not_in_schema"})
	if !errors.Is(err, domain.ErrFlowFieldUnknown) {
		t.Fatalf("Resolve err = %v, want ErrFlowFieldUnknown", err)
	}
}

func TestSchemaFieldResolver_Resolve_SchemaLoadFailurePropagates(t *testing.T) {
	t.Parallel()
	const url = "https://example.test/missing.json"
	mock := gomock.NewController(t)
	schemaResolver := domainmock.NewMockSchemaResolver(mock)
	schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), url, gomock.Any()).
		Return(nil, errors.New("FAILURE"))

	resolver := domain.NewSchemaFieldResolver(schemaResolver)

	_, err := resolver.Resolve(t.Context(), nil, testProjectID, url, "step", []string{"email"})
	assert.Error(t, err)
}

func TestSchemaFieldResolver_Resolve_FormatAndTypeVariants(t *testing.T) {
	t.Parallel()
	const url = "https://example.test/variants.json"
	schemaContent := `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"properties": {
			"website":    { "type": "string", "format": "uri" },
			"birthday":   { "type": "string", "format": "date" },
			"created":    { "type": "string", "format": "date-time" },
			"nickname":   { "type": "string" },
			"gender":     { "type": "string", "enum": ["female", "male", "non_binary"] },
			"newsletter": { "type": "boolean" },
			"opt_in":     { "type": ["null", "boolean"] },
			"opt_in_rev": { "type": ["boolean", "null"] }
		}
	}`
	mock := gomock.NewController(t)
	schemaResolver := domainmock.NewMockSchemaResolver(mock)
	schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), url, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, schemaContent), nil)

	resolver := domain.NewSchemaFieldResolver(schemaResolver)

	got, err := resolver.Resolve(t.Context(), nil, testProjectID, url, "step",
		[]string{"website", "birthday", "created", "nickname", "gender", "newsletter", "opt_in", "opt_in_rev"})
	require.NoError(t, err)

	wantTypes := map[string]domain.FlowFieldType{
		"website":    domain.FlowFieldTypeURL,
		"birthday":   domain.FlowFieldTypeDate,
		"created":    domain.FlowFieldTypeDate,
		"nickname":   domain.FlowFieldTypeText,
		"gender":     domain.FlowFieldTypeSelect,
		"newsletter": domain.FlowFieldTypeCheckbox,
		"opt_in":     domain.FlowFieldTypeCheckbox,
		"opt_in_rev": domain.FlowFieldTypeCheckbox,
	}
	for name, want := range wantTypes {
		if mustField(t, got, name).Type != want {
			t.Errorf("Resolve field %q Type = %q, want %q", name, mustField(t, got, name).Type, want)
		}
	}
	if mustField(t, got, "nickname").Validation != nil {
		t.Errorf("Resolve nickname Validation = %+v, want nil (no rules)", mustField(t, got, "nickname").Validation)
	}
	if v := mustField(t, got, "gender").Validation; v == nil {
		t.Errorf("Resolve gender Validation = nil, want enum rule")
	} else if !slices.Equal(v.Enum, []string{"female", "male", "non_binary"}) {
		t.Errorf("Resolve gender Validation.Enum = %v, want [female male non_binary]", v.Enum)
	}
	if mustField(t, got, "newsletter").Validation != nil {
		t.Errorf("Resolve newsletter Validation = %+v, want nil (no rules)", mustField(t, got, "newsletter").Validation)
	}
}

func TestSchemaFieldResolver_Resolve_AmbiguousJSONTypeRejected(t *testing.T) {
	t.Parallel()
	const url = "https://example.test/ambiguous-type.json"
	schemaContent := `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"properties": {
			"either": { "type": ["string", "boolean"] }
		}
	}`
	mock := gomock.NewController(t)
	schemaResolver := domainmock.NewMockSchemaResolver(mock)
	schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), url, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, schemaContent), nil)

	resolver := domain.NewSchemaFieldResolver(schemaResolver)

	_, err := resolver.Resolve(t.Context(), nil, testProjectID, url, "step", []string{"either"})
	if !errors.Is(err, domain.ErrFlowFieldUnsupportedType) {
		t.Fatalf("Resolve err = %v, want %v", err, domain.ErrFlowFieldUnsupportedType)
	}
}
