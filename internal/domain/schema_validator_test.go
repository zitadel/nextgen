package domain_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

const testBuiltinBase = "https://example.test/schemas"

func newTestValidator(t *testing.T) *domain.TenantSchemaValidator {
	t.Helper()
	v, err := domain.NewTenantSchemaValidator(testBuiltinBase)
	require.NoError(t, err)
	return v
}

func TestNewTenantSchemaValidator(t *testing.T) {
	t.Run("succeeds with valid base", func(t *testing.T) {
		v, err := domain.NewTenantSchemaValidator(testBuiltinBase)
		require.NoError(t, err)
		require.NotNil(t, v)
	})

	t.Run("fails with empty base", func(t *testing.T) {
		_, err := domain.NewTenantSchemaValidator("")
		require.Error(t, err)
	})
	t.Run("fails with relative base", func(t *testing.T) {
		_, err := domain.NewTenantSchemaValidator("schemas/meta")
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInvalidBuiltinPublicBase)
	})
	t.Run("fails with no-host URL", func(t *testing.T) {
		_, err := domain.NewTenantSchemaValidator("file:///local/path")
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInvalidBuiltinPublicBase)
	})
	t.Run("trailing slash is normalized", func(t *testing.T) {
		v, err := domain.NewTenantSchemaValidator("https://example.test/schemas/")
		require.NoError(t, err)
		require.NotNil(t, v)
	})
}

func TestTenantSchemaValidator_ValidateAgainstMetaSchema(t *testing.T) {
	v := newTestValidator(t)

	tests := []struct {
		name    string
		input   []byte
		wantErr error
	}{
		{
			name: "valid user schema",
			input: []byte(`{
				"$schema": "https://json-schema.org/draft/2020-12/schema",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"password": { "enabled": true, "position": 0 }
				}
			}`),
		},
		{
			name: "valid user schema with optional properties",
			input: []byte(`{
				"$schema": "https://json-schema.org/draft/2020-12/schema",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"description": "A user schema",
				"x-auth-methods": {
					"passkey": { "enabled": true, "position": 1 }
				},
				"required": ["email"],
				"properties": {
					"email": { "type": "string", "title": "Email" }
				}
			}`),
		},
		{
			name: "valid with nested property",
			input: []byte(`{
				"$schema": "https://json-schema.org/draft/2020-12/schema",
				"$id": "https://example.test/schemas/my-user.json",
				"kind":    "user-schema",
				"title":   "My User",
				"x-auth-methods": {
					"password": { "enabled": true, "position": 0 }
				},
				"properties": {
					"address": {
						"type": "object",
						"title": "Address",
						"properties": {
							"street": { "title": "Street", "type": "string" }
						}
					}
				}
			}`),
		},
		{
			name: "missing $schema",
			input: []byte(`{
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"password": { "enabled": true, "position": 0 }
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
		},
		{
			name: "missing $id",
			input: []byte(`{
				"$schema": "https://json-schema.org/draft/2020-12/schema",
				"kind":    "user-schema",
				"title":   "My User",
				"x-auth-methods": {
					"password": { "enabled": true, "position": 0 }
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
		},
		{
			name:    "missing kind",
			input:   []byte(`{"title": "No Kind"}`),
			wantErr: domain.ErrMissingSchemaKind,
		},
		{
			name:    "unknown kind",
			input:   []byte(`{"kind": "unknown-schema", "title": "Unknown"}`),
			wantErr: domain.ErrUnknownSchemaKind,
		},
		{
			name: "missing required title",
			input: []byte(`{
				"$schema": "https://json-schema.org/draft/2020-12/schema",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"x-auth-methods": {
					"password": { "enabled": true, "position": 0 }
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
		},
		{
			name: "missing required x-auth-methods",
			input: []byte(`{
				"$schema": "https://json-schema.org/draft/2020-12/schema",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User"
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
		},
		{
			name: "title exceeds maxLength",
			input: []byte(`{
				"$schema": "https://json-schema.org/draft/2020-12/schema",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "` + strings.Repeat("aaa", 300) + `",
				"x-auth-methods": {
					"password": { "enabled": true, "position": 0 }
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
		},
		{
			name: "invalid auth method — missing position",
			input: []byte(`{
				"$schema": "https://json-schema.org/draft/2020-12/schema",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"password": { "enabled": true }
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
		},
		{
			name: "invalid auth method — missing enabled",
			input: []byte(`{
				"$schema": "https://json-schema.org/draft/2020-12/schema",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"password": { "position": 0 }
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
		},
		{
			name: "invalid property — missing type",
			input: []byte(`{
				"$schema": "https://json-schema.org/draft/2020-12/schema",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"password": { "enabled": true, "position": 0 }
				},
				"properties": {
					"email": { "title": "Email" }
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
		},
		{
			name: "invalid property — missing title",
			input: []byte(`{
				"$schema": "https://json-schema.org/draft/2020-12/schema",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"password": { "enabled": true, "position": 0 }
				},
				"properties": {
					"email": { "type": "string" }
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
		},
		{
			name: "invalid property — type not one of allowed",
			input: []byte(`{
				"$schema": "https://json-schema.org/draft/2020-12/schema",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"password": { "enabled": true, "position": 0 }
				},
				"properties": {
					"email": { "type": "random", "title": "Email" }
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
		},
		{
			name: "unknown auth method key rejected",
			input: []byte(`{
				"$schema": "https://json-schema.org/draft/2020-12/schema",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"totp": { "enabled": true, "position": 0 }
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
		},
		{
			name:    "invalid JSON",
			input:   []byte(`{invalid`),
			wantErr: domain.ErrSchemaParseFailed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := v.ValidateAgainstMetaSchema(tt.input)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}
